/**
 * @fileoverview Boilerplate Game Module Template for the P2P Engine.
 * 
 * Instructions for developers:
 * 1. Rename 'My Custom Game' to your actual game name.
 * 2. Add `<script src="games/my_custom_game.js"></script>` to your `index.html`.
 * 3. The Engine will automatically detect it and add it to the host lobby dropdown.
 */

window.Games = window.Games || {};
window.Games['My Custom Game'] = (function() {

  // ============================================================================
  // 1. STATE MANAGEMENT
  // ============================================================================
  
  /**
   * Local module state.
   */
  let state = {
    myRole: 'Spectator',
    settings: {}
  };

  /**
   * Host-only state.
   * Use this to keep track of secrets, timers, or authoritative game flow 
   * that clients should not tamper with.
   */
  let hostState = {};

  // ============================================================================
  // 2. LOBBY & INITIALIZATION
  // ============================================================================

  const settingsHTML = `
    <div class="form-group">
      <label>Number of Rounds</label>
      <input type="number" id="setting-rounds" value="3" min="1" max="10">
    </div>
  `;

  function getSettings() {
    return {
      rounds: parseInt(document.getElementById('setting-rounds').value) || 3
    };
  }

  function initUI(myRole, settings) {
    state.myRole = myRole;
    state.settings = settings;

    document.getElementById('game-topbar').style.display = 'flex';
    document.getElementById('game-topbar').innerHTML = `
      <div id="game-status">Waiting for game to start...</div>
    `;

    document.getElementById('game-board-container').innerHTML = `
      <div style="padding: 20px; color: white; display: flex; flex-direction: column; align-items: center; gap: 15px;">
        <h2>Welcome to My Custom Game!</h2>
        <p>Your Role: <strong>${myRole}</strong></p>
        
        <div style="display:flex; gap: 10px;">
          <button class="btn primary-btn" id="custom-action-btn">Do Something</button>
          <button class="btn" id="score-btn">Add Score to State Manager</button>
        </div>
        
        <p id="score-display">Current Shared Score: 0</p>
      </div>
    `;

    document.getElementById('custom-action-btn').addEventListener('click', onCustomActionClicked);
    document.getElementById('score-btn').addEventListener('click', () => {
      // You must send a network action requesting the host to change state
      networkSend({ type: 'GAME_ACTION', action: { type: 'ADD_SCORE' } });
    });
  }

  // ============================================================================
  // 3. ACTION HANDLING & NETWORKING
  // ============================================================================

  function onCustomActionClicked() {
    const payload = { 
      type: 'GAME_ACTION', 
      action: { type: 'BTN_CLICKED', value: Engine.Math.random() } 
    };
    if (Engine.isHost) onHostAction(payload.action, Engine.myId);
    else networkSend(payload); 
  }

  function onAction(action, senderId) {
    if (Engine.isHost) onHostAction(action, senderId);
    else handleClientAction(action);
  }

  /**
   * Authoritative logic. Processes client requests and mutates shared state.
   */
  function onHostAction(action, senderId) {
    switch (action.type) {
      case 'BTN_CLICKED':
        const pName = Engine.players.get(senderId)?.name || 'Someone';
        const msg = `${pName} clicked the button!`;
        
        const updatePayload = { type: 'GAME_ACTION', action: { type: 'UPDATE_TEXT', text: msg } };
        networkSend(updatePayload);
        handleClientAction(updatePayload.action);
        window.YieldTurn();
        break;
        
      case 'ADD_SCORE':
        let currentScore = Engine.State.get('globalScore') || 0;
        Engine.State.set('globalScore', currentScore + 1); // Automatically syncs to all clients!
        break;
    }
  }

  function handleClientAction(action) {
    switch (action.type) {
      case 'UPDATE_TEXT':
        const statusDiv = document.getElementById('game-status');
        if (statusDiv) statusDiv.innerText = action.text;
        
        if (typeof showToast !== 'undefined') showToast(action.text, 'success');
        break;
    }
  }
  
  // ============================================================================
  // 4. ENGINE LIFECYCLE HOOKS
  // ============================================================================

  function onInit(settings, players, myId) {
    if (Engine.isHost) {
      Engine.maxRounds = settings.rounds || 3;
      networkSend({ type: 'ENGINE_VAR_SYNC', key: 'maxRounds', value: Engine.maxRounds });
      Engine.State.set('globalScore', 0);
    }
  }

  function onRoundStart(round) {}
  
  function onTurnChange(activeId, isMyTurn) {}
  
  function onBotTurn(botId) {
    onHostAction({ type: 'BTN_CLICKED', value: Engine.Math.random() }, botId);
  }

  function onHostChat(text, senderId) { return false; }
  
  /**
   * Called automatically when the Engine.State.set() modifies a variable.
   */
  function onStateChange(key, value) {
    if (key === 'globalScore') {
      const scoreDisp = document.getElementById('score-display');
      if (scoreDisp) scoreDisp.innerText = `Current Shared Score: ${value}`;
      
      // Hit 5 points? Spawn Confetti and trigger match end!
      if (value === 5) {
        if (typeof spawnConfetti !== 'undefined') spawnConfetti();
        if (Engine.isHost) window.TriggerPhaseChange('GAME_END');
      }
    }
  }
  
  function onPlayerDisconnect(id, isActiveTurn) {}

  function reset() {}

  // ============================================================================
  // 5. PUBLIC API (Exported to Engine)
  // ============================================================================

  return {
    layoutMode: 'default', 
    showSidePanel: true,   
    maxPlayers: 8, 
    settingsHTML: settingsHTML,
    getSettings: getSettings,
    initUI: initUI,
    onInit: onInit,
    onRoundStart: onRoundStart,
    onTurnChange: onTurnChange,
    onBotTurn: onBotTurn,
    onAction: onAction,
    onHostChat: onHostChat,
    onStateChange: onStateChange,
    onPlayerDisconnect: onPlayerDisconnect,
    reset: reset
  };
})();