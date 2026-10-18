package app.glbandme.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.text.TextPaint
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

// =============================================================================================
// layout helpers – always pass explicit LayoutParams (vertical LinearLayouts default to
// MATCH_PARENT width, which silently stretches custom controls).
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
    textSize = sizeSp * Theme.uiScale
    setTextColor(color)
    typeface = if (bold) Theme.medium else Theme.regular
    includeFontPadding = false
    setLineSpacing(0f, 1.12f)
}

fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, weight: Float = 0f) =
    LinearLayout.LayoutParams(w, h, weight)

fun flp(w: Int, h: Int, gravity: Int = Gravity.NO_GRAVITY) = FrameLayout.LayoutParams(w, h, gravity)

const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun View.haptic(strong: Boolean = false) {
    if (Prefs.of(context).haptics) performHapticFeedback(if (strong) HapticFeedbackConstants.LONG_PRESS else HapticFeedbackConstants.KEYBOARD_TAP)
}

/** Human readable name for an icon (accessibility fallback). */
fun Icon.spoken(): String = name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }

/** Base for custom-drawn controls: pressed state, press animation, TalkBack button semantics. */
abstract class PressableView(ctx: Context) : View(ctx) {
    protected var pressedNow = false
    var onClick: (() -> Unit)? = null
    var onLongClick: (() -> Unit)? = null
    /** Accessibility role announced by TalkBack. */
    protected open val a11yClass: String = "android.widget.Button"
    private var downX = 0f
    private var downY = 0f
    private var longFired = false
    private val longRunnable = Runnable { longFired = true; onLongClick?.let { haptic(true); it() } }

    init { isClickable = true; isFocusable = true; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES }

    private fun pressAnim(down: Boolean) {
        if (Theme.reduceMotion) return
        animate().scaleX(if (down) 0.95f else 1f).scaleY(if (down) 0.95f else 1f).setDuration(if (down) 70 else 140).start()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (!isEnabled) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressedNow = true; downX = e.x; downY = e.y; longFired = false
                if (onLongClick != null) postDelayed(longRunnable, 450)
                pressAnim(true); invalidate()
            }
            MotionEvent.ACTION_MOVE -> if (abs(e.x - downX) > dp(12f) || abs(e.y - downY) > dp(12f)) {
                if (pressedNow) { pressedNow = false; removeCallbacks(longRunnable); pressAnim(false); invalidate() }
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longRunnable)
                if (pressedNow && !longFired) { haptic(); performClick() }
                pressedNow = false; pressAnim(false); invalidate()
            }
            MotionEvent.ACTION_CANCEL -> { removeCallbacks(longRunnable); pressedNow = false; pressAnim(false); invalidate() }
        }
        return true
    }

    override fun performClick(): Boolean { super.performClick(); onClick?.invoke(); return true }

    /** Drop a pending long-press and the pressed look (used by custom hit zones). */
    fun cancelPress() { removeCallbacks(longRunnable); if (pressedNow) { pressedNow = false; pressAnim(false); invalidate() } }

    override fun onDetachedFromWindow() { removeCallbacks(longRunnable); super.onDetachedFromWindow() }

    override fun performLongClick(): Boolean {
        val l = onLongClick ?: return super.performLongClick()
        l(); return true
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.className = a11yClass
        if (onLongClick != null) info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_LONG_CLICK)
    }

    /** Sets both the spoken label and the long-press tooltip. */
    fun describe(text: String) { contentDescription = text; tooltipText = text }
}

// =============================================================================================
// icon button (toolbar / palette)
// =============================================================================================
class IconButton(ctx: Context, icon: Icon, text: String? = null, private val sizeDp: Int = 44) : PressableView(ctx) {
    var icon: Icon = icon; set(v) { field = v; if (text == null) describe(v.spoken()); invalidate() }
    var text: String? = text; set(v) { field = v; describe(v ?: icon.spoken()); requestLayout(); invalidate() }
    var active = false; set(v) { field = v; isSelected = v; invalidate() }
    var tint: Int? = null; set(v) { field = v; invalidate() }
    var badge: String? = null; set(v) { field = v; invalidate() }
    var filled = false
    var compactLabel = false
    /** Round (circular) background instead of a rounded square. */
    var round = false
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
    private val r = RectF()

