package app.glbandme.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.glbandme.ui.Theme.dp
import kotlin.math.abs
import kotlin.math.roundToInt

// =============================================================================================
// layout helpers
// =============================================================================================
fun Context.vbox(padDp: Int = 0, spacingDp: Int = 0): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(padDp), dp(padDp), dp(padDp), dp(padDp))
    if (spacingDp > 0) { showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE; dividerDrawable = spacer(spacingDp) }
}

fun Context.hbox(padDp: Int = 0, spacingDp: Int = 0): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(dp(padDp), dp(padDp), dp(padDp), dp(padDp))
    if (spacingDp > 0) { showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE; dividerDrawable = spacer(spacingDp) }
}

private fun spacer(sizeDp: Int) = android.graphics.drawable.GradientDrawable().apply { setSize(dp(sizeDp), dp(sizeDp)); setColor(Color.TRANSPARENT) }

fun Context.label(text: CharSequence, sizeSp: Float = 14f, color: Int = Theme.TEXT, bold: Boolean = false): TextView = TextView(this).apply {
    this.text = text
    textSize = sizeSp
    setTextColor(color)
    typeface = if (bold) Theme.medium else Theme.regular
    includeFontPadding = false
}

fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, weight: Float = 0f) =
    LinearLayout.LayoutParams(w, h, weight)

fun flp(w: Int, h: Int, gravity: Int = Gravity.NO_GRAVITY) = FrameLayout.LayoutParams(w, h, gravity)

const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun View.haptic() { if (Prefs.of(context).haptics) performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP) }

/** Base for custom-drawn controls with a pressed state. */
abstract class PressableView(ctx: Context) : View(ctx) {
    protected var pressedNow = false
    var onClick: (() -> Unit)? = null
    var onLongClick: (() -> Unit)? = null
    private var downX = 0f
    private var downY = 0f
    private var longFired = false
    private val longRunnable = Runnable { longFired = true; onLongClick?.let { haptic(); it() } }

    init { isClickable = true; isFocusable = true }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (!isEnabled) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressedNow = true; downX = e.x; downY = e.y; longFired = false
                if (onLongClick != null) postDelayed(longRunnable, 450)
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> if (abs(e.x - downX) > dp(12f) || abs(e.y - downY) > dp(12f)) {
                if (pressedNow) { pressedNow = false; removeCallbacks(longRunnable); invalidate() }
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longRunnable)
                if (pressedNow && !longFired) { haptic(); performClick() }
                pressedNow = false; invalidate()
            }
            MotionEvent.ACTION_CANCEL -> { removeCallbacks(longRunnable); pressedNow = false; invalidate() }
        }
        return true
    }

    override fun performClick(): Boolean { super.performClick(); onClick?.invoke(); return true }
}

// =============================================================================================
// icon button (toolbar / palette)
// =============================================================================================
class IconButton(ctx: Context, var icon: Icon, var text: String? = null, private val sizeDp: Int = 44) : PressableView(ctx) {
    var active = false; set(v) { field = v; invalidate() }
    var tint: Int? = null; set(v) { field = v; invalidate() }
    var badge: String? = null; set(v) { field = v; invalidate() }
    var filled = false
    var compactLabel = false
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
    private val r = RectF()

    init { contentDescription = text ?: icon.name.lowercase() }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = dp(if (text != null && !compactLabel) sizeDp + 12 else sizeDp)
        val h = dp(if (text != null) sizeDp + 12 else sizeDp)
        setMeasuredDimension(resolveSize(w, widthMeasureSpec), resolveSize(h, heightMeasureSpec))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val inset = dp(3f)
        r.set(inset, inset, w - inset, h - inset)
        val rad = dp(12f)
        if (active) {
            bg.shader = null; bg.color = Theme.withAlpha(Theme.accent, 0.95f)
            c.drawRoundRect(r, rad, rad, bg)
        } else if (filled) {
            bg.shader = null; bg.color = Theme.SURFACE_2
            c.drawRoundRect(r, rad, rad, bg)
        }
        if (pressedNow) { bg.shader = null; bg.color = 0x33FFFFFF; c.drawRoundRect(r, rad, rad, bg) }
        val color = when {
            !isEnabled -> Theme.TEXT_MUTED
            active -> Color.WHITE
            else -> tint ?: Theme.TEXT
        }
        val t = text
        if (t != null) {
            val iconSize = dp(22f)
            Icons.draw(c, icon, w / 2, h / 2 - dp(6f), iconSize, color)
            tp.color = if (active) Color.WHITE else if (isEnabled) Theme.TEXT_DIM else Theme.TEXT_MUTED
            tp.textSize = dp(9.5f)
            val label = TextUtils.ellipsize(t, android.text.TextPaint(tp), w - dp(4f), TextUtils.TruncateAt.END).toString()
            c.drawText(label, w / 2, h / 2 + dp(15f), tp)
        } else {
            Icons.draw(c, icon, w / 2, h / 2, dp(22f), color)
        }
        badge?.let {
            tp.textSize = dp(8.5f); tp.color = Color.WHITE
            bg.color = Theme.DANGER
            c.drawCircle(w - dp(9f), dp(9f), dp(6.5f), bg)
            c.drawText(it, w - dp(9f), dp(12f), tp)
        }
    }
}

