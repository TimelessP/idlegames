---
name: threejs-browser-game-dev
description: Build browser-based Three.js 3D games with sane axis conventions, disciplined scene graphs, stable camera and lighting setup, procedural geometry patterns, and practical debugging habits. Use when creating or refactoring a Three.js game so transforms, materials, and coordinate systems stay understandable.
---

# Three.js Browser Game Development

Use this skill when building a browser 3D game in Three.js, especially in a single HTML file or lightweight vanilla-JS codebase where there is no engine editor to hide coordinate mistakes.

This skill is about preventing confusion before it starts. The goal is to make scene layout, model orientation, camera behavior, lights, procedural geometry, and material choices consistent enough that later debugging stays local instead of turning into a full-world axis crisis.

## What This Skill Is For

Typical triggers:
- Starting a new browser-based 3D game in Three.js
- Refactoring a scene that has become hard to reason about
- Defining what `x`, `y`, and `z` mean in gameplay and rendering terms
- Building compound vehicles, props, instruments, or interiors from primitives
- Fixing transform confusion caused by nested groups and ad hoc rotations

Use this for:
- Coordinate-system conventions
- Scene graph and transform discipline
- Camera rig design
- Light setup for stylized or readable gameplay scenes
- Procedural geometry assembly from primitives and extrusions
- Material and texture defaults for browser delivery

Do not use this for:
- Heavy DCC asset pipelines as the main workflow
- Physics-engine architecture unrelated to scene construction
- Narrow mobile rendering defects after the architecture is already sound

## First Rule: Define The World Axes Early

Pick one world convention and state it near the top of the file.

Recommended browser-game convention:
- `x`: left/right
- `y`: up/down
- `z`: forward/back

This matches Three.js defaults well enough to reduce surprise:
- the default camera looks down `-z`
- `y` as up matches gravity and human intuition
- yaw commonly rotates around `y`

Write the convention down in code comments and keep gameplay language aligned with it.

Example:

```javascript
// World frame:
// x = left/right
// y = up/down
// z = forward/back
// Positive yaw turns around +y.
```

## Second Rule: Separate World Orientation From Model Orientation

The biggest source of pain in Three.js game code is mixing these two ideas:
- how the world is defined
- how a specific mesh was authored or procedurally constructed

A model may naturally point along `+x`, `+z`, or `-z`. That is fine. Do not rewrite your entire world around one mesh.

Instead:
1. Keep the world convention fixed.
2. Create a model root group.
3. Rotate the model once so its gameplay-forward direction matches your world-forward direction.
4. Attach gameplay logic to the root, not to random child meshes.

Pattern:

```javascript
const ship = new THREE.Group();
scene.add(ship);

const visual = new THREE.Group();
ship.add(visual);

// The built geometry happened to point +x, but gameplay forward is +z.
visual.rotation.y = -Math.PI * 0.5;
```

This keeps movement, aiming, camera follow, and hit logic attached to one stable root.

## Third Rule: Use Clear Group Roles

Do not make every mesh a sibling with its own mysterious rotation. Build a small hierarchy where each group has one job.

Useful group roles:
- root group: world position and gameplay-facing orientation
- visual group: static correction for model forward/up alignment
- body group: main hull or chassis geometry
- control-surface group: animated parts such as rudders, flaps, wheels, turrets
- face group: a sub-group that rotates a panel, dashboard, or sign so child details stay easy to author

This is especially important for panels, instruments, decals, or cabins. If a panel needs to face the player, rotate the whole panel group once instead of rotating every knob, label, and gauge independently.

Pattern:

```javascript
const panel = new THREE.Group();
body.add(panel);
panel.position.set(0, 1.2, 0.8);
panel.rotation.x = -0.35;

const face = new THREE.Group();
panel.add(face);
face.rotation.y = Math.PI;

face.add(makeGauge());
face.add(makeSwitch());
face.add(makeLabel());
```

## Local Space vs World Space

Three.js transforms are local by default. Most confusion comes from forgetting which space a value belongs to.

Use these rules:
- set `position`, `rotation`, and `scale` assuming the parent is the local frame
- animate moving parts in their local space whenever possible
- only query world transforms when needed for gameplay, effects, or camera behavior

Helpful tools:
- `object.getWorldPosition(vec)`
- `object.getWorldQuaternion(quat)`
- `object.localToWorld(vec)`
- `object.worldToLocal(vec)`

