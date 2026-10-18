package app.glbandme.ui

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.SceneIO
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.Texture
import app.glbandme.core.sculpt.Picking
import app.glbandme.data.FileIO
import app.glbandme.data.ProjectMeta
import app.glbandme.data.ProjectStore
import app.glbandme.data.ShareProvider
import app.glbandme.editor.AddPanel
import app.glbandme.editor.AnimatePanel
import app.glbandme.editor.BrushPanel
import app.glbandme.editor.Change
import app.glbandme.editor.ContextStrip
import app.glbandme.editor.Editor
import app.glbandme.editor.ExportSheet
import app.glbandme.editor.LayersPanel
import app.glbandme.editor.MaterialPanel
import app.glbandme.editor.MeshPanel
import app.glbandme.editor.ObjectPanel
import app.glbandme.editor.Overlay
import app.glbandme.editor.Panel
import app.glbandme.editor.RenderPanel
import app.glbandme.editor.Timeline
import app.glbandme.editor.Tool
import app.glbandme.editor.Viewport
import app.glbandme.ui.Theme.dp
import kotlin.math.roundToInt

/** Workspace modes – each one is a focused set of tools (like Nomad's / Procreate's menus). */
enum class Mode(val label: String, val icon: Icon) {
    OBJECT("Object", Icon.CUBE), SCULPT("Sculpt", Icon.CLAY), PAINT("Paint", Icon.BRUSH), EDIT("Edit", Icon.POLYGON), ANIMATE("Animate", Icon.ANIMATE)
}

/** The modeling / sculpting workspace. */
class EditorActivity : BaseActivity() {
    companion object {
        const val EXTRA_ID = "project_id"
        const val EXTRA_WARNINGS = "warnings"
        const val EXTRA_ACTION = "action"
        const val ACTION_TEXT = "text"
        const val ACTION_DRAW = "draw"
        const val ACTION_ADD = "add"
        private const val REQ_IMPORT = 11
        private const val REQ_EXPORT = 12
        private const val REQ_IMAGE = 13
        private const val REQ_SAVE_PNG = 14
        private const val REQ_FONT = 15
        const val INSPECT_OBJECT = 0
        const val INSPECT_MATERIAL = 1
        const val INSPECT_MESH = 2
    }

    override val rebuildOnThemeChange = false
    lateinit var editor: Editor; private set
    lateinit var viewport: Viewport; private set
    lateinit var overlay: Overlay; private set
    private lateinit var store: ProjectStore
    private var meta: ProjectMeta? = null
    private lateinit var root: FrameLayout

    // chrome
    private lateinit var topBar: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var undoBtn: IconButton
    private lateinit var redoBtn: IconButton
    private lateinit var eyeBtn: IconButton
    private lateinit var rail: LinearLayout
    private val railButtons = LinkedHashMap<String, IconButton>()
    private lateinit var leftColumn: LinearLayout
    private lateinit var radiusSlider: VSlider
    private lateinit var intensitySlider: VSlider
    private lateinit var negButton: IconButton
    private lateinit var symButton: IconButton
    lateinit var strip: ContextStrip; private set
    private lateinit var stripScroll: HorizontalScrollView
    private lateinit var modeBar: ModeBar
    private lateinit var hint: HintBubble
    lateinit var sheet: SheetHost; private set
    private lateinit var statusView: TextView
    private lateinit var placementBar: LinearLayout
    private lateinit var placementText: TextView
    var timeline: Timeline? = null; private set

    var mode = Mode.OBJECT; private set
    private var lastSculptTool = Tool.CLAY
    private var chromeHidden = false
    private var lastInsets = Insets(0, 0, 0, 0)
    private var topLimit = 0
    private var landscape = false

    // sheet state
    private var sheetKey: String? = null
    private var sheetPages: List<Pair<String, () -> Panel>> = emptyList()
    private var sheetPage = 0
    private var panel: Panel? = null
    val currentPanel: Panel? get() = panel

    // pending actions for activity results
    private var pendingExport: Pair<ByteArray, String>? = null
    private var pendingPng: Bitmap? = null
    var imageCallback: ((Texture) -> Unit)? = null
    var importCallback: ((Uri) -> Unit)? = null
    var fontCallback: ((Uri) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ProjectStore(this)
        root = FrameLayout(this).apply { setBackgroundColor(Theme.BG) }
        setContentView(root)
        trackInsets(root)
        val id = intent.getStringExtra(EXTRA_ID)
        if (id == null) { finish(); return }
        val loading = Dialogs.progress(this, "Opening project…")
        async({ store.meta(id) to store.load(id) }, onError = { loading.dismiss(); showError(it); root.postDelayed({ finish() }, 2500) }) { (m, scene) ->
            loading.dismiss()
            meta = m
            setup(scene)
            intent.getStringExtra(EXTRA_WARNINGS)?.takeIf { it.isNotBlank() }?.let { Dialogs.message(this, "Imported with notes", it) }
            val action = intent.getStringExtra(EXTRA_ACTION)
            intent.removeExtra(EXTRA_ACTION)
            root.postDelayed({
                when (action) {
                    ACTION_TEXT -> app.glbandme.editor.TextStudio.create(this, "Title")
                    ACTION_DRAW -> app.glbandme.editor.ShapeStudio.show(this)
                    ACTION_ADD -> openAdd()
                }
            }, 350)
        }
    }

