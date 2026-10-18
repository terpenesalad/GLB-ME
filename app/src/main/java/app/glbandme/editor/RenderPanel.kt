package app.glbandme.editor

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import app.glbandme.core.scene.EnvPreset
import app.glbandme.core.scene.RenderSettings
import app.glbandme.core.scene.ShadingMode
import app.glbandme.core.sculpt.LambdaAction
import app.glbandme.render.Matcaps
import app.glbandme.render.OrbitCamera
import app.glbandme.ui.Chip
import app.glbandme.ui.ColorPickerView
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.FlowLayout
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.Segmented
import app.glbandme.ui.Swatch
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** Viewport look: shading, matcaps, lights, environment, background, camera. */
class RenderPanel(act: EditorActivity) : Panel(act) {
    override val title = "Render"
    override val icon = Icon.RENDER
    override val rebuildOn = setOf(Change.RENDER, Change.UNDO)
    private var dragging = false
    override fun onChanged(c: Set<Change>) { if (!dragging) super.onChanged(c) }

    private val rs get() = ed.scene.render

    /** Apply a render-settings change with undo. */
    private fun change(label: String, block: (RenderSettings) -> Unit) {
        val before = RenderSettings().also { it.copyFrom(rs) }
        ed.locked { block(rs) }
        val after = RenderSettings().also { it.copyFrom(rs) }
        ed.undo.push(LambdaAction(label, { ed.locked { rs.copyFrom(before) }; ed.notify(Change.RENDER) }, { ed.locked { rs.copyFrom(after) }; ed.notify(Change.RENDER) }))
        ed.notify(Change.RENDER)
    }

    private fun slider(title: String, min: Float, max: Float, value: Float, step: Float = 0f, fmt: (Float) -> String, set: (RenderSettings, Float) -> Unit): HSlider {
        var before: RenderSettings? = null
        return HSlider(act, title, min, max, value, step, fmt).apply {
            onChange = { v ->
                if (before == null) { before = RenderSettings().also { it.copyFrom(rs) }; dragging = true }
                ed.locked { set(rs, v) }; ed.requestRender()
            }
            onRelease = {
                val b = before
                if (b != null) {
                    val after = RenderSettings().also { it.copyFrom(rs) }
                    ed.undo.push(LambdaAction(title, { ed.locked { rs.copyFrom(b) }; ed.notify(Change.RENDER) }, { ed.locked { rs.copyFrom(after) }; ed.notify(Change.RENDER) }))
                }
                before = null; dragging = false
            }
        }
    }