If a child needs a strange position, check the parent’s transform before assuming the child is wrong.

## Time Step, FPS, And Non-Frame-Locked Simulation

Three.js does not give you a game loop for free. If your simulation is tied to "one update per frame" instead of elapsed time, the game will fly differently on different devices.

Use wall-clock delta time, not frame count.

### Always Simulate With `dt`

Recommended pattern:

```javascript
let lastT = performance.now();

function frame(now) {
  let dt = (now - lastT) / 1000;
  lastT = now;

  update(dt);
  render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

That means:
- movement should use units per second
- rotation rates should use radians per second
- control slew rates should use units per second
- damping and interpolation terms should be scaled by `dt`

Bad pattern:

```javascript
position.x += 0.2;
heading += 0.01;
```

Good pattern:

```javascript
position.x += speed * dt;
heading += turnRate * dt;
```

### Cap Large `dt` Spikes

When a tab resumes, the browser stalls, or the game unpauses, you can get a huge delta time. Feeding that directly into physics often causes tunneling, explosive forces, or giant control jumps.

Use a cap:

```javascript
let dt = (now - lastT) / 1000;
if (dt > 0.05) dt = 0.05;
```

`0.05` seconds is a practical cap for lightweight browser games because it limits one-step jumps to roughly 20 FPS worth of simulation.

### FPS Is A Measurement, Not A Physics Input

FPS matters for smoothness and responsiveness, but your simulation should not depend on the current framerate.

Think of it this way:
- FPS tells you how often you get to draw
- `dt` tells you how much simulated time passed

If a player is running at 30 FPS and another at 120 FPS, they should still get the same aircraft acceleration, camera follow speed, and control authority over one real second.

### Input Feel Must Also Be Framerate-Independent

Do not smooth controls by adding a fixed amount per frame.

Bad:

```javascript
input += 0.1;
```

Good:

```javascript
input += pressRate * dt;
```

This is especially important for:
- throttle movement
- camera lag
- stick easing
- banking auto-level
- procedural animations like prop spin or instrument needles

### Use Seconds-Based Parameters

Choose parameter names and meanings that make time dependence obvious.

Good parameter examples:
- `PITCH_RATE = 1.4` meaning radians per second
- `pressRate = 1.6` meaning input units per second
- `ENGINE_THRUST = 18` meaning metres per second squared
- `friction = 6.0` meaning metres per second squared of deceleration

This makes tuning much easier because parameters survive FPS changes.

### Separate Simulation Timing From Visual Timing

Some effects are purely visual and may intentionally track rendered frames, but most game state should still be seconds-based.

Good split:
- simulation state uses `dt`
- camera smoothing uses `dt`
- HUD needles and animated props use `dt`
- one-off screen-space effects can be frame-based only if the result is purely cosmetic

If changing monitors from 60 Hz to 144 Hz changes how the game plays, your timing contract is broken.

## Rotation Discipline

### Prefer One Driving Axis Per Behavior

Use the axis that matches the gameplay behavior:
- yaw around `y`
- pitch around `x`
- roll around `z`

If a mesh’s authored orientation does not match that, correct it once in a visual wrapper group rather than scattering compensating rotations throughout update code.

### Keep Static Corrections Out Of Runtime Logic

Bad pattern:

```javascript
mesh.rotation.y = heading + Math.PI * 0.5;
mesh.rotation.z = bank - Math.PI;
```

Better pattern:

```javascript
visual.rotation.y = -Math.PI * 0.5;

