# Window drag diagnostics

These diagnostics investigate cases where the macOS window stops moving after
the user resizes it. They record observations only and do not modify or repair
Chromium draggable regions.

## Reproduction

1. Start Ousia with `npm start`.
2. Resize the native window repeatedly by width, height, and a corner.
3. Release the resize handle and wait about one second.
4. Within two minutes, try dragging each available top-bar region:
   - the sidebar top bar;
   - the chat title bar;
   - the settings top bar.
5. If dragging fails, stop the app and extract only the diagnostic lines:

```sh
rg '\[(window\.resize|window\.drag|window\.fullscreen|renderer\.resize-observer)' \
  ~/.ousia/logs/ousia-desktop.log
```

Do not share the complete runtime log. Other subsystems can contain unrelated
application information.

## Interpretation

- `window.resize.start` and `window.resize.finish` identify one native resize
  sequence. The finish event aggregates event counts, bounds, duration,
  fullscreen inference transitions, zoom, and calls to
  `setWindowButtonPosition`.
- `window.drag.renderer-layout` is captured two animation frames after resize.
  It contains the viewport and sanitized geometry of `.window-drag` elements.
- `window.drag.pointerdown` with
  `signal: 'renderer-received-pointerdown-for-drag-region'` is the strongest
  stale-native-region signal: renderer CSS still classified the point as
  draggable, but the native hit test allowed a pointer event through.
- `window.drag.pointerdown` with
  `signal: 'renderer-pointerdown-control'` is a control observation. Its
  `expectedRegion` and sanitized stack help identify a `no-drag` exclusion or
  a point outside every draggable region.
- `window.fullscreen` shows whether resizing or moving changed the inferred
  fullscreen state, including the native state and the `fillsDisplay` result.
- `renderer.resize-observer` reports previously suppressed ResizeObserver
  warnings as one-second aggregate counts.

Element samples intentionally contain no text, ids, paths, or raw class names.
They contain only bounded rectangles, allowlisted tag categories, app-region
classification, pointer-event classification, positioning, z-index, and the
presence of the two known drag classes.

## Native title-bar mitigation

Ousia does not call `setWindowButtonPosition` from the live `resize` handler.
The traffic-light position depends on renderer zoom rather than window bounds,
and repeatedly mutating the native title bar during resize can leave native
draggable-region hit testing stale. Instead, it reapplies the position exactly
once from the macOS `resized` event, after the live resize has finished. That
post-resize native title-bar update rebuilds Chromium's hit-test map for CSS
draggable regions. The position is also applied during window creation and
renderer load, after zoom changes, after unmaximize, and after leaving
fullscreen.

After a completed macOS resize, `window.resize.finish` should therefore report
`windowButtonPositionApplyCount: 1`; values above one indicate that the native
title bar was mutated during the live resize. If a failed drag still produces
`renderer-received-pointerdown-for-drag-region` with that count at one, the
next isolation target is Electron's native draggable-region handling rather
than renderer layout or traffic-light updates.
