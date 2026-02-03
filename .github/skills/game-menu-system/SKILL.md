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

## Rendering and Updates

### 1) Render Once, Update Values In-Place
For `keep-open` actions, **do not rebuild DOM**. Rebuild the **data** and update values in-place.

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

## Custom Action Patterns

### 1) Toggle / +/- without DOM Rebuild
```js
const toggle = (k) => () => {
  state.crewAI[k] = !state.crewAI[k];
  markDirty();
};

{ type: 'setting', label: 'Auto Repair', value: state.crewAI.autoRepair ? 'ON' : 'OFF',
  actions: [{ label: 'Toggle', action: toggle('autoRepair'), behavior: 'keep-open' }] }
```

### 2) Submenu Navigation
```js
{ type: 'action', label: 'System Status', action: () => openMenu('computerSystemStatus') }
```

### 3) Root Menu Close vs Back
If `isRoot` and the action is `Back`, render it as `Close` and set behavior to `close`.

## Concurrency (Game Continues)
Menus should **not pause** the simulation. Keep game state updates independent and let the menu update values via `refreshUnifiedMenuValues`.

## Focus/Key Handling
- Use a single menu key handler tied to the panel.
- Avoid stealing focus when closing menus.
- If you close the panel, blur the active element and return focus to the game canvas.

```js
if (document.activeElement && document.activeElement !== document.body) {
  document.activeElement.blur();
}
const gameCanvas = document.getElementById('gameCanvas');
if (gameCanvas?.focus) gameCanvas.focus();
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
