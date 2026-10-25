/**
 * @fileoverview P2P Turn-Based & Simultaneous Game Engine.
 * Utilizes PeerJS for WebRTC mesh/star networking. 
 * This file handles all peer connections, state synchronization, 
 * phase transitions, and chat routing. It is designed to be completely game-agnostic.
 * 
 * NOTE FOR DEVELOPERS:
 * Do not modify this file to add game logic. Instead, inject your game modules 
 * via the `window.Games` global object using the provided template.
 */

window.Games = window.Games || {};

/**
 * Core Engine State.
 * Maintains the current authoritative game state and networking variables.
 * @namespace
 */
const Engine = {
  peer: null,
  isHost: false,
  hostConnection: null,
  connections: new Map(),
  roomId: "",
  pendingJoinCode: null,
  currentGame: "",
  activeModule: null,
  settings: {}, 
  phase: "LOBBY", // LOBBY, PRE_GAME, PLAYING, SIMULTANEOUS, ROUND_END, GAME_END
  round: 0,
  maxRounds: 1,
  turnQueue: [],
  currentTurnIndex: -1,
  turnDirection: 1,
  turnTimer: null,
  pendingActions: new Set(),
  submittedActions: {},
  ticker: null,
  myId: "",
  profile: { name: "Anon", avatar: "👽" },
  players: new Map(),
  
  // Custom RNG for Synchronized Randomness across peers
  Math: {
    _seed: 0,
    /**
     * Seeds the Pseudo-Random Number Generator.
     * @param {number} seed 
     */
    seedRNG: function(seed) { 
      this._seed = seed; 
    },
    /**
     * Mulberry32 PRNG. Generates the exact same sequence of pseudo-random 
     * numbers on all clients based on the shared room seed.
     * @returns {number} Float between 0 and 1.
     */
    random: function() {
      let t = this._seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  },

  // Authoritative Key-Value Store for Game State
  State: {
    _data: {},
    /**
     * Retrieves a synchronized state variable.
     * @param {string} key 
     */
    get: function(key) { 
      return this._data[key]; 
    },
    /**
     * Updates a state variable and broadcasts to all clients. (Host Only)
     * @param {string} key 
     * @param {any} value 
     */
    set: function(key, value) {
      if (!Engine.isHost) {
        console.warn("Engine.State.set() can only be called by the Host.");
        return;
      }
      this._data[key] = value;
      networkSend({ type: 'STATE_SYNC', key: key, value: value });
      
      if (Engine.activeModule && Engine.activeModule.onStateChange) {
        Engine.activeModule.onStateChange(key, value);
      }
    },
    clear: function() { 
      this._data = {}; 
    }
  }
};

/**
 * Global mute state persisting via localStorage.
 * @type {boolean}
 */
let isMuted = localStorage.getItem('p2p_muted') === 'true';

/**
 * Standardized UI sound effects utilizing the Web Audio API.
 */
const sounds = {
  join: () => playTone(440, 'square', 0.1, () => playTone(660, 'square', 0.2)),
  leave: () => playTone(660, 'square', 0.1, () => playTone(440, 'square', 0.2)),
  ready: () => playTone(880, 'sine', 0.1),
  turn: () => playTone(523, 'square', 0.15),
  chat: () => playTone(800, 'sine', 0.05, 0.02)
};

/**
 * Application Entry Point.
 * Processes URL deep-linking, handles Session Recovery for page refreshes,
 * and auto-discovers game modules.
 */
window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomCode = urlParams.get('room');
  
  if (urlRoomCode) {
    Engine.pendingJoinCode = urlRoomCode.toUpperCase().trim();
  }

  const hasProfile = loadProfile();
  
  // SESSION RECOVERY CHECK
  const recoveryData = JSON.parse(sessionStorage.getItem('p2p_recovery'));
  
  if (recoveryData && (!Engine.pendingJoinCode || Engine.pendingJoinCode === recoveryData.room)) {
    showToast("Recovering session...", "info");
    if (recoveryData.role === 'HOST') {
      startHosting(recoveryData.room);
    } else {
      joinGame(recoveryData.room, recoveryData.id);
    }
  } else {
    // Normal routing
    if (hasProfile) {
      if (Engine.pendingJoinCode) {
        document.getElementById('join-code').value = Engine.pendingJoinCode;
        joinGame(); 
      } else {
        switchPanel('menu-ui');
      }
    } else {
      switchPanel('profile-ui');
    }
  }

  buildGameDropdown();
  
  const muteBtn = document.getElementById('audio-toggle-btn');
  if (muteBtn) muteBtn.innerText = isMuted ? '🔇' : '🔊';
  
  // Keep connections alive to prevent timeout disconnects
  setInterval(() => {
    checkHeartbeats();
    sendHeartbeat();
  }, 5000);
};

// ============================================================================
// VISUAL POLISH: TOASTS, JUICE & OVERLAYS
// ============================================================================

/**
 * Spawns a non-blocking toast notification.
 * @param {string} message 
 * @param {string} type 'info', 'success', or 'error'
 * @param {number} duration Milliseconds
 */
window.showToast = function(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('fadeOut');
    setTimeout(() => toast.remove(), 300); 
  }, duration);
};