    init { describe(text ?: icon.name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }) }

    private fun labelH() = if (text != null) (sp(10f) + dp(6f)).toInt() else 0

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val base = dp(sizeDp)
        val w = if (text != null && !compactLabel) base + dp(14) else base
        val h = base + labelH()
        setMeasuredDimension(resolveSize(w, widthMeasureSpec), resolveSize(h, heightMeasureSpec))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val t = text
        val iconAreaH = h - labelH()
        val inset = dp(2f)
        if (t != null) r.set(inset, inset, w - inset, h - inset) else r.set(inset, inset, w - inset, h - inset)
        val rad = if (round) r.height() / 2 else dp(13f)
        if (active) {
            bg.color = Theme.accent
            c.drawRoundRect(r, rad, rad, bg)
        } else if (filled) {
            bg.color = Theme.SURFACE_2
            c.drawRoundRect(r, rad, rad, bg)
        }
        if (pressedNow) { bg.color = 0x2EFFFFFF; c.drawRoundRect(r, rad, rad, bg) }
        val color = when {
            !isEnabled -> Theme.withAlpha(Theme.TEXT_MUTED, 0.6f)
            active -> Color.WHITE
            else -> tint ?: Theme.TEXT
        }
        val iconSize = dp(if (sizeDp >= 44) 23f else 21f)
        if (t != null) {
            Icons.draw(c, icon, w / 2, iconAreaH / 2 + dp(3f), iconSize, color)
            tp.color = if (active) Color.WHITE else if (isEnabled) Theme.TEXT_DIM else Theme.TEXT_MUTED
            tp.textSize = sp(10f)
            val label = TextUtils.ellipsize(t, tp, w - dp(4f), TextUtils.TruncateAt.END).toString()
            c.drawText(label, w / 2, h - dp(6f), tp)
        } else Icons.draw(c, icon, w / 2, h / 2, iconSize, color)
        badge?.let {
            tp.textSize = sp(8.5f); tp.color = Color.WHITE
            bg.color = Theme.DANGER
            c.drawCircle(w - dp(9f), dp(9f), dp(7f), bg)
            c.drawText(it, w - dp(9f), dp(12f), tp)
        }
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        if (active) info.isSelected = true
    }
}

// =============================================================================================
// pill button
// =============================================================================================
class PillButton(ctx: Context, text: String, var icon: Icon? = null, var style: Style = Style.SECONDARY) : PressableView(ctx) {
    enum class Style { PRIMARY, SECONDARY, GHOST, DANGER, TINTED }
    var text: String = text; set(v) { field = v; describe(v); requestLayout(); invalidate() }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Theme.medium }
    private val r = RectF()

    init { describe(text) }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        tp.textSize = sp(15f)
        val tw = tp.measureText(text) + dp(36f) + (if (icon != null) dp(28f) else 0f)
        val h = max(dp(48), (sp(15f) * 2.6f).toInt())
        setMeasuredDimension(resolveSize(tw.toInt(), widthMeasureSpec), resolveSize(h, heightMeasureSpec))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
        val rad = dp(14f)
        bg.shader = null
        when (style) {
            Style.PRIMARY -> { bg.color = if (isEnabled) Theme.accent else Theme.SURFACE_3; c.drawRoundRect(r, rad, rad, bg) }
            Style.SECONDARY -> { bg.color = Theme.SURFACE_2; c.drawRoundRect(r, rad, rad, bg) }
            Style.TINTED -> { bg.color = Theme.withAlpha(Theme.accent, 0.22f); c.drawRoundRect(r, rad, rad, bg) }
            Style.DANGER -> { bg.color = Theme.withAlpha(Theme.DANGER, 0.16f); c.drawRoundRect(r, rad, rad, bg) }
            Style.GHOST -> {}
        }
        if (pressedNow) { bg.color = 0x26FFFFFF; c.drawRoundRect(r, rad, rad, bg) }
        val fg = when {
            !isEnabled -> Theme.TEXT_MUTED
            style == Style.DANGER -> Theme.DANGER
            style == Style.GHOST || style == Style.TINTED -> Theme.accentLight()
            else -> Color.WHITE
        }
        tp.color = fg; tp.textSize = sp(15f)
        val tw = tp.measureText(text)
        val total = tw + (if (icon != null) dp(28f) else 0f)
        var x = (w - total) / 2
        icon?.let { Icons.draw(c, it, x + dp(10f), h / 2, dp(20f), fg); x += dp(28f) }
        c.drawText(text, x, h / 2 + tp.textSize * 0.35f, tp)
    }
}

