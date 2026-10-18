package app.glbandme.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.SceneIO
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.Texture
import app.glbandme.core.sculpt.Falloff
import app.glbandme.data.FileIO
import app.glbandme.data.ProjectMeta
import app.glbandme.data.ProjectStore
import app.glbandme.data.ShareProvider
import app.glbandme.editor.AddPanel
import app.glbandme.editor.AnimatePanel
import app.glbandme.editor.Change
import app.glbandme.editor.Editor
import app.glbandme.editor.ExportSheet
import app.glbandme.editor.GizmoMode
import app.glbandme.editor.MaterialPanel
import app.glbandme.editor.MeshPanel
import app.glbandme.editor.Overlay
import app.glbandme.editor.Panel
import app.glbandme.editor.RenderPanel
import app.glbandme.editor.ScenePanel
import app.glbandme.editor.Timeline
import app.glbandme.editor.Tool
import app.glbandme.editor.Viewport
import app.glbandme.ui.Theme.dp
import kotlin.math.roundToInt

/** The modeling / sculpting workspace. */
class EditorActivity : BaseActivity() {
    companion object {
        const val EXTRA_ID = "project_id"
        const val EXTRA_WARNINGS = "warnings"
        private const val REQ_IMPORT = 11
        private const val REQ_EXPORT = 12
        private const val REQ_IMAGE = 13
        private const val REQ_SAVE_PNG = 14
    }

    lateinit var editor: Editor; private set
    lateinit var viewport: Viewport; private set
    private lateinit var overlay: Overlay
    private lateinit var store: ProjectStore
    private var meta: ProjectMeta? = null
    private lateinit var root: FrameLayout

    // chrome
    private lateinit var topBar: LinearLayout
    private lateinit var tabs: LinearLayout
    private lateinit var toolColumn: LinearLayout
    private lateinit var toolScroll: ScrollView
    private lateinit var leftColumn: LinearLayout
    private lateinit var bottomBar: LinearLayout
    private lateinit var bottomScroll: View
    private lateinit var panelCard: LinearLayout
    private lateinit var panelBody: ScrollView
    private lateinit var panelTitle: TextView
    private lateinit var statusView: TextView
    private lateinit var titleView: TextView
    private lateinit var undoBtn: IconButton
    private lateinit var redoBtn: IconButton
    private lateinit var radiusSlider: VSlider
    private lateinit var intensitySlider: VSlider
    private lateinit var negButton: IconButton
    private lateinit var symButton: IconButton
    var timeline: Timeline? = null; private set
    private val toolButtons = HashMap<Tool, IconButton>()
    private val tabButtons = LinkedHashMap<String, IconButton>()
    private var panel: Panel? = null
    private var panelKey: String? = null

