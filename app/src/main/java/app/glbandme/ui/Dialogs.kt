package app.glbandme.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.ColorDrawable
import android.text.InputType
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import app.glbandme.ui.Theme.dp

class MenuItem(val icon: Icon?, val text: String, val danger: Boolean = false, val subtitle: String? = null, val action: () -> Unit)

object Dialogs {

    /** Rounded dark card dialog. [bottom] = bottom sheet. */
    fun base(act: Activity, content: View, bottom: Boolean = false, cancelable: Boolean = true): Dialog {
        val d = Dialog(act, android.R.style.Theme_DeviceDefault_Dialog_NoActionBar)
        d.setCancelable(cancelable)
        val card = FrameLayout(act).apply {
            background = if (bottom) android.graphics.drawable.GradientDrawable().apply {
                setColor(Theme.SURFACE)
                cornerRadii = floatArrayOf(dp(22f), dp(22f), dp(22f), dp(22f), 0f, 0f, 0f, 0f)
            } else Theme.rounded(Theme.SURFACE, 22f, Theme.STROKE, 1f)
            addView(content)
        }
        d.setContentView(card)
        d.window?.let { w ->
            w.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            val dm = act.resources.displayMetrics
            if (bottom) {
                w.setGravity(Gravity.BOTTOM)
                w.setLayout(minOf(dm.widthPixels, dp(560)), ViewGroup.LayoutParams.WRAP_CONTENT)
                w.attributes = w.attributes.apply { windowAnimations = android.R.style.Animation_InputMethod }
            } else {
                w.setLayout(minOf((dm.widthPixels * 0.92f).toInt(), dp(460)), ViewGroup.LayoutParams.WRAP_CONTENT)
            }
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            w.setDimAmount(0.55f)
        }
        return d
    }

    private fun titleView(ctx: Context, title: String, message: String?): View = ctx.vbox().apply {
        addView(ctx.label(title, 19f, Theme.TEXT, bold = true))
        if (message != null) addView(ctx.label(message, 14f, Theme.TEXT_DIM).apply { setPadding(0, dp(8), 0, 0); setLineSpacing(0f, 1.15f) })
    }

    fun custom(
        act: Activity, title: String?, body: View?, positive: String? = "OK", negative: String? = "Cancel",
        danger: Boolean = false, scroll: Boolean = true, onPositive: (() -> Boolean)? = null, onNegative: (() -> Unit)? = null
    ): Dialog {
        val root = act.vbox(20)
        lateinit var d: Dialog
        if (title != null) root.addView(titleView(act, title, null), lp())
        if (body != null) {
            val wrap: View = if (scroll) ScrollView(act).apply { isVerticalScrollBarEnabled = false; addView(body) } else body
            root.addView(wrap, lp().apply { topMargin = if (title != null) dp(12) else 0 })
            if (scroll) {
                val maxH = (act.resources.displayMetrics.heightPixels * 0.62f).toInt()
                wrap.layoutParams = lp().apply { topMargin = if (title != null) dp(12) else 0 }
                (wrap as ScrollView).viewTreeObserver.addOnGlobalLayoutListener {
                    if (wrap.height > maxH) wrap.layoutParams = wrap.layoutParams.apply { height = maxH }
                }
            }
        }
        if (positive != null || negative != null) {
            val row = act.hbox(0, 10).apply { gravity = Gravity.END }
            if (negative != null) row.addView(PillButton(act, negative, style = PillButton.Style.GHOST).apply { onClick = { onNegative?.invoke(); d.dismiss() } })
            if (positive != null) row.addView(PillButton(act, positive, style = if (danger) PillButton.Style.DANGER else PillButton.Style.PRIMARY).apply {
                onClick = { if (onPositive?.invoke() != false) d.dismiss() }
            })
            root.addView(row, lp().apply { topMargin = dp(18) })
        }
        d = base(act, root)
        d.show()
        return d
    }

