package app.glbandme.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.SceneIO
import app.glbandme.core.mesh.PrimType
import app.glbandme.data.ProjectMeta
import app.glbandme.data.ProjectStore
import app.glbandme.data.ShareProvider
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp

/** Launcher: project library, create/templates/import. */
class HomeActivity : BaseActivity() {
    private lateinit var store: ProjectStore
    private lateinit var root: FrameLayout
    private lateinit var content: LinearLayout
    private lateinit var grid: LinearLayout
    private lateinit var projectsTitle: android.widget.TextView
    private val thumbs = HashMap<String, Bitmap>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ProjectStore(this)
        root = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xFF1A1630.toInt(), Theme.BG, Theme.BG))
        }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = true }
        content = vbox().apply { setPadding(dp(18), 0, dp(18), dp(24)) }
        scroll.addView(content)
        root.addView(scroll, flp(MATCH, MATCH))
        setContentView(root)
        trackInsets(root)
        onInsets { i -> content.setPadding(dp(18) + i.left, i.top + dp(12), dp(18) + i.right, i.bottom + dp(28)) }
        build()
        handleIncoming(intent)
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
        refreshProjects()
    }

    private fun build() {
        // header
        val header = hbox().apply { setPadding(0, dp(6), 0, dp(20)) }
        header.addView(LogoView(this, 46))
        val titles = vbox().apply { setPadding(dp(12), 0, 0, 0) }
        titles.addView(label("GLB&ME", 26f, Theme.TEXT, bold = true).apply { letterSpacing = 0.02f })
        titles.addView(label("Sculpt · Model · Paint · Animate · Export GLB", 12.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0) })
        header.addView(titles, lp(0, WRAP, 1f))
        header.addView(IconButton(this, Icon.HELP).apply { onClick = { showHelp() } })
        header.addView(IconButton(this, Icon.SETTINGS).apply { onClick = { startActivity(Intent(this@HomeActivity, SettingsActivity::class.java)) } })
        content.addView(header)

        // create tiles
        val tiles = hbox(0, 12)
        tiles.addView(ActionTile(this, Icon.PLUS, "New", "Blank or a shape", intArrayOf(Theme.accent, 0xFF9D7BFF.toInt())).apply { onClick = { newMenu() } }, lp(0, WRAP, 1f))
        tiles.addView(ActionTile(this, Icon.TEMPLATES, "Templates", "20 starters", intArrayOf(0xFF22D3EE.toInt(), 0xFF0EA5E9.toInt())).apply {
            onClick = { startActivity(Intent(this@HomeActivity, TemplatesActivity::class.java)) }
        }, lp(0, WRAP, 1f))
        tiles.addView(ActionTile(this, Icon.IMPORT, "Import", "GLB, glTF, OBJ…", intArrayOf(0xFFFF7A59.toInt(), 0xFFFF4FA3.toInt())).apply { onClick = { pickImport() } }, lp(0, WRAP, 1f))
        content.addView(tiles)

        // quick shapes
        content.addView(sectionTitle("Start with a shape").apply { setPadding(dp(2), dp(22), 0, dp(10)) })
        val chips = hbox(0, 8)
        for ((t, icon) in listOf(
            PrimType.SCULPT_SPHERE to Icon.SCULPT_SPHERE, PrimType.CUBE to Icon.CUBE, PrimType.CYLINDER to Icon.CYLINDER,
            PrimType.TORUS to Icon.TORUS, PrimType.CAPSULE to Icon.CAPSULE, PrimType.CONE to Icon.CONE,
            PrimType.ICOSPHERE to Icon.ICOSPHERE, PrimType.PLANE to Icon.PLANE
        )) {
            chips.addView(Chip(this, t.label, icon).apply { onClick = { SceneFactory.createAndOpen(this@HomeActivity, if (t == PrimType.SCULPT_SPHERE) "Sculpt" else t.label) { SceneFactory.withPrimitive(t) } } })
        }
        content.addView(hscroll(chips).apply { clipToPadding = false })

        // projects
        val ph = hbox().apply { setPadding(0, dp(26), 0, dp(12)) }
        projectsTitle = label("Your projects", 18f, Theme.TEXT, bold = true)
        ph.addView(projectsTitle, lp(0, WRAP, 1f))
        ph.addView(Chip(this, sortLabel(), Icon.SORT).apply {
            onClick = {
                val p = Prefs.of(this@HomeActivity)
                p.sortMode = (p.sortMode + 1) % 3
                text = sortLabel(); requestLayout(); invalidate()
                refreshProjects()
            }
        })
        content.addView(ph)
        grid = vbox(0, 12)
        content.addView(grid)
    }

    private fun sortLabel() = when (Prefs.of(this).sortMode) { 0 -> "Recent"; 1 -> "Name"; else -> "Size" }

    private fun columns(): Int {
        val wdp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        return when { wdp >= 900 -> 4; wdp >= 600 -> 3; else -> 2 }
    }

    private fun refreshProjects() {
        val list = store.list().let { l ->
            when (Prefs.of(this).sortMode) {
                1 -> l.sortedBy { it.name.lowercase() }
                2 -> l.sortedByDescending { it.triangles }
                else -> l.sortedByDescending { it.modified }
            }
        }
        projectsTitle.text = if (list.isEmpty()) "Your projects" else "Your projects · ${list.size}"
        grid.removeAllViews()
        if (list.isEmpty()) { grid.addView(emptyState()); return }
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
        addView(label("No projects yet", 17f, Theme.TEXT, bold = true).apply { setPadding(0, dp(16), 0, dp(6)) })
        addView(label("Sculpt something from a sphere, open a template or import a GLB to get started.", 13.5f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.2f) })
        addView(PillButton(this@HomeActivity, "Start sculpting", Icon.SCULPT_SPHERE, PillButton.Style.PRIMARY).apply {
            onClick = { SceneFactory.createAndOpen(this@HomeActivity, "Sculpt") { SceneFactory.withPrimitive(PrimType.SCULPT_SPHERE) } }
        }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(18) })
    }

    private fun newMenu() {
        Dialogs.menu(this, "New project", listOf(
            MenuItem(Icon.SCULPT_SPHERE, "Sculpt sphere", subtitle = "Dense clay ball – the classic start") { SceneFactory.createAndOpen(this, "Sculpt") { SceneFactory.withPrimitive(PrimType.SCULPT_SPHERE) } },
            MenuItem(Icon.CUBE, "Cube", subtitle = "Subdivided box for hard-surface or sculpting") { SceneFactory.createAndOpen(this, "Cube") { SceneFactory.withPrimitive(PrimType.CUBE) } },
            MenuItem(Icon.GRID, "Empty scene", subtitle = "Add shapes, text and images yourself") { SceneFactory.createAndOpen(this, "Untitled") { SceneFactory.empty() } },
            MenuItem(Icon.TEMPLATES, "From template…") { startActivity(Intent(this, TemplatesActivity::class.java)) },
            MenuItem(Icon.IMPORT, "Import a model…", subtitle = "GLB · glTF · OBJ · STL · PLY") { pickImport() },
        ))
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

    private fun showHelp() = HelpSheet.show(this)

    companion object { private const val REQ_IMPORT = 41 }
}