// =============================================================================================
// pill button
// =============================================================================================
class PillButton(ctx: Context, var text: String, var icon: Icon? = null, var style: Style = Style.SECONDARY) : PressableView(ctx) {
    enum class Style { PRIMARY, SECONDARY, GHOST, DANGER }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Theme.medium; textSize = dp(14f) }
    private val r = RectF()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val tw = tp.measureText(text) + dp(32f) + (if (icon != null) dp(26f) else 0f)
        setMeasuredDimension(resolveSize(tw.toInt(), widthMeasureSpec), resolveSize(dp(44), heightMeasureSpec))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
        val rad = h / 2
        bg.shader = null
        when (style) {
            Style.PRIMARY -> { bg.shader = Theme.brandGradient(0f, 0f, w, h); c.drawRoundRect(r, rad, rad, bg) }
            Style.SECONDARY -> { bg.color = Theme.SURFACE_3; c.drawRoundRect(r, rad, rad, bg) }
            Style.DANGER -> { bg.color = Theme.withAlpha(Theme.DANGER, 0.18f); c.drawRoundRect(r, rad, rad, bg) }
            Style.GHOST -> {}
        }
        if (pressedNow) { bg.shader = null; bg.color = 0x26FFFFFF; c.drawRoundRect(r, rad, rad, bg) }
        val fg = when { !isEnabled -> Theme.TEXT_MUTED; style == Style.DANGER -> Theme.DANGER; style == Style.GHOST -> Theme.TEXT_DIM; else -> Color.WHITE }
        tp.color = fg
        val tw = tp.measureText(text)
        val total = tw + (if (icon != null) dp(26f) else 0f)
        var x = (w - total) / 2
        icon?.let { Icons.draw(c, it, x + dp(10f), h / 2, dp(19f), fg); x += dp(26f) }
        c.drawText(text, x, h / 2 + tp.textSize * 0.35f, tp)
    }
}

// =============================================================================================
// vertical slider (Nomad style radius / intensity)
// =============================================================================================
class VSlider(ctx: Context, val title: String, var min: Float, var max: Float, value: Float, val format: (Float) -> String = { "${(it * 100).roundToInt()}" }) : View(ctx) {
    var value = value; set(v) { field = v.coerceIn(min, max); invalidate() }
    var onChange: ((Float) -> Unit)? = null
    var onRelease: (() -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
    private val r = RectF()
    private var dragging = false
    private var lastY = 0f

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(40), w), resolveSize(dp(170), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(4f), dp(4f), w - dp(4f), h - dp(4f))
        val rad = (w - dp(8f)) / 2
        bg.shader = null; bg.color = Theme.withAlpha(Theme.SURFACE, 0.92f)
        c.drawRoundRect(r, rad, rad, bg)
        val t = (value - min) / (max - min)
        val fillTop = r.bottom - (r.height()) * t
        c.save()
        c.clipRect(r.left, fillTop, r.right, r.bottom)
        bg.shader = android.graphics.LinearGradient(0f, r.bottom, 0f, r.top, Theme.accent, Theme.CYAN, android.graphics.Shader.TileMode.CLAMP)
        bg.alpha = if (dragging) 255 else 210
        c.drawRoundRect(r, rad, rad, bg)
        c.restore()
        bg.alpha = 255
        tp.textSize = dp(10f); tp.color = Color.WHITE
        c.drawText(title, w / 2, h - dp(12f), tp)
        tp.textSize = dp(11f); tp.color = if (t > 0.88f) Color.WHITE else Theme.TEXT
        c.drawText(format(value), w / 2, dp(20f), tp)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { dragging = true; lastY = e.y; parent?.requestDisallowInterceptTouchEvent(true); invalidate() }
            MotionEvent.ACTION_MOVE -> {
                val dy = lastY - e.y
                lastY = e.y
                // relative drag gives fine control; 1 slider height = full range
                value += dy / (height - dp(8f)) * (max - min)
                onChange?.invoke(value)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { dragging = false; invalidate(); onRelease?.invoke() }
        }
        return true
    }
}

