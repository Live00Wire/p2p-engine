# >L P2P Engine: Developer & AI Integration Guide

This document serves as the technical manual and AI context for building modules on the **>L P2P Engine**. 

**To AI Agents:** If you are instructed to create a game for this engine, read this entire document carefully. Do not invent native WebSockets, do not write custom Node.js backends, and do not modify `app.js` or `index.html`. You are to generate a single `.js` file following the `window.Games['GameName'] = (function() { ... })();` IIFE module pattern.

---

## 1. Architectural Rules (The Golden Constraints)

1. **Star Topology (Host Authority):** One peer is the `Host`, all others are `Clients`. All game logic, state validation, and scoring must be executed by the Host in `onHostAction`. Clients only render UI via `handleClientAction`.
2. **No Native Math.random():** Because this is peer-to-peer, calling `Math.random()` will desync clients. You MUST use `Engine.Math.random()` which is a globally synced PRNG. 
3. **No setInterval for Game Loops:** Use the built-in `window.StartTicker(fps)` and the `onTick()` module hook to manage real-time game loops.
4. **State Encapsulation:** All internal game state must be stored inside the module's IIFE closure. Never pollute the global `window` object.
5. **UI Injection:** Game modules do not have their own HTML files. They must inject their DOM into `document.getElementById('game-board-container')` during the `initUI` hook.

---

## 2. The `Engine` Object API

The global `Engine` namespace exposes read-only state and utilities.

### 2.1 Variables & State
* `Engine.isHost` *(boolean)*: True if the local client is authoritative.
* `Engine.myId` *(string)*: The local client's PeerJS connection ID.
* `Engine.players` *(Map<string, Object>)*: Map of all players. `{ id, name, avatar, isHost, score, isReady, role, connected, isBot }`.
* `Engine.phase` *(string)*: Current phase (`LOBBY`, `PRE_GAME`, `PLAYING`, `SIMULTANEOUS`, `ROUND_END`, `GAME_END`).
* `Engine.round` *(number)*: Current round number.
* `Engine.turnQueue` *(Array<string>)*: Ordered array of player IDs representing the turn cycle.
* `Engine.currentTurnIndex` *(number)*: Index of the currently active player in the `turnQueue`.

### 2.2 Synced State Manager (`Engine.State`)
A built-in Key-Value store. Modifying this automatically broadcasts the new value to all clients and triggers their `onStateChange` hook.
* `Engine.State.set(key: string, value: any)`: **Host Only.** Updates a state variable and syncs to all peers.
* `Engine.State.get(key: string)`: Returns the current synced value.

### 2.3 Math & RNG
* `Engine.Math.random()`: Returns a synced float between 0 and 1. Safe to use for shuffling decks or random spawn points on all clients simultaneously.

---

## 3. Global Network & Flow Commands

These functions are globally available on the `window` object or directly callable.

* `networkSend(payload: Object, targetId?: string, excludeId?: string)`: 
   * **Host:** Broadcasts to all. Unicasts if `targetId` is provided.
   * **Client:** Sends data exclusively to the Host.
* `window.YieldTurn()`: Ends the current active player's turn and advances the turn queue.
* `window.SkipTurn(steps: number)`: (Host Only) Skips the queue forward by X steps.
* `window.ReverseTurnOrder()`: (Host Only) Inverts the turn queue direction.
* `window.TriggerPhaseChange(newPhase: string)`: (Host Only) Forces a phase change (e.g., `'GAME_END'` to trigger the Rematch overlay).

### Simultaneous Phases
* `window.StartSimultaneousPhase(participantsArray: Array<string>)`: (Host Only) Pauses turn-based execution and waits for actions from the array of IDs.
* `window.SubmitAction(actionData: Object)`: Submits a player's action. Triggers `onSimultaneousResolve` on the Host when all players lock in.

---

## 4. Module Lifecycle Hooks (The Exported API)

Your module MUST return an object matching this schema. The Engine automatically calls these hooks.

```javascript
return {
  // --- CONFIGURATION ---
  layoutMode: 'default', // 'default' (constrained width) or 'fullscreen'
  showSidePanel: true,   // Show/hide the chat and leaderboard panel
  maxPlayers: 8,         // Engine auto-rejects joins if room exceeds this limit
  
  // --- SETTINGS (Lobby Phase) ---
  settingsHTML: `<div class="form-group">...</div>`, 
  getSettings: function() { return { ... }; },       
  
  // --- INITIALIZATION ---
  initUI: function(myRole, settings) {}, // Inject game DOM here.
  onInit: function(settings, players, myId) {}, // Setup initial host state here.
  
  // --- GAMEPLAY FLOW ---
  onRoundStart: function(round) {}, 
  onTurnChange: function(activeId, isMyTurn) {}, 
  onBotTurn: function(botId) {}, // Simulate a turn if active player is a bot
  
  // --- NETWORKING ---
  onAction: function(action, senderId) {
    if (Engine.isHost) onHostAction(action, senderId);
    else handleClientAction(action);
  },
  
  onSimultaneousResolve: function(submittedActionsMap) {}, // Host only
  onStateChange: function(key, value) {}, // Called when Engine.State updates
  
  // --- CHAT INTERCEPTION ---
  onHostChat: function(text, senderId) { return false; }, // Return true to swallow chat
  
  // --- CLEANUP ---
  onPlayerDisconnect: function(id, isActiveTurn) {}, // Handle dropouts
  reset: function() {} // Clear intervals, DOM listeners, and local state
};
```

---

## 5. UI / UX Utilities

Utilize the engine's global classes and visual juice APIs. Do not build redundant overlays.

**JavaScript Juice:**
* `window.showToast(message: string, type: 'info'|'success'|'error', duration?: number)`: Non-blocking notification.
* `window.spawnConfetti()`: Drops full-screen confetti.
* *Note:* You do not need to build a "Game Over" screen. When the Host triggers `window.TriggerPhaseChange('GAME_END')`, the Engine automatically displays a standard Match Complete overlay with Rematch controls.

**CSS Component Classes:**
* Buttons: `<button class="btn primary-btn">`, `<button class="btn danger-btn">`, `<button class="btn sm-btn">`
* Forms: `<div class="form-group"><label>Title</label><input type="text"></div>`
* Cards: `<div class="card"><div class="card-title">Title</div><div class="card-body">...</div></div>`
* Loading: `<div class="spinner"></div>`, `<div class="spinner-sm"></div>`
* Badges: `<span class="badge-status badge-success">Active</span>`