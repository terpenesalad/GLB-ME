package app.glbandme.editor

import android.annotation.SuppressLint
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import app.glbandme.ui.ColorPickerView
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.MenuItem
import app.glbandme.ui.Mode
import app.glbandme.ui.Prefs
import app.glbandme.ui.Swatch
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.label

/**
 * The contextual tool strip above the mode bar. Its content follows the current mode and
 * selection so only relevant actions are ever on screen.
 */
@SuppressLint("ViewConstructor")
class ContextStrip(private val act: EditorActivity) : LinearLayout(act) {
    private val ed get() = act.editor

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(6), dp(4), dp(6), dp(4))
    }

    private fun btn(icon: Icon, text: String, active: Boolean = false, action: (IconButton) -> Unit): IconButton =
        IconButton(act, icon, text, 40).apply { this.active = active; onClick = { action(this) } }.also { addView(it, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)) }

    private fun divider() = addView(View(act).apply { setBackgroundColor(0x26FFFFFF); importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO },
        LayoutParams(1, dp(32)).apply { setMargins(dp(5), 0, dp(5), 0) })

    private fun note(text: String) = addView(act.label(text, 13f, Theme.TEXT_DIM).apply { setPadding(dp(8), 0, dp(10), 0) })

    fun rebuild() {
        removeAllViews()
        val sel = ed.scene.selected
        when (act.mode) {
            Mode.OBJECT -> objectTools(sel != null)
            Mode.SCULPT -> sculptTools()
            Mode.PAINT -> paintTools()
            Mode.EDIT -> editTools(sel != null)
            Mode.ANIMATE -> animateTools(sel != null)
        }
        requestLayout()
    }

    private fun gizmoModes() {
        for (g in GizmoMode.values()) btn(g.icon, g.label, ed.gizmoMode == g) { ed.gizmoMode = g; rebuild(); act.viewport.requestRender(); act.overlay.invalidate() }
    }

    private fun objectTools(hasSel: Boolean) {
        if (!hasSel) {
            btn(Icon.PLUS, "Add") { act.openAdd() }
            btn(Icon.LAYERS, "Layers") { act.openLayers() }
            btn(Icon.FOCUS, "Frame all") { act.viewport.frameSelection() }
            note("Tap an object to select it")
            return
        }
        gizmoModes()
        divider()
        btn(Icon.MAGIC, "Snap", ed.snap) { b -> ed.snap = !ed.snap; b.active = ed.snap; act.status(if (ed.snap) "Snapping on" else "Snapping off", 800) }
        btn(Icon.FOCUS, "Focus") { act.viewport.frameSelection() }
        btn(Icon.FLOOR, "Floor") { ed.dropToFloor() }
        btn(Icon.SLIDERS, "Inspect") { act.openInspector(EditorActivity.INSPECT_OBJECT) }
        btn(Icon.MATERIAL, "Material") { act.openInspector(EditorActivity.INSPECT_MATERIAL) }
        divider()
        btn(Icon.COPY, "Duplicate") { ed.duplicateSelected() }
        btn(Icon.MIRROR, "Mirror") { mirrorMenu() }
        btn(Icon.ARRAY, "Array") { act.openPanel("array", ArrayPanel(act)) }
        btn(Icon.TRASH, "Delete") { ed.deleteSelected() }
    }

    private fun mirrorMenu() {
        Dialogs.menu(act, "Mirrored copy", listOf(
            MenuItem(Icon.MIRROR, "Across X", subtitle = "Left ↔ right") { ed.duplicateSelected(0) },
            MenuItem(Icon.MIRROR, "Across Y", subtitle = "Up ↔ down") { ed.duplicateSelected(1) },
            MenuItem(Icon.MIRROR, "Across Z", subtitle = "Front ↔ back") { ed.duplicateSelected(2) },
        ))
    }

    private val sculptTools = listOf(Tool.CLAY, Tool.DRAW, Tool.INFLATE, Tool.SMOOTH, Tool.FLATTEN, Tool.PINCH, Tool.CREASE, Tool.MOVE, Tool.DRAG, Tool.LAYER, Tool.MASK)

    private fun sculptTools() {
        btn(Icon.SLIDERS, "Options") { act.openBrushOptions() }
        divider()
        for (t in sculptTools) btn(t.icon, t.label, ed.tool == t) { act.selectTool(t) }
    }

    private fun recentColors(): List<Int> = Prefs.of(act).recentColors.split(',').mapNotNull { it.trim().toLongOrNull(16)?.toInt() }.take(6)

    fun rememberColor(c: Int) {
        val list = (listOf(c) + recentColors().filter { it != c }).take(6)
        Prefs.of(act).recentColors = list.joinToString(",") { Integer.toHexString(it) }
    }

    private fun paintTools() {
        val sw = Swatch(act, ed.paintColor, 42).apply {
            ring = true
            onClick = { ColorPickerView.show(act, "Paint colour", ed.paintColor) { c -> ed.paintColor = c; color = c; rememberColor(c); rebuild() } }
        }
        addView(sw)
        for (c in recentColors().filter { it != ed.paintColor }.take(5)) addView(Swatch(act, c, 34).apply { onClick = { ed.paintColor = c; rememberColor(c); rebuild() } })
        divider()
        btn(Icon.FILL, "Fill") { ed.fillPaint() }
        btn(Icon.TRASH, "Clear") { ed.clearPaint() }
        btn(Icon.SYMMETRY, "Mirror", ed.symmetry(0)) { b -> ed.setSymmetry(0, !ed.symmetry(0)); b.active = ed.symmetry(0) }
        btn(Icon.SLIDERS, "Options") { act.openBrushOptions() }
        btn(Icon.TEXTURE, "Texture") { act.openInspector(EditorActivity.INSPECT_MATERIAL) }
    }

    private fun editTools(hasSel: Boolean) {
        if (!hasSel) { note("Tap an object, then brush over its faces"); return }
        val f = ed.faces
        val n = if (f.mesh === ed.scene.selected?.mesh) f.list().size else 0
        gizmoModes()
        divider()
        btn(Icon.TEMPLATES, "All") { f.selectAll(); ed.notify(Change.EDIT_SELECTION) }
        btn(Icon.CLOSE, "None") { f.clear(); ed.notify(Change.EDIT_SELECTION) }
        btn(Icon.INVERT, "Invert") { f.invert(); ed.notify(Change.EDIT_SELECTION) }
        btn(Icon.PLUS, "Grow") { f.grow(); ed.notify(Change.EDIT_SELECTION) }
        btn(Icon.LINK, "Linked") { f.selectLinked(); ed.notify(Change.EDIT_SELECTION) }
        divider()
        fun need(block: () -> Unit) { if (n == 0) act.status("Select some faces first", 1200) else block() }
        btn(Icon.EXTRUDE, "Extrude") { need { extrude() } }
        btn(Icon.CENTER, "Inset") { need { ed.editOp("Inset") { s -> s.inset(0.25f)?.let { it.first to it.second } } } }
        btn(Icon.FLIP, "Flip") { need { ed.editOp("Flip faces") { s -> s.flipFaces()?.let { it to s.selected.copyOf() } } } }
        btn(Icon.MATERIAL, "Material") { need { ownMaterial() } }
        btn(Icon.PAINT, "Colour") { need { colorSelection() } }
        btn(Icon.SEPARATE, "Separate") { need { ed.separateSelection(false); act.status("Separated into its own object", 1300) } }
        btn(Icon.COPY, "Copy") { need { ed.separateSelection(true) } }
        btn(Icon.TRASH, "Delete") { need { ed.editOp("Delete faces") { s -> s.deleteFaces()?.let { it to null } } } }
    }

    private fun extrude() {
        val o = ed.scene.selected ?: return
        val size = o.mesh.averageEdgeLength().coerceAtLeast(1e-4f) * 2f
        ed.editOp("Extrude") { f -> f.extrude(size)?.let { it.first to it.second } }
        ed.gizmoMode = GizmoMode.MOVE
        rebuild()
        act.status("Extruded – drag the gizmo to adjust", 1600)
    }

    /** Selected faces become their own part with their own material (ready for a texture). */
    private fun ownMaterial() {
        val src = ed.scene.selected ?: return
        ed.separateSelection(false)
        val part = ed.scene.selected
        if (part != null && part !== src) {
            ed.locked { part.name = ed.scene.uniqueName("${src.name} · part"); part.material.name = "${src.material.name} (part)" }
            ed.notify(Change.OBJECTS, Change.MATERIAL)
            act.openInspector(EditorActivity.INSPECT_MATERIAL)
            act.status("These faces now have their own material", 1600)
        }
    }

    private fun colorSelection() {
        ColorPickerView.show(act, "Colour selected faces", ed.paintColor) { c -> ed.paintColor = c; rememberColor(c); ed.fillSelectionColor() }
    }

    private fun animateTools(hasSel: Boolean) {
        if (!hasSel) { note("Select an object to animate it"); btn(Icon.SETTINGS, "Settings") { act.openAnimationSettings() }; return }
        gizmoModes()
        divider()
        btn(Icon.ROTATE, "Spin") { ed.presetAnimation(Editor.AnimPreset.SPIN); act.status("360° spin over ${ed.scene.frameCount} frames", 1300) }
        btn(Icon.FLOOR, "Bounce") { ed.presetAnimation(Editor.AnimPreset.BOUNCE); act.status("Bounce added", 1100) }
        btn(Icon.CURVE, "Float") { ed.presetAnimation(Editor.AnimPreset.FLOAT); act.status("Float added", 1100) }
        btn(Icon.SCALE, "Pulse") { ed.presetAnimation(Editor.AnimPreset.PULSE); act.status("Pulse added", 1100) }
        btn(Icon.RESET, "Wobble") { ed.presetAnimation(Editor.AnimPreset.WOBBLE); act.status("Wobble added", 1100) }
        divider()
        btn(Icon.SETTINGS, "Settings") { act.openAnimationSettings() }
        btn(Icon.TRASH, "Clear") {
            Dialogs.menu(act, "Clear animation", listOf(
                MenuItem(Icon.TRASH, "Selected object", danger = true) { ed.clearAnimation(false) },
                MenuItem(Icon.TRASH, "All objects", danger = true) { ed.clearAnimation(true) },
            ))
        }
    }
}
