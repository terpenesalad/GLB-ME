package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.text.TextUtils
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.sculpt.Falloff
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Fmt
import app.glbandme.ui.GroupCard
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.Icons
import app.glbandme.ui.MenuItem
import app.glbandme.ui.NavRow
import app.glbandme.ui.PillButton
import app.glbandme.ui.Prefs
import app.glbandme.ui.PressableView
import app.glbandme.ui.Segmented
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.Units
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import kotlin.math.abs

// =============================================================================================
// Layers
// =============================================================================================
class LayersPanel(act: EditorActivity) : Panel(act) {
    override val title = "Layers"
    override val icon = Icon.LAYERS
    override val rebuildOn = setOf(Change.SELECTION, Change.OBJECTS, Change.UNDO, Change.TOPOLOGY, Change.MATERIAL)

    override fun headerActions(): List<View> = listOf(IconButton(act, Icon.PLUS, sizeDp = 38).apply { round = true; filled = true; describe("Add"); onClick = { act.openAdd() } })

    override fun build(): View {
        val root = act.vbox()
        val scene = ed.scene
        if (scene.objects.isEmpty()) {
            root.addView(act.label("Nothing here yet. Add a shape, 3D text or an image, or import a model.", 14f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(10), 0, dp(14)); setLineSpacing(0f, 1.2f) })
            root.addView(PanelUi.button(act, "Add something", Icon.PLUS, PillButton.Style.PRIMARY) { act.openAdd() })
            return root
        }
        root.addView(act.label("${scene.objects.size} objects · ${Fmt.count(scene.totalTriangles())} triangles", 12.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(6), 0, dp(8)) })
        val list = act.vbox(0, 6)
        for (o in scene.objects) list.addView(ObjectRow(act, o, o === scene.selected).apply {
            onClick = { if (ed.scene.selected === o) act.openInspector(EditorActivity.INSPECT_OBJECT) else ed.select(o) }
            onLongClick = { objectMenu(o) }
            onEye = { ed.setVisible(o, !o.visible) }
        }, lp())
        root.addView(list)
        root.addView(act.label("Tap to select · tap again for details · hold for more", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(10), 0, 0) })
        root.addView(act.sectionTitle("Arrange"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.COPY, "Duplicate") { ed.duplicateSelected() },
            Triple(Icon.LINK, "Join all") {
                Dialogs.confirm(act, "Join visible objects?", "All visible objects are merged into “${scene.selected?.name}”. Material colours are baked into vertex colours.", "Join") { ed.joinVisible() }
            },
            Triple(Icon.EYE, "Show all") { for (o in scene.objects) if (!o.visible) ed.setVisible(o, true) },
            Triple(Icon.TRASH, "Delete") { ed.deleteSelected() },
        )))
        return root
    }

    private fun objectMenu(o: SceneObject) {
        ed.select(o)
        Dialogs.menu(act, o.name, listOf(
            MenuItem(Icon.PEN, "Rename") { Dialogs.prompt(act, "Rename object", o.name) { ed.rename(o, it) } },
            MenuItem(Icon.SLIDERS, "Inspect") { act.openInspector(EditorActivity.INSPECT_OBJECT) },
            MenuItem(Icon.MATERIAL, "Material & textures") { act.openInspector(EditorActivity.INSPECT_MATERIAL) },
            MenuItem(Icon.FOCUS, "Focus") { act.viewport.frameSelection() },
            MenuItem(if (o.visible) Icon.EYE_OFF else Icon.EYE, if (o.visible) "Hide" else "Show") { ed.setVisible(o, !o.visible) },
            MenuItem(if (o.locked) Icon.UNLOCK else Icon.LOCK, if (o.locked) "Unlock" else "Lock (no sculpting)") { ed.locked { o.locked = !o.locked }; ed.notify(Change.OBJECTS) },
            MenuItem(Icon.COPY, "Duplicate") { ed.duplicateSelected() },
            MenuItem(Icon.SORT, "Move up") { ed.moveInList(o, -1) },
            MenuItem(Icon.CHEVRON_DOWN, "Move down") { ed.moveInList(o, 1) },
            MenuItem(Icon.TRASH, "Delete", danger = true) { ed.deleteSelected() },
        ))
    }
}

/** Outliner row: material dot, kind icon, name, triangle count, visibility toggle. */
@SuppressLint("ViewConstructor")
class ObjectRow(ctx: Context, val o: SceneObject, private val selected: Boolean) : PressableView(ctx) {
    var onEye: (() -> Unit)? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()

