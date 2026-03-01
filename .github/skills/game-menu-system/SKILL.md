---
name: game-menu-system
description: Build a data-driven, attribute-controlled game menu system with concurrent gameplay and simulation, custom actions, and in-place value updates.
---

# Game Menu System (Data-Driven + Concurrent)

Build a menu system that is **data-driven**, **attribute-controlled**, and **non-blocking** (gameplay and simulation continue while menus are open). This skill defines patterns used in IdleGames to keep UI consistent, fast, and accessible.

## Goals

- **Data-driven menus**: menus are pure data; handlers are separate.
- **Attribute-controlled behavior**: each action chooses how the menu behaves.
- **Concurrent**: menu opens without pausing simulation.
- **No DOM re-creation for toggles/adjusters**: update values in place and preserve focus/scroll.
- **Custom actions**: actions can dispatch game logic while staying in-menu.

## Core Architecture

### 1) Menu Definitions
Define all menus in a single `MENUS` object. Menus are **pure data**.

Implementation note for larger runtimes:
- Keep menu data/builders in a dedicated module (for example `src/ui/menu-definitions.ts`).
- Keep row/item renderers in a separate renderer module (for example `src/ui/menu-render.ts`).
- Keep top-level menu orchestration (stack transitions, queue draining, pointer-lock coupling) in the runtime root (for example `src/main.ts`).

```js
const MENUS = {
  computerRoom: {
    isRoot: true,
    title: 'COMPUTER',
    overview: 'Computer Room systems access',
    items: [
      { type: 'action', label: 'System Status', action: () => openMenu('computerSystemStatus') },
      { type: 'action', label: 'Crew Automation', action: () => openMenu('crewCommand') }
    ],
    actions: [{ label: 'Back', behavior: 'back' }]
  },
  crewCommand: {
    isRoot: false,
    title: 'CREW COMMAND',
    overview: 'Configure crew automation:',
    itemBuilder: 'buildCrewCommandItems',
    actions: [{ label: 'Back', behavior: 'back' }]
  }
};
```

### 2) Behavior Attributes
Every action has a `behavior` attribute that drives navigation:

- `keep-open`: update values **in-place**, no DOM rebuild
- `back`: pop to previous menu
- `submenu`: open another menu
- `close`: close the panel
- `close-all`: clear stack + close

```js
{ label: 'Toggle', action: toggle('autoRepair'), behavior: 'keep-open' }
{ label: 'Back', behavior: 'back' }
```

### 3) Stack-Based Navigation
The menu stack holds the current breadcrumb trail. Root menus replace the stack; submenus push onto it.

```js
if (menuDef.isRoot) {
  state.ui.unifiedMenuStack = [stackEntry];
} else {
  state.ui.unifiedMenuStack.push(stackEntry);
}
```

### 3b) Root vs Submenu Action Convention
Use action buttons consistently:
- **Root-level menus** should expose **Close** (`behavior: 'close'`).
- **Submenus** should expose **Back** (`behavior: 'back'`).

This prevents ambiguous navigation and keeps stack behavior predictable when menus are opened directly from world interactions.

## Rendering and Updates

### 1) Two Update Strategies

**refreshUnifiedMenuValues()** - Update values in-place without DOM rebuild:
- Use for toggles, counters, status displays
- Updates text content only
- Preserves focus and scroll position

**rebuildUnifiedMenuInPlace()** - Full DOM rebuild:
- Use when items are added/removed from the menu
- Use when the list structure changes (crew hired/dismissed, contracts completed)
- Rebuilds entire menu but keeps the same menu open

```js
function handleMenuBehavior(behavior, target, menuDef) {
  switch (behavior) {
    case 'keep-open': {
      const current = state.ui.unifiedMenuStack.at(-1);
      let items = current.definition.items || [];
      if (current.definition.itemBuilder) {
        const builder = MENU_HANDLERS[current.definition.itemBuilder];
        if (typeof builder === 'function') items = builder();
      }
      current.items = items;
      // Only updates values - fast, preserves focus
      refreshUnifiedMenuValues(current.definition, items);
      break;
    }
  }
}
```

