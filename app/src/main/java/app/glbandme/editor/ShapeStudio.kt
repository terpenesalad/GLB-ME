package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import app.glbandme.core.mesh.Extruder
import app.glbandme.core.mesh.FloatArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.mesh.Sweep
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.SceneObject
import app.glbandme.math.Vec3
import app.glbandme.ui.Chip
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.Segmented
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.vbox
import kotlin.math.abs
import kotlin.math.hypot

/**
 * Draw a 2D shape with your finger, then turn it into 3D: extrude it (logos, signs, cookie
 * cutters), revolve it (vases, bottles, chess pieces) or sweep a tube along it (pipes, wires).
 */
object ShapeStudio {
    enum class Kind(val label: String, val icon: Icon) { EXTRUDE("Extrude", Icon.EXTRUDE), REVOLVE("Revolve", Icon.LATHE), TUBE("Tube", Icon.CURVE) }

    fun show(act: EditorActivity) {
        val body = act.vbox()
        val pad = DrawPad(act)
        var kind = Kind.EXTRUDE
        var size = 1f; var depth = 0.25f; var bevel = 0.02f; var segments = 48f; var radius = 0.05f
        val kindSeg = Segmented(act, Kind.values().map { it.label }, 0, Kind.values().map { it.icon })
        body.addView(kindSeg, lp().apply { topMargin = dp(4) })
        val tip = act.label("", 12.5f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(8), dp(4), dp(8)); setLineSpacing(0f, 1.15f) }
        body.addView(tip)
        body.addView(pad, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(320)))

        val tools = act.hbox(0, 6).apply { setPadding(0, dp(8), 0, 0) }
        val drawChip = Chip(act, "Draw", Icon.PEN).apply { active = true }
        val pointsChip = Chip(act, "Points", Icon.POLYGON)
        drawChip.onClick = { pad.pointMode = false; drawChip.active = true; pointsChip.active = false }
        pointsChip.onClick = { pad.pointMode = true; drawChip.active = false; pointsChip.active = true }
        val mirrorChip = Chip(act, "Mirror", Icon.SYMMETRY).apply { onClick = { pad.mirror = !pad.mirror; active = pad.mirror; pad.invalidate() } }
        tools.addView(drawChip); tools.addView(pointsChip); tools.addView(mirrorChip)
        tools.addView(View(act), lp(0, 1, 1f))
        tools.addView(IconButton(act, Icon.UNDO, sizeDp = 40).apply { filled = true; describe("Undo last stroke"); onClick = { pad.undo() } })
        tools.addView(IconButton(act, Icon.TRASH, sizeDp = 40).apply { filled = true; describe("Clear drawing"); onClick = { pad.clear() } })
        body.addView(tools)

        val params = act.vbox().apply { setPadding(0, dp(6), 0, 0) }
        body.addView(params)
        fun rebuildParams() {
            params.removeAllViews()
            fun s(title: String, min: Float, max: Float, v: Float, step: Float, fmt: (Float) -> String, set: (Float) -> Unit) =
                params.addView(HSlider(act, title, min, max, v, step, fmt).apply { onChange = set }, lp())
            s("Size", 0.1f, 5f, size, 0.05f, { String.format("%.2f m", it) }) { size = it }
            when (kind) {
                Kind.EXTRUDE -> {
                    s("Thickness", 0.01f, 2f, depth, 0.01f, { String.format("%.2f", it) }) { depth = it }
                    s("Bevel", 0f, 0.1f, bevel, 0.005f, { if (it == 0f) "Sharp" else String.format("%.3f", it) }) { bevel = it }
                }
                Kind.REVOLVE -> s("Smoothness", 6f, 128f, segments, 1f, { "${it.toInt()} sides" }) { segments = it }
                Kind.TUBE -> s("Tube radius", 0.005f, 0.3f, radius, 0.005f, { String.format("%.3f", it) }) { radius = it }
            }
        }
        fun setKind(k: Kind) {
            kind = k; pad.kind = k
            tip.text = when (k) {
                Kind.EXTRUDE -> "Draw a closed outline – a logo, a sign, a cookie cutter. Draw inside a shape to cut a hole."
                Kind.REVOLVE -> "Draw half a silhouette to the right of the dashed axis – it spins around into a vase, bottle or chess piece."
                Kind.TUBE -> "Draw a path – it becomes a round tube, like a pipe, wire or handle."
            }
            pad.invalidate(); rebuildParams()
        }
        kindSeg.onSelect = { setKind(Kind.values()[it]) }
        setKind(Kind.EXTRUDE)

        Dialogs.sheet(act, "Draw a shape", body, action = "Create", tall = true, onAction = {
            val strokes = pad.result()
            if (strokes.isEmpty()) { act.status("Draw something first", 1200); false } else {
                val k = kind; val sz = size; val dp_ = depth; val bv = bevel; val sg = segments.toInt(); val rad = radius
                act.heavyResult("Building…", { build(k, strokes, sz, dp_, bv, sg, rad) }) { m ->
                    if (m == null || m.triangleCount == 0) Dialogs.message(act, "Couldn't build that", when (k) {
                        Kind.EXTRUDE -> "Try drawing a closed outline that doesn't cross itself."
                        Kind.REVOLVE -> "Draw the profile on the right side of the axis."
                        Kind.TUBE -> "Draw a longer path."
                    }) else {
                        val o = SceneObject("${k.label}d shape", m, Material.preset(MaterialPreset.CLAY).apply { name = "Clay" })
                        val (mn, _) = m.bounds()
                        o.position.y = -mn.y
                        act.editor.addObject(o, "Draw shape")
                        act.selectTool(Tool.TRANSFORM)
                        act.viewport.frameSelection()
                    }
                }
                true
            }
        })
    }

    /** strokes are in pad units (-1..1, y up). */
    fun build(kind: Kind, strokes: List<FloatArray>, size: Float, depth: Float, bevel: Float, segments: Int, radius: Float): Mesh? {
        val k = size / 2f
        return when (kind) {
            Kind.EXTRUDE -> {
                val contours = strokes.filter { it.size >= 6 }.map { s -> FloatArray(s.size) { i -> s[i] * k } }
                if (contours.isEmpty()) null else Extruder.extrude(contours, depth, bevel, 3)?.also { MeshOps.centerToOrigin(it) }
            }
            Kind.REVOLVE -> {
                val s = strokes.maxByOrNull { it.size } ?: return null
                val prof = ArrayList<FloatArray>()
                for (i in 0 until s.size / 2) prof.add(floatArrayOf(abs(s[i * 2]) * k, s[i * 2 + 1] * k))
                if (prof.size < 2) return null
                // sort the profile bottom -> top so normals face outwards, then close it onto the axis
                if (prof.first()[1] > prof.last()[1]) prof.reverse()
                if (prof.first()[0] > 1e-4f) prof.add(0, floatArrayOf(0f, prof.first()[1]))
                if (prof.last()[0] > 1e-4f) prof.add(floatArrayOf(0f, prof.last()[1]))
                val m = Primitives.lathe(listOf(prof), segments)
                // lathe faces point outward when the profile runs downward; fix if needed
                if (signedVolume(m) < 0f) m.flipWinding()
                m.computeNormals()
                MeshOps.centerToOrigin(m)
                m
            }
            Kind.TUBE -> {
                val s = strokes.maxByOrNull { it.size } ?: return null
                val pts = Extruder.resample(s, 0.02f, false)
                val path = (0 until pts.size / 2).map { Vec3(pts[it * 2] * k, pts[it * 2 + 1] * k, 0f) }
                if (path.size < 2) null else Sweep.tube(path, radius, 16, closed = false)?.also { MeshOps.centerToOrigin(it) }
            }
        }
    }

    private fun signedVolume(m: Mesh): Float {
        var v = 0.0
        val p = m.positions; val idx = m.indices
        for (t in 0 until m.triangleCount) {
            val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val c = idx[t * 3 + 2] * 3
            v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])).toDouble()
        }
        return (v / 6.0).toFloat()
    }
}