root.rotation.y = heading;
root.rotation.z = bank;
```

Static orientation fixes belong in construction code. Runtime logic should express gameplay state directly.

### Consider Quaternions When Order Starts Fighting You

Euler angles are fine for many browser games, but if nested yaw/pitch/roll behavior starts producing order bugs, move the affected subsystem to quaternions rather than stacking more compensating rotations.

## Flight Simulators: Body Axes, Dynamics, And Controls

If you are making a flight game, add a second coordinate contract on top of your world axes: the aircraft body frame.

Example body-frame convention:
- local forward: whichever axis the airframe truly points along, such as `+x`
- local up: aircraft roof direction, often `+y`
- local right: starboard direction, often `+z`

The important part is not which local axis is forward. The important part is that you define it once and use it consistently everywhere in the flight model.

### Keep World Axes And Body Axes Separate

For flight work, you usually need both:
- world frame for gravity, terrain, runway placement, and world-heading references
- body frame for pilot controls, thrust, lift, sideslip damping, and instrument logic

Recommended rule:
- apply pilot pitch, roll, and rudder in body space
- apply gravity in world space
- use world-up only for things that truly belong to the world, such as coordinated-turn yaw assistance or runway alignment

### Derive Local Axes From The Current Quaternion Every Frame

Do not cache these conceptually and hope they stay valid after rotation. Recompute them from the aircraft quaternion before using them.

Pattern:

```javascript
const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(flight.quat);
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(flight.quat);
const right = new THREE.Vector3(0, 0, 1).applyQuaternion(flight.quat);
```

If your plane uses a different local-forward axis, change the basis vectors but keep the pattern the same.

### Recommended Flight-State Shape

Keep the flight state minimal and explicit:

```javascript
const flight = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  throttle: 0,
  pitchInput: 0,
  rollInput: 0,
  yawInput: 0,
  brakeInput: false,
  onGround: true,
  crashed: false,
};
```

This is enough for a convincing lightweight flight model if the contracts stay clean.

### Recommended Functions

These function boundaries worked well and are worth preserving:
- `spawnAt(airfield)` or `spawnAtRunway(runway)` to initialize position, heading, and throttle state
- `updateFlight(dt)` as the single owner of orientation, forces, and ground interaction
- `easeAxis(current, target)` to shape raw control input into flyable authority
- `updateCamera(dt)` kept separate from the flight model
- small helpers for runway contact, terrain height, and world-heading conversion

Do not scatter flight math across rendering, HUD, and input code.

### Pilot Controls Should Act In Local Aircraft Space

For the core feel, apply pitch, roll, and yaw about the aircraft's current local axes.

Pattern:

```javascript
dq.setFromAxisAngle(right,   pitchInput * PITCH_RATE * dt);
flight.quat.premultiply(dq);

dq.setFromAxisAngle(forward, -rollInput * ROLL_RATE * dt);
flight.quat.premultiply(dq);