// =============================================================================================
// sliders – exposed to TalkBack as SeekBars with range info and step actions
// =============================================================================================
private fun sliderNode(v: View, info: AccessibilityNodeInfo, title: String, min: Float, max: Float, value: Float, text: String) {
    info.className = "android.widget.SeekBar"
    info.contentDescription = title
    info.text = text
    info.rangeInfo = AccessibilityNodeInfo.RangeInfo.obtain(AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT, min, max, value)
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD)
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_PROGRESS)
    info.isScrollable = true
    v.isFocusable = true
}

/** Returns the new value for an accessibility action or null if not handled. */
private fun sliderAction(action: Int, args: Bundle?, min: Float, max: Float, value: Float, step: Float): Float? {
    val s = if (step > 0f) step else (max - min) / 20f
    return when (action) {
        AccessibilityNodeInfo.ACTION_SCROLL_FORWARD -> (value + s).coerceIn(min, max)
        AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> (value - s).coerceIn(min, max)
        android.R.id.accessibilityActionSetProgress -> args?.getFloat(AccessibilityNodeInfo.ACTION_ARGUMENT_PROGRESS_VALUE)?.coerceIn(min, max)
        else -> null
    }
}

class VSlider(ctx: Context, val title: String, var min: Float, var max: Float, value: Float, val format: (Float) -> String = { "${(it * 100).roundToInt()}" }) : View(ctx) {
    var value = value; set(v) { field = v.coerceIn(min, max); invalidate() }
    var onChange: ((Float) -> Unit)? = null
    var onRelease: (() -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
    private val r = RectF()
    private var dragging = false
    private var lastY = 0f

    init { isFocusable = true; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES; contentDescription = title }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(44), w), resolveSize(dp(168), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(3f), dp(3f), w - dp(3f), h - dp(3f))
        val rad = dp(14f)
        bg.shader = null; bg.color = Theme.GLASS
        c.drawRoundRect(r, rad, rad, bg)
        val t = (value - min) / (max - min)
        val fillTop = r.bottom - r.height() * t
        c.save()
        c.clipRect(r.left, fillTop, r.right, r.bottom)
        bg.color = if (dragging) Theme.accent else Theme.withAlpha(Theme.accent, 0.85f)
        c.drawRoundRect(r, rad, rad, bg)
        c.restore()
        // grip line
        bg.color = 0xCCFFFFFF.toInt()
        c.drawRoundRect(RectF(w / 2 - dp(7f), fillTop.coerceIn(r.top + dp(6f), r.bottom - dp(6f)) - dp(1.5f), w / 2 + dp(7f), fillTop.coerceIn(r.top + dp(6f), r.bottom - dp(6f)) + dp(1.5f)), dp(1.5f), dp(1.5f), bg)
        tp.textSize = sp(9.5f); tp.color = if (t > 0.12f) Color.WHITE else Theme.TEXT_DIM
        c.drawText(title.uppercase(), w / 2, h - dp(11f), tp)
        tp.textSize = sp(12f); tp.color = if (t > 0.9f) Color.WHITE else Theme.TEXT
        c.drawText(format(value), w / 2, dp(21f), tp)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { dragging = true; lastY = e.y; parent?.requestDisallowInterceptTouchEvent(true); invalidate() }
            MotionEvent.ACTION_MOVE -> {
                val dy = lastY - e.y
                lastY = e.y
                value += dy / (height - dp(8f)) * (max - min)
                onChange?.invoke(value)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { dragging = false; invalidate(); onRelease?.invoke() }
        }
        return true
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        sliderNode(this, info, title, min, max, value, format(value))
    }

    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        val v = sliderAction(action, arguments, min, max, value, 0f) ?: return super.performAccessibilityAction(action, arguments)
        value = v; onChange?.invoke(value); onRelease?.invoke()
        announceForAccessibility(format(value))
        return true
    }
}

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

    init { isFocusable = true; importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES; contentDescription = title }

    private fun quantize(v: Float) = if (step > 0f) (Math.round(v / step) * step).coerceIn(min, max) else v

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(260), w), resolveSize((sp(14f) + dp(40f)).toInt(), h))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val textY = sp(14f) + dp(4f)
        tp.textSize = sp(14f); tp.color = Theme.TEXT; tp.textAlign = Paint.Align.LEFT; tp.typeface = Theme.regular
        c.drawText(title, dp(2f), textY, tp)
        tp.color = Theme.TEXT_DIM; tp.textAlign = Paint.Align.RIGHT; tp.typeface = Theme.medium
        c.drawText(format(value), w - dp(2f), textY, tp)
        tp.typeface = Theme.regular
        val ty = textY + dp(20f)
        r.set(dp(2f), ty - dp(2.5f), w - dp(2f), ty + dp(2.5f))
        bg.color = Theme.SURFACE_3
        c.drawRoundRect(r, dp(2.5f), dp(2.5f), bg)
        val t = ((value - min) / (max - min)).coerceIn(0f, 1f)
        r.right = r.left + (w - dp(4f)) * t
        bg.color = Theme.accent
        c.drawRoundRect(r, dp(2.5f), dp(2.5f), bg)
        val kx = r.right.coerceIn(dp(13f), w - dp(13f))
        bg.color = 0x40000000
        c.drawCircle(kx, ty + dp(1f), dp(13f), bg)
        bg.color = Color.WHITE
        c.drawCircle(kx, ty, dp(if (dragging) 13f else 12f), bg)
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
                    val old = value
                    value = startValue + (e.x - downX) / w * (max - min)
                    if (step > 0f && value != old) haptic()
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

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        sliderNode(this, info, title, min, max, value, format(value))
    }

    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        val v = sliderAction(action, arguments, min, max, value, step) ?: return super.performAccessibilityAction(action, arguments)
        value = v; onChange?.invoke(value); onRelease?.invoke(value)
        announceForAccessibility(format(value))
        return true
    }
}