    init { describe("${o.name}, ${if (o.visible) "visible" else "hidden"}${if (selected) ", selected" else ""}") }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(300), w), maxOf(dp(52), (sp(14f) + dp(34f)).toInt()))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(0f, 0f, w, h)
        p.color = if (selected) Theme.withAlpha(Theme.accent, 0.22f) else Theme.SURFACE_2
        c.drawRoundRect(r, dp(14f), dp(14f), p)
        if (selected) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = Theme.accent; c.drawRoundRect(r, dp(14f), dp(14f), p); p.style = Paint.Style.FILL }
        if (pressedNow) { p.color = 0x18FFFFFF; c.drawRoundRect(r, dp(14f), dp(14f), p) }
        p.color = o.material.baseColorSrgb()
        c.drawCircle(dp(20f), h / 2, dp(8f), p)
        if (o.material.baseColorTexture != null) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = 0xCCFFFFFF.toInt(); c.drawCircle(dp(20f), h / 2, dp(8f), p); p.style = Paint.Style.FILL }
        val icon = when { o.text != null -> Icon.TEXT; o.primitive != null -> Icon.SHAPES; o.keys.isNotEmpty() -> Icon.ANIMATE; else -> Icon.CUBE }
        Icons.draw(c, icon, dp(44f), h / 2, dp(18f), Theme.TEXT_DIM)
        tp.color = if (o.visible) Theme.TEXT else Theme.TEXT_MUTED
        tp.textSize = sp(14.5f); tp.typeface = if (selected) Theme.medium else Theme.regular
        val count = Fmt.count(o.mesh.triangleCount)
        val tw = w - dp(62f) - dp(104f)
        c.drawText(TextUtils.ellipsize(o.name, tp, tw, TextUtils.TruncateAt.END).toString(), dp(62f), h / 2 + sp(14.5f) * 0.35f, tp)
        tp.textSize = sp(11.5f); tp.color = Theme.TEXT_MUTED; tp.typeface = Theme.regular
        tp.textAlign = Paint.Align.RIGHT
        c.drawText(count, w - dp(50f), h / 2 + sp(11.5f) * 0.35f, tp)
        tp.textAlign = Paint.Align.LEFT
        if (o.locked) Icons.draw(c, Icon.LOCK, w - dp(98f), h / 2, dp(14f), Theme.TEXT_MUTED)
        Icons.draw(c, if (o.visible) Icon.EYE else Icon.EYE_OFF, w - dp(24f), h / 2, dp(20f), if (o.visible) Theme.TEXT_DIM else Theme.TEXT_MUTED)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.actionMasked == MotionEvent.ACTION_UP && e.x > width - dp(48f)) {
            pressedNow = false; invalidate(); onEye?.invoke(); return true
        }
        return super.onTouchEvent(e)
    }

    override fun onInitializeAccessibilityNodeInfo(info: android.view.accessibility.AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction(R_ID_TOGGLE, if (o.visible) "Hide" else "Show"))
    }

    override fun performAccessibilityAction(action: Int, arguments: android.os.Bundle?): Boolean {
        if (action == R_ID_TOGGLE) { onEye?.invoke(); return true }
        return super.performAccessibilityAction(action, arguments)
    }

    companion object { private const val R_ID_TOGGLE = 0x7f0a0101 }
}

// =============================================================================================
// Object inspector
// =============================================================================================
class ObjectPanel(act: EditorActivity) : Panel(act) {
    override val title = "Object"
    override val icon = Icon.SLIDERS
    override val rebuildOn = setOf(Change.SELECTION, Change.OBJECTS, Change.UNDO, Change.TRANSFORM, Change.TOPOLOGY)
    private var editing = false
    private var uniform = true

    override fun onChanged(c: Set<Change>) { if (!editing) super.onChanged(c) }

    override fun build(): View {
        val root = act.vbox()
        val o = ed.scene.selected
        if (o == null) {
            root.addView(act.label("Select an object to see its details.", 14f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(10), 0, dp(10)) })
            root.addView(PanelUi.button(act, "Show layers", Icon.LAYERS) { act.openLayers() })
            return root
        }
        // ---- identity --------------------------------------------------------------------------
        val card = GroupCard(act)
        card.row(NavRow(act, Icon.PEN, "Name", o.name).apply { onClick = { Dialogs.prompt(act, "Rename object", o.name) { ed.rename(o, it) } } })
        card.row(ToggleRow(act, "Visible", o.visible).apply { onToggle = { v -> ed.setVisible(o, v) } })
        card.row(ToggleRow(act, "Locked", o.locked, "Protect from sculpting and painting").apply { onToggle = { v -> ed.locked { o.locked = v }; ed.notify(Change.OBJECTS) } })
        root.addView(card, lp().apply { topMargin = dp(6) })