    override fun build(): View {
        val root = act.vbox()
        root.addView(act.sectionTitle("Shading"))
        val modes = ShadingMode.values().toList()
        root.addView(Segmented(act, modes.map { it.label }, modes.indexOf(rs.shading), listOf(Icon.SUN, Icon.MATERIAL, Icon.SCULPT_SPHERE, Icon.GLOBE, Icon.PALETTE)).apply {
            onSelect = { i -> change("Shading ${modes[i].label}") { it.shading = modes[i] } }
        })
        if (rs.shading == ShadingMode.MATCAP) {
            root.addView(act.sectionTitle("Matcap"))
            val flow = FlowLayout(act, 8, 10)
            Matcaps.defs.forEachIndexed { i, d ->
                val cell = act.vbox().apply { gravity = Gravity.CENTER_HORIZONTAL }
                cell.addView(Swatch(act, d.swatch or 0xFF000000.toInt(), 42).apply { ring = rs.matcap == i; onClick = { change("Matcap ${d.name}") { it.matcap = i } } })
                cell.addView(act.label(d.name, 9.5f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; maxLines = 1 })
                flow.addView(cell, LinearLayout.LayoutParams(dp(56), LinearLayout.LayoutParams.WRAP_CONTENT))
            }
            root.addView(flow)
        }

        root.addView(act.sectionTitle("Lighting"))
        val envRow = act.hbox(0, 8)
        for (e in EnvPreset.values()) envRow.addView(Chip(act, e.label).apply { active = rs.env == e; onClick = { change("Environment ${e.label}") { it.env = e } } })
        root.addView(act.hscrollOf(envRow))
        root.addView(slider("Exposure", 0.2f, 3f, rs.exposure, 0.05f, { String.format("%.2f", it) }) { r, v -> r.exposure = v }, lp())
        root.addView(slider("Light direction", -180f, 180f, rs.lightAngle, 1f, { "${it.toInt()}°" }) { r, v -> r.lightAngle = v }, lp())
        root.addView(slider("Light height", 5f, 89f, rs.lightHeight, 1f, { "${it.toInt()}°" }) { r, v -> r.lightHeight = v }, lp())
        root.addView(ToggleRow(act, "Shadows", rs.shadows, "Soft shadows on the model and floor").apply { onToggle = { v -> change("Shadows") { it.shadows = v } } }, lp())

        root.addView(act.sectionTitle("Viewport"))
        root.addView(ToggleRow(act, "Floor grid", rs.showGrid).apply { onToggle = { v -> change("Grid") { it.showGrid = v } } }, lp())
        root.addView(ToggleRow(act, "Wireframe", rs.wireframe).apply { onToggle = { v -> change("Wireframe") { it.wireframe = v } } }, lp())
        root.addView(ToggleRow(act, "Orthographic camera", rs.orthographic).apply { onToggle = { v -> change("Orthographic") { it.orthographic = v } } }, lp())
        root.addView(slider("Field of view", 15f, 100f, rs.fov, 1f, { "${it.toInt()}°" }) { r, v -> r.fov = v }, lp())
        val views = act.hbox(0, 8)
        for (v in OrbitCamera.View.values()) views.addView(Chip(act, v.label).apply { onClick = { ed.locked { act.viewport.uiCam.snap(v) }; ed.requestRender() } })
        root.addView(act.hscrollOf(views), lp().apply { topMargin = dp(6) })

        root.addView(act.sectionTitle("Background"))
        val bg = act.hbox(0, 12)
        val top = Swatch(act, rs.bgTop or 0xFF000000.toInt(), 40)
        val bottom = Swatch(act, rs.bgBottom or 0xFF000000.toInt(), 40)
        top.onClick = { ColorPickerView.show(act, "Background top", top.color, live = { c -> ed.locked { rs.bgTop = c and 0xFFFFFF }; ed.requestRender() }) { c -> change("Background") { it.bgTop = c and 0xFFFFFF } } }
        bottom.onClick = { ColorPickerView.show(act, "Background bottom", bottom.color, live = { c -> ed.locked { rs.bgBottom = c and 0xFFFFFF }; ed.requestRender() }) { c -> change("Background") { it.bgBottom = c and 0xFFFFFF } } }
        bg.addView(top); bg.addView(act.label("Top", 12f, Theme.TEXT_DIM))
        bg.addView(bottom); bg.addView(act.label("Bottom", 12f, Theme.TEXT_DIM))
        root.addView(bg)
        val presets = listOf(
            "Midnight" to (0x2B2E3A to 0x101116), "Studio" to (0xD9DCE3 to 0x9EA3AD), "Sunset" to (0xF7A35C to 0x5B3A7A),
            "Ocean" to (0x1E5A8C to 0x0B1A2B), "Mint" to (0xDDF5EA to 0x8FC7B1), "Black" to (0x000000 to 0x000000), "White" to (0xFFFFFF to 0xEDEDED)
        )
        val pr = act.hbox(0, 8)
        for ((name, c) in presets) pr.addView(Chip(act, name).apply { onClick = { change("Background $name") { it.bgTop = c.first; it.bgBottom = c.second } } })
        root.addView(act.hscrollOf(pr), lp().apply { topMargin = dp(8) })

        root.addView(PanelUi.button(act, "Take screenshot", Icon.CAMERA) { act.screenshot() }, lp().apply { topMargin = dp(16) })
        return root
    }
}

private fun android.app.Activity.hscrollOf(v: View) = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(v) }
