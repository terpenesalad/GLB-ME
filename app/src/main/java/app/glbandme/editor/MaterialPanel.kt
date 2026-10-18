package app.glbandme.editor

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Color
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.ui.Chip
import app.glbandme.ui.ColorPickerView
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.FlowLayout
import app.glbandme.ui.GroupCard
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.MenuItem
import app.glbandme.ui.Mode
import app.glbandme.ui.Swatch
import app.glbandme.ui.TextureFactory
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** PBR material editor: presets, surface, textures (slots, built-ins, stickers), tiling. */
class MaterialPanel(act: EditorActivity) : Panel(act) {
    override val title = "Material"
    override val icon = Icon.MATERIAL
    override val rebuildOn = setOf(Change.SELECTION, Change.MATERIAL, Change.UNDO, Change.OBJECTS, Change.TOPOLOGY)
    private var editing = false
    private var splitRepeat: Boolean? = null

    override fun onChanged(c: Set<Change>) { if (!editing) super.onChanged(c) }

    override fun headerActions(): List<View> {
        val o = ed.scene.selected ?: return emptyList()
        return listOf(IconButton(act, Icon.MORE, sizeDp = 38).apply {
            round = true; filled = true; describe("Material options")
            onClick = {
                Dialogs.menu(act, o.material.name, listOfNotNull(
                    MenuItem(Icon.PEN, "Rename material") { Dialogs.prompt(act, "Material name", o.material.name) { n -> ed.editMaterial("Rename material") { it.name = n } } },
                    MenuItem(Icon.COPY, "Copy material") { ed.copyMaterial(); act.status("Material copied", 900) },
                    if (ed.copiedMaterial != null) MenuItem(Icon.IMPORT, "Paste material", subtitle = ed.copiedMaterial!!.name) { ed.pasteMaterial() } else null,
                    MenuItem(Icon.LAYERS, "Use on all objects") { ed.materialToAll(); act.status("Applied to every visible object", 1200) },
                    MenuItem(Icon.RESET, "Reset to clay") { ed.editMaterial("Reset material") { m -> m.copyFrom(Material.preset(MaterialPreset.CLAY)) } },
                ))
            }
        })
    }

    private fun slider(o: SceneObject, title: String, min: Float, max: Float, get: (Material) -> Float, set: (Material, Float) -> Unit, step: Float = 0f, fmt: (Float) -> String = { String.format("%.2f", it) }): HSlider {
        var before: Material? = null
        return HSlider(act, title, min, max, get(o.material), step, fmt).apply {
            onChange = { v ->
                if (before == null) { before = o.material.copy(); editing = true }
                ed.locked { set(o.material, v) }
                ed.requestRender()
            }
            onRelease = { before?.let { ed.materialChange(o, title, it) }; before = null; editing = false }
        }
    }