/** Finger drawing surface with a grid, optional mirror line and point editing. */
@SuppressLint("ViewConstructor")
class DrawPad(ctx: Context) : View(ctx) {
    var kind = ShapeStudio.Kind.EXTRUDE
    var mirror = false
    var pointMode = false
    private val strokes = ArrayList<FloatArrayList>()
    private var current: FloatArrayList? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private val r = RectF()
    private var dragIndex = -1

    init { contentDescription = "Drawing area"; isFocusable = true }

    private fun side() = minOf(width, height).toFloat()
    private fun ox() = (width - side()) / 2f
    private fun oy() = (height - side()) / 2f
    private fun toPad(x: Float, y: Float) = floatArrayOf(((x - ox()) / side() * 2f - 1f).coerceIn(-1f, 1f), (1f - (y - oy()) / side() * 2f).coerceIn(-1f, 1f))
    private fun toScreenX(u: Float) = ox() + (u + 1f) / 2f * side()
    private fun toScreenY(v: Float) = oy() + (1f - v) / 2f * side()

    fun undo() { if (strokes.isNotEmpty()) strokes.removeAt(strokes.size - 1); invalidate() }
    fun clear() { strokes.clear(); invalidate() }

    /** Final strokes in pad units (smoothed, mirrored, closed as needed). */
    fun result(): List<FloatArray> = strokes.mapNotNull { s ->
        var a = s.toArray()
        if (a.size < 4) return@mapNotNull null
        if (!pointMode || a.size > 40) {
            a = Extruder.resample(a, 0.02f, kind == ShapeStudio.Kind.EXTRUDE && !mirror)
            a = Extruder.smooth(a, 2, kind == ShapeStudio.Kind.EXTRUDE && !mirror)
        }
        if (mirror && kind != ShapeStudio.Kind.REVOLVE) {
            // the drawn half plus its reflection across the centre line
            val n = a.size / 2
            val out = FloatArrayList(a.size * 2)
            for (i in 0 until n) out.add(abs(a[i * 2]), a[i * 2 + 1])
            for (i in n - 1 downTo 0) out.add(-abs(a[i * 2]), a[i * 2 + 1])
            a = out.toArray()
        }
        a
    }

