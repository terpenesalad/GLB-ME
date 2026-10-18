package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import app.glbandme.render.OrbitCamera
import app.glbandme.ui.Fmt
import app.glbandme.ui.Prefs
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import kotlin.math.hypot

/** 2D overlay on top of the viewport: gizmo, axis navigator, brush cursor, stats. */
@SuppressLint("ViewConstructor")
class Overlay(ctx: Context, private val vp: Viewport) : View(ctx) {
    private val ed get() = vp.ed
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.bold }
    private val path = Path()
    var navCx = 0f
    var navCy = 0f
    val navR get() = dp(36f)
    var statsY = 0f
    var statsX = 0f
    var hideHud = false
    private var brushX = 0f; private var brushY = 0f; private var brushR = 0f; private var brushOn = false
    private val prefs = Prefs.of(ctx)

    init { isClickable = false; isFocusable = false }

    fun brush(x: Float, y: Float, r: Float, on: Boolean) { brushX = x; brushY = y; brushR = r; brushOn = on; postInvalidateOnAnimation() }

    private val axisCols = intArrayOf(Theme.AXIS_X, Theme.AXIS_Y, Theme.AXIS_Z)
    private val axisNames = arrayOf("X", "Y", "Z")

    /** Projected navigator bubbles: list of (x, y, depth, axis index (+0..2 / -1..-3)). */
    private fun navBubbles(cam: OrbitCamera): List<FloatArray> {
        val v = cam.view
        val out = ArrayList<FloatArray>()
        for (i in 0 until 3) {
            val rx = v[i * 4]; val uy = v[i * 4 + 1]; val fz = v[i * 4 + 2]
            out.add(floatArrayOf(navCx + rx * navR, navCy - uy * navR, fz, (i + 1).toFloat()))
            out.add(floatArrayOf(navCx - rx * navR, navCy + uy * navR, -fz, -(i + 1).toFloat()))
        }
        return out.sortedBy { it[2] }
    }

    fun navigatorHit(x: Float, y: Float): OrbitCamera.View? {
        if (hypot(x - navCx, y - navCy) > navR + dp(18f)) return null
        val cam = vp.uiCam
        synchronized(ed.scene) { cam.update() }
        val bubbles = navBubbles(cam).reversed() // front-most first
        for (b in bubbles) if (hypot(x - b[0], y - b[1]) < dp(16f)) {
            return when (b[3].toInt()) {
                1 -> OrbitCamera.View.RIGHT; -1 -> OrbitCamera.View.LEFT
                2 -> OrbitCamera.View.TOP; -2 -> OrbitCamera.View.BOTTOM
                3 -> OrbitCamera.View.FRONT; else -> OrbitCamera.View.BACK
            }
        }
        return null
    }

    override fun onDraw(c: Canvas) {
        val cam = vp.uiCam
        synchronized(ed.scene) {
            cam.fovDeg = ed.scene.render.fov; cam.ortho = ed.scene.render.orthographic
            cam.update()
            drawGizmo(c)
        }
        if (hideHud) return
        drawNavigator(c, cam)
        if (brushOn) {
            p.style = Paint.Style.STROKE
            p.strokeWidth = dp(1.5f)
            val neg = ed.currentBrush?.negative == true || (ed.tool == Tool.SELECT && vp.selectNegative)
            p.color = if (neg) 0xCCFF6B81.toInt() else 0xCCFFFFFF.toInt()
            c.drawCircle(brushX, brushY, brushR, p)
            p.color = 0x55000000
            c.drawCircle(brushX, brushY, brushR + dp(1.5f), p)
            p.style = Paint.Style.FILL
            p.color = 0xAAFFFFFF.toInt()
            c.drawCircle(brushX, brushY, dp(2f), p)
        }
        if (prefs.showStats || prefs.showFps) {
            val sb = StringBuilder()
            if (prefs.showStats) synchronized(ed.scene) {
                val o = ed.scene.selected
                sb.append("Scene ").append(Fmt.count(ed.scene.totalTriangles())).append(" tris")
                if (o != null) sb.append("   ·   ").append(o.name).append(" ").append(Fmt.count(o.mesh.triangleCount))
            }
            if (prefs.showFps) { if (sb.isNotEmpty()) sb.append("   ·   "); sb.append(vp.fps.toInt()).append(" fps") }
            tp.textAlign = Paint.Align.LEFT; tp.textSize = sp(11f); tp.typeface = Theme.medium
            tp.color = 0x99000000.toInt()
            c.drawText(sb.toString(), statsX + dp(1f), statsY + dp(1f), tp)
            tp.color = 0xCCECEEF6.toInt()
            c.drawText(sb.toString(), statsX, statsY, tp)
            tp.textAlign = Paint.Align.CENTER; tp.typeface = Theme.bold
        }
    }

    private fun drawNavigator(c: Canvas, cam: OrbitCamera) {
        p.style = Paint.Style.FILL
        p.color = 0x33000000
        c.drawCircle(navCx, navCy, navR + dp(14f), p)
        for (b in navBubbles(cam)) {
            val i = kotlin.math.abs(b[3].toInt()) - 1
            val pos = b[3] > 0
            val col = axisCols[i]
            if (pos) {
                p.strokeWidth = dp(2f); p.color = col; p.style = Paint.Style.STROKE
                c.drawLine(navCx, navCy, b[0], b[1], p)
                p.style = Paint.Style.FILL
                c.drawCircle(b[0], b[1], dp(10f), p)
                tp.color = Color.BLACK; tp.textSize = sp(11f)
                c.drawText(axisNames[i], b[0], b[1] + dp(4f), tp)
            } else {
                p.style = Paint.Style.FILL
                p.color = Theme.withAlpha(col, 0.35f)
                c.drawCircle(b[0], b[1], dp(8f), p)
                p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = Theme.withAlpha(col, 0.8f)
                c.drawCircle(b[0], b[1], dp(8f), p)
                p.style = Paint.Style.FILL
            }
        }
    }

    private fun drawGizmo(c: Canvas) {
        val gz = vp.gizmo
        if (!gz.visible()) return
        val g = gz.geometry() ?: return
        val active = gz.active
        p.strokeCap = Paint.Cap.ROUND
        when (ed.gizmoMode) {
            GizmoMode.MOVE, GizmoMode.SCALE -> {
                // draw back-facing axes first
                val order = (0 until 3).sortedByDescending { g.facing[it] }
                for (i in order) {
                    val ex = g.ends[i * 2]; val ey = g.ends[i * 2 + 1]
                    val hot = active == i
                    val col = if (hot) Color.WHITE else axisCols[i]
                    if (active != Gizmo.NONE && !hot && active != Gizmo.CENTER) p.alpha = 70
                    p.style = Paint.Style.STROKE; p.strokeWidth = dp(if (hot) 4f else 3f); p.color = col
                    if (active != Gizmo.NONE && !hot && active != Gizmo.CENTER) p.alpha = 70
                    val dx = ex - g.cx; val dy = ey - g.cy
                    val len = hypot(dx, dy).coerceAtLeast(1f)
                    val ux = dx / len; val uy = dy / len
                    c.drawLine(g.cx + ux * dp(14f), g.cy + uy * dp(14f), ex, ey, p)
                    p.style = Paint.Style.FILL
                    if (ed.gizmoMode == GizmoMode.MOVE) {
                        path.reset()
                        val hs = dp(11f)
                        path.moveTo(ex + ux * hs * 1.4f, ey + uy * hs * 1.4f)
                        path.lineTo(ex - uy * hs * 0.6f, ey + ux * hs * 0.6f)
                        path.lineTo(ex + uy * hs * 0.6f, ey - ux * hs * 0.6f)
                        path.close()
                        c.drawPath(path, p)
                    } else {
                        val s = dp(7f)
                        c.drawRect(ex - s, ey - s, ex + s, ey + s, p)
                    }
                    tp.color = col; tp.textSize = sp(10.5f)
                    if (len > dp(20f)) c.drawText(axisNames[i], ex + ux * dp(22f), ey + uy * dp(22f) + dp(4f), tp)
                    p.alpha = 255
                }
                p.style = Paint.Style.FILL
                p.color = if (active == Gizmo.CENTER) Color.WHITE else 0xCCFFFFFF.toInt()
                if (ed.gizmoMode == GizmoMode.SCALE) c.drawRect(g.cx - dp(8f), g.cy - dp(8f), g.cx + dp(8f), g.cy + dp(8f), p)
                else {
                    p.style = Paint.Style.STROKE; p.strokeWidth = dp(2.5f)
                    c.drawCircle(g.cx, g.cy, dp(11f), p)
                    p.style = Paint.Style.FILL
                    c.drawCircle(g.cx, g.cy, dp(3.5f), p)
                }
            }
            GizmoMode.ROTATE -> {
                p.style = Paint.Style.STROKE
                // view ring
                p.strokeWidth = dp(2f)
                p.color = if (active == Gizmo.VIEW) Color.WHITE else 0x88FFFFFF.toInt()
                c.drawCircle(g.cx, g.cy, dp(92f) * 1.12f, p)
                for (i in 0 until 3) {
                    val r = gz.ring(i, g)
                    val n = r.size / 2
                    path.reset()
                    for (k in 0..n) { val j = k % n; if (k == 0) path.moveTo(r[j * 2], r[j * 2 + 1]) else path.lineTo(r[j * 2], r[j * 2 + 1]) }
                    p.color = if (active == i) Color.WHITE else axisCols[i]
                    p.strokeWidth = dp(if (active == i) 4f else 2.8f)
                    if (active != Gizmo.NONE && active != i) p.alpha = 60
                    c.drawPath(path, p)
                    p.alpha = 255
                }
                p.style = Paint.Style.FILL
                p.color = 0xCCFFFFFF.toInt()
                c.drawCircle(g.cx, g.cy, dp(3.5f), p)
            }
        }
    }
}
