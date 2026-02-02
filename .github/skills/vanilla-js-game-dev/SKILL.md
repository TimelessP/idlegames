---
name: vanilla-js-game-dev
description: Build high-performance games using vanilla JavaScript with HTML5 Canvas and DOM APIs. Use when creating games, implementing game loops, handling input, or optimizing game performance.
---

# Vanilla JavaScript Game Development

Build engaging games with pure JavaScript, HTML5, and CSS3. This skill covers core game development patterns without frameworks, including advanced systems like pose-based animation, multi-arena rendering, complex state machines, gamepad support with remapping, and 2-player competitive gameplay.

## Game Loop Architecture

### Basic Game Loop Pattern
```javascript
class GameEngine {
  constructor() {
    this.deltaTime = 0;
    this.lastTime = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    requestAnimationFrame(this.gameLoop.bind(this));
  }

  gameLoop(currentTime) {
    // Calculate delta time (time since last frame)
    this.deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;
    
    // Cap delta time to prevent spiral of death
    if (this.deltaTime > 0.1) this.deltaTime = 0.1;
    
    // Update game state
    this.update(this.deltaTime);
    
    // Render
    this.render();
    
    if (this.running) {
      requestAnimationFrame(this.gameLoop.bind(this));
    }
  }

  update(dt) {
    // Update game entities, physics, etc.
  }

  render() {
    // Draw to canvas or update DOM
  }
}
```

### Delta Time Usage
Always use delta time for consistent motion across framerates:

```javascript
// GOOD - framerate independent
this.x += this.velocity * deltaTime;

// BAD - framerate dependent, changes with refresh rate
this.x += this.velocity;
```

## Input Handling

### Keyboard Input
```javascript
class InputHandler {
  constructor() {
    this.keys = {};
    
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      this.handleKeyDown(e);
    });
    
    window.addEventListener('keyup', e => {
      this.keys[e.key.toLowerCase()] = false;
      this.handleKeyUp(e);
    });
  }

  isKeyPressed(key) {
    return this.keys[key.toLowerCase()] === true;
  }

  handleKeyDown(event) {
    // Handle specific key down actions
  }

  handleKeyUp(event) {
    // Handle specific key up actions
  }
}
```

### Mouse/Touch Input
```javascript
class PointerHandler {
  constructor(element) {
    this.position = { x: 0, y: 0 };
    this.isPressed = false;
    this.touches = new Map();

    // Mouse
    element.addEventListener('mousemove', e => this.handleMove(e));
    element.addEventListener('mousedown', e => {
      this.isPressed = true;
      this.handleDown(e);
    });
    element.addEventListener('mouseup', e => {
      this.isPressed = false;
      this.handleUp(e);
    });

    // Touch
    element.addEventListener('touchstart', e => this.handleTouchStart(e));
    element.addEventListener('touchmove', e => this.handleTouchMove(e));
    element.addEventListener('touchend', e => this.handleTouchEnd(e));
  }

  handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    this.position = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  handleTouchStart(event) {
    for (let touch of event.touches) {
      this.touches.set(touch.identifier, {
        x: touch.clientX,
        y: touch.clientY
      });
    }
  }

  handleTouchMove(event) {
    for (let touch of event.touches) {
      const rect = event.currentTarget.getBoundingClientRect();
      this.touches.set(touch.identifier, {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      });
    }
  }

  handleTouchEnd(event) {
    for (let touch of event.changedTouches) {
      this.touches.delete(touch.identifier);
    }
  }
}
```

## Rendering Approaches

### Canvas 2D Rendering
```javascript
class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
    
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawEntity(entity) {
    this.ctx.save();
    this.ctx.translate(entity.x, entity.y);
    this.ctx.rotate(entity.rotation);
    
    // Draw entity graphics
    if (entity.type === 'circle') {
      this.ctx.fillStyle = entity.color;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    
    this.ctx.restore();
  }
}
```

### DOM-based Rendering
```javascript
class DOMRenderer {
  constructor() {
    this.entities = new Map();
  }

  createEntity(id, element) {
    this.entities.set(id, element);
    document.body.appendChild(element);
  }

  updateEntity(id, x, y, rotation = 0) {
    const element = this.entities.get(id);
    if (element) {
      element.style.transform = 
        `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
    }
  }

  removeEntity(id) {
    const element = this.entities.get(id);
    if (element) element.remove();
    this.entities.delete(id);
  }
}
```

## Collision Detection

### Simple AABB (Axis-Aligned Bounding Box)
```javascript
function checkAABBCollision(a, b) {
  return a.x < b.x + b.width &&
         a.x + a.width > b.x &&
         a.y < b.y + b.height &&
         a.y + a.height > b.y;
}
```

### Circle Collision
```javascript
function checkCircleCollision(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < a.radius + b.radius;
}
```

### Spatial Partitioning (for many objects)
```javascript
class QuadTree {
  constructor(bounds, maxObjects = 10, maxLevels = 5, level = 0) {
    this.bounds = bounds;
    this.maxObjects = maxObjects;
    this.maxLevels = maxLevels;
    this.level = level;
    this.objects = [];
    this.nodes = [];
  }