    override fun build(): View {
        val root = act.vbox()
        val o = ed.scene.selected
        if (o == null) {
            root.addView(act.label("Select an object to edit its material.", 14f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(10), 0, dp(10)) })
            return root
        }
        if (o.light != null) {
            root.addView(act.label("This is a light – set its colour and brightness on the Object page.", 14f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(10), 0, dp(10)) })
            root.addView(PanelUi.button(act, "Light settings", Icon.BULB) { act.openInspector(EditorActivity.INSPECT_OBJECT) })
            return root
        }
        val mat = o.material

        // ---- presets ----------------------------------------------------------------------------
        val presets = FlowLayout(act, 6, 10)
        for (p in MaterialPreset.values()) {
            val cell = act.vbox().apply { gravity = Gravity.CENTER_HORIZONTAL }
            cell.addView(Swatch(act, p.color or 0xFF000000.toInt(), 40).apply {
                describe("${p.label} material")
                ring = mat.name == p.label
                onClick = { ed.editMaterial("Material: ${p.label}") { m -> p.apply(m); m.name = p.label } }
            })
            cell.addView(act.label(p.label, 9.5f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; maxWidth = dp(54); maxLines = 1; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO })
            presets.addView(cell, LinearLayout.LayoutParams(dp(54), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(presets, lp().apply { topMargin = dp(8) })

        // ---- surface -------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Surface"))
        val colorRow = act.hbox(0, 12).apply { setPadding(0, dp(4), 0, dp(4)); gravity = Gravity.CENTER_VERTICAL }
        val sw = Swatch(act, mat.baseColorSrgb(), 46)
        sw.onClick = {
            val before = mat.copy()
            ColorPickerView.show(act, "Base colour", mat.baseColorSrgb(), live = { c -> ed.locked { mat.setBaseColorSrgb(c) }; sw.color = c; ed.requestRender() }) { c ->
                ed.locked { mat.setBaseColorSrgb(c) }
                ed.materialChange(o, "Base colour", before)
            }
        }
        colorRow.addView(sw)
        colorRow.addView(act.vbox().apply {
            addView(act.label(if (mat.baseColorTexture != null) "Tint" else "Colour", 15f, Theme.TEXT))
            addView(act.label(String.format("#%06X  ·  %s", mat.baseColorSrgb() and 0xFFFFFF, mat.name), 12f, Theme.TEXT_MUTED).apply { setPadding(0, dp(3), 0, 0) })
        }, lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(colorRow)
        root.addView(slider(o, "Metallic", 0f, 1f, { it.metallic }, { m, v -> m.metallic = v }), lp())
        root.addView(slider(o, "Roughness", 0f, 1f, { it.roughness }, { m, v -> m.roughness = v }), lp())
        root.addView(slider(o, "Opacity", 0.02f, 1f, { it.baseColor[3] }, { m, v ->
            m.baseColor[3] = v
            m.alphaMode = if (v < 0.999f) AlphaMode.BLEND else if (m.alphaMode == AlphaMode.BLEND) AlphaMode.OPAQUE else m.alphaMode
        }) { "${(it * 100).toInt()}%" }, lp())

        // ---- textures ---------------------------------------------------------------------------
        root.addView(act.sectionTitle("Textures"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.IMAGE, "Photo") { loadInto(o, Slot.BASE) },
            Triple(Icon.TEXTURE, "Built-in") { TextureLibrary.show(act, o) },
            Triple(Icon.STICKER, "Sticker") { Stickers.start(act) },
            Triple(Icon.POLYGON, "Part only") { partHelp() },
        )))
        val slots = GroupCard(act)
        for (s in Slot.values()) slots.row(textureRow(o, s))
        root.addView(slots, lp().apply { topMargin = dp(8) })
        if (o.mesh.uvs == null) root.addView(act.label("This mesh has no UV map yet – one is made automatically when you add a texture.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(8), 0, 0) })

        // ---- mapping -------------------------------------------------------------------------------
        if (mat.textures().isNotEmpty()) mapping(root, o)

        // ---- emission ---------------------------------------------------------------------------
        root.addView(act.sectionTitle("Glow"))
        val emRow = act.hbox(0, 12).apply { gravity = Gravity.CENTER_VERTICAL }
        val emHex = Color.linearToArgb(mat.emissive[0], mat.emissive[1], mat.emissive[2])
        val esw = Swatch(act, emHex, 42)
        esw.describe("Glow colour")
        esw.onClick = {
            val before = mat.copy()
            ColorPickerView.show(act, "Glow colour", emHex, live = { c -> val l = Color.hexToLinear(c); ed.locked { l.copyInto(mat.emissive) }; esw.color = c; ed.requestRender() }) { c ->
                val l = Color.hexToLinear(c); ed.locked { l.copyInto(mat.emissive) }
                ed.materialChange(o, "Glow colour", before)
            }
        }
        emRow.addView(esw)
        emRow.addView(slider(o, "Glow strength", 0f, 8f, { it.emissiveStrength }, { m, v -> m.emissiveStrength = v }), lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(emRow)

        // ---- options ---------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Options"))
        val opts = GroupCard(act)
        opts.row(ToggleRow(act, "Double sided", mat.doubleSided, "Show back faces (planes, leaves, cloth)").apply { onToggle = { v -> ed.editMaterial("Double sided") { it.doubleSided = v } } })
        opts.row(ToggleRow(act, "Unlit", mat.unlit, "Flat colour that ignores lighting").apply { onToggle = { v -> ed.editMaterial("Unlit") { it.unlit = v } } })
        opts.row(ToggleRow(act, "Cut-out transparency", mat.alphaMode == AlphaMode.MASK, "Hard edges from the texture's alpha").apply {
            onToggle = { v -> ed.editMaterial("Alpha cut-out") { it.alphaMode = if (v) AlphaMode.MASK else if (it.baseColor[3] < 1f) AlphaMode.BLEND else AlphaMode.OPAQUE } }
        })
        root.addView(opts)
        if (mat.alphaMode == AlphaMode.MASK) root.addView(slider(o, "Cut-out threshold", 0.01f, 0.99f, { it.alphaCutoff }, { m, v -> m.alphaCutoff = v }), lp().apply { topMargin = dp(6) })

        // ---- vertex paint ---------------------------------------------------------------------------
        root.addView(act.sectionTitle("Paint"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.BRUSH, "Paint") { act.setMode(Mode.PAINT); act.closeSheet() },
            Triple(Icon.FILL, "Fill") { ed.fillPaint() },
            Triple(Icon.TRASH, "Clear") { ed.clearPaint() },
            Triple(Icon.PALETTE, "Colour") { ColorPickerView.show(act, "Paint colour", ed.paintColor) { c -> ed.paintColor = c } },
        )))
        return root
    }

    // ---------------------------------------------------------------------------------------------
    enum class Slot(val label: String, val hint: String) {
        BASE("Colour", "The image on the surface"),
        NORMAL("Bump (normal)", "Fake surface detail that catches light"),
        MR("Metal / rough", "G = roughness, B = metal"),
        EMISSIVE("Glow", "Parts that light up"),
        OCCLUSION("Shadows (AO)", "Baked contact shadows");

        fun get(m: Material): Texture? = when (this) { BASE -> m.baseColorTexture; NORMAL -> m.normalTexture; MR -> m.metallicRoughnessTexture; EMISSIVE -> m.emissiveTexture; OCCLUSION -> m.occlusionTexture }
        fun set(m: Material, t: Texture?) {
            when (this) { BASE -> m.baseColorTexture = t; NORMAL -> m.normalTexture = t; MR -> m.metallicRoughnessTexture = t; EMISSIVE -> m.emissiveTexture = t; OCCLUSION -> m.occlusionTexture = t }
        }
    }

    private fun textureRow(o: SceneObject, slot: Slot): View {
        val row = act.hbox(0, 12).apply { setPadding(0, dp(7), 0, dp(7)); gravity = Gravity.CENTER_VERTICAL }
        val t = slot.get(o.material)
        val thumb = ImageView(act).apply {
            background = Theme.rounded(Theme.SURFACE_2, 10f)
            scaleType = ImageView.ScaleType.CENTER_CROP
            clipToOutline = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(v: View, outline: android.graphics.Outline) { outline.setRoundRect(0, 0, v.width, v.height, dp(10f)) }
            }
        }
        if (t != null) thumbBitmap(t)?.let { thumb.setImageBitmap(it) }
        row.addView(thumb, LinearLayout.LayoutParams(dp(44), dp(44)))
        row.addView(act.vbox().apply {
            addView(act.label(slot.label, 15f, Theme.TEXT))
            addView(act.label(t?.let { "${it.name} · ${it.mimeType.substringAfter('/').uppercase()}" } ?: slot.hint, 11.5f, Theme.TEXT_MUTED).apply { setPadding(0, dp(3), 0, 0); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
        }, lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(IconButton(act, if (t == null) Icon.PLUS else Icon.MORE, sizeDp = 40).apply {
            describe(if (t == null) "Add ${slot.label} texture" else "${slot.label} texture options")
            onClick = { slotMenu(o, slot, t) }
        })
        return row
    }

    private fun slotMenu(o: SceneObject, slot: Slot, t: Texture?) {
        val items = ArrayList<MenuItem>()
        items.add(MenuItem(Icon.IMAGE, if (t == null) "Choose image…" else "Replace image…", subtitle = "Photos, PNG, JPEG, WebP") { loadInto(o, slot) })
        if (slot == Slot.BASE || slot == Slot.NORMAL) items.add(MenuItem(Icon.TEXTURE, "Built-in textures…", subtitle = "Bricks, wood, marble, tiles…") { TextureLibrary.show(act, o) })
        if (slot == Slot.NORMAL && o.material.baseColorTexture != null) items.add(MenuItem(Icon.WAND, "Make bump from colour image", subtitle = "Uses brightness as height") { bumpFromColor(o) })
        if (slot == Slot.EMISSIVE && o.material.baseColorTexture != null) items.add(MenuItem(Icon.SUN, "Glow with the colour image") { ed.editMaterial("Glow texture") { m -> m.emissiveTexture = m.baseColorTexture; if (m.emissive.all { it == 0f }) m.emissive.fill(1f) } })
        if (t != null) items.add(MenuItem(Icon.TRASH, "Remove", danger = true) { ed.editMaterial("Remove ${slot.label}") { m -> slot.set(m, null) } })
        Dialogs.menu(act, slot.label, items)
    }

    private fun loadInto(o: SceneObject, slot: Slot) {
        act.pickImage { tex -> applyTexture(act, o, slot, tex) }
    }

    private fun bumpFromColor(o: SceneObject) {
        val base = o.material.baseColorTexture ?: return
        act.heavyResult("Making bump map…", { TextureFactory.normalFromImage(base, 3f) }) { nm ->
            ed.editMaterial("Bump from colour") { it.normalTexture = nm; it.normalScale = 1f }
        }
    }

    private fun partHelp() {
        Dialogs.custom(act, "Texture just one part", act.label(
            "1.  Switch to Edit mode.\n2.  Brush over the faces you want to change.\n3.  Tap Material in the tool strip.\n\nThose faces become their own part with their own material, so you can give them a different colour, photo or built-in texture.",
            15f, Theme.TEXT_DIM).apply { setLineSpacing(0f, 1.25f) }, "Go to Edit mode", "Not now", onPositive = { act.setMode(Mode.EDIT); act.closeSheet(); true })
    }

    private fun mapping(root: LinearLayout, o: SceneObject) {
        val mat = o.material
        root.addView(act.sectionTitle("Mapping"))
        val proj = act.hbox(0, 8)
        for (mode in MeshOps.UvProjection.values()) proj.addView(Chip(act, mode.label).apply {
            onClick = { act.heavy("Mapping…") { ed.projectUvs(mode) } }
        })
        root.addView(android.widget.HorizontalScrollView(act).apply { isHorizontalScrollBarEnabled = false; addView(proj) })
        root.addView(act.label("Re-wraps the texture: Box suits most props, Front/Top/Side for flat faces, Cylinder for bottles, Sphere for planets.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(6), 0, dp(4)); setLineSpacing(0f, 1.15f) })
        val linked = !(splitRepeat ?: (mat.uvScale[0] != mat.uvScale[1]))
        if (linked) root.addView(slider(o, "Repeat", 0.25f, 16f, { it.uvScale[0] }, { m, v -> m.uvScale[0] = v; m.uvScale[1] = v }, 0.25f) { "${fmtRepeat(it)}×" }, lp())
        else {
            root.addView(slider(o, "Repeat across", 0.25f, 16f, { it.uvScale[0] }, { m, v -> m.uvScale[0] = v }, 0.25f) { "${fmtRepeat(it)}×" }, lp())
            root.addView(slider(o, "Repeat down", 0.25f, 16f, { it.uvScale[1] }, { m, v -> m.uvScale[1] = v }, 0.25f) { "${fmtRepeat(it)}×" }, lp())
        }
        root.addView(slider(o, "Shift across", 0f, 1f, { it.uvOffset[0] }, { m, v -> m.uvOffset[0] = v }, 0.01f) { "${(it * 100).toInt()}%" }, lp())
        root.addView(slider(o, "Shift down", 0f, 1f, { it.uvOffset[1] }, { m, v -> m.uvOffset[1] = v }, 0.01f) { "${(it * 100).toInt()}%" }, lp())
        root.addView(slider(o, "Rotate", -180f, 180f, { it.uvRotation }, { m, v -> m.uvRotation = v }, 5f) { "${it.toInt()}°" }, lp())
        if (mat.normalTexture != null) root.addView(slider(o, "Bump strength", 0f, 3f, { it.normalScale }, { m, v -> m.normalScale = v }, 0.05f), lp())
        val card = GroupCard(act)
        card.row(ToggleRow(act, "Separate across / down", !linked).apply {
            onToggle = { v -> splitRepeat = v; if (!v && mat.uvScale[1] != mat.uvScale[0]) ed.editMaterial("Repeat") { m -> m.uvScale[1] = m.uvScale[0] } else act.rebuildPanel() }
        })
        card.row(ToggleRow(act, "Pixel art", mat.pixelated, "Crisp pixels instead of smooth filtering").apply { onToggle = { v -> ed.editMaterial("Pixel art") { it.pixelated = v } } })
        root.addView(card, lp().apply { topMargin = dp(6) })
        if (mat.hasUvTransform()) root.addView(PanelUi.button(act, "Reset tiling", Icon.RESET) { ed.editMaterial("Reset tiling") { it.resetUvTransform() } }, lp().apply { topMargin = dp(8) })
    }

    private fun fmtRepeat(v: Float) = if (v == v.toInt().toFloat()) v.toInt().toString() else String.format("%.2f", v)

    private val thumbCache = HashMap<Long, Bitmap>()
    private fun thumbBitmap(t: Texture): Bitmap? = thumbCache.getOrPut(t.uid) {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o)
        var s = 1
        while (o.outWidth / (s * 2) >= 96 && o.outHeight / (s * 2) >= 96) s *= 2
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, BitmapFactory.Options().apply { inSampleSize = s }) ?: return null
    }

    companion object {
        /** Put [tex] in [slot], creating UVs first if the mesh has none. */
        fun applyTexture(act: EditorActivity, o: SceneObject, slot: Slot, tex: Texture) {
            val ed = act.editor
            if (ed.scene.selected !== o) ed.select(o)
            if (o.mesh.uvs == null) ed.projectUvs(MeshOps.UvProjection.BOX)
            ed.editMaterial("${slot.label} texture") { m ->
                slot.set(m, tex)
                if (slot == Slot.BASE) { m.baseColor[0] = 1f; m.baseColor[1] = 1f; m.baseColor[2] = 1f }
                if (slot == Slot.EMISSIVE && m.emissive.all { it == 0f }) m.emissive.fill(1f)
            }
            act.status("${slot.label} texture added", 1100)
        }
    }
}
