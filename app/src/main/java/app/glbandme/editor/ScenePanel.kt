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
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.SceneObject
import app.glbandme.math.Quat
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Fmt
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.Icons
import app.glbandme.ui.MenuItem
import app.glbandme.ui.PressableView
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import kotlin.math.abs

/** Outliner + transform + procedural shape parameters. */
class ScenePanel(act: EditorActivity) : Panel(act) {
    override val title = "Scene"
    override val icon = Icon.LAYERS
    override val rebuildOn = setOf(Change.SELECTION, Change.OBJECTS, Change.UNDO, Change.TRANSFORM, Change.TOPOLOGY)

    private var editing = false
    override fun onChanged(c: Set<Change>) {
        if (editing) return // don't rebuild while a field/slider is being dragged
        super.onChanged(c)
    }

    override fun build(): View {
        val root = act.vbox()
        val scene = ed.scene
        if (scene.objects.isEmpty()) {
            root.addView(act.label("The scene is empty. Use Add to create a shape, text or image plane, or import a model.", 13.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(8), 0, dp(12)) })
            root.addView(PanelUi.button(act, "Add a shape", Icon.PLUS, app.glbandme.ui.PillButton.Style.PRIMARY) { act.openPanel("add", AddPanel(act)) })
            return root
        }
        root.addView(act.sectionTitle("Objects · ${scene.objects.size}"))
        val list = act.vbox(0, 4)
        for (o in scene.objects) list.addView(ObjectRow(act, o, o === scene.selected).apply {
            onClick = { ed.select(o) }
            onLongClick = { objectMenu(o) }
            onEye = { ed.setVisible(o, !o.visible) }
        }, lp())
        root.addView(list)
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.COPY, "Duplicate") { ed.duplicateSelected() },
            Triple(Icon.MIRROR, "Mirror X") { ed.duplicateSelected(0) },
            Triple(Icon.LINK, "Join all") {
                Dialogs.confirm(act, "Join visible objects?", "All visible objects are merged into “${scene.selected?.name}”. Material colors are baked into vertex colors.", "Join") { ed.joinVisible() }
            },
            Triple(Icon.TRASH, "Delete") { ed.deleteSelected() },
        )).apply { setPadding(0, dp(8), 0, 0) })

        val o = scene.selected ?: return root
        // ---- transform ----------------------------------------------------------------------
        root.addView(act.sectionTitle("Transform · ${o.name}"))
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
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.RESET, "Reset") { ed.resetTransform() },
            Triple(Icon.CHECK, "Apply") { ed.applyTransform() },
            Triple(Icon.CENTER, "Origin") { ed.originToGeometry(false) },
            Triple(Icon.FLOOR, "Floor") { ed.dropToFloor() },
        )).apply { setPadding(0, dp(8), 0, 0) })

        // ---- procedural parameters ------------------------------------------------------------
        val spec = o.primitive
        if (spec != null) {
            root.addView(act.sectionTitle("${spec.type.label} parameters"))
            var beforeMesh: Mesh? = null
            var beforeSpec: PrimitiveSpec? = null
            for (d in app.glbandme.core.mesh.Primitives.paramDefs(spec.type)) {
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
            root.addView(act.label("Shapes become meshes automatically when you sculpt or edit them.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(2), dp(8), 0, 0) })
        }
        return root
    }

    private fun objectMenu(o: SceneObject) {
        ed.select(o)
        Dialogs.menu(act, o.name, listOf(
            MenuItem(Icon.PEN, "Rename") { Dialogs.prompt(act, "Rename object", o.name) { ed.rename(o, it) } },
            MenuItem(Icon.FOCUS, "Focus") { act.viewport.frameSelection() },
            MenuItem(if (o.visible) Icon.EYE_OFF else Icon.EYE, if (o.visible) "Hide" else "Show") { ed.setVisible(o, !o.visible) },
            MenuItem(if (o.locked) Icon.UNLOCK else Icon.LOCK, if (o.locked) "Unlock sculpting" else "Lock (no sculpting)") { ed.locked { o.locked = !o.locked }; ed.notify(Change.OBJECTS) },
            MenuItem(Icon.COPY, "Duplicate") { ed.duplicateSelected() },
            MenuItem(Icon.CHEVRON_DOWN, "Move down in list") { ed.moveInList(o, 1) },
            MenuItem(Icon.SORT, "Move up in list") { ed.moveInList(o, -1) },
            MenuItem(Icon.TRASH, "Delete", danger = true) { ed.deleteSelected() },
        ))
    }
}

/** Outliner row. */
@SuppressLint("ViewConstructor")
class ObjectRow(ctx: Context, val o: SceneObject, private val selected: Boolean) : PressableView(ctx) {
    var onEye: (() -> Unit)? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(300), w), dp(46))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(0f, 0f, w, h)
        p.color = if (selected) Theme.withAlpha(Theme.accent, 0.22f) else Theme.SURFACE_2
        c.drawRoundRect(r, dp(12f), dp(12f), p)
        if (selected) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = Theme.accent; c.drawRoundRect(r, dp(12f), dp(12f), p); p.style = Paint.Style.FILL }
        if (pressedNow) { p.color = 0x18FFFFFF; c.drawRoundRect(r, dp(12f), dp(12f), p) }
        // material dot
        p.color = o.material.baseColorSrgb()
        c.drawCircle(dp(20f), h / 2, dp(7f), p)
        val icon = when { o.primitive != null -> Icon.SHAPES; o.keys.isNotEmpty() -> Icon.ANIMATE; else -> Icon.CUBE }
        Icons.draw(c, icon, dp(42f), h / 2, dp(17f), Theme.TEXT_DIM)
        tp.color = if (o.visible) Theme.TEXT else Theme.TEXT_MUTED
        tp.textSize = dp(14f); tp.typeface = if (selected) Theme.medium else Theme.regular
        val count = Fmt.count(o.mesh.triangleCount)
        val tw = w - dp(58f) - dp(100f)
        c.drawText(TextUtils.ellipsize(o.name, tp, tw, TextUtils.TruncateAt.END).toString(), dp(58f), h / 2 + dp(5f), tp)
        tp.textSize = dp(11f); tp.color = Theme.TEXT_MUTED; tp.typeface = Theme.regular
        tp.textAlign = Paint.Align.RIGHT
        c.drawText(count, w - dp(48f), h / 2 + dp(4f), tp)
        tp.textAlign = Paint.Align.LEFT
        if (o.locked) Icons.draw(c, Icon.LOCK, w - dp(96f), h / 2, dp(14f), Theme.TEXT_MUTED)
        Icons.draw(c, if (o.visible) Icon.EYE else Icon.EYE_OFF, w - dp(22f), h / 2, dp(20f), if (o.visible) Theme.TEXT_DIM else Theme.TEXT_MUTED)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.actionMasked == MotionEvent.ACTION_UP && e.x > width - dp(44f)) {
            pressedNow = false; invalidate(); onEye?.invoke(); return true
        }
        return super.onTouchEvent(e)
    }
}