/**
 * Spawns full-screen falling confetti.
 */
window.spawnConfetti = function() {
  const container = document.getElementById('confetti-container');
  if (!container) return;
  const colors = ['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6'];
  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti-piece';
    confetti.style.left = Math.random() * 100 + 'vw';
    confetti.style.top = -20 + 'px';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    const duration = Math.random() * 2 + 2; 
    confetti.style.animationDuration = duration + 's';
    confetti.style.animationDelay = (Math.random() * 0.5) + 's';
    container.appendChild(confetti);
    setTimeout(() => confetti.remove(), (duration + 0.5) * 1000);
  }
};

/**
 * Displays the end-of-match modal with options to Rematch or leave.
 */
window.showGameOverOverlay = function() {
  const overlay = document.getElementById('game-over-overlay');
  const controls = document.getElementById('game-over-controls');
  if (!overlay || !controls) return;
  
  if (Engine.isHost) {
    controls.innerHTML = `
      <button class="btn" onclick="resetToLobby()">Back to Lobby</button>
      <button class="btn primary-btn pulse" onclick="hostRematch()">Rematch</button>
    `;
  } else {
    controls.innerHTML = `<p style="color: var(--text-muted); font-size: 16px;">Waiting for host to choose...</p>`;
  }
  overlay.classList.add('active');
};

/** Hides the game over overlay */
window.hideGameOverOverlay = function() {
  const overlay = document.getElementById('game-over-overlay');
  if (overlay) overlay.classList.remove('active');
};

/** Triggers a rematch without leaving the room */
window.hostRematch = function() {
  if (!Engine.isHost) return;
  window.hideGameOverOverlay();
  hostStartGame(); 
};

// ============================================================================
// LOBBY & INITIALIZATION
// ============================================================================

function updateProfilePreview() {
  const nameEl = document.getElementById('preview-name');
  const avatarEl = document.getElementById('preview-avatar');
  if (nameEl) nameEl.innerText = Engine.profile.name;
  if (avatarEl) avatarEl.innerText = Engine.profile.avatar;
}

function loadProfile() {
  const savedName = localStorage.getItem('p2p_name');
  Engine.profile.name = savedName || "";
  Engine.profile.avatar = localStorage.getItem('p2p_avatar') || "👽";
  document.getElementById('player-name').value = Engine.profile.name;
  selectAvatar(Engine.profile.avatar);
  updateProfilePreview();
  return !!savedName;
}

/**
 * Initializes a new WebRTC room as the Host.
 */
function startHosting(existingCode = null) {
  initAudio();
  Engine.isHost = true;
  Engine.currentGame = document.getElementById('game-select').value || Engine.currentGame;
  Engine.roomId = existingCode || Math.random().toString(36).substring(2, 7).toUpperCase();
  
  const newUrl = `${window.location.origin}${window.location.pathname}?room=${Engine.roomId}`;
  window.history.pushState({ path: newUrl }, '', newUrl);
  
  switchPanel('lobby-ui');
  document.getElementById('role-title').innerText = "Host Lobby";
  document.getElementById('host-controls').style.display = "block";
  document.getElementById('room-code-display').innerText = Engine.roomId;
  
  Engine.peer = new Peer('my-game-' + Engine.roomId);
  
  Engine.peer.on('open', (id) => {
    Engine.myId = id;
    sessionStorage.setItem('p2p_recovery', JSON.stringify({ role: 'HOST', room: Engine.roomId }));
    if (!existingCode) addPlayer(id, Engine.profile.name, Engine.profile.avatar, true);
  });
  
  Engine.peer.on('connection', (conn) => {
    Engine.connections.set(conn.peer, conn);
    conn.on('open', () => {
      conn.send({ type: 'SYNC_STATE', state: getSyncState() });
    });
    conn.on('data', (data) => routeData(data, conn.peer));
    conn.on('close', () => handlePlayerDisconnect(conn.peer));
  });
}

/**
 * Connects to an existing WebRTC room.
 */
function joinGame(existingCode = null, existingPeerId = null) {
  initAudio();
  saveUserData();
  const code = existingCode || document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 5) return;
  
  const newUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
  window.history.pushState({ path: newUrl }, '', newUrl);
  Engine.pendingJoinCode = null; 
  
  switchPanel('lobby-ui');
  document.getElementById('role-title').innerText = "Joining...";
  document.getElementById('host-controls').style.display = "none";
  document.getElementById('client-controls').style.display = "block";
  
  Engine.peer = existingPeerId ? new Peer(existingPeerId) : new Peer();
  
  Engine.peer.on('open', (id) => {
    Engine.myId = id;
    Engine.hostConnection = Engine.peer.connect('my-game-' + code);
    sessionStorage.setItem('p2p_recovery', JSON.stringify({ role: 'CLIENT', room: code, id: id }));
    
    Engine.hostConnection.on('open', () => {
      document.getElementById('role-title').innerText = "Joined Lobby";
      networkSend({ type: 'REQ_JOIN', name: Engine.profile.name, avatar: Engine.profile.avatar });
    });
    Engine.hostConnection.on('data', (data) => routeData(data, 'HOST'));
    Engine.hostConnection.on('close', () => {
      showToast("Connection to host lost.", "error");
      resetToMainMenu();
    });
  });
}

