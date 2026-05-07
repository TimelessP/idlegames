---
name: mobile-webgl-rendering-debugging
description: Diagnose and fix browser 3D rendering bugs that appear only on some phones or GPUs, especially in Three.js WebGL scenes using dynamic textures, shadows, lighting, and custom materials. Use when a model looks dark, black, missing, inverted, or otherwise wrong on one mobile device but fine on desktop or other phones.
---

# Mobile WebGL Rendering Debugging

Use this skill when a browser 3D scene behaves differently across devices, especially when a problem appears on one phone or GPU but not on desktop or other mobile hardware.

This skill is aimed at narrow, falsifiable debugging of rendering defects in WebGL or Three.js scenes, not broad rewrites. The priority is to identify which subsystem is actually responsible: shadows, direct lighting, material shading, texture upload/sampling, geometry, normals, or face culling.

## What This Skill Is For

Typical triggers:
- A mesh is unexpectedly dark or black on one phone
- A texture looks wrong on one mobile GPU but correct elsewhere
- Turning shadows off does not fix a dark or broken surface
- A model disappears or inverts only on Android or Pixel-class devices
- A runtime-generated texture behaves differently from a file texture
- A scene is correct on desktop but wrong on a subset of mobile devices

Use this for:
- Three.js `WebGLRenderer` debugging
- `CanvasTexture` and other runtime-generated texture issues
- Device-specific lighting or sampling artifacts
- Fast in-scene diagnostic toggles that isolate one rendering axis at a time

Do not use this for:
- General game performance optimization without a rendering artifact
- Pure gameplay bugs unrelated to rendering
- Broad engine migrations before the defect is isolated

## Debugging Principles

### 1. Isolate One Rendering Axis At A Time

Do not jump between theories. Add the smallest reversible probe that isolates a single subsystem.

Good isolation order:
1. Shadows
2. Direct and ambient lighting
3. Lit vs unlit material shading
4. Textured vs flat color material path
5. Single-sided vs double-sided rendering
6. Texture sampling and mip/filter state
7. Texture transform path
8. Geometry or normal generation

The point is not to create a permanent debug UI. The point is to get one decisive signal from each probe.

### 2. Prefer In-Scene Toggles Over Theory

When the bug only reproduces on one device, a local settings toggle is often the cheapest discriminating check.

Good temporary toggles include:
- `Shadows Enabled`
- `Unlit Surface`
- `Plain Color`
- `Double-Sided`
- `Force Bright Lighting`

Remove temporary toggles after the cause is identified unless they provide lasting user value.

### 3. Use Falsifiable Reads From The Results

Interpret probes narrowly:

- If disabling shadows fixes it: the problem is in the shadow path.
- If unlit but textured is still wrong: it is not primarily a lighting problem.
- If plain color fixes it: the defect is in the texture path, not the mesh itself.
- If double-sided fixes it: suspect winding, culling, or face orientation.
- If none of those change the artifact: step to texture sampling state, transforms, or driver quirks.

## Texture-Path Diagnostics

When a textured surface is wrong on one device but the same mesh with a plain color is correct, treat the texture path as the main suspect.

### Runtime-Generated Textures Need Conservative Defaults

`CanvasTexture` and other dynamic textures can hit device-specific sampling bugs. If a mobile GPU mishandles the default path, switch to a simpler and more conservative setup first.

Known-safe pattern:

```javascript
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = 1;
texture.generateMipmaps = false;
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.needsUpdate = true;
```

Why this helps:
- `generateMipmaps = false` avoids device-specific mip generation or mip sampling trouble
- `LinearFilter` removes more complex minification paths
- `anisotropy = 1` avoids anisotropic sampling bugs on some mobile GPUs
- `needsUpdate = true` makes the upload path explicit

This is especially useful when:
- the texture is painted at runtime
- the affected mesh is fine with a flat color
- the issue survives shadow and lighting probes

### Compare Against A Nearby Known-Good Texture

If the codebase already has another runtime-generated texture that behaves correctly on the affected device, copy its texture-state setup first. That local precedent is usually more valuable than generic online advice.

Examples of good comparisons:
- cloud sprites
- minimap canvases
- HUD or instrument textures
- procedural decals

### If Conservative Sampling Still Fails

Next probes should stay inside the texture path:
- remove texture rotation and center transforms
- bake rotation directly into the canvas instead of using `texture.rotation`
- try `NearestFilter` as a diagnostic, not necessarily as the final look
- reduce canvas dimensions
- replace alpha-bearing textures with opaque textures as a check

## Lighting And Material Diagnostics

If the issue may still involve shading:

### Lit vs Unlit

Swap only the affected surfaces to `MeshBasicMaterial` while keeping the same texture.

If the bug remains, the problem is not primarily dynamic lighting.

### Textured vs Flat Color

Keep the same material family but remove the map and use a solid color.

If that fixes the surface, the mesh, normals, and most lighting are usually fine.

### Double-Sided

Temporarily force `THREE.DoubleSide`.

If it fixes the issue, investigate:
- wrong winding
- mirrored transforms
- bad normals on one side
- GPU culling differences

If it does not help, culling is less likely to be the root cause.

## Shadow Diagnostics

Shadows are often blamed first, but do not stay there if the evidence rejects it.

Useful probes:
- disable shadows entirely
- switch shadow map type
- set shadow radius to 0
- reduce or remove `normalBias`
- reduce shadow map size or sampling complexity

Interpret carefully:
- If a surface stays dark with shadows fully disabled, stop debugging the shadow path.

## Geometry And Normal Diagnostics

Only step here after texture and shading probes fail.

Checks:
- recompute normals
- force flat shading
- verify cap vs side-face material grouping on extrusions
- inspect whether mirrored meshes have the intended normal direction
- compare against a primitive using the same material

For `ExtrudeGeometry`, lid faces and side faces can often be split into separate materials. That is useful when debugging whether a cap-specific path is involved.

## Recommended Workflow

1. Reproduce on the affected device and at least one unaffected device.
2. Add one or two targeted toggles in the existing settings UI.
3. Build after each small probe.
4. Record each result as a yes/no discriminator.
5. Move only one hop at a time toward the controlling subsystem.
6. Once the root cause is identified, remove temporary probes and keep only user-valuable settings.
7. Document the actual fix where it lives, especially if it is a non-obvious driver workaround.

## Good Final Documentation

When the fix is non-obvious, comment it where the fix is applied, not in a distant changelog.

Good comment content:
- what behavior was wrong
- what the old path did
- what was changed
- what evidence isolated the cause
- why the new state avoids the bad device path

## Example Final Fix Shape

```javascript
// Mobile GPU fix: this runtime-generated texture rendered too dark on one
// phone when left on the default sampling path. A plain-color material proved
// the mesh and lighting were fine, so the issue was isolated to texture
// sampling state. Disable mipmaps, keep filtering simple, and avoid
// anisotropic sampling on this texture.
const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = 1;
texture.generateMipmaps = false;
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
texture.needsUpdate = true;
```

## Summary

When a mobile-only rendering bug survives shadow, lighting, and culling probes, do not keep treating it as a general shading mystery. If plain color fixes the surface, the texture path is the likely root. For runtime-generated textures, the fastest durable fix is often a conservative sampling setup rather than a geometry rewrite.