    override fun onDraw(c: Canvas) {
        val s = side(); val x0 = ox(); val y0 = oy()
        r.set(x0, y0, x0 + s, y0 + s)
        p.style = Paint.Style.FILL; p.color = Theme.SURFACE_2
        c.drawRoundRect(r, dp(16f), dp(16f), p)
        p.color = 0x14FFFFFF; p.strokeWidth = 1f
        for (i in 1 until 10) {
            val t = i / 10f
            c.drawLine(x0 + s * t, y0, x0 + s * t, y0 + s, p)
            c.drawLine(x0, y0 + s * t, x0 + s, y0 + s * t, p)
        }
        if (mirror || kind == ShapeStudio.Kind.REVOLVE) {
            p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = Theme.withAlpha(Theme.accent, 0.8f)
            p.pathEffect = DashPathEffect(floatArrayOf(dp(6f), dp(6f)), 0f)
            c.drawLine(x0 + s / 2, y0, x0 + s / 2, y0 + s, p)
            p.pathEffect = null
        }
        // floor line for revolve
        p.style = Paint.Style.STROKE; p.strokeWidth = dp(3f); p.strokeCap = Paint.Cap.ROUND; p.strokeJoin = Paint.Join.ROUND
        val all = strokes + listOfNotNull(current)
        for (st in all) {
            val n = st.size / 2
            if (n < 1) continue
            for (pass in 0 until (if (mirror && kind != ShapeStudio.Kind.REVOLVE) 2 else 1)) {
                path.reset()
                for (i in 0 until n) {
                    val u = if (pass == 1) -st[i * 2] else st[i * 2]
                    val sx = toScreenX(u); val sy = toScreenY(st[i * 2 + 1])
                    if (i == 0) path.moveTo(sx, sy) else path.lineTo(sx, sy)
                }
                if (kind == ShapeStudio.Kind.EXTRUDE && !mirror && st !== current) path.close()
                p.color = if (pass == 1) Theme.withAlpha(Theme.TEXT, 0.35f) else Theme.TEXT
                c.drawPath(path, p)
            }
            if (pointMode) {
                p.style = Paint.Style.FILL; p.color = Theme.accent
                for (i in 0 until n) c.drawCircle(toScreenX(st[i * 2]), toScreenY(st[i * 2 + 1]), dp(5f), p)
                p.style = Paint.Style.STROKE
            }
        }
        if (all.isEmpty()) {
            p.style = Paint.Style.FILL; p.color = Theme.TEXT_MUTED; p.textSize = Theme.sp(14f); p.textAlign = Paint.Align.CENTER
            c.drawText(if (pointMode) "Tap to place points" else "Draw here", x0 + s / 2, y0 + s / 2, p)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        parent?.requestDisallowInterceptTouchEvent(true)
        val q = toPad(e.x, e.y)
        if (pointMode) {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    // grab a nearby point, else add one to the last stroke
                    dragIndex = -1
                    val st = strokes.lastOrNull()
                    if (st != null) for (i in 0 until st.size / 2) if (hypot(toScreenX(st[i * 2]) - e.x, toScreenY(st[i * 2 + 1]) - e.y) < dp(18f)) { dragIndex = i; break }
                    if (dragIndex < 0) {
                        val target = st ?: FloatArrayList(64).also { strokes.add(it) }
                        target.add(q[0], q[1])
                        dragIndex = target.size / 2 - 1
                    }
                }
                MotionEvent.ACTION_MOVE -> strokes.lastOrNull()?.let { st -> if (dragIndex >= 0) { st[dragIndex * 2] = q[0]; st[dragIndex * 2 + 1] = q[1] } }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragIndex = -1
            }
            invalidate(); return true
        }
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { current = FloatArrayList(256).also { it.add(q[0], q[1]) } }
            MotionEvent.ACTION_MOVE -> current?.let { cur ->
                for (h in 0 until e.historySize) { val hq = toPad(e.getHistoricalX(h), e.getHistoricalY(h)); addPoint(cur, hq) }
                addPoint(cur, q)
            }
            MotionEvent.ACTION_UP -> { current?.let { if (it.size >= 6) strokes.add(it) }; current = null }
            MotionEvent.ACTION_CANCEL -> current = null
        }
        invalidate()
        return true
    }

    private fun addPoint(cur: FloatArrayList, q: FloatArray) {
        val n = cur.size
        if (n >= 2 && hypot(cur[n - 2] - q[0], cur[n - 1] - q[1]) < 0.012f) return
        cur.add(q[0], q[1])
    }
}