// =============================================================================================
// switch row
// =============================================================================================
class ToggleRow(ctx: Context, val title: String, checked: Boolean, val subtitle: String? = null) : PressableView(ctx) {
    var checked = checked; set(v) { field = v; invalidate() }
    var onToggle: ((Boolean) -> Unit)? = null
    override val a11yClass = "android.widget.Switch"
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()

    init {
        describe(title)
        onClick = { this.checked = !this.checked; onToggle?.invoke(this.checked) }
    }

    override fun onMeasure(w: Int, h: Int) {
        val hh = if (subtitle != null) sp(15f) + sp(12f) + dp(26f) else sp(15f) + dp(30f)
        setMeasuredDimension(resolveSize(dp(260), w), resolveSize(max(dp(50).toFloat(), hh).toInt(), h))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        if (pressedNow) { bg.color = 0x14FFFFFF; r.set(0f, 0f, w, h); c.drawRoundRect(r, dp(10f), dp(10f), bg) }
        val textW = w - dp(68f)
        tp.textSize = sp(15f); tp.color = Theme.TEXT; tp.typeface = Theme.regular
        if (subtitle != null) {
            c.drawText(TextUtils.ellipsize(title, tp, textW, TextUtils.TruncateAt.END).toString(), dp(2f), h / 2 - dp(2f), tp)
            tp.textSize = sp(12f); tp.color = Theme.TEXT_MUTED
            c.drawText(TextUtils.ellipsize(subtitle, tp, textW, TextUtils.TruncateAt.END).toString(), dp(2f), h / 2 + sp(12f) + dp(1f), tp)
        } else c.drawText(TextUtils.ellipsize(title, tp, textW, TextUtils.TruncateAt.END).toString(), dp(2f), h / 2 + sp(15f) * 0.35f, tp)
        val sw = dp(51f); val sh = dp(31f)
        r.set(w - sw - dp(2f), (h - sh) / 2, w - dp(2f), (h + sh) / 2)
        bg.color = if (checked) Theme.accent else Theme.SURFACE_3
        c.drawRoundRect(r, sh / 2, sh / 2, bg)
        bg.color = 0x33000000
        val cx = if (checked) r.right - sh / 2 else r.left + sh / 2
        c.drawCircle(cx, h / 2 + dp(1f), sh / 2 - dp(2f), bg)
        bg.color = Color.WHITE
        c.drawCircle(cx, h / 2, sh / 2 - dp(2.5f), bg)
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.isCheckable = true
        info.isChecked = checked
        if (subtitle != null) info.contentDescription = "$title. $subtitle"
    }
}