// ============================================================================
// NETWORKING & ROUTING PIPELINE
// ============================================================================

/**
 * Dispatches a payload over the P2P network.
 */
function networkSend(payload, targetId = null, excludeId = null) {
  if (Engine.isHost) {
    if (targetId) {
      if (targetId === Engine.myId) handleClientRouting(payload);
      else {
        const conn = Engine.connections.get(targetId);
        if (conn && conn.open) conn.send(payload);
      }
    } else {
      Engine.connections.forEach((conn, id) => {
        if (conn.open && id !== excludeId) conn.send(payload);
      });
    }
  } else {
    if (Engine.hostConnection && Engine.hostConnection.open) {
      Engine.hostConnection.send(payload);
    }
  }
}

/**
 * Core entry point for all received PeerJS data.
 */
function routeData(data, senderId) {
  if (Engine.players.has(senderId)) Engine.players.get(senderId).lastSeen = Date.now();
  if (Engine.isHost) handleHostRouting(data, senderId);
  else handleClientRouting(data);
}

/**
 * Authoritative Host Routing. Evaluates all client packets.
 */
function handleHostRouting(data, senderId) {
  switch (data.type) {
    case 'REQ_JOIN':
      const activeGame = window.Games[Engine.currentGame];
      const maxPlayers = (activeGame && activeGame.maxPlayers) ? activeGame.maxPlayers : 99;
      const existingPlayer = Engine.players.get(senderId);
      
      if (existingPlayer) {
        // Handle reconnecting ghost players
        if (existingPlayer.disconnectTimeout) {
          clearTimeout(existingPlayer.disconnectTimeout);
          existingPlayer.disconnectTimeout = null;
        }
        existingPlayer.connected = true;
        existingPlayer.name = data.name;
        existingPlayer.avatar = data.avatar;
        
        showToast(`${data.name} reconnected!`, "success");
        syncState(); 
        networkSend({ type: 'SYNC_STATE', state: getSyncState() }, senderId);
        
        if (Engine.phase !== 'LOBBY') {
          networkSend({ type: 'PHASE_CHANGE', phase: 'PRE_GAME', settings: Engine.settings, turnQueue: Engine.turnQueue }, senderId);
          setTimeout(() => { networkSend({ type: 'PHASE_CHANGE', phase: Engine.phase, round: Engine.round }, senderId); }, 150);
        }
        return;
      }
      
      // Enforce max player limits
      if (Engine.players.size >= maxPlayers) {
        networkSend({ type: 'JOIN_REJECTED', reason: 'Room is full' }, senderId);
        return;
      }
      
      // Late joiners are routed as spectators
      const isLateJoin = Engine.phase !== 'LOBBY';
      addPlayer(senderId, data.name, data.avatar, false, isLateJoin ? 'SPECTATOR' : 'PLAYER');
      
      if (isLateJoin) {
        networkSend({ type: 'SYNC_STATE', state: getSyncState() }, senderId);
        networkSend({ type: 'PHASE_CHANGE', phase: 'PRE_GAME', settings: Engine.settings, turnQueue: Engine.turnQueue }, senderId);
        setTimeout(() => { networkSend({ type: 'PHASE_CHANGE', phase: Engine.phase, round: Engine.round }, senderId); }, 150);
      }
      
      if (Engine.phase !== 'LOBBY' && Engine.activeModule && Engine.activeModule.onPlayerSync) {
        Engine.activeModule.onPlayerSync(senderId);
      }
      break;
      
    case 'TOGGLE_READY':
      const p = Engine.players.get(senderId);
      if (p) { p.isReady = !p.isReady; syncState(); checkAllReady(); }
      break;
      
    case 'CHAT':
      if (Engine.activeModule && Engine.activeModule.onHostChat) {
        // Module can swallow chat messages (like correct guesses)
        if (Engine.activeModule.onHostChat(data.text, senderId)) return;
      }
      networkSend(data, null, senderId);
      renderChatMessage(data.avatar, data.name, data.text, "other");
      sounds.chat();
      break;
      
    case 'GAME_ACTION':
      if (data.action.type === 'YIELD_TURN') {
        if (senderId === Engine.turnQueue[Engine.currentTurnIndex]) advanceTurn(1);
      } else if (Engine.activeModule && Engine.activeModule.onAction) {
        Engine.activeModule.onAction(data.action, senderId);
      }
      break;
      
    case 'SUBMIT_ACTION':
      handleActionSubmission(senderId, data.action);
      break;
      
    case 'INPUT_STREAM':
      if (Engine.activeModule && Engine.activeModule.onInput) Engine.activeModule.onInput(data.input, senderId);
      break;
  }
}

/**
 * Client Routing. Accepts state transitions mandated by the Host.
 */
