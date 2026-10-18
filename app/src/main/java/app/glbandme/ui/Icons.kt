package app.glbandme.ui

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import kotlin.math.cos
import kotlin.math.sin

enum class Icon {
    HOME, MENU, MORE, UNDO, REDO, BACK, CLOSE, CHECK, PLUS, MINUS, TRASH, COPY, EDIT, EYE, EYE_OFF, LOCK, UNLOCK,
    SAVE, EXPORT, IMPORT, SHARE, SETTINGS, TEMPLATES, LAYERS, SHAPES, TOPOLOGY, MATERIAL, RENDER, ANIMATE, CAMERA,
    PLAY, PAUSE, KEY, KEY_DELETE, PREV, NEXT, CUBE, SPHERE, SCULPT_SPHERE, CYLINDER, CONE, TORUS, PLANE, CAPSULE, TUBE, PYRAMID,
    ICOSPHERE, TEXT, IMAGE, MOVE, ROTATE, SCALE, SELECT, CLAY, DRAW, INFLATE, SMOOTH, FLATTEN, PINCH, CREASE,
    GRAB, DRAG, LAYER, MASK, PAINT, SYMMETRY, WIREFRAME, GRID, FOCUS, PALETTE, SUN, STAR, FOLDER, SORT, INFO,
    EXTRUDE, MAGIC, SUBDIVIDE, DECIMATE, MIRROR, FLIP, GLOBE, FLOOR, CENTER, RESET, LINK, CHEVRON_DOWN, CHEVRON_RIGHT,
    PEN, FILL, INVERT, BLUR, SEPARATE, AUTO, LIGHT, SHADOW, ORTHO, ROTATE_VIEW, HELP, DICE, SPARKLE
}

/** Hand-drawn stroke icon set on a 24-unit grid. */
object Icons {
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val path = Path()
    private val rect = RectF()

    fun draw(c: Canvas, icon: Icon, cx: Float, cy: Float, size: Float, color: Int, weight: Float = 1.8f) {
        c.save()
        c.translate(cx - size / 2f, cy - size / 2f)
        c.scale(size / 24f, size / 24f)
        stroke.color = color; stroke.strokeWidth = weight
        fill.color = color
        render(c, icon)
        c.restore()
    }

