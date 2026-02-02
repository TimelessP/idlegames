---
name: accessible-game-design
description: Design inclusive games that are playable by everyone, including players with disabilities. Use when improving game accessibility, supporting alternative inputs, or designing inclusive UI.
---

# Accessible Game Design

Create games that everyone can enjoy. Accessibility is not just for people with disabilities—it benefits all players.

## Core Accessibility Principles for Games

### POUR Framework
- **Perceivable**: Information must be perceivable to at least one sense
- **Operable**: Interfaces must be operable via keyboard and other inputs
- **Understandable**: Content and operations must be understandable
- **Robust**: Content must be robust enough to work with assistive technologies

## Visual Accessibility

### Color and Contrast
```css
/* WCAG AA: 4.5:1 contrast ratio for normal text, 3:1 for large text */
/* WCAG AAA: 7:1 contrast ratio for normal text, 4.5:1 for large text */

body {
  color: #222222;      /* Dark gray on light background */
  background: #ffffff;
}

/* High contrast mode support */
@media (prefers-contrast: more) {
  body {
    color: #000000;    /* Pure black */
    background: #ffffff; /* Pure white */
  }
}
```

### Not Relying on Color Alone
```html
<!-- BAD: Only color shows status -->
<div style="color: red;">Incorrect</div>

<!-- GOOD: Color + text + icon -->
<div style="color: red;">
  ✗ Incorrect
</div>
```

### Text Sizing and Readability
```css
/* Use relative units, not fixed pixels */
body {
  font-size: 1rem;     /* 16px base */
  line-height: 1.5;    /* Adequate spacing */
  letter-spacing: 0.05em;
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }

/* Support user font size preferences */
@media (prefers-reduced-motion: no-preference) {
  /* Use motion only when user allows it */
}
```

### Animations and Motion
```css
/* Respect motion preferences */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Provide static fallback for animated content */
.game-animation {
  animation: slide 2s ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .game-animation {
    animation: none;
    transform: translateX(100px); /* End state */
  }
}
```

### Font Selection
```css
/* Use readable fonts, avoid decorative fonts for body text */
body {
  /* Sans-serif is generally more readable for screen text */
  font-family: -apple-system, BlinkMacSystemFont, 
               'Segoe UI', Roboto, Oxygen, Ubuntu, 
               Cantarell, sans-serif;
}

/* Ensure glyphs are distinct: I, l, 1, O, 0 */
body {
  font-family: 'Courier New', monospace; /* Numbers game? */
  -webkit-font-smoothing: antialiased;
}
```

## Auditory Accessibility

### Captions and Transcripts
```html
<!-- Provide captions for audio content -->
<video>
  <source src="gameplay.mp4" type="video/mp4">
  <track kind="captions" src="captions.vtt" srclang="en">
</video>

<!-- Provide transcript for longer audio -->
<audio src="tutorial.mp3"></audio>
<p>
  <a href="tutorial-transcript.txt">Transcript of tutorial audio</a>
</p>
```

### Audio Alternatives
```javascript
// Provide visual feedback for important sounds
const soundManager = {
  playSuccess() {
    // 1. Play audio
    audio.play('success');
    
    // 2. Show visual feedback
    document.querySelector('.game-feedback')
      .classList.add('success');
    
    // 3. Haptic feedback (for supported devices)
    navigator.vibrate?.(50);
  }
};
```

### Sound Design
```javascript
// Use distinct sounds, not overlapping audio
const sounds = {
  // Each frequency band is distinct
  menuClick: 'sound-high-pitch.mp3',
  gameOver: 'sound-low-pitch.mp3',
  success: 'sound-mid-pitch.mp3'
};
```

## Motor Accessibility

### Keyboard Navigation
```javascript
class AccessibleGame {
  constructor() {
    // Support standard keys
    this.keyMap = {
      'ArrowUp': 'move-up',
      'ArrowDown': 'move-down',
      'ArrowLeft': 'move-left',
      'ArrowRight': 'move-right',
      'w': 'move-up',
      'a': 'move-left',
      's': 'move-down',
      'd': 'move-right',
      ' ': 'action',
      'Enter': 'confirm',
      'Escape': 'cancel',
      'Tab': 'next-control'
    };

    document.addEventListener('keydown', (e) => {
      const action = this.keyMap[e.key];
      if (action) {
        e.preventDefault();
        this.handleAction(action);
      }
    });
  }

  handleAction(action) {
    // Game logic here
  }
}
```