// Rudder/yaw about local up, not world up.
dq.setFromAxisAngle(up, -yawInput * YAW_RATE * dt);
flight.quat.premultiply(dq);
```

That local-yaw choice matters. If yaw is applied around world up instead, the rudder starts behaving like a camera orbit when the aircraft is banked or pitched.

### Control Authority Should Scale With Airspeed

Arcade and sim-lite flight models both feel better when control effectiveness is weak at very low airspeed and stronger near flying speed.

Useful pattern:
- define a reference speed such as half-cruise or approach speed
- scale pitch and roll authority up toward 1.0 as speed increases
- optionally keep ground rudder or tailwheel steering separate and stronger

Example shape:

```javascript
const ctrlEff = Math.min(1, speed / referenceSpeed);
const yawRate = onGround ? GROUND_YAW_RATE : YAW_RATE;
const yawEff = onGround ? 1 : ctrlEff;
```

This avoids dead-feeling takeoff rolls while still keeping airborne controls honest.

### Smooth Raw Inputs Before They Reach The Flight Model

Good flight feel often comes from control shaping before physics, not from adding more physics afterward.

The pattern that worked well here:
- map keyboard or touch to raw target values in `[-1, 1]`
- slew toward those targets over time
- make press buildup slower than release so quick taps stay gentle and recovery feels crisp

Useful contract:

```javascript
function easeAxis(current, target, pressRate, releaseRate, dt) {
  const tgt = THREE.MathUtils.clamp(target, -1, 1);
  const sameDir = (tgt !== 0) && Math.sign(tgt) === Math.sign(current);
  const buildingUp = sameDir && Math.abs(tgt) > Math.abs(current);
  const rate = buildingUp ? pressRate : releaseRate;
  const step = rate * dt;
  if (Math.abs(tgt - current) <= step) return tgt;
  return current + Math.sign(tgt - current) * step;
}
```

This is especially good for landing approaches and touch controls.

### A Simple, Effective Force Model

For a lightweight browser flight game, you can get a long way with five ingredients:
- thrust along local forward
- gravity in world down
- lift along local up based on forward airspeed
- quadratic drag opposite velocity
- light sideslip damping so the aircraft does not skate sideways forever

Good parameter surface:
- `STALL_SPEED`
- `CRUISE_SPEED`
- `MAX_SPEED`
- `ENGINE_THRUST`
- `DRAG_COEF`
- `PITCH_RATE`
- `ROLL_RATE`
- `YAW_RATE`
- `GROUND_YAW_RATE`
- `GRAVITY`
- `LIFT_COEF`

That set is compact, tuneable, and understandable.

### Lift Should Follow Forward Airspeed, Not Total Speed Blindly

Use the component of velocity along the aircraft forward axis, not just the total velocity magnitude.

Pattern:

```javascript
const fwdSpeed = Math.max(0, velocity.dot(forward));
const liftFactor = Math.min(1.4, (fwdSpeed * fwdSpeed) / (CRUISE_SPEED * CRUISE_SPEED));
const stallScale = fwdSpeed < STALL_SPEED ? (fwdSpeed / STALL_SPEED) * 0.4 : 1;
const lift = LIFT_COEF * GRAVITY * liftFactor * stallScale;
velocity.addScaledVector(up, lift * dt);
```

This gives you a readable stall story and a clear equilibrium target around cruise speed.

### Add Gentle Nose-Following To The Velocity Vector

Without some aerodynamic alignment, a plane can point steeply down while its velocity keeps carrying it in an old direction, which feels wrong in a lightweight model.

One pragmatic fix is to rotate the velocity vector a small fraction toward the nose direction each frame, scaled by airspeed. This gives a weather-vaning effect without requiring a full aerodynamic simulation.

Use it gently. It should guide the motion, not override it.

### Coordinated Turns Need A Small World-Up Assist

If the aircraft banks, the lift vector tilts. In a lightweight model, adding a modest coordinated-turn yaw around world up helps banked turns feel like arcs instead of pure rolls.

Useful pattern:
- derive bank from current local axes
- estimate turn rate from $g \tan(\text{bank}) / \text{TAS}$
- clamp it hard
- scale it down so it assists rather than dominates

Important distinction:
- rudder input yaw should be local to the plane
- coordinated-turn assistance can be around world up because it represents path curvature in the world

### Sideslip Damping Is Worth Keeping Explicit

In a simple model, damping the velocity component along the local right axis is an easy way to reduce unrealistic sideways skating.

Pattern:

```javascript
const sideV = velocity.dot(right);
velocity.addScaledVector(right, -sideV * damping * dt);
```

This is cheap and does a lot of work.

### Auto-Level Should Be Mild And Conditional

For an accessible or arcade-leaning flight game, mild roll auto-level works well if:
- it only acts when the player is not actively rolling
- it is weak enough not to fight intentional banked flight

Good cue:
- use the aircraft's local right vector against world up to determine bank sign
- apply a small corrective roll around local forward

### Ground Handling Deserves Its Own Logic

Do not expect the airborne force model to make taxi, takeoff roll, or landing feel right.

Useful ground-specific behaviors:
- stronger yaw on the ground than in the air for rudder or tailwheel steering
- runway vs rough-ground friction
- idle-throttle braking semantics
- vertical impact and attitude checks for crash detection
- a separate ground sit attitude, especially for taildraggers

### Taildraggers Need Contact Geometry, Not Just A Magic Height Offset

If the aircraft sits tail-down on the ground, define approximate local contact points for main wheels and tail skid, rotate those points by the current aircraft orientation, and solve the aircraft pivot height from the lowest active contact.

That gives you:
- a real tail-down sit angle
- a natural transition toward level as airspeed lifts the tail
- cleaner landing and takeoff behavior than a constant offset

This is one of the highest-value details in a lightweight prop-plane model.

### Recommended Ground Parameters

Useful parameters to keep explicit:
- `tailDownSpeed`
- `tailUpSpeed`
- `sitAngle`
- runway friction
- rough-ground friction
- braking deceleration
- crash sink-rate threshold
- minimum levelness threshold for safe touchdown

These are gameplay-facing parameters, so they should be easy to tune.

### Input Mapping Guidance

For keyboard flight controls, map to semantic axes, not directly to Euler properties.

Example:
- pitch: `W/S` or arrow up/down
- roll: `A/D` or arrow left/right
- yaw/rudder: `Q/E`
- throttle: separate up/down controls or a lever
- brake: separate control, or implicit when throttle is held at idle on the ground

For touch:
- left pad for pitch and roll
- right pad or lever for throttle
- horizontal component of the throttle pad can drive rudder

That split works well on phones because it keeps attitude and power separate.

### Keep Camera And Flight Logic Decoupled

A chase camera can use local offsets from the aircraft, but it should observe the flight state rather than participate in it.

Recommended camera contract:
- one local offset behind and above the aircraft
- one local look offset near the nose or cockpit
- smoothing in `updateCamera(dt)`, not in `updateFlight(dt)`

### Recommended Update Order For Flight Games

1. Read raw input.
2. Ease input toward semantic control targets.
3. Derive local aircraft axes from the current quaternion.
4. Apply pilot rotations in body space.
5. Re-derive axes.
6. Apply coordinated-turn assist if desired.
7. Apply thrust, gravity, lift, drag, and sideslip damping.
8. Integrate position.
9. Resolve ground contact, braking, crash logic, and sit attitude.
10. Copy state to the plane mesh.
11. Update camera and HUD.

That ordering avoids stale-axis bugs and keeps local-yaw behavior correct.

### Common Flight-Model Mistakes

#### "Yaw Feels Wrong When Banked"

You are probably yawing around world up instead of the aircraft's local up vector.

#### "Rolling Does Not Really Turn The Plane"

The model is missing either coordinated-turn assistance, aerodynamic velocity alignment, or both.

#### "The Plane Slides Sideways Forever"

Add explicit sideslip damping in body space.

#### "Takeoff And Taxi Feel Like The Same State"

Ground steering, braking, and sit attitude need their own rules instead of sharing the pure airborne model.

#### "It Is Technically Flying But Feels Terrible"

Check the control-shaping layer first. Input slew rates and throttle semantics often matter more than another force term.

## Camera Rig Patterns

Treat the camera as its own rig, not as a magical object with hand-tuned offsets scattered through the update loop.

Useful setup:
- camera target group: follows the gameplay root
- camera boom group: provides distance and pitch
- camera object: the actual `PerspectiveCamera`

Pattern:

```javascript
const cameraTarget = new THREE.Group();
scene.add(cameraTarget);