        // ---- text / procedural ----------------------------------------------------------------------
        o.text?.let { spec ->
            root.addView(act.sectionTitle("3D Text"))
            root.addView(PanelUi.button(act, "Edit text “${spec.text.take(18)}”", Icon.TEXT, PillButton.Style.TINTED) { TextStudio.edit(act, o) }, lp())
        }

        // ---- transform --------------------------------------------------------------------------
        root.addView(act.sectionTitle("Transform"))
        var before: Keyframe? = null
        val begin = { editing = true; before = ed.beginTransform(o) }
        val commit = { editing = false; before?.let { ed.commitTransform(o, it) }; before = null }
        root.addView(PanelUi.vec3Row(act, "Position", floatArrayOf(o.position.x, o.position.y, o.position.z), 0.01f, "%.3f", begin, { i, v ->
            ed.locked { o.position[i] = v }; ed.requestRender()
        }, commit))
        val e = o.rotation.toEulerDeg()
        val euler = floatArrayOf(e.x, e.y, e.z)
        root.addView(PanelUi.vec3Row(act, "Rotation °", euler, 0.5f, "%.1f", begin, { i, v ->
            euler[i] = v
            ed.locked { o.rotation.set(Quat.fromEulerDeg(euler[0], euler[1], euler[2])) }; ed.requestRender()
        }, commit))
        root.addView(PanelUi.vec3Row(act, "Scale", floatArrayOf(o.scale.x, o.scale.y, o.scale.z), 0.01f, "%.3f", begin, { i, v ->
            ed.locked { o.scale[i] = if (abs(v) < 1e-4f) 1e-4f else v }; ed.requestRender()
        }, commit))

        // ---- dimensions -------------------------------------------------------------------------
        val units = Units.of(Prefs.of(act).units)
        val (a, b) = o.worldBounds()
        val dims = b - a
        root.addView(act.sectionTitle("Size (${units.label})"))
        val dimRow = act.hbox(0, 6)
        val colors = intArrayOf(Theme.AXIS_X, Theme.AXIS_Y, Theme.AXIS_Z)
        for (i in 0 until 3) {
            val f = NumberField(act, colors[i], dims[i] * units.perMeter, 0.01f, "%.3f")
            f.contentDescription = "${"Width Height Depth".split(' ')[i]} ${units.format(dims[i])}"
            f.onTapEdit = {
                Dialogs.prompt(act, "${"Width Height Depth".split(' ')[i]} (${units.suffix})", String.format(java.util.Locale.US, "%.4f", dims[i] * units.perMeter).trimEnd('0').trimEnd('.'), numeric = true, ok = "Set") { t ->
                    t.replace(',', '.').toFloatOrNull()?.let { v -> ed.setDimension(o, i, v / units.perMeter, uniform) }
                }
            }
            f.onBegin = begin
            f.onChange = { v -> ed.locked {
                val cur = (o.worldBounds().let { (p, q) -> q - p })[i].coerceAtLeast(1e-6f)
                val k = (v / units.perMeter).coerceAtLeast(1e-5f) / cur
                if (uniform) o.scale.set(o.scale.x * k, o.scale.y * k, o.scale.z * k) else o.scale[i] = o.scale[i] * k
            }; ed.requestRender() }
            f.onCommit = commit
            dimRow.addView(f, LinearLayout.LayoutParams(0, dp(38), 1f))
        }
        root.addView(dimRow)
        root.addView(ToggleRow(act, "Keep proportions", uniform).apply { onToggle = { uniform = it } }, lp())

        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.RESET, "Reset") { ed.resetTransform() },
            Triple(Icon.CHECK, "Apply") { ed.applyTransform(); act.status("Transform baked into the mesh", 1200) },
            Triple(Icon.CENTER, "Origin") { Dialogs.menu(act, "Set origin", listOf(
                MenuItem(Icon.CENTER, "Centre of geometry") { ed.originToGeometry(false) },
                MenuItem(Icon.FLOOR, "Bottom centre", subtitle = "Great for props that stand on the ground") { ed.originToGeometry(true) },
            )) },
            Triple(Icon.FLOOR, "On floor") { ed.dropToFloor() },
        )).apply { setPadding(0, dp(8), 0, 0) })

        // ---- procedural parameters ------------------------------------------------------------
        val spec = o.primitive
        if (spec != null) {
            root.addView(act.sectionTitle("${spec.type.label} shape"))
            var beforeMesh: Mesh? = null
            var beforeSpec: PrimitiveSpec? = null
            for (d in Primitives.paramDefs(spec.type)) {
                val s = HSlider(act, d.label, d.min, d.max, spec[d.key], if (d.integer) 1f else 0f) { v -> if (d.integer) v.toInt().toString() else String.format("%.3f", v) }
                s.onChange = { v ->
                    if (beforeMesh == null) { editing = true; beforeMesh = o.mesh; beforeSpec = o.primitive?.copy() }
                    val ns = (o.primitive ?: spec).copy()
                    ns.params[d.key] = v
                    ed.updatePrimitive(o, ns)
                }
                s.onRelease = {
                    val bm = beforeMesh; val bs = beforeSpec
                    if (bm != null && bs != null) ed.commitPrimitive(o, bm, bs)
                    beforeMesh = null; beforeSpec = null; editing = false
                }
                root.addView(s, lp())
            }
            root.addView(PanelUi.button(act, "Convert to editable mesh", Icon.TOPOLOGY) { ed.bakePrimitive() }, lp().apply { topMargin = dp(8) })
            root.addView(act.label("Shapes stay adjustable until you sculpt or edit them.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(8), 0, 0) })
        }

        // ---- info -------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Info"))
        val info = GroupCard(act)
        info.row(NavRow(act, null, "Triangles", Fmt.count(o.mesh.triangleCount), chevron = false))
        info.row(NavRow(act, null, "Vertices", Fmt.count(o.mesh.vertexCount), chevron = false))
        info.row(NavRow(act, null, "Size", "${units.format(dims.x)} × ${units.format(dims.y)} × ${units.format(dims.z)}", chevron = false))
        info.row(NavRow(act, null, "Keyframes", if (o.keys.isEmpty()) "None" else o.keys.size.toString(), chevron = false))
        root.addView(info)
        return root
    }
}

