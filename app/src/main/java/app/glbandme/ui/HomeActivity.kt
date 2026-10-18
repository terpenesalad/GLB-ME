package app.glbandme.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.glbandme.BuildConfigInfo
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.SceneIO
import app.glbandme.core.mesh.PrimType
import app.glbandme.data.ProjectMeta
import app.glbandme.data.ProjectStore
import app.glbandme.data.ShareProvider
import app.glbandme.editor.AddPanel
import app.glbandme.ui.Theme.dp

/** Launcher: project library with search, quick starts, templates and import. */
class HomeActivity : BaseActivity() {
    private lateinit var store: ProjectStore
    private lateinit var root: FrameLayout
    private lateinit var content: LinearLayout
    private lateinit var grid: LinearLayout
    private lateinit var projectsTitle: TextView
    private lateinit var search: EditText
    private var query = ""
    private val thumbs = HashMap<String, Bitmap>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ProjectStore(this)
        root = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Theme.blend(Theme.BG, Theme.accent, 0.18f), Theme.BG, Theme.BG))
        }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = true }
        content = vbox().apply { setPadding(dp(18), 0, dp(18), dp(24)) }
        scroll.addView(content)
        root.addView(scroll, flp(MATCH, MATCH))
        setContentView(root)
        trackInsets(root)
        onInsets { i -> content.setPadding(dp(18) + i.left, i.top + dp(10), dp(18) + i.right, i.bottom + dp(28)) }
        build()
        handleIncoming(intent)
        root.post { firstRun() }
    }

    private fun firstRun() {
        val p = Prefs.of(this)
        val v = BuildConfigInfo.versionName(this)
        when {
            !p.seenWelcome -> WelcomeSheet.welcome(this) { p.seenWelcome = true; p.lastVersionSeen = v }
            p.lastVersionSeen != v && v.startsWith("1.1") -> WelcomeSheet.whatsNew(this) { p.lastVersionSeen = v }
            else -> p.lastVersionSeen = v
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncoming(intent)
    }

    private fun handleIncoming(i: Intent?) {
        val uri: Uri? = when (i?.action) {
            Intent.ACTION_VIEW -> i.data
            Intent.ACTION_SEND -> if (android.os.Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)
            else -> null
        }
        if (uri != null) {
            i?.action = Intent.ACTION_MAIN
            SceneFactory.importAsProject(this, uri)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::grid.isInitialized) refreshProjects()
    }

    private fun build() {
        // ---- large title header -----------------------------------------------------------------------
        val header = hbox().apply { setPadding(0, dp(4), 0, dp(6)); gravity = Gravity.CENTER_VERTICAL }
        header.addView(LogoView(this, 40))
        header.addView(label("GLB&ME", 15f, Theme.TEXT_DIM, bold = true).apply { setPadding(dp(10), 0, 0, 0); letterSpacing = 0.04f }, lp(0, WRAP, 1f))
        header.addView(IconButton(this, Icon.HELP).apply { describe("Help"); onClick = { HelpSheet.show(this@HomeActivity) } })
        header.addView(IconButton(this, Icon.SETTINGS).apply { describe("Settings"); onClick = { startActivity(Intent(this@HomeActivity, SettingsActivity::class.java)) } })
        content.addView(header)
        content.addView(label("Create in 3D", 32f, Theme.TEXT, bold = true).apply { setPadding(dp(2), dp(6), 0, dp(2)); if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true })
        content.addView(label("Sculpt, build, paint and export GLB models.", 15f, Theme.TEXT_DIM).apply { setPadding(dp(2), 0, 0, dp(18)) })

        // ---- create tiles ----------------------------------------------------------------------------------
        val tiles = hbox(0, 12)
        tiles.addView(ActionTile(this, Icon.PLUS, "New", "Shape, text or blank", intArrayOf(Theme.accent, Theme.accentLight())).apply { onClick = { newSheet() } }, lp(0, WRAP, 1f))
        tiles.addView(ActionTile(this, Icon.TEMPLATES, "Templates", "${app.glbandme.core.templates.Templates.all.size} starters", intArrayOf(0xFF0E7C86.toInt(), 0xFF22D3EE.toInt())).apply {
            onClick = { startActivity(Intent(this@HomeActivity, TemplatesActivity::class.java)) }
        }, lp(0, WRAP, 1f))
        tiles.addView(ActionTile(this, Icon.IMPORT, "Import", "GLB · OBJ · STL…", intArrayOf(0xFFC2410C.toInt(), 0xFFFF7A59.toInt())).apply { onClick = { pickImport() } }, lp(0, WRAP, 1f))
        content.addView(tiles)

        // ---- quick starts ----------------------------------------------------------------------------------
        content.addView(sectionTitle("Quick start").apply { setPadding(dp(4), dp(24), 0, dp(10)) })
        val chips = hbox(0, 8)
        chips.addView(Chip(this, "Sculpt", Icon.SCULPT_SPHERE).apply { onClick = { start("Sculpt", PrimType.SCULPT_SPHERE) } })
        chips.addView(Chip(this, "3D Text", Icon.TEXT).apply { onClick = { startEmpty("Title", EditorActivity.ACTION_TEXT) } })
        chips.addView(Chip(this, "Draw", Icon.PEN).apply { onClick = { startEmpty("Drawing", EditorActivity.ACTION_DRAW) } })
        for (t in listOf(PrimType.CUBE, PrimType.ROUNDED_BOX, PrimType.CYLINDER, PrimType.TORUS, PrimType.STAR, PrimType.HEART, PrimType.GEAR, PrimType.TERRAIN)) {
            chips.addView(Chip(this, t.label, AddPanel.iconFor(t)).apply { onClick = { start(t.label, t) } })
        }
        content.addView(hscroll(chips).apply { clipToPadding = false })

        // ---- projects ---------------------------------------------------------------------------------------
        val ph = hbox().apply { setPadding(0, dp(26), 0, dp(10)); gravity = Gravity.CENTER_VERTICAL }
        projectsTitle = label("Your projects", 20f, Theme.TEXT, bold = true).apply { if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true }
        ph.addView(projectsTitle, lp(0, WRAP, 1f))
        ph.addView(Chip(this, sortLabel(), Icon.SORT).apply {
            describe("Sort: ${sortLabel()}")
            onClick = {
                val p = Prefs.of(this@HomeActivity)
                p.sortMode = (p.sortMode + 1) % 3
                text = sortLabel(); describe("Sort: ${sortLabel()}"); requestLayout(); invalidate()
                refreshProjects()
            }
        })
        content.addView(ph)
        search = EditText(this).apply {
            hint = "Search projects"
            setTextColor(Theme.TEXT); setHintTextColor(Theme.TEXT_MUTED)
            textSize = 16f * Theme.uiScale
            background = Theme.rounded(Theme.SURFACE_2, 12f)
            setPadding(dp(40), dp(11), dp(14), dp(11))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { query = s?.toString()?.trim() ?: ""; refreshProjects() }
            })
        }
        val searchWrap = FrameLayout(this)
        searchWrap.addView(search, FrameLayout.LayoutParams(MATCH, WRAP))
        searchWrap.addView(object : View(this) {
            override fun onDraw(c: android.graphics.Canvas) = Icons.draw(c, Icon.SEARCH, width / 2f, height / 2f, dp(18f), Theme.TEXT_MUTED)
        }.apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }, FrameLayout.LayoutParams(dp(40), MATCH, Gravity.START or Gravity.CENTER_VERTICAL))
        content.addView(searchWrap, lp().apply { bottomMargin = dp(12) })
        grid = vbox(0, 12)
        content.addView(grid)
    }

    private fun sortLabel() = when (Prefs.of(this).sortMode) { 0 -> "Recent"; 1 -> "Name"; else -> "Size" }

    private fun columns(): Int {
        val wdp = resources.displayMetrics.widthPixels / resources.displayMetrics.density / Theme.uiScale
        return when { wdp >= 900 -> 4; wdp >= 600 -> 3; else -> 2 }
    }

    private fun refreshProjects() {
        val all = store.list()
        val list = all.filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }.let { l ->
            when (Prefs.of(this).sortMode) {
                1 -> l.sortedBy { it.name.lowercase() }
                2 -> l.sortedByDescending { it.triangles }
                else -> l.sortedByDescending { it.modified }
            }
        }
        projectsTitle.text = if (all.isEmpty()) "Your projects" else "Your projects · ${all.size}"
        (search.parent as View).visibility = if (all.size > 3) View.VISIBLE else View.GONE
        grid.removeAllViews()
        if (all.isEmpty()) { grid.addView(emptyState()); return }
        if (list.isEmpty()) { grid.addView(label("No projects match “$query”.", 14f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(10), 0, dp(10)) }); return }
        val cols = columns()
        var row: LinearLayout? = null
        list.forEachIndexed { i, m ->
            if (i % cols == 0) { row = hbox(0, 12); grid.addView(row, lp()) }
            row!!.addView(card(m), lp(0, WRAP, 1f))
        }
        val rem = list.size % cols
        if (rem != 0) repeat(cols - rem) { row!!.addView(View(this), lp(0, 1, 1f)) }
    }

    private fun card(m: ProjectMeta): ThumbCard {
        val c = ThumbCard(this)
        c.title = m.name
        c.subtitle = "${Fmt.count(m.triangles)} tris · ${Fmt.ago(m.modified)}"
        c.badge = if (m.animated) "▶ Anim" else null
        thumbs[m.id + m.modified]?.let { c.thumb = it } ?: run {
            c.loading = true
            async({ store.loadThumb(m.id) }, onError = {}) { b -> c.loading = false; if (b != null) { thumbs[m.id + m.modified] = b; c.thumb = b } }
        }
        c.onClick = { SceneFactory.openEditor(this, m.id) }
        c.onLongClick = { projectMenu(m) }
        return c
    }

    private fun emptyState(): View = vbox().apply {
        gravity = Gravity.CENTER_HORIZONTAL
        background = Theme.rounded(Theme.SURFACE, 22f)
        setPadding(dp(24), dp(30), dp(24), dp(26))
        addView(LogoView(this@HomeActivity, 64))
        addView(label("No projects yet", 18f, Theme.TEXT, bold = true).apply { setPadding(0, dp(16), 0, dp(6)) })
        addView(label("Start from a ball of clay, type some 3D text, open a template or import a GLB.", 14f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.2f) })
        addView(PillButton(this@HomeActivity, "Start sculpting", Icon.SCULPT_SPHERE, PillButton.Style.PRIMARY).apply {
            onClick = { start("Sculpt", PrimType.SCULPT_SPHERE) }
        }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(18) })
    }

    private fun start(name: String, t: PrimType) = SceneFactory.createAndOpen(this, if (t == PrimType.SCULPT_SPHERE) "Sculpt" else name) { SceneFactory.withPrimitive(t) }

    private fun startEmpty(name: String, action: String) = SceneFactory.createAndOpen(this, name, action) { SceneFactory.empty() }

    /** "New" sheet: blank, quick creations and every shape. */
    private fun newSheet() {
        val body = vbox()
        lateinit var d: android.app.Dialog
        body.addView(sectionTitle("Start with"))
        body.addView(app.glbandme.editor.PanelUi.actionGrid(this, listOf(
            Triple(Icon.SCULPT_SPHERE, "Clay ball") { d.dismiss(); start("Sculpt", PrimType.SCULPT_SPHERE) },
            Triple(Icon.TEXT, "3D Text") { d.dismiss(); startEmpty("Title", EditorActivity.ACTION_TEXT) },
            Triple(Icon.PEN, "Draw") { d.dismiss(); startEmpty("Drawing", EditorActivity.ACTION_DRAW) },
            Triple(Icon.GRID, "Empty") { d.dismiss(); startEmpty("Untitled", EditorActivity.ACTION_ADD) },
        )))
        body.addView(sectionTitle("Shapes"))
        body.addView(app.glbandme.editor.PanelUi.actionGrid(this, (AddPanel.basic.drop(1) + AddPanel.more).map { (t, i) -> Triple(i, t.label) { d.dismiss(); start(t.label, t) } }))
        body.addView(sectionTitle("More"))
        body.addView(app.glbandme.editor.PanelUi.actionGrid(this, listOf(
            Triple(Icon.TEMPLATES, "Templates") { d.dismiss(); startActivity(Intent(this, TemplatesActivity::class.java)) },
            Triple(Icon.IMPORT, "Import") { d.dismiss(); pickImport() },
        )))
        d = Dialogs.sheet(this, "New project", body, action = null, tall = false)
    }

    private fun projectMenu(m: ProjectMeta) {
        Dialogs.menu(this, m.name, listOf(
            MenuItem(Icon.EDIT, "Open") { SceneFactory.openEditor(this, m.id) },
            MenuItem(Icon.PEN, "Rename") { Dialogs.prompt(this, "Rename project", m.name) { store.rename(m.id, it); refreshProjects() } },
            MenuItem(Icon.COPY, "Duplicate") { store.duplicate(m.id); refreshProjects() },
            MenuItem(Icon.SHARE, "Share as GLB") { shareProject(m) },
            MenuItem(Icon.TRASH, "Delete", danger = true) {
                Dialogs.confirm(this, "Delete “${m.name}”?", "This removes the project from your device. Exported files are not affected.", "Delete", danger = true) {
                    store.delete(m.id); refreshProjects()
                }
            },
        ))
    }

    private fun shareProject(m: ProjectMeta) {
        val progress = Dialogs.progress(this, "Exporting…")
        async({
            val scene = store.load(m.id)
            SceneIO.export(scene, ExportFormat.GLB, GltfExportOptions())
        }, onError = { progress.dismiss(); showError(it) }) { bytes ->
            progress.dismiss()
            ShareProvider.share(this, "${m.name}.glb", bytes, "Share model")
        }
    }

    private fun pickImport() {
        try { startActivityForResult(SceneFactory.importIntent(), REQ_IMPORT) } catch (e: Exception) { showError(e) }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_IMPORT && resultCode == RESULT_OK) data?.data?.let { SceneFactory.importAsProject(this, it) }
    }

    companion object { private const val REQ_IMPORT = 41 }
}