  insert(obj) {
    if (this.nodes.length > 0) {
      this.nodes.forEach(node => {
        if (node.bounds.contains(obj)) {
          node.insert(obj);
          return;
        }
      });
      return;
    }

    this.objects.push(obj);

    if (this.objects.length > this.maxObjects && 
        this.level < this.maxLevels) {
      this.split();
    }
  }

  split() {
    // Subdivide into 4 quadrants
    // Implementation details...
  }

  retrieve(area) {
    let objects = this.objects.filter(obj => 
      area.overlaps(obj)
    );

    if (this.nodes.length > 0) {
      this.nodes.forEach(node => {
        if (area.overlaps(node.bounds)) {
          objects = objects.concat(node.retrieve(area));
        }
      });
    }

    return objects;
  }
}
```

## State Management

### Simple State Machine
```javascript
class GameState {
  constructor() {
    this.state = 'menu';
    this.states = {
      'menu': new MenuState(),
      'playing': new PlayingState(),
      'gameOver': new GameOverState()
    };
  }

  setState(newState) {
    this.state = newState;
    this.states[newState]?.enter?.();
  }

  update(dt) {
    this.states[this.state]?.update?.(dt);
  }

  render() {
    this.states[this.state]?.render?.();
  }
}
```

## Performance Optimization

### 1. Object Pooling
```javascript
class ObjectPool {
  constructor(ObjectClass, size) {
    this.pool = [];
    for (let i = 0; i < size; i++) {
      this.pool.push(new ObjectClass());
    }
  }

  get() {
    return this.pool.pop() || new ObjectClass();
  }

  return(obj) {
    obj.reset();
    this.pool.push(obj);
  }
}
```

### 2. Throttle Updates
```javascript
class ThrottledUpdater {
  constructor(updateInterval = 1000 / 30) {
    this.updateInterval = updateInterval;
    this.accumulator = 0;
  }

  update(dt) {
    this.accumulator += dt;
    
    while (this.accumulator >= this.updateInterval) {
      this.fixedUpdate(this.updateInterval);
      this.accumulator -= this.updateInterval;
    }
  }

  fixedUpdate(dt) {
    // Fixed timestep updates
  }
}
```

### 3. Memory Management
```javascript
// Clean up objects when no longer needed
class Entity {
  destroy() {
    // Remove from collections
    // Cancel animations/timers
    // Release resources
  }
}

// In game loop
entities = entities.filter(entity => !entity.destroyed);
```

## Advanced Animation Systems

### Pose-Based Character Animation
For complex games with many animation states, use keyframe poses that define character limb positions at specific moments. This pattern is ideal for fighting games, platformers, and action games.

```javascript
// Define poses with relative offsets (head, body, limbs all relative to center)
const POSES = {
  idle: {
    head: {x: 0, y: -80},
    body: {x: 0, y: -40, w: 40, h: 60},
    fistF: {x: 25, y: -55},  // Front hand
    fistB: {x: 10, y: -50},  // Back hand
    footF: {x: 15, y: -5},
    footB: {x: -15, y: -5}
  },
  punch: {
    head: {x: 15, y: -75},
    body: {x: 10, y: -38, w: 40, h: 60},
    fistF: {x: 60, y: -55},  // Extended punch
    fistB: {x: -5, y: -50},
    footF: {x: 25, y: -5},
    footB: {x: -20, y: -5}
  }
};

// Interpolate between poses for smooth animation
class AnimationController {
  constructor() {
    this.currentPose = POSES.idle;
    this.targetPose = POSES.idle;
    this.transitionTime = 0;
    this.transitionDuration = 0.15;
  }
  
  playAnimation(poseName, duration = 0.15) {
    if (POSES[poseName]) {
      this.targetPose = POSES[poseName];
      this.transitionTime = 0;
      this.transitionDuration = duration;
    }
  }
  