### 2) In-Place Value Refresh
Use data attributes to map items to DOM elements.

```js
function renderUnifiedSettingItem(container, item, menuDef) {
  const row = document.createElement('div');
  row.className = 'menu-setting-item';
  row.dataset.menuLabel = item.label;

  const value = document.createElement('div');
  value.className = 'menu-setting-value';
  value.textContent = item.value || '';

  row.appendChild(value);
  container.appendChild(row);
}

function refreshUnifiedMenuValues(menuDef, items) {
  const menuItemsEl = document.getElementById('panelMenuItems');
  if (!menuItemsEl) return;

  for (const item of items) {
    if (item.type === 'setting') {
      const row = [...menuItemsEl.querySelectorAll('.menu-setting-item')]
        .find(el => el.dataset.menuLabel === item.label);
      if (row) {
        const valueEl = row.querySelector('.menu-setting-value');
        if (valueEl) valueEl.textContent = item.value || '';
      }
    }
  }
}
```

### 2e) Queue-Driven Live Bindings (Recommended)
For frequently changing simulator values (power, fuel, temperatures), prefer a queue-driven, in-place binding approach that never rebuilds the menu DOM while it is visible.

Pattern:
- Add a stable key per live value (for example `liveValueKey`).
- During render, bind only the value element node to that key (`Map<key, HTMLElement>`).
- Emit lightweight UI snapshot events from sim/event-queue only when values actually change.
- Gate high-frequency stat event emission to when the target menu is visible, and apply a minimum enqueue interval to avoid queue churn.
- On event consume, update bound text nodes directly (no `renderMenu()` call).
- Keep `keep-open` behavior for toggle actions, but use a fast path that drains queue + applies live bindings and returns without redraw.

```js
// 1) Bind during render
if (item.liveValueKey) {
  liveMenuValueBindings.set(item.liveValueKey, valueEl);
}

// 2) Emit only on change
function enqueueStatsIfChanged(stats) {
  const nextSig = serialize(stats);
  if (nextSig === lastSig) return;
  lastSig = nextSig;
  queue.push({ type: 'ui/menu-stats', stats });
}

// 3) Consume and update in-place
function applyLiveStats(stats) {
  if (!isTargetMenuVisible()) return;
  for (const [key, element] of liveMenuValueBindings) {
    element.textContent = toText(key, stats);
  }
}

// 4) keep-open fast path (no redraw)
if (behavior === 'keep-open' && isTargetMenuVisible()) {
  drainEvents();
  applyLiveStats(currentStats());
  return; // preserve focus + scroll + DOM identity
}
```

Why this is preferred:
- Preserves current focused button and keyboard context.
- Preserves scroll position in long/scrollable panels.
- Avoids DOM churn and reduces GC/layout pressure.
- Keeps simulation/event queue as the source of truth, UI as a consumer.

### 2b) Custom Item Types (Non-Standard Rows)
When you introduce a new item type (for example, a feed entry with metadata + buttons), add a dedicated renderer and wire it in `renderUnifiedMenu`.

```js
// In renderUnifiedMenu
if (item.type === 'spacebook') {
  renderUnifiedSpacebookItem(menuItemsEl, item, menuDef);
}

// Dedicated renderer
function renderUnifiedSpacebookItem(container, item, menuDef) {
  const wrapper = document.createElement('div');
  wrapper.className = 'spacebook-post';
  // ...header/meta/content and per-item actions...
  container.appendChild(wrapper);
}
```

### 2d) Document/Letter Content Pattern
For readable in-world documents (letters, logs, memos), prefer one structured custom item over multiple spacer text rows.

```js
{
  type: 'letter',
  from: 'Chief Engineer',
  to: 'Captain',
  subject: 'Routing Update',
  dateUtc: '2026-02-14 22:10:00 UTC',
  paragraphs: ['Paragraph 1', 'Paragraph 2']
}
```

Renderer guidance:
- Render metadata (from/to/subject/date) in a header block.
- Render body as paragraph elements from `paragraphs[]`.
- Set an explicit dark ink text color in the custom row styles; do not rely on global value colors intended for generic menu rows.