### Reduced Motor Requirements
```javascript
// 1. Don't require rapid clicks
// Avoid: "Click 10 times as fast as possible"
// Good: "Click when ready to continue"

// 2. Large click targets
const button = document.querySelector('button');
button.style.minWidth = '44px';  // Apple standard: 44x44px
button.style.minHeight = '44px';

// 3. Support toggle/hold controls
class ToggleControl {
  constructor(element) {
    this.active = false;
    
    element.addEventListener('mousedown', () => {
      this.active = true;
      this.onActivate?.();
    });
    
    element.addEventListener('mouseup', () => {
      this.active = false;
      this.onDeactivate?.();
    });
    
    // Maintain state across pointer leaving element
  }
}

// 4. Allow customizable key bindings
class KeybindingManager {
  constructor() {
    this.bindings = new Map([
      ['move-up', ['ArrowUp', 'w']],
      ['move-down', ['ArrowDown', 's']],
      ['action', [' ', 'Enter']]
    ]);
  }

  remapKey(action, newKey) {
    const current = this.bindings.get(action);
    current.push(newKey);
  }

  save() {
    localStorage.setItem('keybindings', 
      JSON.stringify(Object.fromEntries(this.bindings)));
  }
}
```

### Mouse/Pointer Input
```javascript
// Don't exclusively require precise mouse control
// Provide:
// - Large UI targets
// - Forgiving hit boxes
// - Visual feedback on hover

class ForgivingHitBox {
  constructor(visual, hitbox = 20) {
    // Visual element is 10x10, hit box expands to 50x50
    this.visual = visual;
    this.expandBy = hitbox;
  }

  isHit(x, y) {
    const rect = this.visual.getBoundingClientRect();
    return (x > rect.left - this.expandBy &&
            x < rect.right + this.expandBy &&
            y > rect.top - this.expandBy &&
            y < rect.bottom + this.expandBy);
  }
}
```

### Gamepad Support
```javascript
class GamepadManager {
  constructor() {
    this.gamepadIndex = null;
    setInterval(() => this.update(), 100);
  }

  update() {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return;

    for (let i = 0; i < gamepads.length; i++) {
      const gamepad = gamepads[i];
      if (!gamepad) continue;

      this.gamepadIndex = i;
      this.handleInput(gamepad);
      break;
    }
  }

  handleInput(gamepad) {
    // Standard gamepad layout
    const buttons = {
      0: 'A',      // Bottom button
      1: 'B',      // Right button
      2: 'X',      // Left button
      3: 'Y',      // Top button
      4: 'LB',     // Left shoulder
      5: 'RB',     // Right shoulder
      12: 'up',
      13: 'down',
      14: 'left',
      15: 'right'
    };

    gamepad.buttons.forEach((button, index) => {
      if (button.pressed) {
        const action = buttons[index];
        if (action) this.onButtonPress?.(action);
      }
    });

    // Analog sticks
    const deadzone = 0.2;
    const leftX = Math.abs(gamepad.axes[0]) > deadzone ? 
                  gamepad.axes[0] : 0;
    const leftY = Math.abs(gamepad.axes[1]) > deadzone ? 
                  gamepad.axes[1] : 0;

    if (leftX !== 0 || leftY !== 0) {
      this.onAnalogStick?.(leftX, leftY);
    }
  }
}
```

## Cognitive Accessibility

### Clear Language
```html
<!-- BAD: Jargon-heavy, unclear instructions -->
<p>Utilize the interface apparatus to manipulate the digital construct.</p>

<!-- GOOD: Simple, direct instructions -->
<p>Click the button to move forward.</p>
```