    private fun Canvas.line(x0: Float, y0: Float, x1: Float, y1: Float) = drawLine(x0, y0, x1, y1, stroke)
    private fun Canvas.circle(x: Float, y: Float, r: Float) = drawCircle(x, y, r, stroke)
    private fun Canvas.dot(x: Float, y: Float, r: Float) = drawCircle(x, y, r, fill)
    private fun Canvas.rrect(l: Float, t: Float, r: Float, b: Float, rad: Float) { rect.set(l, t, r, b); drawRoundRect(rect, rad, rad, stroke) }
    private fun Canvas.frrect(l: Float, t: Float, r: Float, b: Float, rad: Float) { rect.set(l, t, r, b); drawRoundRect(rect, rad, rad, fill) }
    private fun Canvas.poly(closed: Boolean, vararg p: Float) {
        path.reset(); path.moveTo(p[0], p[1])
        var i = 2
        while (i < p.size) { path.lineTo(p[i], p[i + 1]); i += 2 }
        if (closed) path.close()
        drawPath(path, stroke)
    }
    private fun Canvas.fpoly(vararg p: Float) {
        path.reset(); path.moveTo(p[0], p[1])
        var i = 2
        while (i < p.size) { path.lineTo(p[i], p[i + 1]); i += 2 }
        path.close(); drawPath(path, fill)
    }
    private fun Canvas.arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float) {
        rect.set(cx - r, cy - r, cx + r, cy + r); drawArc(rect, start, sweep, false, stroke)
    }
    private fun Canvas.oval(cx: Float, cy: Float, rx: Float, ry: Float) { rect.set(cx - rx, cy - ry, cx + rx, cy + ry); drawOval(rect, stroke) }
    private fun Canvas.arrowHead(x: Float, y: Float, angleDeg: Float, len: Float = 4f) {
        val a = Math.toRadians(angleDeg.toDouble())
        val a1 = a + Math.PI * 0.8; val a2 = a - Math.PI * 0.8
        line(x, y, x + (cos(a1) * len).toFloat(), y + (sin(a1) * len).toFloat())
        line(x, y, x + (cos(a2) * len).toFloat(), y + (sin(a2) * len).toFloat())
    }
    private fun Canvas.cube() {
        poly(true, 12f, 3f, 20f, 7.5f, 20f, 16.5f, 12f, 21f, 4f, 16.5f, 4f, 7.5f)
        poly(false, 4f, 7.5f, 12f, 12f, 20f, 7.5f)
        line(12f, 12f, 12f, 21f)
    }

    private fun render(c: Canvas, icon: Icon): Unit = with(c) {
        when (icon) {
            Icon.HOME -> { poly(false, 3.5f, 11f, 12f, 4f, 20.5f, 11f); poly(false, 6f, 9.5f, 6f, 20f, 18f, 20f, 18f, 9.5f); rrect(10f, 14f, 14f, 20f, 1f) }
            Icon.MENU -> { line(4f, 7f, 20f, 7f); line(4f, 12f, 20f, 12f); line(4f, 17f, 20f, 17f) }
            Icon.MORE -> { dot(12f, 5.5f, 1.8f); dot(12f, 12f, 1.8f); dot(12f, 18.5f, 1.8f) }
            Icon.UNDO -> { arc(13f, 13f, 6.5f, 180f, 230f); poly(false, 3.5f, 9f, 6.5f, 13f, 10.5f, 10.5f) }
            Icon.REDO -> { arc(11f, 13f, 6.5f, -50f, 230f); poly(false, 20.5f, 9f, 17.5f, 13f, 13.5f, 10.5f) }
            Icon.BACK -> { line(19f, 12f, 5f, 12f); poly(false, 11f, 6f, 5f, 12f, 11f, 18f) }
            Icon.CLOSE -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            Icon.CHECK -> poly(false, 5f, 12.5f, 10f, 17.5f, 19f, 7f)
            Icon.PLUS -> { line(12f, 5f, 12f, 19f); line(5f, 12f, 19f, 12f) }
            Icon.MINUS -> line(5f, 12f, 19f, 12f)
            Icon.TRASH -> { line(4f, 6.5f, 20f, 6.5f); poly(false, 9f, 6.5f, 9.5f, 4f, 14.5f, 4f, 15f, 6.5f); poly(false, 6f, 6.5f, 7f, 20f, 17f, 20f, 18f, 6.5f); line(10f, 10f, 10f, 16.5f); line(14f, 10f, 14f, 16.5f) }
            Icon.COPY -> { rrect(8f, 8f, 20f, 20f, 2.5f); poly(false, 16f, 8f, 16f, 5f, 14.5f, 4f, 5.5f, 4f, 4f, 5.5f, 4f, 14.5f, 5f, 16f, 8f, 16f) }
            Icon.EDIT, Icon.PEN -> { poly(true, 4f, 20f, 5f, 15.5f, 15.5f, 5f, 19f, 8.5f, 8.5f, 19f); line(13f, 7.5f, 16.5f, 11f) }
            Icon.EYE -> { path.reset(); path.moveTo(2.5f, 12f); path.quadTo(12f, 2.5f, 21.5f, 12f); path.quadTo(12f, 21.5f, 2.5f, 12f); drawPath(path, stroke); circle(12f, 12f, 3f) }
            Icon.EYE_OFF -> { path.reset(); path.moveTo(2.5f, 12f); path.quadTo(12f, 2.5f, 21.5f, 12f); path.quadTo(12f, 21.5f, 2.5f, 12f); drawPath(path, stroke); line(4f, 20f, 20f, 4f) }
            Icon.LOCK -> { rrect(5f, 10.5f, 19f, 20.5f, 2f); arc(12f, 10.5f, 4.5f, 180f, 180f); dot(12f, 15.5f, 1.4f) }
            Icon.UNLOCK -> { rrect(5f, 10.5f, 19f, 20.5f, 2f); arc(12f, 8f, 4.5f, 180f, 160f); dot(12f, 15.5f, 1.4f) }
            Icon.SAVE -> { poly(true, 4f, 4f, 16.5f, 4f, 20f, 7.5f, 20f, 20f, 4f, 20f); poly(false, 8f, 4f, 8f, 8.5f, 15f, 8.5f, 15f, 4f); rrect(7.5f, 13f, 16.5f, 20f, 1f) }
            Icon.EXPORT -> { line(12f, 15f, 12f, 3.5f); poly(false, 7.5f, 8f, 12f, 3.5f, 16.5f, 8f); poly(false, 4.5f, 13f, 4.5f, 20f, 19.5f, 20f, 19.5f, 13f) }
            Icon.IMPORT -> { line(12f, 3.5f, 12f, 15f); poly(false, 7.5f, 10.5f, 12f, 15f, 16.5f, 10.5f); poly(false, 4.5f, 13f, 4.5f, 20f, 19.5f, 20f, 19.5f, 13f) }
            Icon.SHARE -> { circle(17.5f, 5.5f, 2.5f); circle(6.5f, 12f, 2.5f); circle(17.5f, 18.5f, 2.5f); line(8.7f, 10.7f, 15.3f, 6.8f); line(8.7f, 13.3f, 15.3f, 17.2f) }
            Icon.SETTINGS -> {
                circle(12f, 12f, 3f)
                path.reset()
                for (i in 0 until 16) {
                    val a = i * Math.PI / 8 - Math.PI / 16
                    val r = if (i % 2 == 0) 8.6f else 6.6f
                    val x = 12f + (cos(a) * r).toFloat(); val y = 12f + (sin(a) * r).toFloat()
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    val a2 = a + Math.PI / 8
                    path.lineTo(12f + (cos(a2) * r).toFloat(), 12f + (sin(a2) * r).toFloat())
                }
                path.close(); drawPath(path, stroke)
            }
            Icon.TEMPLATES -> { rrect(4f, 4f, 11f, 11f, 2f); rrect(13f, 4f, 20f, 11f, 2f); rrect(4f, 13f, 11f, 20f, 2f); rrect(13f, 13f, 20f, 20f, 2f) }
            Icon.LAYERS -> { poly(true, 12f, 3.5f, 21f, 8.5f, 12f, 13.5f, 3f, 8.5f); poly(false, 3f, 12.5f, 12f, 17.5f, 21f, 12.5f); poly(false, 3f, 16f, 12f, 21f, 21f, 16f) }
            Icon.SHAPES -> { circle(8f, 8f, 4.5f); rrect(12.5f, 12.5f, 20.5f, 20.5f, 1.5f); poly(true, 6.5f, 14f, 10.5f, 20.5f, 2.5f, 20.5f) }
            Icon.TOPOLOGY -> { poly(true, 4f, 18f, 12f, 4f, 20f, 18f); line(8f, 11f, 16f, 11f); line(8f, 11f, 12f, 18f); line(16f, 11f, 12f, 18f); line(4f, 18f, 20f, 18f) }
            Icon.MATERIAL -> { circle(12f, 12f, 8.5f); arc(12f, 12f, 5f, 200f, 70f); dot(9f, 8.5f, 1.3f) }
            Icon.RENDER, Icon.SUN, Icon.LIGHT -> { circle(12f, 12f, 4f); for (i in 0 until 8) { val a = i * Math.PI / 4; line(12f + (cos(a) * 6.5f).toFloat(), 12f + (sin(a) * 6.5f).toFloat(), 12f + (cos(a) * 9f).toFloat(), 12f + (sin(a) * 9f).toFloat()) } }
            Icon.ANIMATE -> { rrect(3.5f, 5f, 20.5f, 19f, 2.5f); poly(true, 10f, 9f, 15f, 12f, 10f, 15f) }
            Icon.CAMERA -> { rrect(3f, 7f, 21f, 19f, 2.5f); poly(false, 8f, 7f, 9.5f, 4.5f, 14.5f, 4.5f, 16f, 7f); circle(12f, 13f, 3.5f) }
            Icon.PLAY -> fpoly(7f, 4.5f, 19f, 12f, 7f, 19.5f)
            Icon.PAUSE -> { frrect(6f, 5f, 10f, 19f, 1f); frrect(14f, 5f, 18f, 19f, 1f) }
            Icon.KEY -> poly(true, 12f, 4f, 20f, 12f, 12f, 20f, 4f, 12f)
            Icon.KEY_DELETE -> { poly(true, 12f, 4f, 20f, 12f, 12f, 20f, 4f, 12f); line(9f, 12f, 15f, 12f) }
            Icon.PREV -> { poly(false, 14f, 6f, 8f, 12f, 14f, 18f); line(6f, 6f, 6f, 18f) }
            Icon.NEXT -> { poly(false, 10f, 6f, 16f, 12f, 10f, 18f); line(18f, 6f, 18f, 18f) }
            Icon.CUBE -> cube()
            Icon.SPHERE -> { circle(12f, 12f, 8.5f); oval(12f, 12f, 8.5f, 3f); oval(12f, 12f, 3.5f, 8.5f) }
            Icon.SCULPT_SPHERE -> { circle(12f, 12f, 8.5f); line(3.5f, 12f, 20.5f, 12f); line(12f, 3.5f, 12f, 20.5f); oval(12f, 12f, 6f, 8.5f) }
            Icon.CYLINDER -> { oval(12f, 6f, 7f, 2.5f); line(5f, 6f, 5f, 18f); line(19f, 6f, 19f, 18f); arc(12f, 18f, 7f, 0f, 180f); oval(12f, 18f, 7f, 2.5f).let { } }
            Icon.CONE -> { poly(false, 5f, 18f, 12f, 3.5f, 19f, 18f); oval(12f, 18f, 7f, 2.5f) }
            Icon.TORUS -> { oval(12f, 12f, 9f, 5.5f); oval(12f, 11.5f, 4f, 1.8f) }
            Icon.PLANE -> { poly(true, 3f, 15f, 9f, 8f, 21f, 9f, 15f, 16f); line(6f, 11.5f, 18f, 12.5f); line(12f, 8.5f, 12f, 15.5f) }
            Icon.CAPSULE -> { rrect(7f, 3f, 17f, 21f, 5f); oval(12f, 12f, 5f, 1.6f) }
            Icon.TUBE -> { oval(12f, 6f, 7f, 2.5f); oval(12f, 6f, 3.5f, 1.2f); line(5f, 6f, 5f, 18f); line(19f, 6f, 19f, 18f); arc(12f, 18f, 7f, 0f, 180f) }
            Icon.PYRAMID -> { poly(true, 12f, 3.5f, 20f, 17f, 12f, 20.5f, 4f, 17f); line(12f, 3.5f, 12f, 20.5f) }
            Icon.ICOSPHERE -> { poly(true, 12f, 3f, 19.5f, 7.5f, 19.5f, 16.5f, 12f, 21f, 4.5f, 16.5f, 4.5f, 7.5f); poly(true, 12f, 8f, 16f, 14.5f, 8f, 14.5f); line(12f, 3f, 12f, 8f); line(19.5f, 16.5f, 16f, 14.5f); line(4.5f, 16.5f, 8f, 14.5f) }
            Icon.TEXT -> { line(5f, 5f, 19f, 5f); line(12f, 5f, 12f, 19.5f); line(9f, 19.5f, 15f, 19.5f) }
            Icon.IMAGE -> { rrect(3.5f, 5f, 20.5f, 19f, 2f); circle(9f, 9.5f, 1.8f); poly(false, 3.5f, 17f, 9.5f, 12f, 14f, 16f, 17f, 13.5f, 20.5f, 16.5f) }
            Icon.MOVE -> { line(12f, 3f, 12f, 21f); line(3f, 12f, 21f, 12f); arrowHead(12f, 3f, -90f); arrowHead(12f, 21f, 90f); arrowHead(3f, 12f, 180f); arrowHead(21f, 12f, 0f) }
            Icon.ROTATE, Icon.ROTATE_VIEW -> { arc(12f, 12f, 7.5f, -60f, 300f); arrowHead(15.75f, 5.5f, -20f) }
            Icon.SCALE -> { rrect(3.5f, 10.5f, 13.5f, 20.5f, 1.5f); poly(false, 14f, 4f, 20f, 4f, 20f, 10f); line(20f, 4f, 12f, 12f) }
            Icon.SELECT -> { poly(true, 6f, 3.5f, 6f, 18f, 9.8f, 14.5f, 12.5f, 20.5f, 15f, 19.3f, 12.3f, 13.5f, 17.5f, 13.5f) }
            Icon.CLAY -> { path.reset(); path.moveTo(3.5f, 17f); path.quadTo(8f, 9f, 12f, 12f); path.quadTo(16f, 15f, 20.5f, 7f); drawPath(path, stroke); line(3.5f, 20f, 20.5f, 20f); oval(12f, 12f, 3f, 1.5f) }
            Icon.DRAW -> { path.reset(); path.moveTo(3f, 18f); path.cubicTo(8f, 18f, 8f, 8f, 12f, 8f); path.cubicTo(16f, 8f, 16f, 18f, 21f, 18f); drawPath(path, stroke) }
            Icon.INFLATE -> { circle(12f, 12f, 5f); arrowHead(12f, 3f, -90f, 3f); line(12f, 3f, 12f, 6f); arrowHead(21f, 12f, 0f, 3f); line(18f, 12f, 21f, 12f); arrowHead(3f, 12f, 180f, 3f); line(3f, 12f, 6f, 12f); arrowHead(12f, 21f, 90f, 3f); line(12f, 18f, 12f, 21f) }
            Icon.SMOOTH -> { path.reset(); path.moveTo(3f, 14f); path.cubicTo(7f, 8f, 10f, 8f, 12f, 12f); path.cubicTo(14f, 16f, 17f, 16f, 21f, 10f); drawPath(path, stroke); line(4f, 19f, 20f, 19f) }
            Icon.FLATTEN -> { line(3f, 9f, 21f, 9f); poly(false, 3f, 18f, 8f, 13f, 12f, 16f, 16f, 12f, 21f, 17f); line(12f, 11f, 12f, 13.5f) }
            Icon.PINCH -> { line(4f, 12f, 10f, 12f); line(14f, 12f, 20f, 12f); arrowHead(10f, 12f, 0f, 3f); arrowHead(14f, 12f, 180f, 3f); line(12f, 4f, 12f, 20f) }
            Icon.CREASE -> { poly(false, 3f, 7f, 12f, 18f, 21f, 7f); line(12f, 18f, 12f, 21f) }
            Icon.GRAB -> { poly(false, 8f, 12f, 8f, 6f); poly(false, 11f, 11f, 11f, 4.5f); poly(false, 14f, 11f, 14f, 5.5f); poly(false, 17f, 12f, 17f, 8f); path.reset(); path.moveTo(8f, 12f); path.lineTo(6f, 10.5f); path.quadTo(3.5f, 11f, 5f, 14f); path.lineTo(9f, 19.5f); path.lineTo(16f, 19.5f); path.quadTo(17f, 16f, 17f, 12f); drawPath(path, stroke) }
            Icon.DRAG -> { path.reset(); path.moveTo(4f, 18f); path.quadTo(10f, 18f, 13f, 12f); path.quadTo(15f, 7f, 20f, 6f); drawPath(path, stroke); arrowHead(20f, 6f, -15f); dot(4f, 18f, 2f) }
            Icon.LAYER -> { line(3f, 17f, 21f, 17f); poly(false, 6f, 17f, 7.5f, 12f, 16.5f, 12f, 18f, 17f); line(12f, 4f, 12f, 9.5f); arrowHead(12f, 4f, -90f, 3f) }
            Icon.MASK -> { circle(12f, 12f, 8.5f); path.reset(); path.addCircle(12f, 12f, 8.5f, Path.Direction.CW); save(); clipPath(path); fpoly(12f, 3f, 21f, 3f, 21f, 21f, 12f, 21f); restore() }
            Icon.PAINT -> { poly(true, 13f, 4f, 20f, 11f, 12f, 19f, 5f, 12f); line(13f, 4f, 15f, 2f); path.reset(); path.moveTo(19f, 15f); path.quadTo(21f, 18f, 19f, 20f); path.quadTo(17f, 18f, 19f, 15f); drawPath(path, fill) }
            Icon.SYMMETRY -> { line(12f, 3f, 12f, 21f); poly(true, 3f, 17f, 9f, 7f, 9f, 17f); poly(true, 21f, 17f, 15f, 7f, 15f, 17f) }
            Icon.WIREFRAME -> { poly(true, 4f, 6f, 20f, 6f, 20f, 18f, 4f, 18f); line(4f, 18f, 20f, 6f); line(12f, 6f, 12f, 18f); line(4f, 12f, 20f, 12f) }
            Icon.GRID -> { rrect(4f, 4f, 20f, 20f, 1f); line(9.3f, 4f, 9.3f, 20f); line(14.6f, 4f, 14.6f, 20f); line(4f, 9.3f, 20f, 9.3f); line(4f, 14.6f, 20f, 14.6f) }
            Icon.FOCUS -> { poly(false, 4f, 9f, 4f, 4f, 9f, 4f); poly(false, 15f, 4f, 20f, 4f, 20f, 9f); poly(false, 20f, 15f, 20f, 20f, 15f, 20f); poly(false, 9f, 20f, 4f, 20f, 4f, 15f); circle(12f, 12f, 3f) }
            Icon.PALETTE -> { path.reset(); path.moveTo(12f, 3.5f); path.cubicTo(20f, 3.5f, 22f, 12f, 17f, 13f); path.cubicTo(13f, 14f, 16f, 20.5f, 12f, 20.5f); path.cubicTo(5f, 20.5f, 3.5f, 16f, 3.5f, 12f); path.cubicTo(3.5f, 7f, 7f, 3.5f, 12f, 3.5f); drawPath(path, stroke); dot(8f, 9f, 1.4f); dot(12f, 7f, 1.4f); dot(7.5f, 13.5f, 1.4f) }
            Icon.STAR, Icon.SPARKLE -> { path.reset(); for (i in 0 until 10) { val a = -Math.PI / 2 + i * Math.PI / 5; val r = if (i % 2 == 0) 9f else 4f; val x = 12f + (cos(a) * r).toFloat(); val y = 12.5f + (sin(a) * r).toFloat(); if (i == 0) path.moveTo(x, y) else path.lineTo(x, y) }; path.close(); drawPath(path, if (icon == Icon.SPARKLE) fill else stroke) }
            Icon.FOLDER -> poly(true, 3f, 6f, 9f, 6f, 11f, 8.5f, 21f, 8.5f, 21f, 19f, 3f, 19f)
            Icon.SORT -> { line(5f, 7f, 19f, 7f); line(5f, 12f, 15f, 12f); line(5f, 17f, 11f, 17f) }
            Icon.INFO, Icon.HELP -> { circle(12f, 12f, 9f); if (icon == Icon.INFO) { line(12f, 11f, 12f, 16.5f); dot(12f, 7.5f, 1.3f) } else { path.reset(); path.moveTo(9.5f, 9.5f); path.quadTo(9.5f, 6.8f, 12f, 6.8f); path.quadTo(14.5f, 6.8f, 14.5f, 9.3f); path.quadTo(14.5f, 11f, 12f, 12.5f); path.lineTo(12f, 14f); drawPath(path, stroke); dot(12f, 17f, 1.3f) } }
            Icon.EXTRUDE -> { poly(true, 4f, 16f, 12f, 20f, 20f, 16f, 12f, 12f); line(12f, 12f, 12f, 3.5f); arrowHead(12f, 3.5f, -90f, 3.5f) }
            Icon.MAGIC -> { line(4f, 20f, 15f, 9f); poly(false, 15f, 3f, 15f, 6f); poly(false, 19.5f, 7.5f, 21f, 6f); poly(false, 21f, 11f, 18f, 11f); poly(false, 11f, 5f, 9.5f, 3.5f) }
            Icon.SUBDIVIDE -> { rrect(4f, 4f, 20f, 20f, 1f); line(12f, 4f, 12f, 20f); line(4f, 12f, 20f, 12f); line(4f, 4f, 20f, 20f) }
            Icon.DECIMATE -> { poly(true, 4f, 18f, 12f, 5f, 20f, 18f); dot(4f, 18f, 1.4f); dot(12f, 5f, 1.4f); dot(20f, 18f, 1.4f) }
            Icon.MIRROR -> { line(12f, 3f, 12f, 21f); poly(true, 3f, 8f, 9f, 12f, 3f, 16f); poly(true, 21f, 8f, 15f, 12f, 21f, 16f) }
            Icon.FLIP -> { line(4f, 8f, 18f, 8f); arrowHead(18f, 8f, 0f); line(20f, 16f, 6f, 16f); arrowHead(6f, 16f, 180f) }
            Icon.GLOBE -> { circle(12f, 12f, 8.5f); oval(12f, 12f, 3.8f, 8.5f); line(3.5f, 12f, 20.5f, 12f) }
            Icon.FLOOR -> { line(3f, 19f, 21f, 19f); rrect(8f, 7f, 16f, 15f, 1.5f); line(12f, 2.5f, 12f, 5f) }
            Icon.CENTER -> { circle(12f, 12f, 7f); line(12f, 2.5f, 12f, 7f); line(12f, 17f, 12f, 21.5f); line(2.5f, 12f, 7f, 12f); line(17f, 12f, 21.5f, 12f); dot(12f, 12f, 1.6f) }
            Icon.RESET -> { arc(12f, 12f, 7.5f, 30f, 300f); arrowHead(18.5f, 15.75f, 110f) }
            Icon.LINK -> { rrect(3f, 9f, 13f, 15f, 3f); rrect(11f, 9f, 21f, 15f, 3f) }
            Icon.CHEVRON_DOWN -> poly(false, 6f, 9f, 12f, 15f, 18f, 9f)
            Icon.CHEVRON_RIGHT -> poly(false, 9f, 6f, 15f, 12f, 9f, 18f)
            Icon.FILL -> { poly(true, 11f, 3.5f, 19f, 11.5f, 12f, 18.5f, 4f, 10.5f); line(4f, 10.5f, 19f, 11.5f); path.reset(); path.moveTo(20f, 15f); path.quadTo(22f, 18f, 20f, 20f); path.quadTo(18f, 18f, 20f, 15f); drawPath(path, fill) }
            Icon.INVERT -> { circle(12f, 12f, 8.5f); path.reset(); path.moveTo(12f, 3.5f); path.arcTo(RectF(3.5f, 3.5f, 20.5f, 20.5f), -90f, 180f); path.close(); drawPath(path, fill) }
            Icon.BLUR -> { dot(6f, 6f, 1.2f); dot(12f, 6f, 1.6f); dot(18f, 6f, 1.2f); dot(6f, 12f, 1.6f); dot(12f, 12f, 2.2f); dot(18f, 12f, 1.6f); dot(6f, 18f, 1.2f); dot(12f, 18f, 1.6f); dot(18f, 18f, 1.2f) }
            Icon.SEPARATE -> { rrect(3f, 3f, 11f, 11f, 1.5f); rrect(13f, 13f, 21f, 21f, 1.5f); line(13f, 11f, 11f, 13f) }
            Icon.AUTO -> { circle(12f, 12f, 8.5f); dot(12f, 12f, 4f) }
            Icon.SHADOW -> { circle(10f, 9f, 5f); oval(13f, 18.5f, 7f, 2f) }
            Icon.ORTHO -> { rrect(4f, 4f, 20f, 20f, 1f); rrect(8f, 8f, 16f, 16f, 1f) }
            Icon.DICE -> { rrect(4f, 4f, 20f, 20f, 3f); dot(8.5f, 8.5f, 1.4f); dot(15.5f, 15.5f, 1.4f); dot(12f, 12f, 1.4f) }
        }
    }
}