// =============================================================================================
// segmented control – real child views so each segment is reachable with TalkBack
// =============================================================================================
class Segmented(ctx: Context, val options: List<String>, selected: Int, val icons: List<Icon>? = null) : LinearLayout(ctx) {
    var onSelect: ((Int) -> Unit)? = null
    var selected = selected
        set(v) { field = v; for (i in 0 until childCount) (getChildAt(i) as Seg).invalidate(); animatePill() }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    private var pillX = -1f

    init {
        orientation = HORIZONTAL
        setWillNotDraw(false)
        setPadding(dp(3), dp(3), dp(3), dp(3))
        options.forEachIndexed { i, _ -> addView(Seg(ctx, i), LayoutParams(0, LayoutParams.MATCH_PARENT, 1f)) }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val h = if (icons != null) (dp(30f) + sp(10.5f) + dp(16f)).toInt() else max(dp(40), (sp(13.5f) + dp(24f)).toInt())
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    }

    private fun segW() = (width - paddingLeft - paddingRight).toFloat() / options.size

    private fun animatePill() {
        val target = paddingLeft + selected * segW()
        if (pillX < 0f || Theme.reduceMotion || width == 0) { pillX = target; invalidate(); return }
        val start = pillX
        val a = android.animation.ValueAnimator.ofFloat(0f, 1f).setDuration(220)
        a.interpolator = android.view.animation.DecelerateInterpolator(2f)
        a.addUpdateListener { pillX = start + (target - start) * (it.animatedValue as Float); invalidate() }
        a.start()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); pillX = paddingLeft + selected * segW() }

    override fun onDraw(c: Canvas) {
        r.set(0f, 0f, width.toFloat(), height.toFloat())
        bg.color = Theme.SURFACE_2
        c.drawRoundRect(r, dp(11f), dp(11f), bg)
        val sw = segW()
        if (pillX < 0f) pillX = paddingLeft + selected * sw
        r.set(pillX, paddingTop.toFloat(), pillX + sw, (height - paddingBottom).toFloat())
        bg.color = Theme.accent
        c.drawRoundRect(r, dp(9f), dp(9f), bg)
    }

    private inner class Seg(ctx: Context, val index: Int) : PressableView(ctx) {
        private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
        override val a11yClass = "android.widget.RadioButton"
        init { describe(options[index]); onClick = { if (selected != index) { selected = index; onSelect?.invoke(index) } } }
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            val sel = index == selected
            tp.color = if (sel) Color.WHITE else Theme.TEXT_DIM
            val ic = icons?.getOrNull(index)
            if (ic != null) {
                Icons.draw(c, ic, w / 2, h / 2 - sp(6f), dp(20f), tp.color)
                tp.textSize = sp(10.5f)
                c.drawText(TextUtils.ellipsize(options[index], tp, w - dp(4f), TextUtils.TruncateAt.END).toString(), w / 2, h / 2 + dp(10f) + sp(6f), tp)
            } else {
                tp.textSize = sp(13.5f)
                c.drawText(TextUtils.ellipsize(options[index], tp, w - dp(6f), TextUtils.TruncateAt.END).toString(), w / 2, h / 2 + sp(13.5f) * 0.35f, tp)
            }
        }
        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.isCheckable = true
            info.isChecked = index == selected
            info.contentDescription = "${options[index]}, ${index + 1} of ${options.size}"
        }
    }
}

