package app.glbandme.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp

/** App logo: gradient rounded square with an isometric cube. */
class LogoView(ctx: Context, private val sizeDp: Int = 44) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(dp(sizeDp), dp(sizeDp))
    override fun onDraw(c: Canvas) {
        val s = width.toFloat()
        r.set(0f, 0f, s, s)
        p.shader = Theme.brandGradient(0f, 0f, s, s)
        c.drawRoundRect(r, s * 0.28f, s * 0.28f, p)
        p.shader = null
        Icons.draw(c, Icon.CUBE, s / 2, s / 2, s * 0.68f, Color.WHITE, 1.9f)
    }
}

/** Big action tile on the home screen. */
class ActionTile(ctx: Context, val icon: Icon, val title: String, val subtitle: String, private val gradient: IntArray) : PressableView(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(110), w), dp(128))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(0f, 0f, w, h)
        p.shader = null; p.color = Theme.SURFACE
        c.drawRoundRect(r, dp(20f), dp(20f), p)
        // soft glow
        p.shader = RadialGradient(w * 0.2f, h * 0.15f, w, intArrayOf(Theme.withAlpha(gradient[0], 0.28f), Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
        c.drawRoundRect(r, dp(20f), dp(20f), p)
        p.shader = null
        if (pressedNow) { p.color = 0x1FFFFFFF; c.drawRoundRect(r, dp(20f), dp(20f), p) }
        val ic = dp(44f)
        r.set(dp(14f), dp(14f), dp(14f) + ic, dp(14f) + ic)
        p.shader = LinearGradient(r.left, r.top, r.right, r.bottom, gradient, null, Shader.TileMode.CLAMP)
        c.drawRoundRect(r, dp(14f), dp(14f), p)
        p.shader = null
        Icons.draw(c, icon, r.centerX(), r.centerY(), dp(24f), Color.WHITE, 2f)
        tp.typeface = Theme.medium; tp.textSize = sp(15.5f); tp.color = Theme.TEXT
        c.drawText(title, dp(14f), h - dp(34f), tp)
        tp.typeface = Theme.regular; tp.textSize = sp(11.5f); tp.color = Theme.TEXT_DIM
        c.drawText(TextUtils.ellipsize(subtitle, tp, w - dp(20f), TextUtils.TruncateAt.END).toString(), dp(14f), h - dp(15f), tp)
    }
}

/** Project / template card with a square thumbnail. */
class ThumbCard(ctx: Context) : PressableView(ctx) {
    var title = ""; set(v) { field = v; invalidate() }
    var subtitle = ""; set(v) { field = v; invalidate() }
    var badge: String? = null; set(v) { field = v; invalidate() }
    var thumb: Bitmap? = null; set(v) { field = v; shader = null; invalidate() }
    var placeholderIcon = Icon.CUBE
    var loading = false; set(v) { field = v; invalidate() }
    private var shader: BitmapShader? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    private val path = Path()
    private val m = Matrix()

    override fun onMeasure(w: Int, h: Int) {
        val width = MeasureSpec.getSize(w)
        setMeasuredDimension(width, width + dp(58))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val rad = dp(18f)
        r.set(0f, 0f, w, h)
        p.shader = null; p.color = Theme.SURFACE
        c.drawRoundRect(r, rad, rad, p)
        // thumbnail area
        val th = w
        path.reset()
        path.addRoundRect(RectF(dp(6f), dp(6f), w - dp(6f), th - dp(2f)), floatArrayOf(rad - dp(4f), rad - dp(4f), rad - dp(4f), rad - dp(4f), dp(10f), dp(10f), dp(10f), dp(10f)), Path.Direction.CW)
        p.shader = LinearGradient(0f, 0f, 0f, th, 0xFF2B2E3A.toInt(), 0xFF14151C.toInt(), Shader.TileMode.CLAMP)
        c.drawPath(path, p)
        val b = thumb
        if (b != null && !b.isRecycled) {
            val sh = shader ?: BitmapShader(b, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).also { shader = it }
            val area = th - dp(8f)
            val s = maxOf(area / b.width, area / b.height)
            m.reset(); m.postScale(s, s); m.postTranslate(dp(6f) + (w - dp(12f) - b.width * s) / 2, dp(6f) + (area - b.height * s) / 2)
            sh.setLocalMatrix(m)
            p.shader = sh
            c.drawPath(path, p)
        } else {
            p.shader = null
            Icons.draw(c, placeholderIcon, w / 2, th / 2, w * 0.28f, if (loading) Theme.TEXT_MUTED else Theme.SURFACE_3, 1.4f)
        }
        p.shader = null
        if (pressedNow) { p.color = 0x22FFFFFF; c.drawRoundRect(r, rad, rad, p) }
        badge?.let {
            tp.textSize = sp(10.5f); tp.typeface = Theme.medium
            val bw = tp.measureText(it) + dp(14f)
            r.set(w - dp(14f) - bw, dp(14f), w - dp(14f), dp(34f))
            p.color = 0xCC0E0F14.toInt()
            c.drawRoundRect(r, dp(10f), dp(10f), p)
            tp.color = Color.WHITE
            c.drawText(it, r.left + dp(7f), r.bottom - dp(6.5f), tp)
        }
        tp.typeface = Theme.medium; tp.textSize = sp(14.5f); tp.color = Theme.TEXT
        c.drawText(TextUtils.ellipsize(title, tp, w - dp(24f), TextUtils.TruncateAt.END).toString(), dp(12f), th + dp(24f), tp)
        tp.typeface = Theme.regular; tp.textSize = sp(11.5f); tp.color = Theme.TEXT_MUTED
        c.drawText(TextUtils.ellipsize(subtitle, tp, w - dp(24f), TextUtils.TruncateAt.END).toString(), dp(12f), th + dp(44f), tp)
    }
}

object Fmt {
    fun count(n: Int): String = when {
        n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000f)
        n >= 10_000 -> "${n / 1000}k"
        n >= 1000 -> String.format("%.1fk", n / 1000f)
        else -> n.toString()
    }

    fun ago(t: Long): String {
        val d = (System.currentTimeMillis() - t) / 1000
        return when {
            d < 60 -> "just now"
            d < 3600 -> "${d / 60}m ago"
            d < 86400 -> "${d / 3600}h ago"
            d < 86400 * 7 -> "${d / 86400}d ago"
            else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(t))
        }
    }

    fun bytes(n: Long): String = when {
        n >= 1 shl 20 -> String.format("%.1f MB", n / 1048576f)
        n >= 1 shl 10 -> String.format("%.0f KB", n / 1024f)
        else -> "$n B"
    }
}
