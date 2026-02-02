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
