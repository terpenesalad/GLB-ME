# GLB&ME

**Create, sculpt, paint, animate and export 3D models (GLB / glTF) on Android and on your PC (Windows, macOS, Linux).**
Inspired by the workflows of Nomad Sculpt, Prisma3D and Sculpt & Draw — with every "premium" feature unlocked, no account, fully offline.

<p align="center"><b>⬇️ Download from the <a href="../../releases/latest">latest release</a>:</b><br>
Android → <code>GLB-ME-x.y.z.apk</code> · Windows → <code>GLB-ME-Setup-x.y.z.exe</code> (or the portable .exe) · macOS → <code>.dmg</code> · Linux → <code>.AppImage</code> / <code>.deb</code></p>

## Desktop version

The PC app (in [`desktop/`](desktop)) has the same toolset as the phone app, laid out for mouse and keyboard:
layers on the left, inspector on the right, a tool strip on top and a timeline when animating.

- **Projects move freely between phone and PC**: every project is a standard `.glb` with the editing data inside. Use *Save as GLB…* on one device and open or import it on the other.
- **3D text with your PC's installed fonts**, 14 bundled open-licence fonts (including Michroma, a wide Horizon-style display face) or any `.ttf` / `.otf` / `.woff` you import.
- Sculpt with a mouse or pen tablet (pressure supported), vertex paint, face selection with part materials, 18 seamless textures, photos, stickers, image planes, lights, keyframe animation with presets.
- Export **GLB, glTF, USDZ, OBJ + MTL (zip), STL, PLY** with presets (Game ready, Web & AR, iPhone AR, 3D print, Other 3D apps), triangle budget, texture size, origin, units and up axis.
- Drag & drop models, images and fonts onto the window; `.glb`/`.gltf` files can be opened with GLB&ME from Explorer/Finder.
- Shortcuts: **1–5** modes · **W/E/R** move/rotate/scale · **F** frame · **Shift+A** add · **T** text · **Ctrl+Z / Ctrl+Shift+Z** · **Ctrl+S** save · **Ctrl+E** export · **[ ]** brush size · hold **Shift** to smooth, **Ctrl** to invert · **Tab** hide UI · **?** all shortcuts.

> The installers are not code-signed yet. Windows SmartScreen may show *“Windows protected your PC”* → **More info → Run anyway**. On macOS, right-click the app → **Open** the first time.

Build it yourself: `cd desktop && npm ci && npm run dist` (installers land in `desktop/release/`).


## Features

### A calm, focused editor
- **Modes**: Object · Sculpt · Paint · Edit · Animate. A context strip shows only the tools for the current mode.
- **Sheets** for Layers, Add, Inspect (Object / Material / Mesh) and View slide up from the bottom and the camera shifts so your model stays visible. On tablets and in landscape they dock to the side.
- Coach marks the first time you use each mode, a hide-interface button, undo history, and two- or three-finger taps for undo and redo.

### Create
- **25 parametric shapes** that stay editable: sculpt ball, cube, rounded box, sphere, icosphere, cylinder, cone, torus, capsule, tube, plane, pyramid, dome, prism, wedge, gem, star, heart, gear, arrow, spring, knot, stairs, arch and terrain.
- **3D text** in any font: import your own **.ttf / .otf** or use 10 built-in families. Bold, italic, alignment, spacing, depth, rounded bevels, and a live preview.
- **Draw → 3D**: finger-draw an outline and **extrude** it, **revolve** it (vases, bottles, chess pieces) or sweep a **tube** along it.
- **Lights**: point, spot and sun (`KHR_lights_punctual`).
- Image planes, **stickers / decals** that wrap around curved surfaces, model import and template parts.
- **20 templates**: head and character bases, an animated robot, a snowman, tree, rock, mushroom, crystals, island diorama, a planet with rings, a product stage, house, chess pawn, vase, mug, donut, sword, a spinning coin and a treasure chest.
- Arrays (line and circle), mirror copies on any axis, and numeric size fields in m, cm, mm or in.

### Sculpt (Nomad-style)
- Brushes: **Clay, Draw, Inflate, Smooth, Flatten, Pinch, Crease, Move (grab), Drag, Layer and Mask**, plus Paint.
- Size and strength sliders, invert (dig or erase), **X/Y/Z symmetry**, 5 falloff curves, spacing, stylus pressure and a stylus-only option.
- **Masking** with invert, blur, sharpen, clear and a mask overlay. Brushes work on welded vertex groups, so UV seams never tear.