// =============================================================================================
// Brush options
// =============================================================================================
class BrushPanel(act: EditorActivity) : Panel(act) {
    override val title get() = if (ed.tool == Tool.PAINT) "Paint options" else "${ed.tool.label} brush"
    override val icon = Icon.SLIDERS
    override val rebuildOn = setOf(Change.TOOL)

    override fun build(): View {
        val root = act.vbox()
        val b = ed.currentBrush
        if (b == null) { root.addView(act.label("Pick a brush first.", 14f, Theme.TEXT_DIM)); return root }
        root.addView(HSlider(act, "Size", 4f, 300f, b.radiusPx, 1f) { "${it.toInt()} px" }.apply { onChange = { b.radiusPx = it }; onRelease = { act.refreshToolUi() } }, lp())
        root.addView(HSlider(act, "Strength", 0f, 1f, b.intensity) { "${(it * 100).toInt()}%" }.apply { onChange = { b.intensity = it }; onRelease = { act.refreshToolUi() } }, lp())
        root.addView(HSlider(act, "Spacing", 0.03f, 0.6f, b.spacing) { "${(it * 100).toInt()}%" }.apply { onChange = { b.spacing = it } }, lp())
        root.addView(act.sectionTitle("Falloff"))
        val falls = Falloff.values().toList()
        root.addView(Segmented(act, falls.map { it.label }, falls.indexOf(b.falloff)).apply { onSelect = { i -> b.falloff = falls[i] } })
        root.addView(act.sectionTitle("Behaviour"))
        val card = GroupCard(act)
        card.row(ToggleRow(act, "Subtract", b.negative, "Dig in instead of building up").apply { onToggle = { b.negative = it; act.refreshToolUi() } })
        card.row(ToggleRow(act, "Pen pressure", b.usePressure, "Stylus pressure changes the strength").apply { onToggle = { b.usePressure = it } })
        card.row(ToggleRow(act, "Stylus only", Prefs.of(act).stylusOnly, "Fingers always navigate").apply { onToggle = { Prefs.of(act).stylusOnly = it } })
        root.addView(card)
        root.addView(act.sectionTitle("Symmetry"))
        val sym = act.hbox(0, 8)
        for ((i, n) in listOf("X", "Y", "Z").withIndex()) sym.addView(app.glbandme.ui.Chip(act, "Mirror $n", Icon.SYMMETRY).apply {
            active = ed.symmetry(i)
            onClick = { ed.setSymmetry(i, !ed.symmetry(i)); active = ed.symmetry(i); act.refreshToolUi() }
        })
        root.addView(sym)
        if (ed.tool != Tool.PAINT) {
            root.addView(act.sectionTitle("Mask"))
            root.addView(PanelUi.actionGrid(act, listOf(
                Triple(Icon.MASK, "Mask brush") { act.selectTool(Tool.MASK) },
                Triple(Icon.CLOSE, "Clear") { ed.maskClear() },
                Triple(Icon.INVERT, "Invert") { ed.maskInvert() },
                Triple(Icon.BLUR, "Blur") { ed.maskBlur() },
                Triple(Icon.SPARKLE, "Sharpen") { ed.maskSharpen() },
                Triple(if (ed.showMask) Icon.EYE else Icon.EYE_OFF, if (ed.showMask) "Shown" else "Hidden") { ed.showMask = !ed.showMask; ed.requestRender(); act.rebuildPanel() },
            )))
            root.addView(act.sectionTitle("Resolution"))
            val o = ed.scene.selected
            if (o != null) root.addView(act.label("${Fmt.count(o.mesh.triangleCount)} triangles. More detail = finer sculpting.", 12.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), 0, 0, dp(8)) })
            root.addView(PanelUi.twoButtons(act,
                PanelUi.button(act, "Subdivide", Icon.SUBDIVIDE, PillButton.Style.TINTED) { act.heavy("Subdividing…") { ed.subdivide(true) } },
                PanelUi.button(act, "Smooth all", Icon.SMOOTH) { act.heavy("Smoothing…") { ed.smoothMesh(2) } }
            ))
            root.addView(ToggleRow(act, "Show wireframe", ed.scene.render.wireframe).apply { onToggle = { v -> ed.locked { ed.scene.render.wireframe = v }; ed.notify(Change.RENDER) } }, lp().apply { topMargin = dp(6) })
        }
        return root
    }
}

