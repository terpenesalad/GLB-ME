package app.glbandme.ui

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.text.TextPaint
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityNodeInfo
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Frosted, rounded panel background used by floating editor chrome. */
fun glassBackground(radiusDp: Float = 18f): GradientDrawable = GradientDrawable().apply {
    setColor(Theme.GLASS)
    cornerRadius = dp(radiusDp)
    setStroke(1, 0x1FFFFFFF)
}

/**
 * Editor sheet: a bottom sheet with two detents (portrait phones) or a docked side panel
 * (landscape / tablets). The header can host a segmented page switcher. The body is scrollable.
 */
@SuppressLint("ViewConstructor")
class SheetHost(ctx: Context) : FrameLayout(ctx) {
    enum class Dock { BOTTOM, SIDE }

    var dock = Dock.BOTTOM
        private set
    /** Called with the area of the screen the sheet covers (bottom px, right px) while it moves. */
    var onCoverageChanged: ((bottom: Int, right: Int) -> Unit)? = null
    var onClosed: (() -> Unit)? = null
    var isOpen = false
        private set

    private val card = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    private val grabber = View(ctx)
    private val titleView: TextView = ctx.label("", 17f, Theme.TEXT, bold = true)
    private val headerActions = ctx.hbox(0, 2)
    private val closeBtn = IconButton(ctx, Icon.CLOSE, sizeDp = 38).apply { round = true; filled = true; describe("Close") }
    private val segHolder = FrameLayout(ctx)
    val body = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; isFillViewport = false; clipToPadding = false }
    private var segmented: Segmented? = null

    // geometry (set by layoutIn)
    private var parentW = 0
    private var parentH = 0
    private var topLimit = 0
    private var bottomInset = 0
    private var rightInset = 0
    private var sideWidth = 0
    private var height0 = 0         // current visible height (bottom dock)
    private var mediumH = 0
    private var largeH = 0
    private var anim: ValueAnimator? = null

    init {
        clipChildren = false
        card.background = GradientDrawable().apply { setColor(Theme.PANEL); setStroke(1, 0x22FFFFFF) }
        card.elevation = dp(16f)
        card.isClickable = true // swallow touches so they don't reach the viewport
        grabber.background = Theme.rounded(Theme.SURFACE_3, 3f)
        grabber.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        card.addView(grabber, LinearLayout.LayoutParams(dp(38), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(7) })
        val head = ctx.hbox().apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(18), dp(6), dp(10), dp(4)) }
        titleView.apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true }
        head.addView(titleView, lp(0, WRAP, 1f))
        head.addView(headerActions, lp(WRAP, WRAP))
        head.addView(closeBtn, lp(WRAP, WRAP))
        card.addView(head, lp())
        segHolder.setPadding(dp(14), dp(2), dp(14), dp(6))
        card.addView(segHolder, lp())
        card.addView(View(ctx).apply { setBackgroundColor(Theme.SEPARATOR) }, lp(MATCH, 1))
        card.addView(body, LinearLayout.LayoutParams(MATCH, 0, 1f))
        addView(card, LayoutParams(MATCH, MATCH))
        closeBtn.onClick = { close() }
        visibility = GONE
        installDrag(head)
        installDrag(grabber)
    }

    /** Configure for the current window. Call on every layout/inset change. */
    fun layoutIn(w: Int, h: Int, insets: Insets, topLimitPx: Int, landscape: Boolean) {
        parentW = w; parentH = h
        topLimit = topLimitPx
        bottomInset = insets.bottom
        rightInset = insets.right
        val wantSide = landscape || w >= dp(840)
        dock = if (wantSide) Dock.SIDE else Dock.BOTTOM
        sideWidth = min(dp(380), (w * 0.5f).toInt())
        mediumH = max(dp(300), (h * 0.46f).toInt())
        largeH = h - topLimit
        val lp = layoutParams as? LayoutParams ?: return
        if (dock == Dock.SIDE) {
            grabber.visibility = GONE
            lp.width = sideWidth + insets.right
            lp.height = h - topLimit - insets.bottom - dp(8)
            lp.gravity = Gravity.END or Gravity.TOP
            lp.topMargin = topLimit
            lp.rightMargin = 0
            lp.bottomMargin = 0
            (card.background as GradientDrawable).cornerRadii = floatArrayOf(dp(22f), dp(22f), 0f, 0f, 0f, 0f, dp(22f), dp(22f))
            card.setPadding(0, 0, insets.right, 0)
        } else {
            grabber.visibility = VISIBLE
            lp.width = min(w, dp(640))
            lp.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            lp.topMargin = 0
            if (height0 == 0) height0 = mediumH
            height0 = height0.coerceIn(dp(160), largeH)
            lp.height = height0
            (card.background as GradientDrawable).cornerRadii = floatArrayOf(dp(22f), dp(22f), dp(22f), dp(22f), 0f, 0f, 0f, 0f)
            card.setPadding(0, 0, 0, insets.bottom)
        }
        layoutParams = lp
        if (isOpen) reportCoverage()
    }

    fun setTitle(t: String) { titleView.text = t }

    private var imeInset = 0
    /** Keep content scrollable above the on-screen keyboard. */
    fun setImeInset(px: Int) {
        if (px == imeInset) return
        imeInset = px
        if (px > 0 && isOpen && dock == Dock.BOTTOM) expand()
        body.getChildAt(0)?.let { it.setPadding(it.paddingLeft, it.paddingTop, it.paddingRight, dp(28) + px) }
    }

    fun setActions(views: List<View>) {
        headerActions.removeAllViews()
        for (v in views) headerActions.addView(v, lp(WRAP, WRAP))
    }

    /** Optional page switcher shown under the title. */
    fun setPages(pages: List<String>?, selected: Int, onSelect: (Int) -> Unit) {
        segHolder.removeAllViews()
        segmented = null
        if (pages == null || pages.size < 2) { segHolder.visibility = GONE; return }
        segHolder.visibility = VISIBLE
        val s = Segmented(context, pages, selected).apply { this.onSelect = onSelect }
        segmented = s
        segHolder.addView(s, LayoutParams(MATCH, WRAP))
    }

    fun setContent(v: View, keepScroll: Boolean = false) {
        val y = body.scrollY
        body.removeAllViews()
        v.setPadding(dp(16), dp(6), dp(16), dp(28) + imeInset)
        body.addView(v, LayoutParams(MATCH, WRAP))
        if (keepScroll) body.post { body.scrollTo(0, y) } else body.scrollTo(0, 0)
    }

    fun open() {
        animate().cancel()
        if (isOpen && visibility == VISIBLE) return
        isOpen = true
        visibility = VISIBLE
        anim?.cancel()
        if (dock == Dock.BOTTOM) {
            height0 = height0.takeIf { it >= dp(160) } ?: mediumH
            (layoutParams as LayoutParams).height = height0
            requestLayout()
        }
        announceForAccessibility("${titleView.text} panel opened")
        if (Theme.reduceMotion) { translationX = 0f; translationY = 0f; reportCoverage(); return }
        if (dock == Dock.BOTTOM) {
            if (translationY == 0f) translationY = height0.toFloat()
            animate().translationY(0f).setDuration(260).setInterpolator(DecelerateInterpolator(2f))
                .setUpdateListener { reportCoverage() }.withEndAction { reportCoverage() }.start()
        } else {
            if (translationX == 0f) translationX = (sideWidth + rightInset).toFloat()
            animate().translationX(0f).setDuration(240).setInterpolator(DecelerateInterpolator(2f))
                .setUpdateListener { reportCoverage() }.withEndAction { reportCoverage() }.start()
        }
    }

    fun close() {
        if (!isOpen) return
        isOpen = false
        animate().cancel()
        val end = Runnable { visibility = GONE; translationX = 0f; translationY = 0f; reportCoverage(); onClosed?.invoke() }
        if (Theme.reduceMotion) { end.run(); return }
        if (dock == Dock.BOTTOM) animate().translationY(height0.toFloat()).setDuration(200).setUpdateListener { reportCoverage() }.withEndAction(end).start()
        else animate().translationX((sideWidth + rightInset).toFloat()).setDuration(200).setUpdateListener { reportCoverage() }.withEndAction(end).start()
    }

    fun expand() = snapTo(largeH)
    fun collapse() = snapTo(mediumH)

    private fun reportCoverage() {
        if (visibility != VISIBLE) { onCoverageChanged?.invoke(0, 0); return }
        if (dock == Dock.BOTTOM) onCoverageChanged?.invoke(max(0, (height0 - translationY).toInt()), 0)
        else onCoverageChanged?.invoke(0, max(0, (sideWidth + rightInset - translationX).toInt()))
    }

    private fun setHeight(h: Int) {
        height0 = h.coerceIn(dp(120), largeH)
        (layoutParams as LayoutParams).height = height0
        requestLayout()
        reportCoverage()
    }

    private fun snapTo(target: Int) {
        anim?.cancel()
        val start = height0
        if (Theme.reduceMotion) { setHeight(target); return }
        anim = ValueAnimator.ofInt(start, target).setDuration(220).apply {
            interpolator = DecelerateInterpolator(2f)
            addUpdateListener { setHeight(it.animatedValue as Int) }
            start()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun installDrag(v: View) {
        var downY = 0f; var startH = 0; var dragging = false; var lastY = 0f; var lastT = 0L; var vel = 0f
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        v.setOnTouchListener { _, e ->
            if (dock != Dock.BOTTOM) return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downY = e.rawY; lastY = e.rawY; lastT = e.eventTime; startH = height0; dragging = false; anim?.cancel(); true }
                MotionEvent.ACTION_MOVE -> {
                    val dy = e.rawY - downY
                    if (!dragging && abs(dy) > slop) dragging = true
                    if (dragging) {
                        val dt = (e.eventTime - lastT).coerceAtLeast(1)
                        vel = (e.rawY - lastY) / dt
                        lastY = e.rawY; lastT = e.eventTime
                        setHeight((startH - dy).toInt())
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        val fling = vel * 1000f // px/s, + = down
                        when {
                            fling > dp(1200f) && height0 < mediumH + dp(40) -> close()
                            height0 < mediumH * 0.62f -> close()
                            fling > dp(900f) -> snapTo(mediumH)
                            fling < -dp(900f) -> snapTo(largeH)
                            abs(height0 - mediumH) < abs(height0 - largeH) -> snapTo(mediumH)
                            else -> snapTo(largeH)
                        }
                    } else if (e.actionMasked == MotionEvent.ACTION_UP && v === grabber) {
                        if (height0 < largeH - dp(10)) expand() else collapse()
                    }
                    dragging = false
                    true
                }
                else -> false
            }
        }
        if (v === grabber) {
            v.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
            v.contentDescription = "Resize panel"
            v.setOnClickListener { if (height0 < largeH - dp(10)) expand() else collapse() }
        }
    }
}

