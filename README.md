# >L P2P Engine

>L P2P Engine is a standalone, serverless multiplayer game framework built right into the browser. I put this together to eliminate the friction of hosting real-time web games, providing a robust WebRTC backend so developers can focus entirely on building game logic and UI.

## Features

**Serverless WebRTC Networking & Lobbies**
Under the hood, the engine utilizes PeerJS to create an authoritative Star Topology network where one player acts as the host. Players can join via a simple 5-letter room code or instantly through deep-linked URLs. The lobby includes built-in controls for kicking players, enforcing maximum room limits, and seamlessly routing late-joiners into a dedicated Spectator mode until the next round begins. 

**Drop-In Modular Architecture**
Games are built as completely isolated `.js` modules. You just drop your custom game file into the `/games` folder and link it in the HTML—the engine dynamically discovers it and adds it to the lobby. If the engine detects only a single game module, it automatically hides the selection dropdown and transforms the UI into a dedicated, single-game application. 

**State, RNG & Turn Management**
The engine handles the heaviest burdens of turn-based and simultaneous multiplayer logic. It features a built-in Turn Queue with auto-advancing, skipping, and reversing, alongside an authoritative Key-Value State Manager (`Engine.State`) that automatically broadcasts UI updates to all clients. To keep peer-to-peer games synchronized without heavy network traffic, the engine utilizes a globally seeded PRNG (`Engine.Math.random()`) so decks shuffle and items spawn identically on every screen.

**Session Recovery & Developer Tools**
Accidental page refreshes no longer kill the session. The engine saves connection data to `sessionStorage` and places disconnected players into a "Ghost" state, automatically catching them up to the live game phase if they return. For developers, the studio includes a built-in Local Bot API to simulate fake players during testing, alongside visual "juice" APIs like non-blocking Toast notifications, a global Confetti engine, and built-in Rematch flow handling.

## Repository Structure

The framework is strictly separated to protect the core networking logic from game-specific code.

```text
p2p-game-engine/
├── index.html            # The main UI shell (Lobby, Chat, Modals, Audio Toggle)
├── style.css             # Global UI styles and utility classes
├── app.js                # CORE ENGINE: Handles all networking, states, and routing
├── README.md             
├── ENGINE_API.md         # Developer documentation and AI prompt spec
└── games/                # 📂 Drop your custom games here
    ├── template.js       # The blank developer template
    └── my_custom_game.js # Your isolated game module
```

## Using the Engine

You can clone this repository and run it locally without a backend server. Just open `index.html` in any modern browser, duplicate the `template.js` file to start writing your game, and host the final product directly on GitHub Pages.

---
**LIVE00WIRE** // Modular Web Applications