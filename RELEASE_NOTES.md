## GLB&ME 1.2.0 – Pro desktop editor

A big update for the PC app (Windows, macOS, Linux). The Android app stays on 1.1.0 and opens projects made with 1.2.0.

### Straight into Godot and Blender
- **Send to Godot**: pick your Godot project once and GLB&ME writes the model into it (res://models by default). Turn on the **live link** and every save updates it – Godot re-imports when you switch back.
- **Collision for Godot**: set Collision on any object (Static exact / convex, collision only, rigid body, navigation mesh, occluder). With Godot hints on you get StaticBody3D, RigidBody3D and NavigationMesh nodes automatically.
- **Send to Blender** opens a new Blender window with your model already imported (lights keep their brightness).
- **Named animation clips** (Idle, Walk, Open…) become separate animations in Godot's AnimationPlayer and Actions in Blender; looping clips loop in Godot.
- **Custom properties** on any object export as glTF extras – Blender custom properties, node metadata in Godot 4.4+.
- New export presets for **Godot 4, Blender, Unity and Unreal**, **glTF + separate files** (great for version control), **PNG renders** (any size, transparent background), **apply scale** for physics, and objects you can exclude from export.
- Verified: exports pass the Khronos glTF validator with no errors or warnings and import correctly in Godot 4.3 / 4.4 and Blender 5.

### Model like a pro
- **Groups and parenting** with a real layers tree: drag onto an object to parent it, Ctrl+G / Ctrl+Shift+G, collapse, filter, empties and cameras.
- **Multi-select** (Shift/Ctrl+click, box select with Ctrl+drag or the Select tool) and move, rotate and scale many objects at once.
- **Booleans**: union, subtract and intersect (Tinkercad-style holes).
- **Push / pull faces**: click a face in Faces mode and drag the arrow, like Shapr3D and SketchUp.
- **Align & distribute**, **arrays** (line or circle), copy & paste, arrow-key nudging, snapping with selectable increments, a **measure tool**, units (m, cm, mm, in, ft).
- **Mesh check & clean-up**: watertight test, merge by distance, recalculate normals, remove degenerate faces, separate loose parts, apply scale / rotation, origin tools.
- **Cameras** (look through, align to view) and **empties** for spawn points and pivots.
- More import formats: **Collada (.dae)** and **3MF**, and imported files keep their hierarchy.

### Paint on your models
- **Texture painting** straight onto the model with a soft or hard brush, an eraser and pen pressure.
- **Straight lines**: the Line tool (L), or Shift+click to draw a line from the last point – they follow the surface.
- **Eyedropper** (I) picks colours from the model.
- **Full colour wheel** everywhere in the app: hue ring, saturation/brightness square, hex, RGB and HSV fields, recent and saved colours – all keyboard and screen-reader friendly.
- **Smart UV unwrap**: models whose faces share texture space are unwrapped automatically before painting, and their current texture and vertex paint are carried over.

### Real materials
- Physically based materials with **clearcoat, real glass (transmission + IOR), sheen, specular and iridescence**, plus new looks (glass, frosted, car paint, velvet, pearl).
- Load your own **normal, roughness, metallic, ambient-occlusion and emission maps**.
- **Shared materials**: link one material to many objects (exported as one material – fewer draw calls).
- Keyframe **easing** (ease in/out, constant), draggable keys and right-click key menus on the timeline.

### Faster and more accessible
- A **menu bar** (File, Edit, Add, Object, Mesh, Animate, View, Help) and a **command palette** (Ctrl+K) that finds every command.
- A **navigation gizmo**, X-ray and wireframe toggles, numpad views and keyboard orbit/zoom.
- **Light and high-contrast themes**, **colour-blind-safe axis colours**, reduce transparency, bold focus outlines and interface scaling.
- Fully keyboard operable: Alt/F10 opens the menus, the layers tree works with the arrow keys, tooltips show on keyboard focus, Tab no longer hides the interface (it's Ctrl+\ now), and status changes are announced to screen readers.

## GLB&ME 1.1.0 – the big redesign

### New: GLB&ME for PC (Windows, macOS, Linux)
- **Windows installer** (`GLB-ME-Setup-1.1.0.exe`) plus a portable `.exe`, a macOS `.dmg` and Linux `.AppImage` / `.deb`.
- The full editor for mouse, keyboard and pen tablets: sculpting, painting, face editing, part materials, textures, stickers, 3D text, draw-to-3D, lights, animation and the pro export dialog.
- **3D text with any font installed on your PC**, 14 bundled open fonts or your own font files.
- Projects are plain `.glb` files with the editing data inside, so they move between your phone and your PC.

### A calmer, clearer editor
- **Modes** at the bottom – Object, Sculpt, Paint, Edit and Animate. The strip above only shows the tools for the mode you're in.
- **Panels slide up as sheets** and the camera shifts so your model stays visible above them. Drag the handle to resize, swipe down to close. On tablets and in landscape they dock to the side.
- Side buttons for **Layers, Add, Inspect** (Object · Material · Mesh) and **View**; the project name opens the project menu.
- First-time **tips** for each mode, numeric **size fields in your units** (m, cm, mm, in), **arrays** (line or circle), mirror copies on any axis and one-tap animations (**spin, bounce, float, pulse, wobble**).

### 3D text with your own fonts
- Type and watch the 3D text update live.
- **Import any .ttf / .otf font**, such as a game title font, plus 10 built-in families.
- Bold, italic, alignment, letter and line spacing, depth, **rounded bevels** and smoothness.

### Create anything
- **14 new shapes**: rounded box, dome, prism, wedge, gem, star, heart, gear, arrow, spring, knot, stairs, arch and terrain.
- **Draw → 3D**: draw with your finger, then extrude it, revolve it into a vase or bottle, or sweep a tube along it. You can mirror while drawing or place points one at a time.
- **Lights**: point, spot and sun lights shine in the viewport and export as `KHR_lights_punctual` for game engines and three.js. The new *Lights only* environment shows nothing but your own lights.

### Textures everywhere
- **18 built-in seamless textures**: bricks, tiles, wood, marble, stone, fabric, carbon, brushed metal, camo, hexagons, lava, pixel grass and more. Each has its own colours, scale, detail and a matching bump (normal) map.
- **Texture just one part**: select faces in Edit mode and tap *Material*.
- **Stickers** that wrap around curved surfaces.
- **Tiling, offset and rotation**, exported as `KHR_texture_transform`. Also new: pixel-art filtering, *bump from colour image*, and copying or pasting materials.

### Pro export
- **Presets** for game engines, web, AR on Android, AR on iPhone and 3D printing.
- **USDZ** export for AR Quick Look on iPhone, iPad and Vision Pro.
- **OBJ with materials and textures**, delivered as a zip.
- Choose the origin (as placed, centred or on the ground), units, up axis, a **triangle limit** (smart simplification that leaves your project untouched) and a maximum texture size.
- A **live file-size estimate** and plain-language checks before you export.

### Made for everyone
- Interface size (Standard, Large, Extra large), in-app text size, bold text, reduce motion and a **left-handed layout**.
- Every control has a spoken label and role for TalkBack, and sliders work with accessibility gestures.

### Fixes
- Normal maps now follow the glTF convention (green = up), so bumps no longer look inverted.
- Bevelled shapes with sharp tips (hearts, stars) no longer show fins.

Install over 1.0.x – your projects are kept.