/**
 * Bottom mode switcher (Object · Sculpt · Paint · Edit · Animate). Each item is its own
 * accessible tab.
 */
@SuppressLint("ViewConstructor")
class ModeBar(ctx: Context, private val items: List<Pair<Icon, String>>) : LinearLayout(ctx) {
    var selected = 0
        set(v) { field = v; for (i in 0 until childCount) getChildAt(i).invalidate(); animatePill() }
    var onSelect: ((Int) -> Unit)? = null
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
    private val r = RectF()
    private var pillX = -1f

    init {
        orientation = HORIZONTAL
        setWillNotDraw(false)
        background = glassBackground(22f)
        setPadding(dp(4), dp(4), dp(4), dp(4))
        items.forEachIndexed { i, _ -> addView(Item(ctx, i), LayoutParams(0, LayoutParams.MATCH_PARENT, 1f)) }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val h = (dp(26f) + sp(10.5f) + dp(20f)).toInt()
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    }

    private fun itemW() = (width - paddingLeft - paddingRight).toFloat() / items.size

    private fun animatePill() {
        val target = paddingLeft + selected * itemW()
        if (pillX < 0f || Theme.reduceMotion || width == 0) { pillX = target; invalidate(); return }
        val start = pillX
        ValueAnimator.ofFloat(0f, 1f).setDuration(240).apply {
            interpolator = DecelerateInterpolator(2f)
            addUpdateListener { pillX = start + (target - start) * (it.animatedValue as Float); invalidate() }
            start()
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); pillX = paddingLeft + selected * itemW() }

