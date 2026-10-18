# GLB&ME desktop

Electron + three.js version of GLB&ME for Windows, macOS and Linux.

```
npm ci
npm run dev        # bundle + launch
npm run dist:win   # Windows installer + portable exe → release/
npm run dist:mac   # macOS dmg
npm run dist:linux # AppImage + deb
```

* `main/` – Electron main process (project library in the user-data folder, fonts, dialogs, `app://` protocol) and the preload bridge.
* `src/core/` – mesh utilities, parametric shapes, sculpt engine, face selection, procedural textures and 3D text (ports of the Android core).
* `src/editor/` – document & undo, viewport, actions, panels, studios (text, draw, textures, export) and file I/O.
* `assets/templates/` – the 20 starter templates, generated from the Android template code, with thumbnails.

Projects are saved as GLB files with editor data in `extras.glbandme` (same layout as the Android app), so they open on both.
The renderer also runs as a plain web page (IndexedDB storage) – handy for automated tests.