function handleClientRouting(data) {
  switch (data.type) {
    case 'SYNC_STATE':
      applySyncState(data.state);
      break;
    case 'PHASE_CHANGE':
      if (data.seed !== undefined) Engine.Math.seedRNG(data.seed);
      Engine.phase = data.phase;
      handlePhaseTransition(data);
      break;
    case 'STATE_SYNC':
      Engine.State._data[data.key] = data.value;
      if (Engine.activeModule && Engine.activeModule.onStateChange) {
        Engine.activeModule.onStateChange(data.key, data.value);
      }
      break;
    case 'TURN_CHANGE':
      Engine.currentTurnIndex = data.turnIndex;
      Engine.turnDirection = data.direction || 1;
      handleTurnTransition(data.activePlayerId);
      break;
    case 'ENGINE_VAR_SYNC':
      Engine[data.key] = data.value;
      break;
    case 'CHAT':
      renderChatMessage(data.avatar, data.name, data.text, "other");
      sounds.chat();
      break;
    case 'GAME_ACTION':
      if (Engine.activeModule && Engine.activeModule.onAction) Engine.activeModule.onAction(data.action, data.senderId);
      break;
    case 'ACTION_LOCKED':
      if (Engine.activeModule && Engine.activeModule.onPlayerLocked) Engine.activeModule.onPlayerLocked(data.senderId);
      break;
    case 'JOIN_REJECTED':
    case 'KICKED':
      showToast(data.reason || "You have been disconnected from the room.", "error");
      resetToMainMenu();
      break;
  }
}

// ============================================================================
// SIMULTANEOUS ACTION ENGINE
// ============================================================================

window.StartSimultaneousPhase = function(participantsArray) {
  if (!Engine.isHost) return;
  Engine.phase = 'SIMULTANEOUS';
  Engine.pendingActions = new Set(participantsArray);
  Engine.submittedActions = {};
  networkSend({ type: 'PHASE_CHANGE', phase: 'SIMULTANEOUS' });
};

window.SubmitAction = function(actionData) {
  if (Engine.isHost) {
    handleActionSubmission(Engine.myId, actionData);
  } else {
    networkSend({ type: 'SUBMIT_ACTION', action: actionData });
  }
};

function handleActionSubmission(senderId, actionData) {
  if (!Engine.isHost || Engine.phase !== 'SIMULTANEOUS') return;
  if (!Engine.pendingActions.has(senderId)) return;

  Engine.pendingActions.delete(senderId);
  Engine.submittedActions[senderId] = actionData;
  networkSend({ type: 'ACTION_LOCKED', senderId: senderId });

  if (Engine.pendingActions.size === 0) {
    Engine.phase = 'PLAYING'; 
    networkSend({ type: 'PHASE_CHANGE', phase: 'PLAYING' });
    if (Engine.activeModule && Engine.activeModule.onSimultaneousResolve) {
      Engine.activeModule.onSimultaneousResolve(Engine.submittedActions);
    }
  }
}

// ============================================================================
// REAL-TIME TICKER ENGINE
// ============================================================================

window.StartTicker = function(fps = 30) {
  if (!Engine.isHost) return;
  if (Engine.ticker) clearInterval(Engine.ticker);
  
  Engine.ticker = setInterval(() => {
    if (Engine.activeModule && Engine.activeModule.onTick) {
      Engine.activeModule.onTick();
    }
  }, 1000 / fps);
};

window.StopTicker = function() {
  if (!Engine.isHost) return;
  if (Engine.ticker) clearInterval(Engine.ticker);
  Engine.ticker = null;
};

window.SendInput = function(inputData) {
  if (Engine.isHost) {
    if (Engine.activeModule && Engine.activeModule.onInput) Engine.activeModule.onInput(inputData, Engine.myId);
  } else {
    networkSend({ type: 'INPUT_STREAM', input: inputData });
  }
};

// ============================================================================
// STATE & PHASE MANAGEMENT
// ============================================================================

window.TriggerPhaseChange = function(newPhase, extraData = {}) {
  if (!Engine.isHost) return;
  Engine.phase = newPhase;
  const payload = { type: 'PHASE_CHANGE', phase: newPhase, round: Engine.round, ...extraData };
  networkSend(payload);
  handlePhaseTransition(payload);
};

function addPlayer(id, name, avatar, isHost, role = 'PLAYER', isBot = false) {
  Engine.players.set(id, {
    id, name, avatar, isHost,
    score: 0, isReady: isHost || isBot, role: role,
    connected: true, isBot: isBot,
    lastSeen: Date.now()
  });
  sounds.join();
  if (Engine.isHost) syncState();
}

/**
 * Developer Tool: Instantly spawns an AI Bot into the lobby.
 */
window.AddBot = function() {
  if (!Engine.isHost) return;
  const botNum = Math.floor(Math.random() * 1000);
  const botId = 'bot_' + Math.random().toString(36).substr(2, 9);
  addPlayer(botId, `Bot ${botNum}`, '🤖', false, 'PLAYER', true);
  checkAllReady();
};

function handlePlayerDisconnect(id) {
  Engine.connections.delete(id);
  const p = Engine.players.get(id);
  
  if (p) {
    p.connected = false;
    showToast(`${p.name} disconnected.`, "error");
    syncState();
    p.disconnectTimeout = setTimeout(() => { dropPlayer(id); }, 10000); 
  }
}