    override fun onDraw(c: Canvas) {
        val iw = itemW()
        if (pillX < 0f) pillX = paddingLeft + selected * iw
        r.set(pillX + dp(2f), paddingTop.toFloat(), pillX + iw - dp(2f), (height - paddingBottom).toFloat())
        bg.color = Theme.withAlpha(Theme.accent, 0.95f)
        c.drawRoundRect(r, dp(17f), dp(17f), bg)
    }

    private inner class Item(ctx: Context, val index: Int) : PressableView(ctx) {
        private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = Theme.medium }
        override val a11yClass = "android.widget.TabWidget"
        init { describe(items[index].second); onClick = { if (selected != index) { selected = index; onSelect?.invoke(index) } } }
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            val sel = index == selected
            val col = if (sel) Color.WHITE else Theme.TEXT_DIM
            Icons.draw(c, items[index].first, w / 2, h / 2 - sp(6f), dp(22f), col)
            tp.color = col; tp.textSize = sp(10.5f)
            c.drawText(TextUtils.ellipsize(items[index].second, tp, w - dp(4f), TextUtils.TruncateAt.END).toString(), w / 2, h / 2 + dp(11f) + sp(5f), tp)
        }
        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.isSelected = index == selected
            info.contentDescription = "${items[index].second} mode, ${index + 1} of ${items.size}"
        }
    }
}