// =============================================================================================
// Array
// =============================================================================================
class ArrayPanel(act: EditorActivity) : Panel(act) {
    override val title = "Array"
    override val icon = Icon.ARRAY
    override val rebuildOn = emptySet<Change>()
    private var count = 5f
    private var radial = false
    private var spacing = 1.2f
    private var axis = 0
    private var angle = 360f

    override fun build(): View {
        val root = act.vbox()
        val o = ed.scene.selected ?: return root.also { it.addView(act.label("Select an object first.", 14f, Theme.TEXT_DIM)) }
        val size = o.worldBounds().let { (a, b) -> b - a }
        root.addView(Segmented(act, listOf("Line", "Circle"), if (radial) 1 else 0, listOf(Icon.ARRAY, Icon.ROTATE)).apply { onSelect = { radial = it == 1; act.rebuildPanel() } }, lp().apply { topMargin = dp(6) })
        root.addView(HSlider(act, "Copies", 2f, 50f, count, 1f) { "${it.toInt()}" }.apply { onChange = { count = it } }, lp().apply { topMargin = dp(8) })
        if (!radial) {
            root.addView(act.sectionTitle("Direction"))
            root.addView(Segmented(act, listOf("X", "Y", "Z"), axis).apply { onSelect = { axis = it } })
            root.addView(HSlider(act, "Gap", 0.5f, 4f, spacing, 0.05f) { "×${String.format("%.2f", it)} size" }.apply { onChange = { spacing = it } }, lp().apply { topMargin = dp(8) })
        } else {
            root.addView(act.sectionTitle("Around"))
            root.addView(Segmented(act, listOf("X", "Y", "Z"), 1).apply { onSelect = { axis = it } }.also { axis = 1 })
            root.addView(HSlider(act, "Angle", 30f, 360f, angle, 5f) { "${it.toInt()}°" }.apply { onChange = { angle = it } }, lp().apply { topMargin = dp(8) })
            root.addView(act.label("Copies are placed around the world centre – move the object away from it first for a ring.", 12f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(6), 0, 0) })
        }
        root.addView(PanelUi.button(act, "Create array", Icon.CHECK, PillButton.Style.PRIMARY) {
            val off = Vec3(); off[axis] = size[axis] * spacing
            ed.arrayDuplicate(count.toInt(), off, radial, angle, axis)
            act.closeSheet()
            act.status("Created ${count.toInt() - 1} copies", 1300)
        }, lp().apply { topMargin = dp(16) })
        return root
    }
}