function dropPlayer(id) {
  const p = Engine.players.get(id);
  if (!p) return;
  
  Engine.players.delete(id);
  sounds.leave();
  renderSystemMessage(`${p.name} left the match.`);

  if (Engine.isHost) {
    const queueIdx = Engine.turnQueue.indexOf(id);
    const isActiveTurn = (Engine.phase === 'PLAYING' && Engine.turnQueue[Engine.currentTurnIndex] === id);
    
    if (queueIdx !== -1) {
      Engine.turnQueue.splice(queueIdx, 1);
      if (Engine.currentTurnIndex >= queueIdx) Engine.currentTurnIndex--; 
    }
    
    if (Engine.phase === 'SIMULTANEOUS' && Engine.pendingActions.has(id)) {
      handleActionSubmission(id, { type: 'TIMEOUT_OR_DISCONNECT' }); 
    }
    
    if (Engine.activeModule && Engine.activeModule.onPlayerDisconnect) {
      Engine.activeModule.onPlayerDisconnect(id, isActiveTurn);
    }
    
    syncState();
    if (Engine.phase === 'LOBBY') checkAllReady();
    if (isActiveTurn) advanceTurn(1);
  }
}

window.kickPlayer = function(id) {
  if (!Engine.isHost || id === Engine.myId) return;
  networkSend({ type: 'KICKED', reason: "Kicked by Host." }, id);
  setTimeout(() => {
    const conn = Engine.connections.get(id);
    if (conn) conn.close();
    const p = Engine.players.get(id);
    if (p && p.disconnectTimeout) clearTimeout(p.disconnectTimeout);
    dropPlayer(id);
  }, 100);
};

function toggleReady() {
  const me = Engine.players.get(Engine.myId);
  if (!me) return;
  me.isReady = !me.isReady;
  sounds.ready();
  if (Engine.isHost) { syncState(); checkAllReady(); } 
  else { networkSend({ type: 'TOGGLE_READY' }); }
}

function getSyncState() {
  return {
    game: Engine.currentGame,
    phase: Engine.phase,
    round: Engine.round,
    turnDirection: Engine.turnDirection,
    turnQueue: Engine.turnQueue,
    currentTurnIndex: Engine.currentTurnIndex,
    gameState: Engine.State._data, 
    players: Array.from(Engine.players.values())
  };
}

function applySyncState(state) {
  Engine.currentGame = state.game;
  Engine.phase = state.phase;
  Engine.round = state.round;
  
  if (state.turnDirection !== undefined) Engine.turnDirection = state.turnDirection;
  if (state.turnQueue !== undefined) Engine.turnQueue = state.turnQueue;
  if (state.currentTurnIndex !== undefined) Engine.currentTurnIndex = state.currentTurnIndex;
  
  Engine.State._data = state.gameState || {};
  
  Engine.players.clear();
  state.players.forEach(p => Engine.players.set(p.id, p));
  
  const badge = document.getElementById('lobby-game-badge');
  if (badge) {
    const keys = Object.keys(window.Games);
    badge.innerText = keys.length === 1 ? Engine.currentGame : `Module: ${Engine.currentGame}`;
  }
  
  Engine.activeModule = window.Games[Engine.currentGame];
  
  const sel = document.getElementById('game-select');
  if (sel) sel.value = Engine.currentGame;
  
  renderPlayerList();
  updateClientLobbyUI();
}

function syncState() {
  if (!Engine.isHost) return;
  networkSend({ type: 'SYNC_STATE', state: getSyncState() });
  renderPlayerList();
}

function checkAllReady() {
  if (!Engine.isHost || Engine.phase !== 'LOBBY') return;
  const activePlayers = Array.from(Engine.players.values()).filter(p => p.role === 'PLAYER');
  const allReady = activePlayers.length > 0 && activePlayers.every(p => p.isReady);
  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.style.display = allReady ? "block" : "none";
}

function hostStartGame() {
  if (!Engine.isHost) return;
  
  Engine.activeModule = window.Games[Engine.currentGame];
  Engine.settings = Engine.activeModule && Engine.activeModule.getSettings ? Engine.activeModule.getSettings() : {};
  
  Engine.phase = 'PRE_GAME';
  Engine.round = 1;
  Engine.turnDirection = 1;
  
  const gameSeed = Math.floor(Math.random() * 1000000000);
  Engine.Math.seedRNG(gameSeed);
  
  Engine.turnQueue = Array.from(Engine.players.values())
    .filter(p => p.role === 'PLAYER' && p.connected)
    .map(p => p.id);
  
  const payload = {
    type: 'PHASE_CHANGE',
    phase: Engine.phase,
    settings: Engine.settings,
    turnQueue: Engine.turnQueue,
    seed: gameSeed 
  };
  
  networkSend(payload);
  handlePhaseTransition(payload);
  
  Engine.phase = 'PLAYING';
  const playPayload = { type: 'PHASE_CHANGE', phase: 'PLAYING', round: Engine.round };
  networkSend(playPayload);
  handlePhaseTransition(playPayload);
  
  Engine.currentTurnIndex = -1;
  advanceTurn();
}