  update(dt) {
    this.transitionTime += dt;
    if (this.transitionTime < this.transitionDuration) {
      const t = this.transitionTime / this.transitionDuration;
      // Blend poses together
      for (const part in this.currentPose) {
        for (const key in this.currentPose[part]) {
          if (typeof this.currentPose[part][key] === 'number') {
            this.currentPose[part][key] += 
              (this.targetPose[part][key] - this.currentPose[part][key]) * t;
          }
        }
      }
    }
  }
}
```

## Complex Game State Machines

For games with multiple screens (menu, settings, gameplay, dialog), use a state machine:

```javascript
class GameStateMachine {
  constructor() {
    this.state = 'title'; // 'title', 'settings', 'game', 'dialog'
  }
  
  setState(newState) {
    // Exit current state
    if (this.currentState?.onExit) {
      this.currentState.onExit();
    }
    
    this.state = newState;
    this.currentState = this.createState(newState);
    
    // Enter new state
    if (this.currentState?.onEnter) {
      this.currentState.onEnter();
    }
  }
  
  update(dt) {
    this.currentState?.update?.(dt);
  }
  
  render(ctx) {
    this.currentState?.render?.(ctx);
  }
}
```

### Multi-Arena Systems
For games with multiple environments or levels:

```javascript
class Arena {
  constructor(name, drawFunction) {
    this.name = name;
    this.draw = drawFunction;
    this.entities = [];
  }
}

const ARENAS = [
  new Arena('Dojo', (ctx) => { /* Draw wooden dojo */ }),
  new Arena('Temple', (ctx) => { /* Draw stone temple */ }),
  new Arena('Forest', (ctx) => { /* Draw trees and mist */ })
];
```

## Gamepad Support with Control Remapping

For competitive or accessible games, allow players to remap controls and use gamepads:

```javascript
class InputRemapper {
  constructor(playerNum = 1) {
    this.playerNum = playerNum;
    this.gamepadIndex = playerNum - 1;
    this.bindings = {
      'punch': 'KeyZ',
      'kick': 'KeyX',
      'jump': 'Space'
    };
    this.listeningFor = null;
  }
  
  startListening(action) {
    this.listeningFor = action;
  }
  
  onKeyDown(event) {
    if (!this.listeningFor) return;
    
    this.bindings[this.listeningFor] = event.code;
    localStorage.setItem(`p${this.playerNum}Bindings`, JSON.stringify(this.bindings));
    this.listeningFor = null;
  }
  
  isActionPressed(action) {
    const gamepad = navigator.getGamepads?.()?.[this.gamepadIndex];
    
    // Check keyboard
    if (this.keysPressed?.[this.bindings[action]]) return true;
    
    // Check gamepad buttons (0=A, 1=B, 2=X, 3=Y)
    const buttonMap = { 'punch': 0, 'kick': 2, 'jump': 1 };
    if (gamepad?.buttons[buttonMap[action]]?.pressed) return true;
    
    return false;
  }
}

// 2-player setup
const player1 = new InputRemapper(1);
const player2 = new InputRemapper(2);
player2.gamepadIndex = 1; // Gamepad 2
```

## Audio Management

```javascript
class AudioManager {
  constructor() {
    this.sounds = new Map();
    this.bgm = null;
    this.masterVolume = 0.7;
  }

  loadSound(key, src) {
    const audio = new Audio(src);
    audio.volume = this.masterVolume;
    this.sounds.set(key, audio);
  }

  play(key, loop = false) {
    const audio = this.sounds.get(key);
    if (audio) {
      audio.currentTime = 0;
      audio.loop = loop;
      audio.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  setVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach(sound => {
      sound.volume = this.masterVolume;
    });
  }
}
```

## Mobile Considerations

### Prevent Bounce Scrolling
```css
body {
  overscroll-behavior: none;
  -webkit-user-select: none;
  user-select: none;
}
```

### Responsive Canvas
```javascript
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);
}
```

### Full Screen Support
```javascript
function toggleFullscreen(element) {
  if (!document.fullscreenElement) {
    element.requestFullscreen().catch(err => {
      alert(`Error: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}
```

## Testing & Debugging

### FPS Counter
```javascript
class FPSCounter {
  constructor() {
    this.frames = 0;
    this.fps = 0;
    this.lastTime = Date.now();
  }

  update() {
    this.frames++;
    const currentTime = Date.now();
    
    if (currentTime - this.lastTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastTime = currentTime;
    }
  }

  render(ctx) {
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.fillText(`FPS: ${this.fps}`, 10, 20);
  }
}
```

### Debug Visualization
```javascript
class DebugRenderer {
  static drawBounds(ctx, x, y, width, height) {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  }

  static drawCircle(ctx, x, y, radius) {
    ctx.strokeStyle = 'yellow';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}
```