### Visual Clarity
```css
/* Use clear visual hierarchy */
h1 { font-size: 2rem; font-weight: bold; }
h2 { font-size: 1.5rem; font-weight: bold; }
p { font-size: 1rem; }

/* Whitespace and grouping */
.game-section {
  padding: 2rem;
  margin-bottom: 2rem;
  border: 1px solid #ccc;
}
```

### Progressive Disclosure
```html
<!-- Hide complex options initially -->
<button id="advanced-toggle">Show Advanced Options</button>
<div id="advanced-options" hidden>
  <!-- Complex settings here -->
</div>

<script>
document.getElementById('advanced-toggle').addEventListener('click', (e) => {
  const opts = document.getElementById('advanced-options');
  opts.hidden = !opts.hidden;
  e.currentTarget.textContent = opts.hidden ? 
    'Show Advanced Options' : 'Hide Advanced Options';
});
</script>
```

### Consistency
```javascript
// Use consistent controls throughout the game
const controlScheme = {
  'confirm': 'Space or Enter',
  'cancel': 'Escape',
  'menu': 'M or Tab',
  'help': '?' or F1'
};

// Don't change these between screens
```

### Error Prevention & Recovery
```javascript
class SafeGame {
  // 1. Confirm destructive actions
  deleteGame() {
    if (confirm('Are you sure you want to delete this save?\n' +
                'This cannot be undone.')) {
      // Delete
    }
  }

  // 2. Provide undo functionality
  undo() {
    if (this.history.length > 0) {
      this.state = this.history.pop();
    }
  }

  // 3. Auto-save frequently
  autoSave() {
    setInterval(() => {
      localStorage.setItem('game-save', 
        JSON.stringify(this.state));
    }, 60000); // Every minute
  }

  // 4. Show clear feedback for actions
  performAction(action) {
    try {
      this.state = action(this.state);
      this.showFeedback(`✓ ${action.name} completed`, 'success');
    } catch (error) {
      this.showFeedback(`✗ Error: ${error.message}`, 'error');
    }
  }
}
```

## Cognitive Load Management

### Tutorials and Onboarding
```javascript
class Tutorial {
  constructor(game) {
    this.game = game;
    this.steps = [];
    this.currentStep = 0;
  }

  addStep(instruction, validation) {
    this.steps.push({ instruction, validation });
  }

  start() {
    this.showInstruction(this.steps[0].instruction);
    
    // Wait for player to complete step
    const checkCompletion = () => {
      if (this.steps[this.currentStep].validation()) {
        this.currentStep++;
        if (this.currentStep < this.steps.length) {
          this.showInstruction(this.steps[this.currentStep].instruction);
        } else {
          this.complete();
        }
      }
    };

    setInterval(checkCompletion, 100);
  }

  showInstruction(text) {
    const div = document.createElement('div');
    div.className = 'tutorial-box';
    div.textContent = text;
    div.setAttribute('role', 'status');
    div.setAttribute('aria-live', 'polite');
    document.body.appendChild(div);
  }
}
```

## Testing for Accessibility

### Automated Testing
```javascript
// Test color contrast
const getContrast = (rgb1, rgb2) => {
  const getLuminance = (r, g, b) => {
    const [rs, gs, bs] = [r, g, b].map(x => {
      x = x / 255;
      return x <= 0.03928 ? 
        x / 12.92 : 
        Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = getLuminance(...rgb1);
  const l2 = getLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
};

// Test: contrast([0, 0, 0], [255, 255, 255]) = 21 (AA and AAA)
```

### Manual Testing
1. **Keyboard Only**: Can you play with keyboard alone?
2. **Screen Reader**: Use NVDA or JAWS to test narration
3. **Color Blind**: Check with ColorOracle or similar tool
4. **Zoom**: Test at 200% zoom level
5. **Mobile**: Test on actual mobile devices
6. **Slow Network**: Test with network throttling
7. **Old Hardware**: Test on older devices

### Accessibility Tools
- axe DevTools: Automated accessibility auditing
- WAVE: Web accessibility evaluation tool
- Lighthouse: Chrome DevTools built-in audit
- Pa11y: Automated accessibility testing