const cameraBoom = new THREE.Group();
cameraTarget.add(cameraBoom);
cameraBoom.rotation.x = -0.2;

const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
cameraBoom.add(camera);
camera.position.set(0, 2.5, -8);
```

Why this helps:
- follow logic updates one target
- pitch changes stay local to the boom
- shake or look offsets can be layered cleanly
- cockpit, chase, and fly-by cameras can share the same target logic

## Light For Readability First

In a browser game, lighting is not a film render. It is part of UX.

Good default stack:
- one directional light for sun or moon shape
- one hemisphere or ambient contribution for readable shadows
- moderate shadow settings only where they improve play

Guidelines:
- start with readable midtones, not dramatic darkness
- keep the main directional light and ambient contribution in balance
- shadow quality should be optional when performance matters
- if the game depends on seeing surface shape, do not let full-shadow black swallow key forms

Recommended mindset:
- style can be dramatic
- gameplay readability cannot be optional

## Procedural Geometry Patterns

For handcrafted browser 3D scenes, primitives and extrusions are often enough.

Good practice:
- build larger objects from named helper functions
- return groups, not loose meshes
- keep dimensions in variables with semantic names
- define one local origin per part that makes assembly easy

Example:

```javascript
function makeWingSpan({ span, chord, thickness, material }) {
  const wing = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(span, thickness, chord),
    material
  );
  wing.add(slab);
  return wing;
}
```

For `ExtrudeGeometry`:
- decide which axis the profile is drawn in before writing points
- document whether the extrusion depth becomes local `z` or needs reorientation
- split face and side materials when caps and sides need different shading or debugging treatment

## Winding Order, Normals, And Mirroring

Yes, these deserve to be explicit because they cause some of the worst fake "lighting" bugs.

### Winding Order Controls Which Side Is Front

By default, Three.js materials usually render front faces only. Which side counts as the front depends on triangle winding order.

Practical implication:
- if geometry is built with the opposite winding order from what you intended, a surface may vanish or appear wrong from one side
- this can look like a lighting problem when it is really a face-orientation problem

When building custom shapes or indexing geometry by hand:
- keep vertex order consistent
- verify which side is meant to face outward
- do not assume a mesh is "dark" when it may actually be back-face culled

### Normals Are Part Of The Shape Contract

Normals are not polish. They define how light reads the surface.

Rules:
- if you generate or modify geometry, recompute or inspect normals intentionally
- if a surface looks inverted, check normals before retuning lights
- if a mesh should look faceted, use flat shading deliberately instead of living with broken normals

Useful checks:
- `geometry.computeVertexNormals()` after procedural edits
- `material.flatShading = true` as a diagnostic for smoothing problems
- `VertexNormalsHelper` or a temporary debug visualization when a surface still looks impossible

### Mirroring Can Flip More Than The Visual Shape

Negative scale is convenient, but it can invert handedness and make front faces or normals behave differently than expected.

Be careful with:
- `mesh.scale.x = -1`
- mirrored child groups used to duplicate wings, doors, props, or panels

If a mirrored part behaves strangely:
- compare it to a non-mirrored copy with the same material
- test `THREE.DoubleSide` as a probe, not as the automatic final fix
- inspect normals and face orientation on the mirrored branch
- prefer rebuilding a symmetric part cleanly when mirroring keeps leaking problems into shading or culling

### Debug Order For "This Face Looks Wrong"

When one surface is black, inside-out, or only visible from some angles, check in this order:
1. Is it back-face culling from winding order?
2. Are the normals pointing where you think they are?
3. Is a negative scale or mirrored parent flipping handedness?
4. Only then retune lights, shadows, or materials.

This prevents wasted time on shadow bias and exposure when the real bug is geometric orientation.

## Naming And Debugging Conventions

Name important groups and parts clearly. This matters more in 3D than in 2D because the hierarchy is the map.

Helpful names:
- `planeRoot`
- `planeVisual`
- `upperWing`
- `cockpitPanelFace`
- `tailRudderPivot`

For hard bugs, temporary helpers are worth it:
- `AxesHelper` on roots and pivots
- `Box3Helper` for bounds
- `VertexNormalsHelper` when the surface response makes no geometric sense
- a toggle for wireframe or unlit materials
- a toggle to show pivot markers or debug lines

Remove one-off probes after the issue is understood, but keep conventions that made the debugging faster.

## Materials And Texture Defaults

Prefer simple, explicit defaults over clever implicit ones.

For browser-delivered Three.js games:
- set `renderer.outputColorSpace = THREE.SRGBColorSpace`
- set texture color space intentionally when using color textures
- use `MeshStandardMaterial` when you want light response
- use `MeshBasicMaterial` for HUD-like or diagnostic surfaces
- keep transparency usage deliberate because sorting can become its own problem

For runtime-generated textures:
- prefer conservative filtering when mobile behavior matters
- mark updates explicitly
- treat dynamic texture sampling as a potential cross-device issue

## Build Order For A New Three.js Game

Recommended sequence:
1. Define world axes and gameplay forward.
2. Create renderer, camera, and resize handling.
3. Add a readable light stack before detailed modeling.
4. Build a test object with clear forward/up indicators.
5. Establish the root and visual-group pattern.
6. Add one controllable gameplay object.
7. Add camera follow behavior.
8. Add environment and secondary props.
9. Add materials and texture detail.
10. Only then tune shadows, post, and polish.

This order prevents many false bugs where the real problem is that the camera, model, and world conventions were never made consistent.

## Common Failure Modes

### "Why Is Forward Sideways?"

The mesh was authored in one forward direction and gameplay assumes another. Fix it in a visual wrapper group once.

### "Why Did Rotating The Panel Flip All The Labels?"

You rotated individual children instead of creating a face group that owns the panel orientation.

### "Why Does My Child Mesh Move Wrong When The Parent Turns?"

You are thinking in world space while editing local transforms. Check the parent transform first.

### "Why Are My Update Equations Full Of `+ Math.PI / 2`?"

Static orientation corrections leaked into runtime logic. Move them back into construction code.

### "Why Is This So Hard To Debug?"

The hierarchy is doing multiple jobs at once. Split world motion, visual orientation, and animated sub-parts into separate groups.

### "Why Does One Side Vanish Or Look Inside-Out?"

Check winding order, normals, and whether a mirrored transform flipped the face orientation before you blame the light rig.

## Recommended Comment Block Near Scene Setup

```javascript
// Scene conventions:
// x = left/right
// y = up/down
// z = forward/back
// Gameplay objects move in world space through their root groups.
// Visual groups are allowed one-time orientation corrections so runtime
// heading, pitch, and roll code can stay clean.
```

## Summary

The pain in Three.js game work rarely comes from one hard API call. It comes from inconsistent frames of reference, mixed responsibilities in the scene graph, and static orientation fixes leaking into runtime code. Pick a world convention early, separate gameplay roots from visual correction groups, build cameras and panels as small rigs, and keep lighting readable. Do that, and most later bugs become local instead of existential.