    fun confirm(act: Activity, title: String, message: String, confirm: String = "OK", danger: Boolean = false, onConfirm: () -> Unit): Dialog {
        val root = act.vbox(20)
        root.addView(titleView(act, title, message))
        lateinit var d: Dialog
        val row = act.hbox(0, 10).apply { gravity = Gravity.END }
        row.addView(PillButton(act, "Cancel", style = PillButton.Style.GHOST).apply { onClick = { d.dismiss() } })
        row.addView(PillButton(act, confirm, style = if (danger) PillButton.Style.DANGER else PillButton.Style.PRIMARY).apply { onClick = { d.dismiss(); onConfirm() } })
        root.addView(row, lp().apply { topMargin = dp(20) })
        d = base(act, root)
        d.show()
        return d
    }

    fun message(act: Activity, title: String, message: String) {
        custom(act, null, titleView(act, title, message), "Got it", null)
    }

    fun editText(ctx: Context, initial: String, hint: String = ""): EditText = EditText(ctx).apply {
        setText(initial)
        this.hint = hint
        setTextColor(Theme.TEXT)
        setHintTextColor(Theme.TEXT_MUTED)
        textSize = 16f
        background = Theme.rounded(Theme.SURFACE_2, 12f, Theme.STROKE, 1f)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_DONE
        setSelection(text.length)
    }

    fun prompt(act: Activity, title: String, initial: String, hint: String = "", ok: String = "Save", numeric: Boolean = false, onOk: (String) -> Unit) {
        val et = editText(act, initial, hint)
        if (numeric) et.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
        val d = custom(act, title, et, ok, "Cancel", scroll = false, onPositive = {
            val t = et.text.toString().trim()
            if (t.isEmpty()) false else { onOk(t); true }
        })
        et.selectAll()
        et.requestFocus()
        d.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        et.setOnEditorActionListener { _, a, _ ->
            if (a == EditorInfo.IME_ACTION_DONE) {
                val t = et.text.toString().trim()
                if (t.isNotEmpty()) { onOk(t); d.dismiss() }
                true
            } else false
        }
        et.postDelayed({ (act.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(et, 0) }, 150)
    }

    /** Bottom sheet list menu. */
    fun menu(act: Activity, title: String?, items: List<MenuItem>): Dialog {
        val root = act.vbox().apply { setPadding(dp(10), dp(14), dp(10), dp(18)) }
        lateinit var d: Dialog
        // grab handle
        root.addView(View(act).apply { background = Theme.rounded(Theme.SURFACE_3, 3f) }, LinearLayout.LayoutParams(dp(40), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(10) })
        if (title != null) root.addView(act.label(title, 15f, Theme.TEXT_DIM, bold = true).apply { setPadding(dp(14), dp(4), dp(14), dp(10)) })
        for (it in items) {
            val row = MenuRow(act, it)
            row.onClick = { d.dismiss(); it.action() }
            root.addView(row, lp())
        }
        val scroll = ScrollView(act).apply { addView(root) }
        d = base(act, scroll, bottom = true)
        d.show()
        return d
    }

    fun progress(act: Activity, text: String): Dialog {
        val row = act.hbox(22, 16)
        row.addView(ProgressBar(act).apply { isIndeterminate = true; indeterminateDrawable?.setTint(Theme.accent) }, LinearLayout.LayoutParams(dp(32), dp(32)))
        row.addView(act.label(text, 15f).apply { tag = "msg" })
        val d = base(act, row, cancelable = false)
        d.show()
        return d
    }

    fun setProgressText(d: Dialog, text: String) {
        d.window?.decorView?.findViewWithTag<TextView>("msg")?.text = text
    }
}

class MenuRow(ctx: Context, val item: MenuItem) : PressableView(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(300), w), dp(if (item.subtitle != null) 60 else 52))
    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        if (pressedNow) { p.color = 0x18FFFFFF; r.set(0f, 0f, w, h); c.drawRoundRect(r, dp(12f), dp(12f), p) }
        val col = if (item.danger) Theme.DANGER else Theme.TEXT
        var x = dp(16f)
        item.icon?.let { Icons.draw(c, it, x + dp(11f), h / 2, dp(22f), if (item.danger) Theme.DANGER else Theme.TEXT_DIM); x += dp(38f) }
        p.color = col; p.textSize = dp(15f); p.typeface = Theme.regular
        if (item.subtitle != null) {
            c.drawText(item.text, x, h / 2 - dp(2f), p)
            p.color = Theme.TEXT_MUTED; p.textSize = dp(12f)
            c.drawText(item.subtitle, x, h / 2 + dp(15f), p)
        } else c.drawText(item.text, x, h / 2 + dp(5.5f), p)
    }
}