## Competitive Game Accessibility

For 2-player and competitive games, ensure fair play and accessible controls:

### Comprehensive Control Remapping for Both Players
Allow both players to configure their own controls - critical for accessibility and competitive fairness:

```javascript
const CONTROL_ACTIONS = ['punch', 'kick', 'jump', 'block', 'pause'];

function renderControlsGrid(playerNum) {
  const grid = document.getElementById(`p${playerNum}ControlsGrid`);
  const binds = getPlayerKeybinds(playerNum);
  
  grid.innerHTML = '';
  CONTROL_ACTIONS.forEach(action => {
    const binding = binds[action];
    const key1 = Array.isArray(binding) ? binding[0] : binding;
    const key2 = Array.isArray(binding) ? binding[1] : null;
    
    const div = document.createElement('div');
    div.className = 'controlMapping';
    div.innerHTML = `
      <span class="controlLabel">${action.toUpperCase()}</span>
      <span class="controlKey" data-player="${playerNum}" data-action="${action}" data-slot="0">
        ${formatKeyName(key1)}
      </span>
      <span class="controlKey" data-player="${playerNum}" data-action="${action}" data-slot="1">
        ${formatKeyName(key2)}
      </span>
    `;
    grid.appendChild(div);
    
    // Click or Enter key to rebind
    div.querySelectorAll('.controlKey').forEach(keyEl => {
      keyEl.addEventListener('click', () => startListening(playerNum, action, keyEl));
      keyEl.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          startListening(playerNum, action, keyEl);
        }
      });
    });
  });
}

function startListening(playerNum, action, element) {
  element.textContent = '...';
  element.classList.add('listening');
  
  const handleKey = (e) => {
    e.preventDefault();
    applyBinding(playerNum, action, e.code);
    element.classList.remove('listening');
    window.removeEventListener('keydown', handleKey);
  };
  
  window.addEventListener('keydown', handleKey);
}
```

### Multi-Input Gamepad Support
Support both keyboard and gamepad for maximum accessibility:

```javascript
function isActionPressed(playerNum, action) {
  const binds = getPlayerKeybinds(playerNum);
  const gamepad = navigator.getGamepads()?.[playerNum - 1];
  
  // Check keyboard (supports primary + secondary bindings)
  const binding = binds[action];
  if (Array.isArray(binding)) {
    if (binding[0] && keysPressed[binding[0]]) return true;
    if (binding[1] && keysPressed[binding[1]]) return true;
  } else if (binding && keysPressed[binding]) return true;
  
  if (!gamepad) return false;
  
  // Check gamepad buttons (Xbox layout: A=0, B=1, X=2, Y=3, etc.)
  const buttonMap = {
    'punch': 0,     // A button
    'kick': 2,      // X button
    'jump': 1,      // B button
    'block': 3      // Y button
  };
  
  if (buttonMap[action] !== undefined) {
    if (gamepad.buttons[buttonMap[action]]?.pressed) return true;
  }
  
  // Check analog stick
  const stickMap = {
    'punch': null,
    'kick': null,
    'jump': { axis: 1, dir: -1 }  // Up on left stick
  };
  
  if (stickMap[action]?.axis !== undefined) {
    const val = gamepad.axes[stickMap[action].axis] || 0;
    if (val * stickMap[action].dir > 0.5) return true;
  }
  
  return false;
}
```

### Fair Pause Mechanics
For 2-player games, require both players to agree on pausing:

```javascript
class CompetitiveGame {
  constructor() {
    this.paused = false;
    this.pauseRequestedBy = null;
  }
  
  handlePausePress(playerNum) {
    if (this.pauseRequestedBy === playerNum) {
      // This player already requested - cancel it
      this.pauseRequestedBy = null;
      return;
    }
    
    if (this.pauseRequestedBy !== null && this.pauseRequestedBy !== playerNum) {
      // Other player requested, this player confirms
      this.doPause();
      return;
    }
    
    // First request
    this.pauseRequestedBy = playerNum;
    this.showMessage(`Player ${playerNum} paused. Player ${3 - playerNum}: Press PAUSE to confirm.`);
    
    // Timeout: cancel pause request if not confirmed
    clearTimeout(this.pauseTimeout);
    this.pauseTimeout = setTimeout(() => {
      this.pauseRequestedBy = null;
      this.hideMessage();
    }, 3000);
  }
  
  doPause() {
    this.paused = true;
    this.pauseRequestedBy = null;
    clearTimeout(this.pauseTimeout);
  }
  
  resume() {
    this.paused = false;
  }
}
```