// =============================================================================================
// horizontal labeled slider
// =============================================================================================
class HSlider(
    ctx: Context, val title: String, var min: Float, var max: Float, value: Float,
    val step: Float = 0f, val format: (Float) -> String = { String.format("%.2f", it) }
) : View(ctx) {
    var value = value; set(v) { field = quantize(v.coerceIn(min, max)); invalidate() }
    var onChange: ((Float) -> Unit)? = null
    var onRelease: ((Float) -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Theme.regular }
    private val r = RectF()
    private var dragging = false
    private var downX = 0f
    private var startValue = 0f
    private var moved = false

    private fun quantize(v: Float) = if (step > 0f) (Math.round(v / step) * step).coerceIn(min, max) else v

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(260), w), resolveSize(dp(52), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        tp.textSize = dp(13f); tp.color = Theme.TEXT_DIM; tp.textAlign = Paint.Align.LEFT
        c.drawText(title, dp(2f), dp(18f), tp)
        tp.color = Theme.TEXT; tp.textAlign = Paint.Align.RIGHT; tp.typeface = Theme.medium
        c.drawText(format(value), w - dp(2f), dp(18f), tp)
        tp.typeface = Theme.regular
        val ty = dp(36f)
        r.set(dp(2f), ty - dp(3f), w - dp(2f), ty + dp(3f))
        bg.color = Theme.SURFACE_3
        c.drawRoundRect(r, dp(3f), dp(3f), bg)
        val t = ((value - min) / (max - min)).coerceIn(0f, 1f)
        r.right = r.left + (w - dp(4f)) * t
        bg.color = Theme.accent
        c.drawRoundRect(r, dp(3f), dp(3f), bg)
        bg.color = Color.WHITE
        c.drawCircle(r.right.coerceAtLeast(dp(9f)).coerceAtMost(w - dp(9f)), ty, dp(if (dragging) 10f else 8f), bg)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val w = width - dp(4f)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragging = true; downX = e.x; startValue = value; moved = false
                parent?.requestDisallowInterceptTouchEvent(true)
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                if (abs(e.x - downX) > dp(4f)) moved = true
                if (moved) {
                    value = startValue + (e.x - downX) / w * (max - min)
                    onChange?.invoke(value)
                }
            }
            MotionEvent.ACTION_UP -> {
                if (!moved) { value = min + ((e.x - dp(2f)) / w).coerceIn(0f, 1f) * (max - min); onChange?.invoke(value) }
                dragging = false; invalidate(); onRelease?.invoke(value)
            }
            MotionEvent.ACTION_CANCEL -> { dragging = false; invalidate(); onRelease?.invoke(value) }
        }
        return true
    }
}

// =============================================================================================
// switch row
// =============================================================================================
class ToggleRow(ctx: Context, val title: String, checked: Boolean, val subtitle: String? = null) : PressableView(ctx) {
    var checked = checked; set(v) { field = v; invalidate() }
    var onToggle: ((Boolean) -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()

    init { onClick = { this.checked = !this.checked; onToggle?.invoke(this.checked) } }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(260), w), resolveSize(dp(if (subtitle != null) 56 else 46), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        if (pressedNow) { bg.color = 0x14FFFFFF; r.set(0f, 0f, w, h); c.drawRoundRect(r, dp(10f), dp(10f), bg) }
        tp.textSize = dp(14f); tp.color = Theme.TEXT; tp.typeface = Theme.regular
        if (subtitle != null) {
            c.drawText(title, dp(2f), h / 2 - dp(3f), tp)
            tp.textSize = dp(11.5f); tp.color = Theme.TEXT_MUTED
            c.drawText(subtitle, dp(2f), h / 2 + dp(14f), tp)
        } else c.drawText(title, dp(2f), h / 2 + dp(5f), tp)
        val sw = dp(42f); val sh = dp(24f)
        r.set(w - sw - dp(2f), (h - sh) / 2, w - dp(2f), (h + sh) / 2)
        bg.color = if (checked) Theme.accent else Theme.SURFACE_3
        c.drawRoundRect(r, sh / 2, sh / 2, bg)
        bg.color = Color.WHITE
        val cx = if (checked) r.right - sh / 2 else r.left + sh / 2
        c.drawCircle(cx, h / 2, sh / 2 - dp(3f), bg)
    }
}