/** Transient message bubble at the bottom of a FrameLayout. */
object Snack {
    fun show(host: ViewGroup, text: String, long: Boolean = false) {
        val ctx = host.context
        val tv = ctx.label(text, 14f, Theme.TEXT).apply {
            background = Theme.rounded(0xF0242836.toInt(), 14f, Theme.STROKE, 1f)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            gravity = Gravity.CENTER
            elevation = dp(8f)
            maxWidth = dp(420)
        }
        val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
        lp.bottomMargin = dp(120)
        tv.alpha = 0f
        tv.translationY = dp(12f)
        if (host is FrameLayout) host.addView(tv, lp) else host.addView(tv)
        tv.animate().alpha(1f).translationY(0f).setDuration(180).start()
        tv.postDelayed({
            tv.animate().alpha(0f).setDuration(220).withEndAction { host.removeView(tv) }.start()
        }, if (long) 3500 else 1900)
    }
}

// =============================================================================================
// color picker
// =============================================================================================
class ColorPickerView(ctx: Context, initial: Int) : LinearLayout(ctx) {
    private val hsv = FloatArray(3)
    var onColor: ((Int) -> Unit)? = null
    private val sv = SvSquare(ctx)
    private val hue = HueBar(ctx)
    private val preview = Swatch(ctx, initial, 44)
    private val hex = Dialogs.editText(ctx, "", "#RRGGBB")
    private var internal = false

    val color: Int get() = Color.HSVToColor(hsv)

    init {
        orientation = VERTICAL
        Color.colorToHSV(initial, hsv)
        addView(sv, LayoutParams(MATCH, dp(190)))
        addView(hue, LayoutParams(MATCH, dp(30)).apply { topMargin = dp(12) })
        val row = ctx.hbox(0, 12).apply { setPadding(0, dp(12), 0, 0) }
        row.addView(preview)
        hex.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        row.addView(hex, LayoutParams(0, WRAP, 1f))
        addView(row)
        hex.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                if (internal) return
                val t = s.toString().trim().removePrefix("#")
                if (t.length == 6) runCatching { Color.parseColor("#$t") }.getOrNull()?.let { Color.colorToHSV(it, hsv); refresh(false) }
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
        addView(ctx.sectionTitle("Palette"))
        val pal = FlowLayout(ctx, 6, 6)
        val presets = intArrayOf(
            0xFFFFFF, 0xD9D9D9, 0x9E9E9E, 0x5C5C5C, 0x1F1F1F, 0x000000,
            0xF44336, 0xFF7043, 0xFFB300, 0xFFEB3B, 0x8BC34A, 0x2E7D32,
            0x00BFA5, 0x00BCD4, 0x2196F3, 0x3F51B5, 0x7C4DFF, 0xE040FB,
            0xF8BBD0, 0xE0AC8D, 0xC68642, 0x8D5524, 0x5D4037, 0xF5E6CA
        )
        for (pc in presets) pal.addView(Swatch(ctx, pc or 0xFF000000.toInt(), 32).apply { onClick = { setColor(this.color) } })
        addView(pal)
        val recent = Prefs.of(ctx).recentColors.split(',').mapNotNull { it.toIntOrNull() }
        if (recent.isNotEmpty()) {
            addView(ctx.sectionTitle("Recent"))
            val rr = FlowLayout(ctx, 6, 6)
            for (rc in recent.take(12)) rr.addView(Swatch(ctx, rc, 32).apply { onClick = { setColor(this.color) } })
            addView(rr)
        }
        sv.onChange = { s, v -> hsv[1] = s; hsv[2] = v; refresh(true) }
        hue.onChange = { h -> hsv[0] = h; refresh(true) }
        refresh(true)
    }