### 2c) Tables With Button Columns
Use a `table` item when you need rows with button actions. Each row is an array of cells; button cells use `{ type: 'button', label, action, behavior }`.

```js
function buildCrewRosterItems() {
  const rows = listRosterEntries().map((entry) => ({
    cells: [
      entry.typeLabel,
      entry.name,
      entry.role.toUpperCase(),
      entry.onDuty ? 'YES' : 'NO',
      {
        type: 'button',
        label: 'Rename',
        action: () => openMenu('crewRosterRename', { uid: entry.uid })
      },
      {
        type: 'button',
        label: 'Role',
        action: () => openMenu('crewRosterRole', { uid: entry.uid })
      }
    ]
  }));

  return [
    {
      type: 'table',
      columns: ['Type', 'Name', 'Role', 'On Duty', 'Rename', 'Role'],
      rows
    }
  ];
}
```

Render buttons inside `renderUnifiedTableItem` and wire `behavior` through `handleMenuBehavior` so table actions can keep the menu open or navigate.

### 3) Full Menu Rebuild for List Changes
When items are added/removed (crew hired, inventory exhausted), rebuild the DOM:

```js
function rebuildUnifiedMenuInPlace() {
  if (state.ui.unifiedMenuStack.length === 0) return;
  const current = state.ui.unifiedMenuStack[state.ui.unifiedMenuStack.length - 1];

  let items = current.definition.items || [];
  if (current.definition.itemBuilder) {
    const builder = MENU_HANDLERS[current.definition.itemBuilder];
    if (typeof builder === 'function') {
      items = builder();
    }
  }

  current.items = items;
  renderUnifiedMenu(current.definition, items, { _skipPush: true });
}

// Use in actions that change list structure
function buildTransferCrewOutItems(options = {}) {
  const npcs = state.npcs.filter(Boolean);
  const items = [/* ... */];

  for (const n of npcs) {
    items.push({
      type: 'action',
      label: `Dismiss ${n.name}`,
      action: () => {
        removeCrewMemberById(n.id);
        updateHUD();
        markDirty();
        rebuildUnifiedMenuInPlace(); // Rebuild to remove button
      },
      danger: true,
      behavior: 'keep-open'
    });
  }

  return items;
}
```

## Custom Action Patterns

### 1) Toggle / +/- without DOM Rebuild
**CRITICAL:** Never call `openMenu()` within an action to refresh. Let `behavior: 'keep-open'` handle it.

```js
const toggle = (k) => () => {
  state.crewAI[k] = !state.crewAI[k];
  markDirty();
  // NO openMenu() call - keep-open handles refresh
};

{ type: 'setting', label: 'Auto Repair', value: state.crewAI.autoRepair ? 'ON' : 'OFF',
  actions: [{ label: 'Toggle', action: toggle('autoRepair'), behavior: 'keep-open' }] }
```

### 2) List Management (Add/Remove Items)
Use `rebuildUnifiedMenuInPlace()` when the action changes the list structure:

