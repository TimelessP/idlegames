# IdleGames Agent Skills

This directory contains Agent Skills that enhance GitHub Copilot's ability to help with the IdleGames project. Agent Skills teach Copilot specialized knowledge and best practices for specific tasks.

## What are Agent Skills?

Agent Skills are folders containing instructions, scripts, and resources that Copilot can load when relevant to improve its performance on specialized tasks. They follow the [Agent Skills open standard](https://github.com/agentskills/agentskills).

Read more: [About Agent Skills (GitHub Docs)](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)

## Available Skills

### 1. **PWA Development** (`pwa-development/`)
Learn best practices for building Progressive Web Apps with service workers, offline support, and manifest configurations.

**Use when:**
- Building or improving PWA features
- Implementing service workers
- Setting up offline functionality
- Working with manifest.webmanifest

**Key topics:**
- Web App Manifest configuration
- Service Worker registration and caching strategies
- URL normalization (critical for PWA integrity)
- Icon setup and platform support
- Update notifications and version management

### 2. **Vanilla JavaScript Game Development** (`vanilla-js-game-dev/`)
Build high-performance games using vanilla JavaScript, HTML5 Canvas, and DOM APIs without frameworks.

**Use when:**
- Creating game mechanics and game loops
- Handling player input (keyboard, mouse, touch)
- Implementing collision detection
- Managing game state
- Optimizing performance for games

**Key topics:**
- Game loop architecture with delta time
- Input handling (keyboard, mouse, touch, gamepad)
- Rendering approaches (Canvas 2D and DOM-based)
- Collision detection (AABB, circle, spatial partitioning)
- State management and audio

### 3. **Web Game Optimization** (`web-game-optimization/`)
Optimize games for smooth performance across all devices, from high-end desktops to low-end mobile phones.

**Use when:**
- Improving game performance and FPS
- Reducing load times
- Optimizing for mobile devices
- Reducing memory usage
- Profiling and debugging performance issues

**Key topics:**
- Performance measurement and monitoring
- Canvas and DOM rendering optimization
- JavaScript memory management and object pooling
- Asset loading and compression
- Mobile-specific optimizations
- Accessibility in games

### 4. **Accessible Game Design** (`accessible-game-design/`)
Design inclusive games that are playable by everyone, including players with disabilities.

**Use when:**
- Improving game accessibility
- Supporting alternative inputs
- Designing inclusive UI
- Adding keyboard navigation
- Providing captions or audio descriptions

**Key topics:**
- Visual accessibility (color contrast, readable fonts, animations)
- Auditory accessibility (captions, transcripts, sound alternatives)
- Motor accessibility (keyboard navigation, large targets, gamepad support)
- Cognitive accessibility (clear language, progressive disclosure)
- Difficulty and assistance options
- Testing for accessibility

### 5. **RTS Games** (`rts-games/`)
Build real-time strategy games as single-page HTML, CSS, and JavaScript apps.

**Use when:**
- Creating or refining browser RTS mechanics
- Building data-driven units, buildings, and upgrades
- Designing command routing, orders, capture, repair, and service flows
- Adding aircraft, fog of war, AI factions, or HUD systems
- Debugging selection, hit-testing, or simulation semantics in an RTS

**Key topics:**
- RTS runtime architecture in a single-page app
- Command grammar and order state machines
- Geometry, targeting, and interaction hitboxes
- Support, logistics, aircraft, and faction systems
- Playtest-driven iteration for complex RTS behavior

### 6. **RTS AI Doctrine** (`rts-ai-doctrine/`)
Design layered AI for RTS games that scouts, remembers, scores objectives, and issues plausible tactical orders without cheating.

**Use when:**
- Building AI economy phases and production heuristics
- Adding scouting, recon, and last-seen enemy memory
- Designing tactical role assignment for ground and air units
- Making AI switch between defense, expansion, siege, or resource-race behavior

**Key topics:**
- Phase-driven AI behavior
- Memory-based target selection
- Objective scoring and hysteresis
- Air doctrine and tactical assignment
- Reusing player-facing order systems for AI

### 7. **RTS Pathfinding** (`rts-pathfinding/`)
Implement movement, occupancy, and pathfinding systems for RTS games with practical browser-friendly patterns.

**Use when:**
- Adding movement over blocked cells or weighted terrain
- Designing occupancy, claims, or reservations
- Handling spawn cells, unload positions, and approach cells
- Debugging stuck units, path thrashing, or building-footprint collisions

**Key topics:**
- Grid/world coordinate conversion
- Traversal rules by mover type
- Static and dynamic occupancy layers
- Goal selection beyond exact target cells
- Path repair and replanning triggers

### 8. **RTS Rendering and Persistence** (`rts-rendering-persistence/`)
Build render, minimap, fog, and save/load systems for browser RTS games.

**Use when:**
- Designing a backbuffer-based RTS render pipeline
- Building minimap and fog-of-war layers
- Precomputing procedural sprites or atlases
- Implementing JSON save/load and restore pipelines

**Key topics:**
- Layered rendering and crisp scaling
- Minimap and fog separation
- State-driven effects and overlays
- Snapshot versioning and restore workflows
- Rebuilding derived caches safely after load

## How to Use These Skills

### In GitHub Copilot Chat
Mention the skill name when asking for help:
- "How do I implement an offline fallback in my PWA?" → Uses **PWA Development**
- "Help me optimize this game loop for 60 FPS" → Uses **Web Game Optimization**
- "Make this game accessible to keyboard users" → Uses **Accessible Game Design**

### In VS Code with Copilot
When Copilot detects you're working on a relevant task, it will automatically consider and use the applicable skills.

### Combining Skills
Multiple skills often work together:
- Use **Vanilla JS Game Dev** to build the game logic
- Use **Web Game Optimization** to make it perform well
- Use **Accessible Game Design** to make it inclusive
- Use **PWA Development** to add offline support, build pipeline setup, version management, and production deployment
- Use **RTS Games** for the core RTS simulation, commands, and unit systems
- Use **RTS AI Doctrine** for factions, scouting, objective choice, and tactical behavior
- Use **RTS Pathfinding** for occupancy, movement, claims, and route recovery
- Use **RTS Rendering and Persistence** for minimaps, fog, render pipelines, and save/load behavior

## Project Context

**IdleGames** is a collection of relaxing idle and puzzle games built with:
- HTML5, CSS3, and Vanilla JavaScript (no frameworks)
- Progressive Web App (PWA) with service worker support
- Local storage for save data
- Deployed on GitHub Pages

The skills in this directory are tailored specifically to this project's architecture and technologies.

## References

- [GitHub Copilot Skills Documentation](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Awesome Copilot Repository](https://github.com/github/awesome-copilot)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Agent Skills Specification](https://agentskills.io/)

## Contributing

To add or improve skills:

1. Create a new directory with a descriptive name (lowercase, hyphens for spaces)
2. Add a `SKILL.md` file with YAML frontmatter and comprehensive instructions
3. Include code examples and best practices
4. Update this README with the new skill

Each skill should be self-contained and focused on a specific domain or task.