// =============================================================================================
// color swatch / chip
// =============================================================================================
class Swatch(ctx: Context, color: Int, private val sizeDp: Int = 34) : PressableView(ctx) {
    var color = color; set(v) { field = v; describe(colorName(v)); invalidate() }
    var ring = false; set(v) { field = v; isSelected = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)

    init { describe(colorName(color)) }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(dp(max(sizeDp, 32)), dp(max(sizeDp, 32)))

    override fun onDraw(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f; val rad = width / 2f - dp(3.5f)
        if (Color.alpha(color) < 255) {
            p.color = 0xFF888888.toInt(); c.drawCircle(cx, cy, rad, p)
            p.color = 0xFFCCCCCC.toInt(); c.drawArc(cx - rad, cy - rad, cx + rad, cy + rad, 0f, 90f, true, p); c.drawArc(cx - rad, cy - rad, cx + rad, cy + rad, 180f, 90f, true, p)
        }
        p.style = Paint.Style.FILL; p.color = color
        c.drawCircle(cx, cy, rad, p)
        p.style = Paint.Style.STROKE
        if (ring) {
            p.strokeWidth = dp(2.5f); p.color = Color.WHITE
            c.drawCircle(cx, cy, rad + dp(1.5f), p)
        } else {
            p.strokeWidth = dp(1f); p.color = 0x33FFFFFF
            c.drawCircle(cx, cy, rad, p)
        }
        p.style = Paint.Style.FILL
        if (pressedNow) { p.color = 0x33FFFFFF; c.drawCircle(cx, cy, rad, p) }
    }

    companion object {
        fun colorName(c: Int): String {
            val hsv = FloatArray(3); Color.colorToHSV(c, hsv)
            val hue = hsv[0]; val s = hsv[1]; val v = hsv[2]
            val name = when {
                v < 0.12f -> "Black"
                s < 0.12f -> if (v > 0.9f) "White" else "Gray"
                hue < 15 || hue >= 345 -> "Red"
                hue < 40 -> if (v < 0.6f) "Brown" else "Orange"
                hue < 65 -> "Yellow"
                hue < 160 -> "Green"
                hue < 200 -> "Teal"
                hue < 250 -> "Blue"
                hue < 290 -> "Purple"
                else -> "Pink"
            }
            return "$name, " + String.format("#%06X", c and 0xFFFFFF)
        }
    }
}

class Chip(ctx: Context, text: String, var icon: Icon? = null) : PressableView(ctx) {
    var text: String = text; set(v) { field = v; describe(v); requestLayout(); invalidate() }
    var active = false; set(v) { field = v; isSelected = v; invalidate() }
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Theme.medium }
    private val r = RectF()

    init { describe(text) }

    override fun onMeasure(w: Int, h: Int) {
        tp.textSize = sp(13.5f)
        val tw = tp.measureText(text) + dp(30f) + (if (icon != null) dp(24f) else 0f)
        setMeasuredDimension(resolveSize(tw.toInt(), w), resolveSize(max(dp(38), (sp(13.5f) + dp(22f)).toInt()), h))
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
        bg.style = Paint.Style.FILL
        bg.color = if (active) Theme.accent else Theme.SURFACE_2
        c.drawRoundRect(r, h / 2, h / 2, bg)
        if (pressedNow) { bg.color = 0x26FFFFFF; c.drawRoundRect(r, h / 2, h / 2, bg) }
        tp.color = if (active) Color.WHITE else Theme.TEXT
        tp.textSize = sp(13.5f)
        var x = dp(15f)
        icon?.let { Icons.draw(c, it, x + dp(8f), h / 2, dp(18f), tp.color); x += dp(24f) }
        c.drawText(text, x, h / 2 + tp.textSize * 0.35f, tp)
    }

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        if (active) info.isSelected = true
    }
}

