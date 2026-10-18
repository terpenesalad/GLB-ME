# GLB&ME

**Create, sculpt, paint, animate and export 3D models (GLB / glTF) on Android.**
Inspired by the workflows of Nomad Sculpt, Prisma3D and Sculpt & Draw — with every "premium" feature unlocked, no account, fully offline.

<p align="center"><b>⬇️ Download the APK from the <a href="../../releases/latest">latest release</a></b></p>

## Features

### Create
- **New from shapes** – sculpt sphere (spherified cube), cube, UV sphere, icosphere, cylinder, cone, torus, capsule, tube, plane, pyramid. Shapes stay **procedural** (size, segments…) until you sculpt or edit them.
- **20 templates** – head base, character base mesh, robot (animated), snowman, low-poly tree, rock, mushroom, crystals, tiny island diorama, planet with rings (animated), product stage, house, chess pawn, vase, mug, donut, sword, spinning coin (animated), treasure chest (animated).
- **3D text** (extruded, 4 font styles) and **image planes** (reference images / textured cards).

### Sculpt (Nomad-style)
- Brushes: **Clay, Draw, Inflate, Smooth, Flatten, Pinch, Crease, Move (grab), Drag, Layer, Mask, Paint**.
- Radius & strength sliders, invert (dig/erase), **X/Y/Z symmetry**, 5 falloff curves, stylus pressure.
- **Masking** with invert / blur / sharpen / clear and visual mask overlay.
- UV seams never tear: brushes operate on welded vertex groups.

### Model (Prisma3D / Sculpt & Draw-style)
- **Transform gizmo** – move / rotate / scale with axis handles, view ring, snapping; numeric position / rotation / scale fields.
- **Face edit mode** – brush-select faces, select all / invert / grow / linked, **extrude, inset, flip, delete, separate, duplicate**, and move/rotate/scale the selection.
- Mesh tools: **Loop subdivision**, simple split, **quadric decimation**, Taubin smoothing, symmetrize, weld, flat/smooth shading, flip/recalculate normals, **UV projection** (box / sphere / cylinder / planar), apply transform, origin to geometry, drop to floor, mirror duplicate, join objects.

### Paint & materials
- Vertex **color painting** with HSV color picker, fill & clear.
- Full **glTF PBR materials**: base color, metallic, roughness, opacity (blend), alpha cutout, emission + strength, double-sided, unlit; 17 presets (gold, chrome, glass, jade, neon…).
- Texture slots: base color, normal, metallic-roughness, emissive, occlusion.

### Render
- Real-time **PBR** with GGX lighting, studio softbox reflections, **soft shadows**, ACES tone mapping; **matcap** mode with 10 matcaps; clay, normals and unlit views.
- 5 environments, exposure, light direction/height, floor grid, wireframe, orthographic camera, gradient backgrounds.
- **Screenshots** up to 2048 px, optional transparent background.

### Animate
- Keyframe timeline (translation / rotation / scale per object), auto-key, play/scrub, 12–60 fps, turntable generator.
- Animations are **exported as glTF animation channels** and imported back from GLB files.

### Import / Export
| Format | Import | Export |
|---|---|---|
| **GLB** (binary glTF 2.0) | ✅ meshes, PBR materials, textures, vertex colors, node animation, sparse/quantized accessors | ✅ everything above |
| **glTF** (.gltf, embedded) | ✅ | ✅ |
| **OBJ** | ✅ (+ vertex colors) | ✅ (+ vertex colors) |
| **STL** | ✅ ascii & binary | ✅ binary (Z-up) |
| **PLY** | ✅ ascii & binary | ✅ binary with colors |

Open files straight from your file manager or share them to GLB&ME. Projects are saved as GLB + editor state, so they reopen exactly as you left them and are always valid glTF.

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
Pushing a `v*` tag runs `.github/workflows/android.yml`, which tests, builds and signs the APK and publishes a GitHub release.
Signing uses the repository secrets `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` when present; otherwise it falls back to the bundled `signing/release.jks` so every build can update the previous install. **For a public Play Store release, add your own private keystore as secrets** (the bundled key is public).

## License
MIT
