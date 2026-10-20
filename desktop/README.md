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
* `src/editor/` – document (object tree, multi-selection, undo), viewport, actions (booleans, push/pull, arrays…), panels, studios (text, draw, textures, export), commands (menu bar & palette), pipeline (Godot / Blender), texture painting and file I/O.
* `src/ui/` – DOM toolkit (menus, dialogs, controls) and the accessible colour wheel.
* `assets/templates/` – the 20 starter templates (from the Android template code) and `thumbs/` for the procedural library.
* `src/templates/` – the procedural template library: `pbr.js` (material generators), `matlib.js`, `kit.js` (geometry kit), `arch.js` / `building.js` (architecture), `sdf.js` (organic shapes) and `fam/*` (the families).
* `assets/materials/` – baked PBR textures (`scripts/bake-materials.mjs`), `assets/hdri/` – CC0 HDR panoramas from Poly Haven.
* Re-bake materials or thumbnails: `xvfb-run -a node scripts/e2e.mjs out scripts/bake-materials.mjs` / `scripts/bake-thumbs.mjs`.

Projects are saved as GLB files with editor data in `extras.glbandme` (same layout as the Android app), so they open on both.
The renderer also runs as a plain web page (IndexedDB storage) – handy for automated tests.

Developer checks (need `xvfb-run` on Linux): `npm run build && xvfb-run -a node scripts/e2e.mjs out scripts/e2e-steps.mjs` – also `e2e-more.mjs`, `e2e-ui.mjs`, `e2e-godot.mjs` (set `E2E_ALLOW_DIR` to a Godot project) and `e2e-blender.mjs`.