function handlePhaseTransition(data) {
  switch (data.phase) {
    case 'LOBBY':
      window.hideGameOverOverlay();
      switchPanel('lobby-ui');
      break;

    case 'PRE_GAME':
      window.hideGameOverOverlay();
      switchPanel('game-ui');
      if (Engine.activeModule && Engine.activeModule.initUI) {
        const pInfo = Engine.players.get(Engine.myId);
        const myRole = pInfo ? (pInfo.role === 'SPECTATOR' ? 'Spectator' : pInfo.role) : 'Spectator';
        Engine.activeModule.initUI(myRole, data.settings);
      }
      if (Engine.activeModule && Engine.activeModule.onInit) {
        Engine.activeModule.onInit(data.settings, Array.from(Engine.players.values()), Engine.myId);
      }
      break;
      
    case 'SIMULTANEOUS':
      renderSystemMessage(`Waiting for players to lock in...`);
      break;

    case 'PLAYING':
      if (Engine.activeModule && Engine.activeModule.onRoundStart) {
        Engine.activeModule.onRoundStart(data.round);
      }
      break;
      
    case 'ROUND_END':
      if (Engine.activeModule && Engine.activeModule.onRoundEnd) {
        Engine.activeModule.onRoundEnd(data.results);
      }
      if (Engine.isHost) setTimeout(hostNextRound, 5000);
      break;
      
    case 'GAME_END':
      window.StopTicker();
      if (Engine.activeModule && Engine.activeModule.onGameEnd) {
        Engine.activeModule.onGameEnd(data.results);
      }
      renderSystemMessage(`Match Complete!`);
      window.showGameOverOverlay(); 
      break;
  }
}

function hostNextRound() {
  if (Engine.round >= Engine.maxRounds) {
    window.TriggerPhaseChange('GAME_END', { results: getStandings() });
  } else {
    Engine.round++;
    window.TriggerPhaseChange('PLAYING');
    Engine.currentTurnIndex = -1;
    advanceTurn();
  }
}

function resetToLobby() {
  window.StopTicker();
  window.hideGameOverOverlay();
  Engine.phase = 'LOBBY';
  
  Engine.players.forEach(p => {
    if (!p.isBot) p.isReady = p.isHost;
    p.role = 'PLAYER'; 
  });
  
  Engine.State.clear();
  networkSend({ type: 'PHASE_CHANGE', phase: 'LOBBY' });
  syncState();
  switchPanel('lobby-ui');
}

// ============================================================================
// TURN MANAGEMENT ENGINE
// ============================================================================

function advanceTurn(steps = 1) {
  if (!Engine.isHost || Engine.phase !== 'PLAYING' || Engine.turnQueue.length === 0) return;
  
  Engine.currentTurnIndex += (steps * Engine.turnDirection);
  while (Engine.currentTurnIndex < 0) Engine.currentTurnIndex += Engine.turnQueue.length;
  Engine.currentTurnIndex = Engine.currentTurnIndex % Engine.turnQueue.length;
  
  const activeId = Engine.turnQueue[Engine.currentTurnIndex];
  const payload = { 
    type: 'TURN_CHANGE', 
    turnIndex: Engine.currentTurnIndex, 
    activePlayerId: activeId,
    direction: Engine.turnDirection 
  };
  
  networkSend(payload);
  handleTurnTransition(activeId);
}

function handleTurnTransition(activeId) {
  const isMyTurn = activeId === Engine.myId;
  const p = Engine.players.get(activeId);
  const name = p ? p.name : 'Unknown';
  
  if (isMyTurn) sounds.turn();
  
  if (Engine.activeModule && Engine.activeModule.onTurnChange) {
    Engine.activeModule.onTurnChange(activeId, isMyTurn);
  }
  
  const ind = document.getElementById('turn-indicator');
  if (ind) {
    ind.innerHTML = isMyTurn ? `YOUR TURN` : `${name}'s Turn`;
  }
  
  if (Engine.isHost && p && p.isBot) {
    setTimeout(() => {
      if (Engine.phase === 'PLAYING' && Engine.turnQueue[Engine.currentTurnIndex] === activeId) {
        if (Engine.activeModule && Engine.activeModule.onBotTurn) Engine.activeModule.onBotTurn(activeId);
        else window.YieldTurn();
      }
    }, 1500);
  }
}

window.YieldTurn = function() {
  if (Engine.isHost) advanceTurn(1);
  else networkSend({ type: 'GAME_ACTION', action: { type: 'YIELD_TURN' } });
};

window.SkipTurn = function(steps) {
  if (Engine.isHost) advanceTurn(steps);
};

window.ReverseTurnOrder = function() {
  if (Engine.isHost) {
    Engine.turnDirection *= -1;
    networkSend({ type: 'ENGINE_VAR_SYNC', key: 'turnDirection', value: Engine.turnDirection });
  }
};

window.SetTurnQueue = function(newQueueArray) {
  if (Engine.isHost) {
    Engine.turnQueue = newQueueArray;
    networkSend({ type: 'ENGINE_VAR_SYNC', key: 'turnQueue', value: Engine.turnQueue });
  }
};

// ============================================================================
// UI & UTILS
// ============================================================================