// =============================================================================================
// segmented control
// =============================================================================================
class Segmented(ctx: Context, val options: List<String>, selected: Int, val icons: List<Icon>? = null) : View(ctx) {
    var selected = selected; set(v) { field = v; invalidate() }
    var onSelect: ((Int) -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium; textSize = dp(12.5f) }
    private val r = RectF()

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(260), w), resolveSize(dp(if (icons != null) 54 else 38), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(0f, 0f, w, h)
        bg.color = Theme.SURFACE_2
        c.drawRoundRect(r, dp(10f), dp(10f), bg)
        val cw = w / options.size
        for (i in options.indices) {
            if (i == selected) {
                r.set(i * cw + dp(3f), dp(3f), (i + 1) * cw - dp(3f), h - dp(3f))
                bg.color = Theme.accent
                c.drawRoundRect(r, dp(8f), dp(8f), bg)
            }
            tp.color = if (i == selected) Color.WHITE else Theme.TEXT_DIM
            val ic = icons?.getOrNull(i)
            if (ic != null) {
                Icons.draw(c, ic, i * cw + cw / 2, h / 2 - dp(7f), dp(20f), tp.color)
                tp.textSize = dp(10.5f)
                c.drawText(options[i], i * cw + cw / 2, h / 2 + dp(17f), tp)
            } else {
                tp.textSize = dp(12.5f)
                c.drawText(options[i], i * cw + cw / 2, h / 2 + dp(4.5f), tp)
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.actionMasked == MotionEvent.ACTION_UP) {
            val i = (e.x / (width.toFloat() / options.size)).toInt().coerceIn(0, options.size - 1)
            if (i != selected) { selected = i; haptic(); onSelect?.invoke(i) }
        }
        return true
    }
}

// =============================================================================================
// color swatch / chip
// =============================================================================================
class Swatch(ctx: Context, color: Int, private val sizeDp: Int = 34) : PressableView(ctx) {
    var color = color; set(v) { field = v; invalidate() }
    var ring = false; set(v) { field = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(dp(sizeDp), dp(sizeDp))

    override fun onDraw(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f; val rad = width / 2f - dp(3f)
        // checker for alpha
        if (Color.alpha(color) < 255) {
            p.color = 0xFF888888.toInt(); c.drawCircle(cx, cy, rad, p)
            p.color = 0xFFCCCCCC.toInt(); c.drawArc(cx - rad, cy - rad, cx + rad, cy + rad, 0f, 90f, true, p); c.drawArc(cx - rad, cy - rad, cx + rad, cy + rad, 180f, 90f, true, p)
        }
        p.style = Paint.Style.FILL; p.color = color
        c.drawCircle(cx, cy, rad, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = dp(if (ring) 2.5f else 1f)
        p.color = if (ring) Color.WHITE else 0x40FFFFFF
        c.drawCircle(cx, cy, rad, p)
        p.style = Paint.Style.FILL
        if (pressedNow) { p.color = 0x33FFFFFF; c.drawCircle(cx, cy, rad, p) }
    }
}

class Chip(ctx: Context, var text: String, var icon: Icon? = null) : PressableView(ctx) {
    var active = false; set(v) { field = v; invalidate() }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Theme.medium; textSize = dp(13f) }
    private val r = RectF()

    override fun onMeasure(w: Int, h: Int) {
        val tw = tp.measureText(text) + dp(28f) + (if (icon != null) dp(22f) else 0f)
        setMeasuredDimension(resolveSize(tw.toInt(), w), resolveSize(dp(36), h))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
        bg.style = Paint.Style.FILL
        bg.color = if (active) Theme.accent else Theme.SURFACE_2
        c.drawRoundRect(r, h / 2, h / 2, bg)
        if (pressedNow) { bg.color = 0x26FFFFFF; c.drawRoundRect(r, h / 2, h / 2, bg) }
        tp.color = if (active) Color.WHITE else Theme.TEXT
        var x = dp(14f)
        icon?.let { Icons.draw(c, it, x + dp(8f), h / 2, dp(17f), tp.color); x += dp(22f) }
        c.drawText(text, x, h / 2 + dp(4.5f), tp)
    }
}

/** Small section header used in panels. */
fun Context.sectionTitle(text: String): TextView = label(text.uppercase(), 11f, Theme.TEXT_MUTED, bold = true).apply {
    letterSpacing = 0.08f
    setPadding(dp(2), dp(14), 0, dp(6))
}

/** Horizontal wrap of children (simple flow layout). */
class FlowLayout(ctx: Context, private val hGapDp: Int = 8, private val vGapDp: Int = 8) : ViewGroup(ctx) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxW = MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val ch = getChildAt(i)
            if (ch.visibility == GONE) continue
            measureChild(ch, MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), heightMeasureSpec)
            if (x > 0 && x + ch.measuredWidth > maxW) { x = 0; y += rowH + dp(vGapDp); rowH = 0 }
            x += ch.measuredWidth + dp(hGapDp)
            rowH = maxOf(rowH, ch.measuredHeight)
        }
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), y + rowH + paddingTop + paddingBottom)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxW = r - l - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val ch = getChildAt(i)
            if (ch.visibility == GONE) continue
            if (x > 0 && x + ch.measuredWidth > maxW) { x = 0; y += rowH + dp(vGapDp); rowH = 0 }
            ch.layout(paddingLeft + x, paddingTop + y, paddingLeft + x + ch.measuredWidth, paddingTop + y + ch.measuredHeight)
            x += ch.measuredWidth + dp(hGapDp)
            rowH = maxOf(rowH, ch.measuredHeight)
        }
    }
}
