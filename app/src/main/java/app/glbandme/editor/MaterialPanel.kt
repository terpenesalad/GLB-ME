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
import app.glbandme.ui.ColorPickerView
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.FlowLayout
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.MenuItem
import app.glbandme.ui.Swatch
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** PBR material editor, texture slots and vertex paint helpers. */
class MaterialPanel(act: EditorActivity) : Panel(act) {
    override val title = "Material"
    override val icon = Icon.MATERIAL
    override val rebuildOn = setOf(Change.SELECTION, Change.MATERIAL, Change.UNDO, Change.OBJECTS)
    private var editing = false

    override fun onChanged(c: Set<Change>) { if (!editing) super.onChanged(c) }

    private fun slider(o: SceneObject, title: String, min: Float, max: Float, get: (Material) -> Float, set: (Material, Float) -> Unit, fmt: (Float) -> String = { String.format("%.2f", it) }): HSlider {
        var before: Material? = null
        return HSlider(act, title, min, max, get(o.material), 0f, fmt).apply {
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
            root.addView(act.label("Select an object to edit its material.", 13.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(8), 0, dp(8)) })
            return root
        }
        val mat = o.material

        // ---- presets ----------------------------------------------------------------------------
        root.addView(act.sectionTitle("Presets"))
        val presets = FlowLayout(act, 8, 10)
        for (p in MaterialPreset.values()) {
            val cell = act.vbox().apply { gravity = Gravity.CENTER_HORIZONTAL }
            cell.addView(Swatch(act, p.color or 0xFF000000.toInt(), 40).apply {
                ring = mat.name == p.label
                onClick = { ed.editMaterial("Material: ${p.label}") { m -> p.apply(m); m.name = p.label } }
            })
            cell.addView(act.label(p.label, 9.5f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; maxWidth = dp(52); maxLines = 1 })
            presets.addView(cell, LinearLayout.LayoutParams(dp(52), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(presets)

        // ---- base ---------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Surface"))
        val colorRow = act.hbox(0, 12).apply { setPadding(0, dp(4), 0, dp(4)) }
        val sw = Swatch(act, mat.baseColorSrgb(), 44)
        sw.onClick = {
            val before = mat.copy()
            ColorPickerView.show(act, "Base color", mat.baseColorSrgb(), live = { c -> ed.locked { mat.setBaseColorSrgb(c) }; sw.color = c; ed.requestRender() }) { c ->
                ed.locked { mat.setBaseColorSrgb(c) }
                ed.materialChange(o, "Base color", before)
            }
        }
        colorRow.addView(sw)
        colorRow.addView(act.vbox().apply {
            addView(act.label("Base color", 14f, Theme.TEXT))
            addView(act.label(String.format("#%06X  ·  %s", mat.baseColorSrgb() and 0xFFFFFF, mat.name), 11.5f, Theme.TEXT_MUTED).apply { setPadding(0, dp(3), 0, 0) })
        }, lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        colorRow.addView(IconButton(act, Icon.PEN, sizeDp = 40).apply { onClick = { Dialogs.prompt(act, "Material name", mat.name) { n -> ed.editMaterial("Rename material") { it.name = n } } } })
        root.addView(colorRow)
        root.addView(slider(o, "Metallic", 0f, 1f, { it.metallic }, { m, v -> m.metallic = v }), lp())
        root.addView(slider(o, "Roughness", 0f, 1f, { it.roughness }, { m, v -> m.roughness = v }), lp())
        root.addView(slider(o, "Opacity", 0.02f, 1f, { it.baseColor[3] }, { m, v ->
            m.baseColor[3] = v
            m.alphaMode = if (v < 0.999f) AlphaMode.BLEND else if (m.alphaMode == AlphaMode.BLEND) AlphaMode.OPAQUE else m.alphaMode
        }) { "${(it * 100).toInt()}%" }, lp())

        // ---- emission ---------------------------------------------------------------------------
        root.addView(act.sectionTitle("Emission"))
        val emRow = act.hbox(0, 12)
        val emHex = Color.linearToArgb(mat.emissive[0], mat.emissive[1], mat.emissive[2])
        val esw = Swatch(act, emHex, 40)
        esw.onClick = {
            val before = mat.copy()
            ColorPickerView.show(act, "Glow color", emHex, live = { c -> val l = Color.hexToLinear(c); ed.locked { l.copyInto(mat.emissive) }; esw.color = c; ed.requestRender() }) { c ->
                val l = Color.hexToLinear(c); ed.locked { l.copyInto(mat.emissive) }
                ed.materialChange(o, "Glow color", before)
            }
        }
        emRow.addView(esw)
        emRow.addView(slider(o, "Glow strength", 0f, 8f, { it.emissiveStrength }, { m, v -> m.emissiveStrength = v }), lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(emRow)

        root.addView(act.sectionTitle("Options"))
        root.addView(ToggleRow(act, "Double sided", mat.doubleSided, "Render back faces (planes, leaves, cloth)").apply { onToggle = { v -> ed.editMaterial("Double sided") { it.doubleSided = v } } }, lp())
        root.addView(ToggleRow(act, "Unlit", mat.unlit, "Flat color, ignores lights (KHR_materials_unlit)").apply { onToggle = { v -> ed.editMaterial("Unlit") { it.unlit = v } } }, lp())
        root.addView(ToggleRow(act, "Alpha cutout", mat.alphaMode == AlphaMode.MASK, "Hard-edged transparency from the texture alpha").apply {
            onToggle = { v -> ed.editMaterial("Alpha cutout") { it.alphaMode = if (v) AlphaMode.MASK else if (it.baseColor[3] < 1f) AlphaMode.BLEND else AlphaMode.OPAQUE } }
        }, lp())

        // ---- textures ---------------------------------------------------------------------------
        root.addView(act.sectionTitle("Textures"))
        if (o.mesh.uvs == null) root.addView(act.label("This mesh has no UVs yet – adding a texture will generate them automatically (box projection). You can change the projection in Mesh › UV map.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(2), 0, 0, dp(8)) })
        root.addView(textureRow(o, "Base color", { it.baseColorTexture }, { m, t -> m.baseColorTexture = t }))
        root.addView(textureRow(o, "Normal map", { it.normalTexture }, { m, t -> m.normalTexture = t }))
        root.addView(textureRow(o, "Metal / Rough", { it.metallicRoughnessTexture }, { m, t -> m.metallicRoughnessTexture = t }))
        root.addView(textureRow(o, "Emissive", { it.emissiveTexture }, { m, t -> m.emissiveTexture = t }))
        root.addView(textureRow(o, "Occlusion", { it.occlusionTexture }, { m, t -> m.occlusionTexture = t }))

        // ---- vertex paint -----------------------------------------------------------------------
        root.addView(act.sectionTitle("Vertex paint"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.PAINT, "Paint tool") { act.selectTool(Tool.PAINT); act.closePanel() },
            Triple(Icon.FILL, "Fill") { ed.fillPaint() },
            Triple(Icon.TRASH, "Clear") { ed.clearPaint() },
            Triple(Icon.PALETTE, "Color") { ColorPickerView.show(act, "Paint color", ed.paintColor) { c -> ed.paintColor = c } },
        )))
        return root
    }

    private fun textureRow(o: SceneObject, label: String, get: (Material) -> Texture?, set: (Material, Texture?) -> Unit): View {
        val row = act.hbox(0, 12).apply { setPadding(0, dp(5), 0, dp(5)) }
        val t = get(o.material)
        val thumb = ImageView(act).apply {
            background = Theme.rounded(Theme.SURFACE_2, 10f)
            scaleType = ImageView.ScaleType.CENTER_CROP
            clipToOutline = true
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(v: View, outline: android.graphics.Outline) { outline.setRoundRect(0, 0, v.width, v.height, dp(10f)) }
            }
        }
        if (t != null) thumbBitmap(t)?.let { thumb.setImageBitmap(it) }
        row.addView(thumb, LinearLayout.LayoutParams(dp(44), dp(44)))
        row.addView(act.vbox().apply {
            addView(act.label(label, 14f, Theme.TEXT))
            addView(act.label(t?.let { "${it.name} · ${it.mimeType.substringAfter('/')}" } ?: "None", 11.5f, Theme.TEXT_MUTED).apply { setPadding(0, dp(3), 0, 0); maxLines = 1 })
        }, lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(IconButton(act, if (t == null) Icon.PLUS else Icon.MORE, sizeDp = 40).apply {
            onClick = {
                if (t == null) load(o, label, set)
                else Dialogs.menu(act, label, listOf(
                    MenuItem(Icon.IMAGE, "Replace image") { load(o, label, set) },
                    MenuItem(Icon.TRASH, "Remove", danger = true) { ed.editMaterial("Remove $label") { m -> set(m, null) } },
                ))
            }
        })
        return row
    }

    private fun load(o: SceneObject, label: String, set: (Material, Texture?) -> Unit) {
        act.pickImage { tex ->
            if (o.mesh.uvs == null) ed.projectUvs(MeshOps.UvProjection.BOX)
            ed.editMaterial("$label texture") { m ->
                set(m, tex)
                if (label == "Base color") { m.baseColor[0] = 1f; m.baseColor[1] = 1f; m.baseColor[2] = 1f }
                if (label == "Emissive" && m.emissive.all { it == 0f }) { m.emissive.fill(1f) }
            }
        }
    }

    private val thumbCache = HashMap<Long, Bitmap>()
    private fun thumbBitmap(t: Texture): Bitmap? = thumbCache.getOrPut(t.uid) {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o)
        var s = 1
        while (o.outWidth / (s * 2) >= 96 && o.outHeight / (s * 2) >= 96) s *= 2
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, BitmapFactory.Options().apply { inSampleSize = s }) ?: return null
    }
}