```js
function buildTransferCrewInItems(options = {}) {
  const fee = 30;
  const candidates = ['CREW', 'TECH', 'MEDIC', /* ... */];
  
  const items = [
    { type: 'setting', label: 'Transport Fee', value: `${fee} credits`, actions: [] },
    { type: 'setting', label: 'Available Credits', value: `${Math.floor(state.credits)}`, actions: [] },
    { type: 'divider' }
  ];

  for (const name of candidates) {
    items.push({
      type: 'action',
      label: `Hire ${name} (have ${have})`,
      action: () => {
        if (state.credits < fee) {
          openMenu('transferCrewInInsufficientCredits'); // Navigate to error submenu
          return;
        }
        state.credits -= fee;
        addCrewMember(name);
        updateHUD();
      **NEVER call `openMenu()` within an action to refresh** - let `behavior: 'keep-open'` handle it.
- [ ] Use `rebuildUnifiedMenuInPlace()` when items are added/removed from lists.
- [ ] Use `refreshUnifiedMenuValues()` (automatic via keep-open) for value-only updates.
- [ ] Error/status messages use dedicated submenus, not dialog popups.
- [ ] Root menus show **Close**, submenus show **Back**.
- [ ] Focus returns to game canvas on close.

## Common Mistakes to Avoid

1. **Calling `openMenu()` to refresh the current menu**
   ```js
   // ❌ WRONG - creates duplicate menu stack entries
   action: () => {
     state.credits -= 10;
     openMenu('transferCrewIn'); // Don't do this!
   }

   // ✅ CORRECT - let keep-open handle refresh
   action: () => {
     state.credits -= 10;
     markDirty();
   },
   behavior: 'keep-open'
   ```

2. **Using dialog popups instead of submenus**
   ```js
   // ❌ WRONG - breaks unified menu flow
   if (state.credits < fee) {
     showMessage('QUARTERS', 'Need more credits');
     return;
   }

   // ✅ CORRECT - navigate to error submenu
   if (state.credits < fee) {
     openMenu('transferCrewInInsufficientCredits');
     return;
   }
   ```

3. **Not rebuilding when list structure changes**
   ```js
   // ❌ WRONG - button stays even after dismissing
   action: () => {
     removeCrewMemberById(n.id);
     // Missing rebuildUnifiedMenuInPlace()
   }

   // ✅ CORRECT - rebuild to remove button
   action: () => {
     removeCrewMemberById(n.id);
     updateHUD();
     markDirty();
     rebuildUnifiedMenuInPlace();
   }
   ```
      danger: !affordable,
      behavior: 'keep-open'
    });
  }

  return items;
}
```

### 3) Error/Status Submenus
Create dedicated submenus for errors instead of dialog popups:

```js
// Menu definition
transferCrewInInsufficientCredits: {
  isRoot: false,
  stationType: 'quarters',
  title: 'INSUFFICIENT CREDITS',
  overview: 'Cannot afford this hire:',
  itemBuilder: 'buildTransferCrewInInsufficientCreditsItems',
  actions: [
    { label: 'Back', behavior: 'back' }
  ]
},

// Item builder
function buildTransferCrewInInsufficientCreditsItems(options = {}) {
  const fee = 30;
  return [
    { type: 'setting', label: 'Required Credits', value: `${fee}`, actions: [] },
    { type: 'setting', label: 'Available Credits', value: `${Math.floor(state.credits)}`, actions: [] },
    { type: 'setting', label: 'Shortage', value: `${fee - Math.floor(state.credits)}`, actions: [] }
  ];
}
```

### 4) Submenu Navigation
```js
{ type: 'action', label: 'System Status', action: () => openMenu('computerSystemStatus'), behavior: 'submenu' }
```

### 5) Root Menu Close vs Back
If `isRoot` and the action is `Back`, render it as `Close` and set behavior to `close`.

## Concurrency (Game Continues)
Menus should **not pause** the simulation. Keep game state updates independent and let the menu update values via `refreshUnifiedMenuValues`.

## Focus/Key Handling
- Use a single menu key handler tied to the panel.
- Avoid stealing focus when closing menus.
- If you close the panel, blur the active element and return focus to the game canvas.
- Always stop propagation for menu Enter/Escape/Space so input does not leak to gameplay.

```js
if (document.activeElement && document.activeElement !== document.body) {
  document.activeElement.blur();
}
const gameCanvas = document.getElementById('gameCanvas');
if (gameCanvas?.focus) gameCanvas.focus();
```

```js
// Inside the menu key handler
if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
  e.preventDefault();
  e.stopPropagation();
  // ...menu handling...
}
```

## Checklist

- [ ] All menus live in `MENUS` data.
- [ ] All actions use `behavior` attributes.
- [ ] `keep-open` does **in-place updates** only.
- [ ] No action calls `openMenu` to refresh itself.
- [ ] Root menus show **Close**, submenus show **Back**.
- [ ] Focus returns to game canvas on close.

## Use This Skill When

- You need non-blocking in-game menus.
- You want a consistent data-driven menu architecture.
- You need toggles and adjusters that update values without re-creating DOM.
- You need stack-based navigation with root/submenu behavior.