function renderPlayerList() {
  const lobbyList = document.getElementById('player-list');
  const gameList = document.getElementById('in-game-leaderboard');
  
  const html = Array.from(Engine.players.values()).sort((a,b) => b.score - a.score).map((p, index) => {
    const isMe = p.id === Engine.myId;
    let readyStatus = `${p.score} pts`;
    let readyClass = '';
    
    if (Engine.phase === 'LOBBY') {
      readyStatus = p.isReady ? '✅ Ready' : '⏳ Waiting';
      readyClass = p.isReady ? 'guessed' : '';
    } else if (Engine.phase === 'SIMULTANEOUS') {
      const lockedIn = !Engine.pendingActions.has(p.id);
      readyStatus = lockedIn ? '🔒 Locked' : 'Thinking...';
      readyClass = lockedIn ? 'guessed' : '';
    }
    
    if (p.connected === false) {
      readyStatus = '🔌 Disconnected...';
      readyClass = 'disconnected';
    }
    
    const turnClass = Engine.turnQueue[Engine.currentTurnIndex] === p.id && Engine.phase === 'PLAYING' ? 'drawer' : '';
    let kickHtml = (Engine.isHost && !isMe) ? `<button class="btn danger-btn" style="padding: 2px 6px; font-size: 10px; margin-left: auto;" onclick="window.kickPlayer('${p.id}')">Kick</button>` : '';
    const specIcon = (p.role === 'SPECTATOR') ? ' 👀' : '';
    
    return `
      <div class="player-card ${readyClass} ${turnClass}">
        <div class="player-rank">#${index+1}</div>
        <div class="player-avatar">${p.avatar}</div>
        <div class="player-info" style="flex:1; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; flex-direction:column;">
            <span class="player-name">${p.name} ${isMe ? '(You)' : ''} ${p.isHost ? '👑' : ''}${specIcon}</span>
            <span class="player-score">${readyStatus}</span>
          </div>
          ${kickHtml}
        </div>
      </div>
    `;
  }).join('');
  
  if (lobbyList) lobbyList.innerHTML = html;
  if (gameList) gameList.innerHTML = html;
}

function updateClientLobbyUI() {
  const me = Engine.players.get(Engine.myId);
  const clientBox = document.getElementById('client-controls');
  if (!clientBox) return;
  
  if (Engine.phase === 'LOBBY') {
    if (me && me.role === 'SPECTATOR') {
      clientBox.innerHTML = `<div>Waiting for the next round to start to join as a player...</div>`;
    } else {
      clientBox.innerHTML = `<button class="btn ${me && me.isReady ? '' : 'primary-btn'}" onclick="toggleReady()" style="width:100%;">${me && me.isReady ? 'Cancel Ready' : 'Ready Up'}</button>`;
    }
  } else {
    clientBox.innerHTML = `Awaiting host...`;
  }
}

/**
 * Renders a chat message securely.
 * USES textContent TO PREVENT XSS INJECTION VIA PEER NETWORK.
 */
function renderChatMessage(avatar, sender, text, type) {
  const box = document.getElementById('messages');
  if (!box) return;
  
  const div = document.createElement('div');
  div.className = 'msg-line';
  
  if (type === 'system') {
    div.innerHTML = `<span class="msg-system">${avatar} ${sender} ${text}</span>`;
  } else {
    div.innerHTML = `<span class="msg-avatar">${avatar}</span> <span class="msg-name ${type}">${sender}:</span> <span class="msg-content"></span>`;
    // Prevent XSS
    div.querySelector('.msg-content').textContent = text;
  }
  
  box.appendChild(div); 
  box.scrollTop = box.scrollHeight;
}

function renderSystemMessage(text) { renderChatMessage("⚙️", "System", text, "system"); }

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  renderChatMessage(Engine.profile.avatar, Engine.profile.name, text, "me");
  sounds.chat();
  networkSend({ type: 'CHAT', avatar: Engine.profile.avatar, name: Engine.profile.name, text: text });
  input.value = '';
}

let audioCtx;
function initAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) {}
}

function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem('p2p_muted', isMuted);
  const muteBtn = document.getElementById('audio-toggle-btn');
  if (muteBtn) muteBtn.innerText = isMuted ? '🔇' : '🔊';
  if (!isMuted) { initAudio(); sounds.ready(); }
}

function playTone(freq, type, duration, callback = null, vol = 0.1) {
  if (isMuted) return;
  try {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
    if (callback) setTimeout(callback, duration * 1000);
  } catch(e) {}
}

function checkHeartbeats() {
  if (!Engine.isHost) return;
  const now = Date.now();
  Engine.players.forEach((p, id) => {
    if (!p.isHost && p.connected && !p.isBot && now - p.lastSeen > 300000) {
      handlePlayerDisconnect(id);
    }
  });
}

function sendHeartbeat() {
  if (!Engine.isHost && Engine.hostConnection && Engine.hostConnection.open) networkSend({ type: 'HEARTBEAT' });
}

function getStandings() {
  return Array.from(Engine.players.values()).map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
}

function saveUserData() {
  Engine.profile.name = document.getElementById('player-name').value.trim() || "Anon";
  try {
    localStorage.setItem('p2p_name', Engine.profile.name);
    localStorage.setItem('p2p_avatar', Engine.profile.avatar);
  } catch(e) {}
  updateProfilePreview();
}