    private fun setup(scene: Scene) {
        editor = Editor(scene)
        editor.undo.maxSteps = Prefs.of(this).undoSteps
        viewport = Viewport(this, editor, Prefs.of(this).msaa)
        overlay = Overlay(this, viewport)
        viewport.overlay = overlay
        viewport.onStatus = { s -> status(s) }
        root.addView(viewport, flp(MATCH, MATCH))
        root.addView(overlay, flp(MATCH, MATCH))
        buildChrome()
        editor.addListener { c -> onChanged(c) }
        onInsets { layoutChrome(it) }
        root.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or2, ob -> if (r - l != or2 - ol || b - t != ob - ot) root.post { layoutChrome(lastInsets) } }
        mode = modeFor(editor.tool)
        if (editor.tool.isBrush && editor.tool != Tool.PAINT) lastSculptTool = editor.tool
        modeBar.selected = mode.ordinal
        refreshTool()
        refreshUndo()
        updateTitle()
        root.post { maybeHint() }
    }

    private fun modeFor(t: Tool): Mode = when {
        t == Tool.PAINT -> Mode.PAINT
        t == Tool.SELECT -> Mode.EDIT
        t.isBrush -> Mode.SCULPT
        timeline != null -> Mode.ANIMATE
        else -> Mode.OBJECT
    }

    // =========================================================================================
    // chrome
    // =========================================================================================
    private fun buildChrome() {
        // --- top bar ---------------------------------------------------------------------------
        topBar = hbox().apply { background = glassBackground(20f); setPadding(dp(4), dp(2), dp(6), dp(2)); gravity = Gravity.CENTER_VERTICAL }
        topBar.addView(IconButton(this, Icon.BACK).apply { describe("Back to projects"); onClick = { leave() } })
        titleView = label("", 15.5f, Theme.TEXT, bold = true).apply {
            setPadding(dp(4), 0, dp(4), 0)
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setCompoundDrawablePadding(dp(4))
            isClickable = true; isFocusable = true
            contentDescription = "Project menu"
            setOnClickListener { projectMenu() }
        }
        topBar.addView(titleView, lp(0, WRAP, 1f))
        undoBtn = IconButton(this, Icon.UNDO).apply { describe("Undo"); onClick = { editor.undo.undo()?.let { status("Undo $it", 900) } }; onLongClick = { showHistory() } }
        redoBtn = IconButton(this, Icon.REDO).apply { describe("Redo"); onClick = { editor.undo.redo()?.let { status("Redo $it", 900) } } }
        eyeBtn = IconButton(this, Icon.EYE).apply { describe("Hide interface"); onClick = { setChromeHidden(!chromeHidden) } }
        topBar.addView(undoBtn); topBar.addView(redoBtn); topBar.addView(eyeBtn)
        topBar.addView(PillButton(this, "Export", Icon.EXPORT, PillButton.Style.PRIMARY).apply { onClick = { ExportSheet.show(this@EditorActivity) } },
            LinearLayout.LayoutParams(WRAP, dp(40)).apply { leftMargin = dp(4) })
        root.addView(topBar, flp(WRAP, WRAP))

        // --- right rail ----------------------------------------------------------------------------
        rail = vbox().apply { background = glassBackground(20f); setPadding(dp(3), dp(4), dp(3), dp(4)); gravity = Gravity.CENTER_HORIZONTAL }
        fun railBtn(key: String, icon: Icon, label: String, open: () -> Unit) {
            val b = railButton(icon, label) { if (sheetKey == key && sheet.isOpen) closeSheet() else open() }
            railButtons[key] = b
            rail.addView(b, LinearLayout.LayoutParams(dp(50), WRAP))
        }
        railBtn("layers", Icon.LAYERS, "Layers") { openLayers() }
        railBtn("add", Icon.PLUS, "Add") { openAdd() }
        railBtn("inspect", Icon.SLIDERS, "Inspect") { openInspector(sheetPage.takeIf { sheetKey == "inspect" } ?: INSPECT_OBJECT) }
        railBtn("view", Icon.SUN, "View") { openView() }
        root.addView(rail, flp(WRAP, WRAP))

        // --- brush sliders ---------------------------------------------------------------------------
        leftColumn = vbox(0, 8).apply { gravity = Gravity.CENTER_HORIZONTAL }
        radiusSlider = VSlider(this, "Size", 4f, 300f, 60f) { "${it.roundToInt()}" }.apply {
            onChange = { v -> editor.currentBrush?.radiusPx = v; if (editor.tool == Tool.SELECT) viewport.selectRadiusPx = v; previewBrush(v) }
            onRelease = { this@EditorActivity.overlay.brush(0f, 0f, 0f, false) }
        }
        intensitySlider = VSlider(this, "Strength", 0f, 1f, 0.5f).apply { onChange = { v -> editor.currentBrush?.intensity = v } }
        negButton = IconButton(this, Icon.MINUS, sizeDp = 40).apply {
            filled = true; describe("Subtract")
            onClick = {
                if (editor.tool == Tool.SELECT) { viewport.selectNegative = !viewport.selectNegative; active = viewport.selectNegative; status(if (active) "Deselect brush" else "Select brush", 800) }
                else editor.currentBrush?.let { it.negative = !it.negative; active = it.negative; status(if (active) "Subtract" else "Add", 700) }
            }
        }
        symButton = IconButton(this, Icon.SYMMETRY, sizeDp = 40).apply {
            filled = true; describe("Mirror symmetry")
            onClick = { val on = !editor.symmetry(0); editor.setSymmetry(0, on); active = on; status(if (on) "Symmetry X on" else "Symmetry off", 900) }
        }
        for (v in listOf(radiusSlider, intensitySlider, negButton, symButton)) leftColumn.addView(v, LinearLayout.LayoutParams(dp(44), WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL })
        root.addView(leftColumn, flp(dp(48), WRAP))

        // --- context strip + mode bar ------------------------------------------------------------
        strip = ContextStrip(this)
        stripScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; background = glassBackground(20f); addView(strip) }
        root.addView(stripScroll, flp(WRAP, WRAP))
        modeBar = ModeBar(this, Mode.values().map { it.icon to it.label }).apply { onSelect = { i -> setMode(Mode.values()[i]) } }
        root.addView(modeBar, flp(WRAP, WRAP))

        hint = HintBubble(this)
        root.addView(hint, flp(WRAP, WRAP))

        // --- placement banner (sticker / text placing) ---------------------------------------------
        placementBar = hbox().apply { background = Theme.rounded(0xF2242429.toInt(), 18f, Theme.withAlpha(Theme.accent, 0.6f), 1.5f); setPadding(dp(14), dp(6), dp(6), dp(6)); gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE; elevation = dp(10f) }
        placementText = label("", 14f, Theme.TEXT, bold = true)
        placementBar.addView(placementText, lp(0, WRAP, 1f))
        placementBar.addView(PillButton(this, "Cancel", style = PillButton.Style.GHOST).apply { onClick = { endPlacement() } }, LinearLayout.LayoutParams(WRAP, dp(40)))
        root.addView(placementBar, flp(WRAP, WRAP))

        // --- sheet ---------------------------------------------------------------------------------
        sheet = SheetHost(this)
        sheet.onClosed = { panel?.onClosed(); panel = null; sheetKey = null; refreshRail() }
        sheet.onCoverageChanged = { b, r -> applyCoverage(b, r) }
        root.addView(sheet, flp(MATCH, WRAP))

        statusView = label("", 13.5f, Theme.TEXT, bold = true).apply {
            background = Theme.rounded(0xF2242429.toInt(), 14f)
            setPadding(dp(14), dp(8), dp(14), dp(8)); visibility = View.GONE
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        root.addView(statusView, flp(WRAP, WRAP, Gravity.CENTER_HORIZONTAL))
    }

    /** Hide everything except the top bar to look at the model unobstructed. */
    private fun setChromeHidden(hidden: Boolean) {
        chromeHidden = hidden
        if (hidden) closeSheet()
        val vis = if (hidden) View.GONE else View.VISIBLE
        rail.visibility = vis
        stripScroll.visibility = vis
        modeBar.visibility = vis
        timeline?.visibility = vis
        if (hidden) { leftColumn.visibility = View.GONE; hint.visibility = View.GONE } else refreshTool()
        overlay.hideHud = hidden
        viewport.gizmo.suppressed = hidden
        eyeBtn.icon = if (hidden) Icon.EYE_OFF else Icon.EYE
        eyeBtn.describe(if (hidden) "Show interface" else "Hide interface")
        viewport.requestRender()
        overlay.invalidate()
        status(if (hidden) "Interface hidden – tap the eye to bring it back" else null, if (hidden) 1600 else 0)
    }

    private fun layoutChrome(i: Insets) {
        lastInsets = i
        val m = dp(8)
        val w = root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val h = root.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        landscape = w > h
        val left = Theme.leftHanded
        val top = i.top + m
        (topBar.layoutParams as FrameLayout.LayoutParams).apply { width = MATCH; leftMargin = i.left + m; rightMargin = i.right + m; topMargin = top; gravity = Gravity.TOP }
        topLimit = top + dp(48) + m
        // bottom stack: mode bar, then strip, then timeline / hint
        val barW = minOf(w - i.left - i.right - 2 * m, dp(520))
        val modeH = (dp(26f) + Theme.sp(10.5f) + dp(20f)).toInt()
        (modeBar.layoutParams as FrameLayout.LayoutParams).apply { width = barW; height = modeH; gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; bottomMargin = i.bottom + m }
        val stripBottom = i.bottom + m + modeH + dp(8)
        (stripScroll.layoutParams as FrameLayout.LayoutParams).apply { width = WRAP; gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; bottomMargin = stripBottom; leftMargin = i.left + m; rightMargin = i.right + m }
        val stripH = dp(64)
        var above = stripBottom + stripH + dp(8)
        timeline?.let { tl ->
            (tl.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; width = minOf(w - i.left - i.right - 2 * m, dp(720)); height = dp(96); bottomMargin = above }
            above += dp(96) + dp(8)
        }
        (hint.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; width = minOf(w - i.left - i.right - 2 * m, dp(480)); bottomMargin = above }
        (placementBar.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; width = minOf(w - 2 * m, dp(460)); topMargin = topLimit + dp(4) }
        // rail & sliders
        (rail.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.TOP or (if (left) Gravity.START else Gravity.END); topMargin = topLimit; leftMargin = i.left + m; rightMargin = i.right + m }
        (leftColumn.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.TOP or (if (left) Gravity.END else Gravity.START); topMargin = topLimit + dp(24); leftMargin = i.left + m; rightMargin = i.right + m }
        (statusView.layoutParams as FrameLayout.LayoutParams).apply { topMargin = topLimit + dp(6) }
        sheet.layoutIn(w, h, i, topLimit, landscape)
        sheet.setImeInset(i.ime)
        // overlay HUD
        val railW = dp(56)
        overlay.navCx = if (left) (i.left + m + railW + dp(52)).toFloat() else (w - i.right - m - railW - dp(52)).toFloat()
        overlay.navCy = (topLimit + dp(48)).toFloat()
        overlay.statsX = (i.left + dp(14)).toFloat()
        overlay.statsY = (h - above + dp(2)).toFloat()
        root.requestLayout()
        overlay.invalidate()
    }

    /** Keep the model centred in the part of the viewport the sheet leaves visible. */
    private fun applyCoverage(bottom: Int, right: Int) {
        val h = root.height.toFloat().coerceAtLeast(1f); val w = root.width.toFloat().coerceAtLeast(1f)
        val sy = if (bottom > 0) {
            val visTop = topLimit.toFloat(); val visBottom = h - bottom
            val center = (visTop + visBottom) / 2f
            ((h / 2f - center) / (h / 2f)).coerceIn(0f, 0.9f)
        } else 0f
        val sx = if (right > 0) -(right / w) else 0f
        viewport.viewShiftY = sy
        viewport.viewShiftX = if (Theme.leftHanded) 0f else sx
        // move the rail / navigator out from under a side sheet
        val shift = if (sheet.dock == SheetHost.Dock.SIDE && !Theme.leftHanded) -right.toFloat() else 0f
        rail.translationX = shift
        overlay.navShiftX = shift
        overlay.invalidate()
    }

    private fun refreshRail() { for ((k, b) in railButtons) b.active = sheet.isOpen && k == sheetKey }

    // =========================================================================================
    // modes & tools
    // =========================================================================================
    fun setMode(m: Mode) {
        if (m == mode && editor.tool == toolFor(m)) return
        val prev = mode
        mode = m
        modeBar.selected = m.ordinal
        endPlacement()
        if (prev == Mode.ANIMATE && m != Mode.ANIMATE) showTimeline(false)
        editor.setTool(toolFor(m))
        if (m == Mode.ANIMATE) showTimeline(true)
        if (editor.scene.selected == null && (m == Mode.SCULPT || m == Mode.PAINT || m == Mode.EDIT)) status("Tap an object to select it first", 1400)
        modeBar.announceForAccessibility("${m.label} mode")
        maybeHint()
    }

    private fun toolFor(m: Mode): Tool = when (m) {
        Mode.OBJECT, Mode.ANIMATE -> Tool.TRANSFORM
        Mode.SCULPT -> lastSculptTool
        Mode.PAINT -> Tool.PAINT
        Mode.EDIT -> Tool.SELECT
    }

    fun selectTool(t: Tool) {
        if (t.isBrush && t != Tool.PAINT) lastSculptTool = t
        val m = when { t == Tool.PAINT -> Mode.PAINT; t == Tool.SELECT -> Mode.EDIT; t.isBrush -> Mode.SCULPT; mode == Mode.ANIMATE -> Mode.ANIMATE; else -> Mode.OBJECT }
        if (m != mode) { setMode(m); if (editor.tool != t) editor.setTool(t) } else editor.setTool(t)
    }

    private fun refreshTool() {
        val t = editor.tool
        val brush = editor.currentBrush
        val showLeft = (brush != null || t == Tool.SELECT) && !chromeHidden
        leftColumn.visibility = if (showLeft) View.VISIBLE else View.GONE
        if (brush != null) {
            radiusSlider.value = brush.radiusPx
            intensitySlider.visibility = View.VISIBLE
            intensitySlider.value = brush.intensity
            negButton.active = brush.negative
            symButton.visibility = View.VISIBLE
            symButton.active = editor.symmetry(0)
        } else if (t == Tool.SELECT) {
            radiusSlider.value = viewport.selectRadiusPx
            intensitySlider.visibility = View.GONE
            negButton.active = viewport.selectNegative
            symButton.visibility = View.GONE
        }
        strip.rebuild()
    }

    fun refreshToolUi() = refreshTool()

    /** Run a slow mesh operation off the UI thread behind a progress dialog. */
    fun heavy(msg: String, work: () -> Unit) {
        val d = Dialogs.progress(this, msg)
        async({ work() }, onError = { d.dismiss(); showError(it) }) { d.dismiss() }
    }

    fun <T> heavyResult(msg: String, work: () -> T, done: (T) -> Unit) {
        val d = Dialogs.progress(this, msg)
        async({ work() }, onError = { d.dismiss(); showError(it) }) { r -> d.dismiss(); done(r) }
    }

    private fun previewBrush(r: Float) { overlay.brush(root.width / 2f, root.height / 2f, r, true) }

    private fun maybeHint() {
        val p = Prefs.of(this)
        if (!p.showHints || chromeHidden) { hint.visibility = View.GONE; return }
        val key = "mode_${mode.name.lowercase()}"
        if (p.hintSeen(key)) { hint.hide(); return }
        val (ic, msg) = when (mode) {
            Mode.OBJECT -> Icon.HAND to "Tap a shape to select it, then drag the arrows to move it. One finger orbits · two fingers pan & zoom · double-tap to frame."
            Mode.SCULPT -> Icon.CLAY to "Drag across the model to sculpt. Size and strength are on the side; tap with two fingers to undo."
            Mode.PAINT -> Icon.BRUSH to "Paint colour straight onto the surface. Fill colours the whole object; textures live in Inspect › Material."
            Mode.EDIT -> Icon.POLYGON to "Brush over faces to select them, then Extrude, Inset or give them their own material and texture."
            Mode.ANIMATE -> Icon.ANIMATE to "Move the playhead, pose the object, then tap ◆ to add a keyframe. Turntable makes a 360° spin."
        }
        hint.onDismiss = { p.markHint(key) }
        hint.show(ic, msg)
    }

    // =========================================================================================
    // sheets
    // =========================================================================================
    /** Open a (possibly multi-page) panel in the sheet. */
    fun openSheet(key: String, title: String, pages: List<Pair<String, () -> Panel>>, page: Int = 0) {
        panel?.onClosed()
        sheetKey = key
        sheetPages = pages
        sheetPage = page.coerceIn(0, pages.size - 1)
        sheet.setTitle(title)
        sheet.setPages(if (pages.size > 1) pages.map { it.first } else null, sheetPage) { i -> switchPage(i) }
        panel = pages[sheetPage].second()
        sheet.setActions(panel!!.headerActions())
        sheet.setContent(panel!!.build())
        sheet.open()
        refreshRail()
        hint.hide()
    }

    /** Single panel convenience. */
    fun openPanel(key: String, p: Panel) = openSheet(key, p.title, listOf(p.title to { p }))

    private fun switchPage(i: Int) {
        panel?.onClosed()
        sheetPage = i
        panel = sheetPages[i].second()
        sheet.setActions(panel!!.headerActions())
        sheet.setContent(panel!!.build())
    }

    fun rebuildPanel() {
        val p = panel ?: return
        sheet.setActions(p.headerActions())
        sheet.setContent(p.build(), keepScroll = true)
    }

    fun closeSheet() = sheet.close()
    fun closePanel() = closeSheet()

    fun openLayers() = openSheet("layers", "Layers", listOf("Layers" to { LayersPanel(this) }))
    fun openAdd() = openSheet("add", "Add", listOf("Add" to { AddPanel(this) }))
    fun openView() = openSheet("view", "View", listOf("View" to { RenderPanel(this) }))
    fun openInspector(page: Int = INSPECT_OBJECT) = openSheet("inspect", "Inspect", listOf(
        "Object" to { ObjectPanel(this) }, "Material" to { MaterialPanel(this) }, "Mesh" to { MeshPanel(this) }
    ), page)
    fun openBrushOptions() = openPanel("brush", BrushPanel(this))
    fun openAnimationSettings() = openPanel("anim", AnimatePanel(this))

    private fun showTimeline(show: Boolean) {
        if (show && timeline == null) {
            val tl = Timeline(this, editor)
            timeline = tl
            root.addView(tl, root.indexOfChild(stripScroll), flp(MATCH, dp(96), Gravity.BOTTOM))
        } else if (!show) {
            timeline?.let { stopPlayback(); root.removeView(it) }
            timeline = null
        }
        layoutChrome(lastInsets)
    }

    // =========================================================================================
    // placement (tap-on-model flows: stickers, text, shapes)
    // =========================================================================================
    fun beginPlacement(message: String, onHit: (Picking.SceneHit?, Float, Float) -> Boolean) {
        placementText.text = message
        placementBar.visibility = View.VISIBLE
        placementBar.announceForAccessibility(message)
        closeSheet()
        viewport.tapInterceptor = { hit, x, y ->
            val done = onHit(hit, x, y)
            if (done) endPlacement()
            true
        }
    }

    fun endPlacement() {
        if (!::viewport.isInitialized) return
        viewport.tapInterceptor = null
        placementBar.visibility = View.GONE
    }

    // =========================================================================================
    // change handling
    // =========================================================================================
    private fun onChanged(c: Set<Change>) {
        if (Change.UNDO in c) refreshUndo()
        if (Change.TOOL in c) {
            val m = modeFor(editor.tool)
            if (editor.tool.isBrush && editor.tool != Tool.PAINT) lastSculptTool = editor.tool
            if (m != mode && !(mode == Mode.ANIMATE && editor.tool == Tool.TRANSFORM)) { mode = m; modeBar.selected = m.ordinal }
            refreshTool()
        } else if (Change.SELECTION in c || Change.EDIT_SELECTION in c || Change.OBJECTS in c) strip.rebuild()
        panel?.onChanged(c)
        timeline?.onChanged(c)
        overlay.invalidate()
    }

    private fun refreshUndo() {
        undoBtn.isEnabled = editor.undo.canUndo; undoBtn.invalidate()
        redoBtn.isEnabled = editor.undo.canRedo; redoBtn.invalidate()
    }

    private val hideStatus = Runnable { statusView.animate().alpha(0f).setDuration(Theme.anim(200)).withEndAction { statusView.visibility = View.GONE }.start() }

    fun status(text: String?, autoHideMs: Long = 0) {
        statusView.removeCallbacks(hideStatus)
        if (text == null) { statusView.visibility = View.GONE; return }
        statusView.text = text
        statusView.alpha = 1f
        statusView.visibility = View.VISIBLE
        if (autoHideMs > 0) statusView.postDelayed(hideStatus, autoHideMs)
    }

    private fun showHistory() {
        val items = ArrayList<MenuItem>()
        editor.undo.undoLabel?.let { items.add(MenuItem(Icon.UNDO, "Undo: $it") { editor.undo.undo() }) }
        editor.undo.redoLabel?.let { items.add(MenuItem(Icon.REDO, "Redo: $it") { editor.undo.redo() }) }
        items.add(MenuItem(Icon.TRASH, "Clear history", danger = true) { editor.undo.clear() })
        Dialogs.menu(this, "History", items)
    }

    // =========================================================================================
    // playback
    // =========================================================================================
    private var lastFrameNs = 0L
    private val frameCb = object : Choreographer.FrameCallback {
        override fun doFrame(now: Long) {
            if (!editor.playing) return
            val dt = if (lastFrameNs == 0L) 0f else (now - lastFrameNs) / 1e9f
            lastFrameNs = now
            var f = editor.scene.currentFrame + dt * editor.scene.fps
            if (f > editor.scene.frameCount) f = if (editor.loop) f % editor.scene.frameCount.coerceAtLeast(1) else { editor.playing = false; editor.scene.frameCount.toFloat() }
            editor.setFrame(f)
            if (editor.playing) Choreographer.getInstance().postFrameCallback(this)
            else timeline?.onChanged(setOf(Change.ANIMATION))
        }
    }

    fun togglePlayback() {
        if (editor.playing) stopPlayback() else {
            editor.playing = true; lastFrameNs = 0L
            Choreographer.getInstance().postFrameCallback(frameCb)
        }
        timeline?.onChanged(setOf(Change.ANIMATION))
    }

    fun stopPlayback() { editor.playing = false; Choreographer.getInstance().removeFrameCallback(frameCb) }

    // =========================================================================================
    // files
    // =========================================================================================
    private fun updateTitle() { titleView.text = (meta?.name ?: "Untitled") + "  ▾" }

    fun renameProject() {
        val m = meta ?: return
        Dialogs.prompt(this, "Rename project", m.name) { name -> m.name = name; store.rename(m.id, name); updateTitle() }
    }

    private fun projectMenu() {
        Dialogs.menu(this, meta?.name, listOf(
            MenuItem(Icon.SAVE, "Save", subtitle = "Projects also save automatically") { save(true) },
            MenuItem(Icon.EXPORT, "Export…", subtitle = "GLB · glTF · USDZ · OBJ · STL · PLY") { ExportSheet.show(this) },
            MenuItem(Icon.SHARE, "Share as GLB") { quickShare() },
            MenuItem(Icon.IMPORT, "Import into scene…", subtitle = "Merge another model file") { importIntoScene() },
            MenuItem(Icon.CAMERA, "Screenshot") { screenshot() },
            MenuItem(Icon.COPY, "Save as copy") { saveCopy() },
            MenuItem(Icon.PEN, "Rename project") { renameProject() },
            MenuItem(Icon.HELP, "Gestures & tips") { HelpSheet.show(this) },
            MenuItem(Icon.SETTINGS, "Settings") { startActivity(Intent(this, SettingsActivity::class.java)) },
        ))
    }

    /**
     * Persist the project. With [withThumb] the GL view renders a fresh thumbnail first (only
     * while the view is running – onPause saves without it because the GL thread stops).
     */
    fun save(feedback: Boolean, withThumb: Boolean = true, after: (() -> Unit)? = null) {
        val m = meta ?: return
        if (!::editor.isInitialized) return
        editor.dirty = false
        val write = { thumb: Bitmap? ->
            bg.execute {
                val r = runCatching { store.save(m, editor.scene, thumb) }
                ui {
                    r.onSuccess { if (feedback) status("Saved", 900) }.onFailure { editor.dirty = true; showError(it) }
                    after?.invoke()
                }
            }
        }
        if (withThumb) {
            var done = false
            val fallback = Runnable { if (!done) { done = true; write(null) } }
            root.postDelayed(fallback, 1500)
            viewport.capture(384, false) { thumb -> if (!done) { done = true; root.removeCallbacks(fallback); write(thumb) } }
        } else write(null)
    }

    private fun saveCopy() {
        val m = meta ?: return
        val progress = Dialogs.progress(this, "Saving copy…")
        async({ store.create(store.uniqueName("${m.name} copy"), editor.scene) }, onError = { progress.dismiss(); showError(it) }) { nm ->
            progress.dismiss()
            meta = nm; updateTitle(); save(false)
            status("Now editing “${nm.name}”", 1600)
        }
    }

    private fun quickShare() {
        val name = meta?.name ?: "model"
        val progress = Dialogs.progress(this, "Exporting GLB…")
        async({ editor.locked { SceneIO.export(editor.scene, ExportFormat.GLB, GltfExportOptions()) } }, onError = { progress.dismiss(); showError(it) }) { bytes ->
            progress.dismiss()
            ShareProvider.share(this, "$name.glb", bytes, "Share model")
        }
    }

    /** Called by the export sheet: ask where to save. */
    fun saveExport(bytes: ByteArray, fileName: String, mime: String) {
        pendingExport = bytes to fileName
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = mime; putExtra(Intent.EXTRA_TITLE, fileName) }
        try { startActivityForResult(i, REQ_EXPORT) } catch (e: Exception) { ShareProvider.share(this, fileName, bytes) }
    }

    fun exportBaseName() = meta?.name ?: "model"

    fun importIntoScene(cb: ((Uri) -> Unit)? = null) {
        importCallback = cb
        try { startActivityForResult(SceneFactory.importIntent(), REQ_IMPORT) } catch (e: Exception) { showError(e) }
    }

    fun pickImage(cb: (Texture) -> Unit) {
        imageCallback = cb
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "image/*" }
        try { startActivityForResult(i, REQ_IMAGE) } catch (e: Exception) { showError(e) }
    }

    fun pickFont(cb: (Uri) -> Unit) {
        fontCallback = cb
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("font/ttf", "font/otf", "font/sfnt", "application/x-font-ttf", "application/x-font-otf", "application/font-sfnt", "application/vnd.ms-opentype", "application/octet-stream"))
        }
        try { startActivityForResult(i, REQ_FONT) } catch (e: Exception) { showError(e) }
    }

    fun screenshot() {
        val content = vbox()
        val trans = ToggleRow(this, "Transparent background", false)
        val size = Segmented(this, listOf("Screen", "1080", "2048", "4096"), 1)
        content.addView(size); content.addView(View(this), lp(MATCH, dp(10))); content.addView(trans)
        Dialogs.custom(this, "Screenshot", content, "Capture", "Cancel", onPositive = {
            val s = when (size.selected) { 0 -> 0; 1 -> 1080; 2 -> 2048; else -> 4096 }
            status("Rendering…")
            viewport.capture(s, trans.checked) { bmp ->
                status(null)
                pendingPng = bmp
                Dialogs.menu(this, "Screenshot ready", listOf(
                    MenuItem(Icon.SAVE, "Save PNG to device") {
                        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "image/png"; putExtra(Intent.EXTRA_TITLE, "${exportBaseName()}.png") }
                        startActivityForResult(i, REQ_SAVE_PNG)
                    },
                    MenuItem(Icon.SHARE, "Share") {
                        val out = java.io.ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                        ShareProvider.share(this, "${exportBaseName()}.png", out.toByteArray(), "Share image")
                    }
                ))
            }
            true
        })
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) { if (requestCode == REQ_EXPORT) pendingExport = null; return }
        when (requestCode) {
            REQ_EXPORT -> {
                val (bytes, _) = pendingExport ?: return
                pendingExport = null
                async({ FileIO.write(this, uri, bytes) }) { status("Exported ${Fmt.bytes(bytes.size.toLong())}", 1800) }
            }
            REQ_SAVE_PNG -> {
                val bmp = pendingPng ?: return
                pendingPng = null
                async({ contentResolver.openOutputStream(uri, "wt")!!.use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }) { status("Screenshot saved", 1500) }
            }
            REQ_FONT -> { val cb = fontCallback; fontCallback = null; cb?.invoke(uri) }
            REQ_IMPORT -> {
                val cb = importCallback
                importCallback = null
                if (cb != null) { cb(uri); return }
                val progress = Dialogs.progress(this, "Importing…")
                async({
                    val name = FileIO.displayName(this, uri)
                    SceneIO.import(name, FileIO.read(this, uri))
                }, onError = { progress.dismiss(); showError(it) }) { res ->
                    progress.dismiss()
                    if (res.objects.isEmpty()) { Dialogs.message(this, "Nothing imported", res.warnings.joinToString("\n").ifBlank { "No meshes found." }); return@async }
                    editor.addObjects(res.objects, "Import ${res.objects.size} object(s)")
                    if (res.objects.any { it.keys.isNotEmpty() }) editor.locked { editor.scene.frameCount = maxOf(editor.scene.frameCount, res.frameCount) }
                    viewport.frameSelection()
                    if (res.warnings.isNotEmpty()) Dialogs.message(this, "Imported with notes", res.warnings.joinToString("\n"))
                    else status("Imported ${res.objects.size} object(s)", 1400)
                }
            }
            REQ_IMAGE -> {
                val cb = imageCallback ?: return
                imageCallback = null
                async({
                    val bytes = FileIO.read(this, uri, 64L * 1024 * 1024)
                    TextureFactory.fromBytes(FileIO.displayName(this, uri) ?: "Image", bytes)
                }) { tex -> cb(tex) }
            }
        }
    }

    // =========================================================================================
    // lifecycle
    // =========================================================================================
    override fun onPause() {
        super.onPause()
        if (::viewport.isInitialized) {
            stopPlayback()
            if (editor.dirty && Prefs.of(this).autosave) save(false, withThumb = false)
            viewport.onPause()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::viewport.isInitialized) { viewport.onResume(); Theme.load(this); overlay.invalidate(); layoutChrome(lastInsets) }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::viewport.isInitialized) root.post { layoutChrome(lastInsets) }
    }

    private fun leave() {
        if (!::editor.isInitialized) { finish(); return }
        if (editor.dirty && Prefs.of(this).autosave) { save(false) { finish() }; return }
        if (editor.dirty) {
            Dialogs.confirm(this, "Save changes?", "Autosave is off. Save “${meta?.name}” before leaving?", "Save") { save(false) { finish() } }
            return
        }
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::viewport.isInitialized && viewport.tapInterceptor != null) { endPlacement(); return }
        if (::sheet.isInitialized && sheet.isOpen) { closeSheet(); return }
        if (chromeHidden) { setChromeHidden(false); return }
        leave()
    }
}
