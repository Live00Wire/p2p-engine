# AI Prompt Template for >L P2P Engine

To quickly generate a new game module using an AI (like ChatGPT, Claude, or Gemini), copy the text in the prompt block below. 

Fill in the bracketed `[ ]` sections with your specific game rules, and paste the entire contents of `ENGINE_API.md` where indicated. The AI will output a perfectly formatted `.js` file ready to be dropped into your `games/` folder.

---

### Copy & Paste This Prompt:

```text
You are an expert JavaScript game developer. I am building a web-based multiplayer game using a custom serverless P2P framework called the >L P2P Engine.

I need you to write a single drop-in game module for this engine. 

First, here is the exact technical specification, lifecycle hooks, and API you MUST follow to build this module. Do not invent native WebSockets, do not use setInterval for game loops, and do not write external HTML files.

--- START ENGINE API SPEC ---
[PASTE THE ENTIRE CONTENTS OF ENGINE_API.md HERE]
--- END ENGINE API SPEC ---

Now, please write a complete game module based on the following design document:

**1. Game Overview**
* Game Name: [ENTER GAME NAME]
* Max Players: [ENTER NUMBER, e.g., 2, 4, 8]
* Game Type: [Turn-Based / Simultaneous / Real-Time Ticker]

**2. Rules & Core Mechanics**
* Setup: [How does the game start? e.g., Host deals 5 cards to everyone, starting score is 0.]
* Gameplay Loop: [What does a player do on their turn? What actions can they take?]
* State Variables: [What needs to be tracked? e.g., global score, player hands, board state.]

**3. Win Condition**
* [How does the game end? e.g., First to 10 points wins, or last player standing.]

**4. UI & Visuals**
* [Describe the layout. e.g., I want a 4x4 grid of buttons in the center, and a "Draw Card" button at the bottom. Use the engine's built-in CSS classes like 'btn primary-btn' and 'card'.]

**Critical Reminders for this Build:**
1. Put all logic that changes the game state inside `onHostAction`. Clients should only send `GAME_ACTION` packets and update their local DOM in `handleClientAction`.
2. Use `Engine.State.set()` for shared variables so the UI updates automatically across all clients.
3. If the game involves chance, you MUST use `Engine.Math.random()` to ensure all clients generate the exact same result.
4. When the game ends, trigger `window.TriggerPhaseChange('GAME_END')` so the engine can display the Rematch overlay. Do not build a custom Game Over screen.
5. Provide the final code as a single JavaScript code block containing the IIFE `window.Games['Game Name'] = (function() { ... })();`.