    fun setColor(c: Int) { Color.colorToHSV(c, hsv); refresh(true) }

    private fun refresh(updateHex: Boolean) {
        sv.hue = hsv[0]; sv.s = hsv[1]; sv.v = hsv[2]; sv.invalidate()
        hue.hue = hsv[0]; hue.invalidate()
        preview.color = color
        if (updateHex) { internal = true; hex.setText(String.format("#%06X", color and 0xFFFFFF)); internal = false }
        onColor?.invoke(color)
    }

    companion object {
        fun remember(ctx: Context, c: Int) {
            val p = Prefs.of(ctx)
            val list = (listOf(c) + p.recentColors.split(',').mapNotNull { it.toIntOrNull() }).distinct().take(12)
            p.recentColors = list.joinToString(",")
        }

        /** Shows a picker dialog; [live] is called while dragging, [done] on confirm. */
        fun show(act: Activity, title: String, initial: Int, live: ((Int) -> Unit)? = null, done: (Int) -> Unit) {
            val v = ColorPickerView(act, initial)
            v.onColor = live
            Dialogs.custom(act, title, v, "Apply", "Cancel", onPositive = { remember(act, v.color); done(v.color); true }, onNegative = { live?.invoke(initial) })
        }
    }

    private class SvSquare(ctx: Context) : View(ctx) {
        var hue = 0f; var s = 1f; var v = 1f
        var onChange: ((Float, Float) -> Unit)? = null
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            r.set(0f, 0f, w, h)
            val sat = LinearGradient(0f, 0f, w, 0f, Color.WHITE, Color.HSVToColor(floatArrayOf(hue, 1f, 1f)), Shader.TileMode.CLAMP)
            val dark = LinearGradient(0f, 0f, 0f, h, Color.WHITE, Color.BLACK, Shader.TileMode.CLAMP)
            p.shader = ComposeShader(sat, dark, PorterDuff.Mode.MULTIPLY)
            c.drawRoundRect(r, dp(12f), dp(12f), p)
            p.shader = null
            val x = s * w; val y = (1 - v) * h
            p.style = Paint.Style.STROKE; p.strokeWidth = dp(3f); p.color = Color.WHITE
            c.drawCircle(x, y, dp(10f), p)
            p.strokeWidth = dp(1f); p.color = 0x66000000
            c.drawCircle(x, y, dp(11.5f), p)
            p.style = Paint.Style.FILL
        }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(true)
            s = (e.x / width).coerceIn(0f, 1f); v = 1f - (e.y / height).coerceIn(0f, 1f)
            onChange?.invoke(s, v); invalidate()
            return true
        }
    }

    private class HueBar(ctx: Context) : View(ctx) {
        var hue = 0f
        var onChange: ((Float) -> Unit)? = null
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            val cols = IntArray(7) { Color.HSVToColor(floatArrayOf(it * 60f, 1f, 1f)) }
            p.shader = LinearGradient(0f, 0f, w, 0f, cols, null, Shader.TileMode.CLAMP)
            r.set(0f, h * 0.2f, w, h * 0.8f)
            c.drawRoundRect(r, h * 0.3f, h * 0.3f, p)
            p.shader = null
            val x = hue / 360f * w
            p.color = Color.WHITE
            c.drawCircle(x.coerceIn(h / 2, w - h / 2), h / 2, h / 2 - dp(2f), p)
            p.color = Color.HSVToColor(floatArrayOf(hue, 1f, 1f))
            c.drawCircle(x.coerceIn(h / 2, w - h / 2), h / 2, h / 2 - dp(5f), p)
        }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(true)
            hue = (e.x / width).coerceIn(0f, 1f) * 359.9f
            onChange?.invoke(hue); invalidate()
            return true
        }
    }
}

/** Horizontally scrolling row helper. */
fun Context.hscroll(child: View): HorizontalScrollView = HorizontalScrollView(this).apply {
    isHorizontalScrollBarEnabled = false
    overScrollMode = View.OVER_SCROLL_NEVER
    addView(child)
}