function confirmProfile() { 
  saveUserData(); 
  if (Engine.pendingJoinCode) { document.getElementById('join-code').value = Engine.pendingJoinCode; joinGame(); }
  else { switchPanel('menu-ui'); }
}
function editProfile() { switchPanel('profile-ui'); }

/**
 * Builds the game module dropdown dynamically based on `window.Games`.
 * Auto-detects if there is only 1 game loaded and transforms into a single-game app mode.
 */
function buildGameDropdown() {
  const sel = document.getElementById('game-select');
  const selWrapper = document.getElementById('game-select-wrapper');
  const selLabel = document.getElementById('game-select-label');
  const badge = document.getElementById('lobby-game-badge');
  
  if (!sel) return;
  sel.innerHTML = '';
  
  const gameKeys = Object.keys(window.Games);
  
  if (gameKeys.length === 0) {
    sel.innerHTML = '<option value="">No games found</option>';
    sel.disabled = true;
    if (badge) badge.innerText = "No Game Loaded";
    return;
  }
  
  if (gameKeys.length === 1) {
    Engine.currentGame = gameKeys[0];
    const opt = document.createElement('option');
    opt.value = gameKeys[0]; opt.innerText = gameKeys[0]; sel.appendChild(opt);
    
    if (selWrapper) selWrapper.style.display = 'none';
    if (selLabel) selLabel.innerText = "Game Controls";
    if (badge) badge.innerText = Engine.currentGame;
    
    const mod = window.Games[Engine.currentGame];
    document.getElementById('dynamic-game-settings').innerHTML = (mod && mod.settingsHTML) ? mod.settingsHTML : '<div style="color:var(--text-muted); font-size:13px;">No settings for this module.</div>';
    return;
  }
  
  if (selWrapper) selWrapper.style.display = 'block';
  if (selLabel) selLabel.innerText = "Select Game Module";
  
  gameKeys.forEach(key => {
    const opt = document.createElement('option');
    opt.value = key; opt.innerText = key; sel.appendChild(opt);
  });
  
  const updateSettings = () => {
    Engine.currentGame = sel.value;
    const mod = window.Games[sel.value];
    document.getElementById('dynamic-game-settings').innerHTML = (mod && mod.settingsHTML) ? mod.settingsHTML : '<div style="color:var(--text-muted); font-size:13px;">No settings for this module.</div>';
    if (badge) badge.innerText = "Module: " + Engine.currentGame;
  };
  sel.addEventListener('change', updateSettings);
  updateSettings();
}

function selectAvatar(emoji) {
  Engine.profile.avatar = emoji;
  const opts = document.querySelectorAll('.avatar-opt');
  opts.forEach(opt => { opt.classList.remove('active'); if (opt.innerText === emoji) opt.classList.add('active'); });
}

function leaveSession() {
  if (Engine.peer) Engine.peer.destroy();
  resetToMainMenu();
}

/**
 * Resets application state and rigorously cleans the DOM between game sessions.
 */
function resetToMainMenu() {
  window.StopTicker();
  window.hideGameOverOverlay();
  
  Engine.isHost = false; 
  Engine.connections.clear(); 
  Engine.hostConnection = null; 
  Engine.peer = null; 
  Engine.pendingJoinCode = null; 
  Engine.players.clear(); 
  sessionStorage.removeItem('p2p_recovery');
  
  if (Engine.activeModule && Engine.activeModule.reset) Engine.activeModule.reset();
  Engine.activeModule = null;
  
  // DOM Cleanup to prevent visual overlap between switching modules
  document.getElementById('messages').innerHTML = ''; 
  document.getElementById('game-board-container').innerHTML = '';
  document.getElementById('dynamic-game-settings').innerHTML = '';
  
  window.history.pushState({}, '', window.location.pathname);
  switchPanel('menu-ui');
}

function copyRoomCode() {
  if (!Engine.roomId) return;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${Engine.roomId}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    const codeDisplay = document.getElementById('room-code-display');
    const originalText = codeDisplay.innerText;
    codeDisplay.innerText = "COPIED URL!";
    codeDisplay.style.fontSize = "20px";
    setTimeout(() => { codeDisplay.innerText = originalText; codeDisplay.style.fontSize = "28px"; }, 1500);
  });
}

function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(panelId).classList.add('active');
  const appWindow = document.querySelector('.app-window');
  const mainLayout = document.getElementById('main-game-layout');
  const sidePanel = document.getElementById('game-side-panel');
  if (panelId === 'game-ui' && Engine.activeModule) {
    const isFullscreen = Engine.activeModule.layoutMode === 'fullscreen';
    const hasSidePanel = Engine.activeModule.showSidePanel !== false;
    document.body.classList.toggle('fullscreen-mode', isFullscreen);
    appWindow.classList.toggle('fullscreen-mode', isFullscreen);
    if (mainLayout) mainLayout.classList.toggle('simple-mode', !isFullscreen);
    if (sidePanel) sidePanel.style.display = hasSidePanel ? 'flex' : 'none';
  } else {
    document.body.classList.remove('fullscreen-mode');
    appWindow.classList.remove('fullscreen-mode');
    if (mainLayout) mainLayout.classList.add('simple-mode');
    if (sidePanel) sidePanel.style.display = 'none';
  }
}