/** One-time coach mark: a short tip with a "Got it" button. */
@SuppressLint("ViewConstructor")
class HintBubble(ctx: Context) : LinearLayout(ctx) {
    private val text = ctx.label("", 13.5f, Theme.TEXT)
    private val icon = object : View(ctx) {
        var ic = Icon.INFO
        override fun onDraw(c: Canvas) = Icons.draw(c, ic, width / 2f, height / 2f, dp(20f), Theme.accentLight())
    }
    private val ok = PillButton(ctx, "Got it", style = PillButton.Style.TINTED)
    var onDismiss: (() -> Unit)? = null

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = Theme.rounded(0xF2242429.toInt(), 18f, 0x2AFFFFFF, 1f)
        elevation = dp(10f)
        setPadding(dp(14), dp(8), dp(8), dp(8))
        addView(icon, LayoutParams(dp(26), dp(26)))
        text.setLineSpacing(0f, 1.15f)
        addView(text, LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10); rightMargin = dp(8) })
        addView(ok, LayoutParams(WRAP, dp(40)))
        ok.onClick = { hide() }
        visibility = GONE
        accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
    }

    fun show(ic: Icon, msg: String) {
        icon.ic = ic; icon.invalidate()
        text.text = msg
        visibility = VISIBLE
        alpha = 0f; translationY = dp(10f)
        animate().alpha(1f).translationY(0f).setDuration(Theme.anim(220)).start()
        if (Theme.reduceMotion) { alpha = 1f; translationY = 0f }
    }

    fun hide() {
        if (visibility != VISIBLE) return
        animate().alpha(0f).setDuration(Theme.anim(160)).withEndAction { visibility = GONE; onDismiss?.invoke() }.start()
        if (Theme.reduceMotion) { visibility = GONE; onDismiss?.invoke() }
    }
}

/** Small round floating button used on the viewport (rail, quick actions). */
fun Context.railButton(icon: Icon, label: String, onClick: () -> Unit) = IconButton(this, icon, label, 44).apply {
    compactLabel = true
    this.onClick = onClick
}
