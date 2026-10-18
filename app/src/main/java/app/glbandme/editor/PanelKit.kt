package app.glbandme.editor

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.PillButton
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.haptic
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import kotlin.math.abs

/** A panel shown in the floating panel host. */
abstract class Panel(val act: EditorActivity) {
    abstract val title: String
    abstract val icon: Icon
    val ed get() = act.editor
    /** Build the content view (called each time the panel opens or needs a full rebuild). */
    abstract fun build(): View
    /** Which changes require a rebuild while open. */
    open val rebuildOn: Set<Change> = setOf(Change.SELECTION, Change.OBJECTS, Change.UNDO)
    open fun onChanged(c: Set<Change>) { if (c.any { it in rebuildOn }) act.rebuildPanel() }
    open fun onClosed() {}
    /** Optional small buttons shown in the sheet header (e.g. a ⋯ menu). */
    open fun headerActions(): List<View> = emptyList()
}

/** Draggable number display; drag horizontally to scrub, tap to type. */
@SuppressLint("ViewConstructor")
class NumberField(ctx: Context, private val axisColor: Int, value: Float, private val step: Float = 0.01f, private val fmt: String = "%.3f") : View(ctx) {
    var value = value; set(v) { field = v; invalidate() }
    var onChange: ((Float) -> Unit)? = null
    var onCommit: (() -> Unit)? = null
    var onBegin: (() -> Unit)? = null
    var onTapEdit: (() -> Unit)? = null
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    private var downX = 0f
    private var lastX = 0f
    private var dragging = false

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(80), w), dp(38))

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(0f, 0f, w, h)
        p.color = if (dragging) Theme.SURFACE_3 else Theme.SURFACE_2
        c.drawRoundRect(r, dp(9f), dp(9f), p)
        p.color = axisColor
        r.set(0f, dp(8f), dp(3f), h - dp(8f))
        c.drawRoundRect(r, dp(1.5f), dp(1.5f), p)
        p.color = Theme.TEXT; p.textSize = sp(13f); p.typeface = Theme.mono; p.textAlign = Paint.Align.CENTER
        c.drawText(String.format(fmt, value), w / 2, h / 2 + dp(4.5f), p)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = e.x; lastX = e.x; dragging = false; parent?.requestDisallowInterceptTouchEvent(true) }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && abs(e.x - downX) > dp(6f)) { dragging = true; onBegin?.invoke(); invalidate() }
                if (dragging) {
                    value += (e.x - lastX) / dp(4f) * step
                    lastX = e.x
                    onChange?.invoke(value)
                }
            }
            MotionEvent.ACTION_UP -> {
                if (dragging) { dragging = false; invalidate(); onCommit?.invoke() } else { haptic(); onTapEdit?.invoke() }
            }
            MotionEvent.ACTION_CANCEL -> { if (dragging) { dragging = false; invalidate(); onCommit?.invoke() } }
        }
        return true
    }
}

object PanelUi {
    /** Row of three axis fields. */
    fun vec3Row(act: Activity, title: String, values: FloatArray, step: Float, fmt: String = "%.3f",
                begin: () -> Unit, change: (Int, Float) -> Unit, commit: () -> Unit): LinearLayout {
        val col = act.let { LinearLayout(it).apply { orientation = LinearLayout.VERTICAL } }
        col.addView(act.label(title, 12f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(8), 0, dp(6)) })
        val row = act.hbox(0, 6)
        val colors = intArrayOf(Theme.AXIS_X, Theme.AXIS_Y, Theme.AXIS_Z)
        for (i in 0 until 3) {
            val f = NumberField(act, colors[i], values[i], step, fmt)
            f.onBegin = begin
            f.onChange = { v -> change(i, v) }
            f.onCommit = commit
            f.onTapEdit = {
                Dialogs.prompt(act, "$title ${"XYZ"[i]}", String.format(java.util.Locale.US, "%.4f", f.value).trimEnd('0').trimEnd('.'), numeric = true, ok = "Set") { t ->
                    t.replace(',', '.').toFloatOrNull()?.let { v -> begin(); f.value = v; change(i, v); commit() }
                }
            }
            row.addView(f, lp(0, dp(38), 1f))
        }
        col.addView(row)
        return col
    }

    fun actionGrid(act: Activity, items: List<Triple<Icon, String, () -> Unit>>, columns: Int = 4): LinearLayout {
        val grid = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL }
        var row: LinearLayout? = null
        items.forEachIndexed { i, (icon, text, action) ->
            if (i % columns == 0) { row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }; grid.addView(row) }
            row!!.addView(IconButton(act, icon, text, 48).apply { onClick = action; filled = true }, lp(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(3), dp(3), dp(3), dp(3)) })
        }
        val rem = items.size % columns
        if (rem != 0) repeat(columns - rem) { row!!.addView(View(act), lp(0, 1, 1f)) }
        return grid
    }

    fun button(act: Activity, text: String, icon: Icon? = null, style: PillButton.Style = PillButton.Style.SECONDARY, onClick: () -> Unit) =
        PillButton(act, text, icon, style).apply { this.onClick = onClick }

    fun twoButtons(act: Activity, a: PillButton, b: PillButton): LinearLayout = act.hbox(0, 8).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(a, lp(0, dp(44), 1f)); addView(b, lp(0, dp(44), 1f))
    }
}