    // pending actions for activity results
    private var pendingExport: Pair<ByteArray, String>? = null
    private var pendingPng: Bitmap? = null
    var imageCallback: ((Texture) -> Unit)? = null
    var importCallback: ((Uri) -> Unit)? = null

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
            if (!Prefs.of(this).seenTips) { Prefs.of(this).seenTips = true; root.postDelayed({ HelpSheet.show(this) }, 400) }
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
        refreshTool()
        refreshUndo()
        updateTitle()
    }

    // =========================================================================================
    // chrome
    // =========================================================================================
    private fun glass(radius: Float = 16f) = GradientDrawable().apply { setColor(0xE6161821.toInt()); cornerRadius = dp(radius); setStroke(1, 0x22FFFFFF) }

    private fun buildChrome() {
        // --- top bar -------------------------------------------------------------------------
        topBar = hbox().apply { background = glass(18f); setPadding(dp(4), dp(2), dp(4), dp(2)) }
        topBar.addView(IconButton(this, Icon.HOME).apply { onClick = { leave() } })
        titleView = label("", 15f, Theme.TEXT, bold = true).apply {
            setPadding(dp(4), 0, dp(6), 0)
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setOnClickListener { renameProject() }
        }
        topBar.addView(titleView, lp(0, WRAP, 1f))
        undoBtn = IconButton(this, Icon.UNDO).apply { onClick = { editor.undo.undo()?.let { status("Undo $it", 900) } }; onLongClick = { showHistory() } }
        redoBtn = IconButton(this, Icon.REDO).apply { onClick = { editor.undo.redo()?.let { status("Redo $it", 900) } } }
        topBar.addView(undoBtn); topBar.addView(redoBtn)
        topBar.addView(IconButton(this, Icon.SAVE).apply { onClick = { save(true) } })
        topBar.addView(IconButton(this, Icon.MORE).apply { onClick = { filesMenu() } })
        root.addView(topBar, flp(WRAP, WRAP))

        // --- menu tabs -----------------------------------------------------------------------
        tabs = hbox().apply { background = glass(16f); setPadding(dp(2), dp(1), dp(2), dp(1)) }
        fun tab(key: String, icon: Icon, label: String, make: () -> Panel) {
            val b = IconButton(this, icon, label, 40).apply { onClick = { togglePanel(key, make) } }
            tabButtons[key] = b
            tabs.addView(b)
        }
        tab("scene", Icon.LAYERS, "Scene") { ScenePanel(this) }
        tab("add", Icon.PLUS, "Add") { AddPanel(this) }
        tab("mesh", Icon.TOPOLOGY, "Mesh") { MeshPanel(this) }
        tab("material", Icon.MATERIAL, "Material") { MaterialPanel(this) }
        tab("render", Icon.RENDER, "Render") { RenderPanel(this) }
        tab("animate", Icon.ANIMATE, "Animate") { AnimatePanel(this) }
        tabs.addView(IconButton(this, Icon.EXPORT, "Export", 40).apply { onClick = { ExportSheet.show(this@EditorActivity) } })
        root.addView(hscroll(tabs), flp(WRAP, WRAP))

        // --- right tool palette ----------------------------------------------------------------
        toolColumn = vbox().apply { setPadding(dp(3), dp(4), dp(3), dp(4)) }
        for (t in Tool.values()) {
            val b = IconButton(this, t.icon, t.label, 44).apply { compactLabel = true; onClick = { selectTool(t) } }
            toolButtons[t] = b
            toolColumn.addView(b)
            if (t == Tool.SELECT) toolColumn.addView(View(this).apply { setBackgroundColor(0x22FFFFFF) }, LinearLayout.LayoutParams(MATCH, 1).apply { setMargins(dp(8), dp(4), dp(8), dp(4)) })
        }
        toolScroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; background = glass(18f); addView(toolColumn) }
        root.addView(toolScroll, flp(WRAP, WRAP))

        // --- left sliders ------------------------------------------------------------------------
        leftColumn = vbox(0, 8).apply { gravity = Gravity.CENTER_HORIZONTAL }
        radiusSlider = VSlider(this, "Radius", 4f, 300f, 60f) { "${it.roundToInt()}" }.apply {
            onChange = { v -> editor.currentBrush?.radiusPx = v; if (editor.tool == Tool.SELECT) viewport.selectRadiusPx = v; previewBrush(v) }
            onRelease = { this@EditorActivity.overlay.brush(0f, 0f, 0f, false) }
        }
        intensitySlider = VSlider(this, "Strength", 0f, 1f, 0.5f).apply { onChange = { v -> editor.currentBrush?.intensity = v } }
        negButton = IconButton(this, Icon.MINUS, sizeDp = 40).apply {
            filled = true
            onClick = {
                if (editor.tool == Tool.SELECT) { viewport.selectNegative = !viewport.selectNegative; active = viewport.selectNegative }
                else editor.currentBrush?.let { it.negative = !it.negative; active = it.negative }
            }
        }
        symButton = IconButton(this, Icon.SYMMETRY, sizeDp = 40).apply {
            filled = true
            onClick = { val on = !editor.symmetry(0); editor.setSymmetry(0, on); active = on; status(if (on) "Symmetry X on" else "Symmetry off", 900) }
        }
        leftColumn.addView(radiusSlider); leftColumn.addView(intensitySlider)
        leftColumn.addView(negButton); leftColumn.addView(symButton)
        root.addView(leftColumn, flp(WRAP, WRAP))

        // --- bottom context bar -------------------------------------------------------------------
        bottomBar = hbox(0, 4).apply { setPadding(dp(6), dp(3), dp(6), dp(3)) }
        bottomScroll = hscroll(bottomBar).apply { background = glass(18f) }
        root.addView(bottomScroll, flp(WRAP, WRAP))

        // --- floating panel -----------------------------------------------------------------------
        panelCard = vbox().apply { background = GradientDrawable().apply { setColor(Theme.PANEL); cornerRadius = dp(20f); setStroke(1, 0x26FFFFFF) }; elevation = dp(12f); visibility = View.GONE }
        val head = hbox().apply { setPadding(dp(16), dp(6), dp(4), 0) }
        panelTitle = label("", 16f, Theme.TEXT, bold = true)
        head.addView(panelTitle, lp(0, WRAP, 1f))
        head.addView(IconButton(this, Icon.CLOSE, sizeDp = 40).apply { onClick = { closePanel() } })
        panelCard.addView(head)
        panelBody = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = false }
        panelCard.addView(panelBody, lp(MATCH, WRAP))
        root.addView(panelCard, flp(WRAP, WRAP))

        statusView = label("", 13.5f, Theme.TEXT, bold = true).apply {
            background = Theme.rounded(0xE6242836.toInt(), 14f)
            setPadding(dp(14), dp(8), dp(14), dp(8)); visibility = View.GONE
        }
        root.addView(statusView, flp(WRAP, WRAP, Gravity.CENTER_HORIZONTAL))
    }

    private var lastInsets = Insets(0, 0, 0, 0)

    private fun layoutChrome(i: Insets) {
        lastInsets = i
        val m = dp(8)
        val screenW = root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val screenH = root.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val top = i.top + m
        (topBar.layoutParams as FrameLayout.LayoutParams).apply { width = MATCH; leftMargin = i.left + m; rightMargin = i.right + m; topMargin = top }
        val tabsTop = top + dp(52) + dp(6)
        ((tabs.parent as View).layoutParams as FrameLayout.LayoutParams).apply { leftMargin = i.left + m; rightMargin = i.right + m; topMargin = tabsTop; width = WRAP }
        val contentTop = tabsTop + dp(58) + dp(8)
        val bottomH = dp(52)
        val bottomY = i.bottom + m
        (bottomScroll.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; bottomMargin = bottomY; leftMargin = i.left + m; rightMargin = i.right + m; width = WRAP }
        val tl = timeline
        val timelineH = if (tl != null) dp(96) else 0
        tl?.let { (it.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.BOTTOM; bottomMargin = bottomY + bottomH + dp(8); leftMargin = i.left + m; rightMargin = i.right + m + dp(72); width = MATCH; height = dp(96) } }
        val availH = screenH - contentTop - (bottomY + bottomH + dp(10)) - timelineH
        (toolScroll.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.END or Gravity.TOP; rightMargin = i.right + m; topMargin = contentTop; height = minOf(availH, dp(14 * 56 + 30)).coerceAtLeast(dp(120)) }
        (leftColumn.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.START or Gravity.TOP; leftMargin = i.left + m; topMargin = contentTop + dp(40) }
        val pw = minOf(screenW - i.left - i.right - dp(16) - dp(70), dp(400))
        (panelCard.layoutParams as FrameLayout.LayoutParams).apply { gravity = Gravity.START or Gravity.TOP; leftMargin = i.left + m; topMargin = contentTop; width = pw }
        panelBody.layoutParams = (panelBody.layoutParams as LinearLayout.LayoutParams).apply { height = WRAP }
        panelMaxH = (availH - dp(50)).coerceAtLeast(dp(200))
        (statusView.layoutParams as FrameLayout.LayoutParams).apply { topMargin = contentTop + dp(4) }
        overlay.navCx = (screenW - i.right - m - dp(60 + 52)).toFloat()
        overlay.navCy = (contentTop + dp(48)).toFloat()
        overlay.statsX = (i.left + dp(14)).toFloat()
        overlay.statsY = (screenH - bottomY - bottomH - dp(12) - timelineH).toFloat()
        root.requestLayout()
        overlay.invalidate()
    }

    private var panelMaxH = 0

    // =========================================================================================
    // tools & context bar
    // =========================================================================================
    fun selectTool(t: Tool) {
        editor.setTool(t)
        if (editor.scene.selected == null && t != Tool.TRANSFORM) status("Select or add an object first", 1400)
    }

    private fun refreshTool() {
        val t = editor.tool
        for ((k, b) in toolButtons) b.active = k == t
        val brush = editor.currentBrush
        val showLeft = brush != null || t == Tool.SELECT
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
        buildContextBar()
    }

    private fun ctxButton(icon: Icon, text: String, active: Boolean = false, action: (IconButton) -> Unit): IconButton =
        IconButton(this, icon, text, 40).apply { this.active = active; onClick = { action(this) } }

    private fun buildContextBar() {
        val bar = bottomBar
        bar.removeAllViews()
        val t = editor.tool
        when {
            t == Tool.TRANSFORM -> {
                for (g in GizmoMode.values()) bar.addView(ctxButton(g.icon, g.label, editor.gizmoMode == g) { editor.gizmoMode = g; buildContextBar(); viewport.requestRender(); overlay.invalidate() })
                bar.addView(divider())
                bar.addView(ctxButton(Icon.MAGIC, "Snap", editor.snap) { b -> editor.snap = !editor.snap; b.active = editor.snap })
                bar.addView(ctxButton(Icon.FOCUS, "Focus") { viewport.frameSelection() })
                bar.addView(ctxButton(Icon.FLOOR, "Floor") { editor.dropToFloor() })
                bar.addView(ctxButton(Icon.RESET, "Reset") { editor.resetTransform() })
                bar.addView(ctxButton(Icon.COPY, "Clone") { editor.duplicateSelected() })
                bar.addView(ctxButton(Icon.MIRROR, "Mirror") { editor.duplicateSelected(0) })
                bar.addView(ctxButton(Icon.TRASH, "Delete") { editor.deleteSelected() })
            }
            t == Tool.SELECT -> {
                for (g in GizmoMode.values()) bar.addView(ctxButton(g.icon, g.label, editor.gizmoMode == g) { editor.gizmoMode = g; buildContextBar(); overlay.invalidate() })
                bar.addView(divider())
                bar.addView(ctxButton(Icon.TEMPLATES, "All") { editor.faces.selectAll(); editor.notify(Change.EDIT_SELECTION) })
                bar.addView(ctxButton(Icon.CLOSE, "None") { editor.faces.clear(); editor.notify(Change.EDIT_SELECTION) })
                bar.addView(ctxButton(Icon.INVERT, "Invert") { editor.faces.invert(); editor.notify(Change.EDIT_SELECTION) })
                bar.addView(ctxButton(Icon.PLUS, "Grow") { editor.faces.grow(); editor.notify(Change.EDIT_SELECTION) })
                bar.addView(ctxButton(Icon.LINK, "Linked") { editor.faces.selectLinked(); editor.notify(Change.EDIT_SELECTION) })
                bar.addView(divider())
                bar.addView(ctxButton(Icon.EXTRUDE, "Extrude") { extrude() })
                bar.addView(ctxButton(Icon.CENTER, "Inset") { editor.editOp("Inset") { f -> f.inset(0.25f)?.let { it.first to it.second } } })
                bar.addView(ctxButton(Icon.FLIP, "Flip") { editor.editOp("Flip faces") { f -> f.flipFaces()?.let { it to f.selected.copyOf() } } })
                bar.addView(ctxButton(Icon.SEPARATE, "Separate") { editor.separateSelection(false) })
                bar.addView(ctxButton(Icon.COPY, "Copy") { editor.separateSelection(true) })
                bar.addView(ctxButton(Icon.TRASH, "Delete") { editor.editOp("Delete faces") { f -> f.deleteFaces()?.let { it to null } } })
            }
            else -> {
                val brush = editor.currentBrush!!
                if (t == Tool.PAINT) {
                    val sw = Swatch(this, editor.paintColor, 40).apply {
                        onClick = { ColorPickerView.show(this@EditorActivity, "Paint color", editor.paintColor) { c -> editor.paintColor = c; color = c } }
                    }
                    bar.addView(sw)
                    bar.addView(ctxButton(Icon.FILL, "Fill") { editor.fillPaint() })
                    bar.addView(ctxButton(Icon.TRASH, "Clear") { editor.clearPaint() })
                    bar.addView(divider())
                }
                if (t == Tool.MASK || t.brush?.sculpts == true) {
                    bar.addView(ctxButton(Icon.CLOSE, "Unmask") { editor.maskClear() })
                    bar.addView(ctxButton(Icon.INVERT, "Invert") { editor.maskInvert() })
                    bar.addView(ctxButton(Icon.BLUR, "Blur") { editor.maskBlur() })
                    bar.addView(ctxButton(Icon.SPARKLE, "Sharpen") { editor.maskSharpen() })
                    bar.addView(ctxButton(if (editor.showMask) Icon.EYE else Icon.EYE_OFF, "Mask") { b -> editor.showMask = !editor.showMask; b.icon = if (editor.showMask) Icon.EYE else Icon.EYE_OFF; b.invalidate(); viewport.requestRender() })
                    bar.addView(divider())
                }
                val axes = arrayOf("X", "Y", "Z")
                for (a in 0 until 3) bar.addView(ctxButton(Icon.SYMMETRY, "Sym ${axes[a]}", editor.symmetry(a)) { b -> editor.setSymmetry(a, !editor.symmetry(a)); b.active = editor.symmetry(a); symButton.active = editor.symmetry(0) })
                bar.addView(ctxButton(Icon.AUTO, brush.falloff.label) { b ->
                    val vals = Falloff.values()
                    brush.falloff = vals[(brush.falloff.ordinal + 1) % vals.size]
                    b.text = brush.falloff.label; b.invalidate()
                })
                bar.addView(ctxButton(Icon.PEN, "Pressure", brush.usePressure) { b -> brush.usePressure = !brush.usePressure; b.active = brush.usePressure })
                bar.addView(ctxButton(Icon.WIREFRAME, "Wire", editor.scene.render.wireframe) { b -> editor.locked { editor.scene.render.wireframe = !editor.scene.render.wireframe }; b.active = editor.scene.render.wireframe; viewport.requestRender() })
                if (editor.scene.selected?.primitive != null) bar.addView(ctxButton(Icon.SUBDIVIDE, "Subdivide") { editor.subdivide(true); status("Subdivided", 900) })
            }
        }
    }

    private fun divider() = View(this).apply { setBackgroundColor(0x22FFFFFF) }.also { it.layoutParams = LinearLayout.LayoutParams(1, dp(32)).apply { setMargins(dp(4), 0, dp(4), 0) } }

    private fun extrude() {
        val o = editor.scene.selected ?: return
        if (editor.faces.isEmpty()) { status("Select faces first", 1200); return }
        val size = o.mesh.averageEdgeLength().coerceAtLeast(1e-4f) * 2f
        editor.editOp("Extrude") { f -> f.extrude(size)?.let { it.first to it.second } }
        editor.gizmoMode = GizmoMode.MOVE
        buildContextBar()
        status("Extruded – drag the gizmo to adjust", 1600)
    }

    private fun previewBrush(r: Float) {
        overlay.brush(root.width / 2f, root.height / 2f, r, true)
    }

    // =========================================================================================
    // panels
    // =========================================================================================
    private fun togglePanel(key: String, make: () -> Panel) {
        if (panelKey == key) { closePanel(); return }
        openPanel(key, make())
    }

    fun openPanel(key: String, p: Panel) {
        panel?.onClosed()
        panel = p
        panelKey = key
        for ((k, b) in tabButtons) b.active = k == key
        panelTitle.text = p.title
        rebuildPanel()
        panelCard.visibility = View.VISIBLE
        panelCard.alpha = 0f; panelCard.translationY = -dp(8f)
        panelCard.animate().alpha(1f).translationY(0f).setDuration(140).start()
        if (key == "animate") showTimeline(true)
    }

    fun rebuildPanel() {
        val p = panel ?: return
        val y = panelBody.scrollY
        panelBody.removeAllViews()
        val content = p.build()
        content.setPadding(dp(14), dp(4), dp(14), dp(16))
        panelBody.addView(content)
        panelBody.post {
            panelBody.scrollTo(0, y)
            val h = content.height
            val lpb = panelBody.layoutParams
            val want = if (h > panelMaxH) panelMaxH else ViewGroup.LayoutParams.WRAP_CONTENT
            if (lpb.height != want) { lpb.height = want; panelBody.layoutParams = lpb }
        }
    }

    fun closePanel() {
        panel?.onClosed()
        if (panelKey == "animate") showTimeline(false)
        panel = null; panelKey = null
        for (b in tabButtons.values) b.active = false
        panelCard.visibility = View.GONE
    }

    private fun showTimeline(show: Boolean) {
        if (show && timeline == null) {
            val tl = Timeline(this, editor)
            timeline = tl
            root.addView(tl, root.indexOfChild(panelCard), flp(MATCH, dp(96), Gravity.BOTTOM))
        } else if (!show) {
            timeline?.let { stopPlayback(); root.removeView(it) }
            timeline = null
        }
        layoutChrome(lastInsets)
    }

    // =========================================================================================
    // change handling
    // =========================================================================================
    private fun onChanged(c: Set<Change>) {
        if (Change.UNDO in c) refreshUndo()
        if (Change.TOOL in c) refreshTool()
        if (Change.SELECTION in c || Change.TOPOLOGY in c) {
            if (editor.tool != Tool.SELECT && editor.tool != Tool.TRANSFORM && Change.SELECTION in c) buildContextBar()
        }
        panel?.onChanged(c)
        timeline?.onChanged(c)
        overlay.invalidate()
    }

    private fun refreshUndo() {
        undoBtn.isEnabled = editor.undo.canUndo; undoBtn.invalidate()
        redoBtn.isEnabled = editor.undo.canRedo; redoBtn.invalidate()
    }

    private val hideStatus = Runnable { statusView.animate().alpha(0f).setDuration(200).withEndAction { statusView.visibility = View.GONE }.start() }

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
    private fun updateTitle() { titleView.text = meta?.name ?: "Untitled" }

    private fun renameProject() {
        val m = meta ?: return
        Dialogs.prompt(this, "Rename project", m.name) { name -> m.name = name; store.rename(m.id, name); updateTitle() }
    }

    private fun filesMenu() {
        Dialogs.menu(this, meta?.name, listOf(
            MenuItem(Icon.SAVE, "Save", subtitle = "Projects also save automatically") { save(true) },
            MenuItem(Icon.EXPORT, "Export…", subtitle = "GLB · glTF · OBJ · STL · PLY") { ExportSheet.show(this) },
            MenuItem(Icon.SHARE, "Share as GLB") { quickShare() },
            MenuItem(Icon.IMPORT, "Import into scene…", subtitle = "Merge another model file") { importIntoScene() },
            MenuItem(Icon.CAMERA, "Screenshot") { screenshot() },
            MenuItem(Icon.COPY, "Save as copy") { saveCopy() },
            MenuItem(Icon.PEN, "Rename project") { renameProject() },
            MenuItem(Icon.HELP, "Gestures & tips") { HelpSheet.show(this) },
            MenuItem(Icon.SETTINGS, "Settings") { startActivity(Intent(this, SettingsActivity::class.java)) },
        ))
    }

    fun save(feedback: Boolean, after: (() -> Unit)? = null) {
        val m = meta ?: return
        if (!::editor.isInitialized) return
        viewport.capture(384, false) { thumb ->
            bg.execute {
                val r = runCatching { store.save(m, editor.scene, thumb) }
                ui {
                    r.onSuccess { editor.dirty = false; if (feedback) status("Saved", 900) }.onFailure { showError(it) }
                    after?.invoke()
                }
            }
        }
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

    fun screenshot() {
        val content = vbox()
        val trans = ToggleRow(this, "Transparent background", false)
        val size = Segmented(this, listOf("Screen", "1080", "2048"), 1)
        content.addView(size); content.addView(View(this), lp(MATCH, dp(10))); content.addView(trans)
        Dialogs.custom(this, "Screenshot", content, "Capture", "Cancel", onPositive = {
            val s = when (size.selected) { 0 -> 0; 1 -> 1080; else -> 2048 }
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
                    val mime = contentResolver.getType(uri) ?: "image/png"
                    val name = FileIO.displayName(this, uri) ?: "Image"
                    // re-encode exotic formats (HEIC etc.) as PNG so every glTF viewer can read them
                    if (mime == "image/png" || mime == "image/jpeg") Texture(name, bytes, mime) else {
                        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("Unsupported image")
                        val out = java.io.ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                        Texture(name.substringBeforeLast('.') + ".png", out.toByteArray(), "image/png")
                    }
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
            if (editor.dirty && Prefs.of(this).autosave) save(false)
            viewport.onPause()
        }
    }

    override fun onResume() {
        super.onResume()
        if (::viewport.isInitialized) { viewport.onResume(); Theme.load(this); overlay.invalidate() }
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
        if (panel != null) { closePanel(); return }
        leave()
    }
}