/** Small section header used in panels and sheets. */
fun Context.sectionTitle(text: String): TextView = label(text.uppercase(), 12f, Theme.TEXT_MUTED, bold = true).apply {
    letterSpacing = 0.06f
    setPadding(dp(4), dp(18), 0, dp(7))
    isFocusable = false
    if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
}

// =============================================================================================
// iOS-style grouped list
// =============================================================================================
/** Rounded card holding rows separated by hairlines. */
class GroupCard(ctx: Context) : LinearLayout(ctx) {
    private val sep = Paint().apply { color = Theme.SEPARATOR }
    init {
        orientation = VERTICAL
        background = Theme.rounded(Theme.SURFACE, 14f)
        setPadding(dp(14), dp(2), dp(14), dp(2))
        setWillNotDraw(false)
    }
    fun row(v: View): GroupCard { addView(v, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)); return this }
    override fun dispatchDraw(c: Canvas) {
        super.dispatchDraw(c)
        for (i in 0 until childCount - 1) {
            val ch = getChildAt(i)
            if (ch.visibility != VISIBLE) continue
            c.drawRect(ch.left.toFloat() + dp(2f), ch.bottom.toFloat(), width.toFloat(), ch.bottom.toFloat() + 1f, sep)
        }
    }
}

/** A tappable list row with optional icon, value text and chevron. */
class NavRow(ctx: Context, var icon: Icon?, title: String, var value: String? = null, var chevron: Boolean = true, var iconBg: Int? = null) : PressableView(ctx) {
    var title: String = title; set(v) { field = v; describe(v); invalidate() }
    var danger = false
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    init { describe(title) }
    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(300), w), max(dp(50), (sp(15f) + dp(30f)).toInt()))
    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        if (pressedNow) { p.color = 0x14FFFFFF; r.set(-dp(14f), 0f, w + dp(14f), h); c.drawRect(r, p) }
        var x = dp(2f)
        icon?.let {
            val bgc = iconBg
            if (bgc != null) {
                r.set(x, h / 2 - dp(15f), x + dp(30f), h / 2 + dp(15f))
                p.color = bgc; c.drawRoundRect(r, dp(8f), dp(8f), p)
                Icons.draw(c, it, x + dp(15f), h / 2, dp(19f), Color.WHITE)
            } else Icons.draw(c, it, x + dp(13f), h / 2, dp(22f), if (danger) Theme.DANGER else Theme.accentLight())
            x += dp(42f)
        }
        tp.textSize = sp(15f); tp.color = if (danger) Theme.DANGER else Theme.TEXT; tp.typeface = Theme.regular
        val right = w - (if (chevron) dp(22f) else dp(2f))
        val vText = value
        var vw = 0f
        if (vText != null) {
            tp.textSize = sp(14.5f); tp.color = Theme.TEXT_DIM; tp.textAlign = Paint.Align.RIGHT
            val s = TextUtils.ellipsize(vText, tp, (w - x) * 0.45f, TextUtils.TruncateAt.END).toString()
            vw = tp.measureText(s) + dp(10f)
            c.drawText(s, right, h / 2 + sp(14.5f) * 0.35f, tp)
            tp.textAlign = Paint.Align.LEFT
        }
        tp.textSize = sp(15f); tp.color = if (danger) Theme.DANGER else Theme.TEXT
        c.drawText(TextUtils.ellipsize(title, tp, right - x - vw, TextUtils.TruncateAt.END).toString(), x, h / 2 + sp(15f) * 0.35f, tp)
        if (chevron) Icons.draw(c, Icon.CHEVRON_RIGHT, w - dp(8f), h / 2, dp(16f), Theme.TEXT_MUTED, 2.2f)
    }
    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        info.contentDescription = if (value != null) "$title, $value" else title
    }
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