### Model (Prisma3D / Sculpt & Draw-style)
- **Transform gizmo** (move / rotate / scale) with snapping and numeric fields.
- **Face edit mode**: brush-select faces; extrude, inset, flip, delete, separate or duplicate them; **give them their own material**; colour them.
- Mesh tools: Loop subdivision, quadric decimation, smoothing, symmetrize, weld, flat or smooth shading, normals, **UV projection** (box, sphere, cylinder, planar), apply transform, set origin and join objects.

### Paint, materials & textures
- Vertex **colour painting** with recent colours, fill and clear.
- **glTF PBR materials** with 17 presets, copy / paste, and *use on all objects*.
- Texture slots: colour, normal, metal/rough, emissive and occlusion. Generate a bump map from a colour image.
- **18 built-in seamless procedural textures** (bricks, tiles, wood, marble, stone, fabric, carbon, brushed metal, camo, lava…), each with a matching normal map and optional roughness map.
- **Tiling, offset and rotation** (`KHR_texture_transform`) and pixel-art filtering.

### Render
- Real-time **PBR** (GGX), studio reflections, **soft shadows**, ACES tone mapping and your scene lights. Also matcap (10), clay, normals and unlit views.
- 6 environments, including *Lights only*. Exposure, key-light direction, floor grid, wireframe, orthographic camera and gradient backgrounds.
- **Screenshots** up to 4096 px, with an optional transparent background.

### Animate
- Keyframe timeline (translation / rotation / scale), auto-key, play and scrub, 12–60 fps.
- One-tap **spin, bounce, float, pulse and wobble**.
- Exported as glTF animation channels and as USDZ time samples.

### Export
Presets: **Game engine · Web · AR Android · AR iPhone · 3D printing**. You can also set scope, origin, units, up axis, a **triangle limit** (smart simplification), a maximum texture size, colours, animation and an OBJ material bundle. Each export shows a **live file-size estimate** and checks.

| Format | Import | Export |
|---|---|---|
| **GLB** (binary glTF 2.0) | ✅ meshes, PBR materials, textures, texture transforms, vertex colours, lights, node animation, sparse/quantized accessors | ✅ everything above |
| **glTF** (.gltf, embedded) | ✅ | ✅ |
| **USDZ** | – | ✅ UsdPreviewSurface materials, textures, animation (AR Quick Look) |
| **OBJ** | ✅ (+ vertex colours) | ✅ + MTL + textures (zip) |
| **STL** | ✅ ascii & binary | ✅ binary, mm / Z-up presets |
| **PLY** | ✅ ascii & binary | ✅ binary with colours |

Open files straight from your file manager or share them to GLB&ME. Projects are saved as GLB plus editor state, so they reopen exactly as you left them and are always valid glTF.

### Accessibility
Interface size (Standard / Large / Extra large), text size, bold text, reduce motion and a left-handed layout. Every custom control has a TalkBack label and role, sliders support accessibility actions, and colours meet AA contrast.

## Gestures
| Gesture | Action |
|---|---|
| 1 finger on background | Orbit |
| 2 fingers | Pan + pinch zoom |
| 1 finger on model | Use active tool |
| 2-finger tap / 3-finger tap | Undo / Redo |
| Double tap | Frame selection |
| Tap axis navigator | Front / side / top views |

## Building
Requirements: JDK 17, Android SDK (compileSdk 35).

```bash
./gradlew testReleaseUnitTest assembleRelease
```

The app has **no third-party dependencies** – pure Kotlin + Android framework + OpenGL ES 3.0. Core geometry, file formats and sculpting live in `app/src/main/java/app/glbandme/core` and are covered by JVM unit tests.

### Releases
`.github/workflows/android.yml` tests, builds and signs the APK on every push. Bumping `version.txt` on `main` (or pushing a `v*` tag) publishes a GitHub release with the APK attached.
Signing uses the repository secrets `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` when present; otherwise it falls back to the bundled `signing/release.jks` so every build can update the previous install. **For a public Play Store release, add your own private keystore as secrets** (the bundled key is public).

## License
MIT