### Clear Visual and Audio Feedback
Provide strong feedback for all critical actions - especially important when players can't easily see or hear attacks:

```javascript
// Screen shake on hit
function screenShake(intensity = 5, duration = 200) {
  const start = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed >= duration) {
      clearInterval(interval);
      canvas.style.transform = 'translate(0, 0)';
      return;
    }
    const progress = 1 - (elapsed / duration);
    const angle = Math.random() * Math.PI * 2;
    const dist = progress * intensity;
    canvas.style.transform = `translate(
      ${Math.cos(angle) * dist}px,
      ${Math.sin(angle) * dist}px
    )`;
  }, 16);
}

// Audio feedback for each action (accessible to deaf/hard of hearing with visual cues)
function playSoundEffect(type) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  const soundMap = {
    'punch': { freq: 100, duration: 0.1 },
    'kick': { freq: 80, duration: 0.15 },
    'hit': { freq: 150, duration: 0.08 },
    'block': { freq: 400, duration: 0.05 }
  };
  
  const sound = soundMap[type] || soundMap.hit;
  osc.frequency.value = sound.freq;
  gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + sound.duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + sound.duration);
  
  // Also provide visual effect
  screenShake(3, 50);
}

// Combo counter display (visual feedback for players with hearing impairment)
function displayCombo(count) {
  const comboDisplay = document.getElementById('comboCounter');
  if (comboDisplay) {
    comboDisplay.textContent = `COMBO x${count}`;
    comboDisplay.style.opacity = 1;
  }
}
```

### Control Configuration Persistence
Save player preferences for return visits:

```javascript
function saveControlConfig(playerNum) {
  const config = {
    bindings: getPlayerKeybinds(playerNum),
    gamepadIndex: getPlayerGamepad(playerNum),
    timestamp: Date.now()
  };
  localStorage.setItem(`idlegames-p${playerNum}-controls`, JSON.stringify(config));
}

function loadControlConfig(playerNum) {
  const saved = localStorage.getItem(`idlegames-p${playerNum}-controls`);
  if (saved) {
    const config = JSON.parse(saved);
    applyControlConfig(playerNum, config);
  }
}

// Load on startup
window.addEventListener('DOMContentLoaded', () => {
  loadControlConfig(1);
  loadControlConfig(2);
});
```

## Difficulty and Assistance Options

```javascript
class AccessibilityOptions {
  constructor() {
    this.difficulty = 'normal';
    this.assistanceOptions = {
      // Gameplay assistance
      infiniteAmmo: false,
      noDamage: false,
      slowerEnemies: false,
      enlargedHitBoxes: false,
      
      // Visual assistance
      highContrast: false,
      largerText: false,
      colorBlindMode: 'none',
      textOutlines: false,
      
      // Audio assistance
      captions: true,
      mono: false,
      
      // Motor assistance
      autoAim: false,
      tapToMove: false,
      simplifiedControls: false
    };
  }

  setDifficulty(level) {
    this.difficulty = level;
    // Adjust game parameters
  }

  setAssistance(option, enabled) {
    this.assistanceOptions[option] = enabled;
    this.applySettings();
  }

  applySettings() {
    if (this.assistanceOptions.enlargedHitBoxes) {
      this.game.hitBoxScale = 1.5;
    }
    if (this.assistanceOptions.highContrast) {
      document.body.classList.add('high-contrast');
    }
    // ... etc
  }
}
```

## Resources

- WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
- Game Accessibility Guidelines: https://gameaccessibilityguidelines.com/
- WebAIM: https://webaim.org/
- The A11Y Project: https://www.a11yproject.com/
