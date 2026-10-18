package app.glbandme.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.FrameLayout
import android.widget.ScrollView
import app.glbandme.BuildConfigInfo
import app.glbandme.core.io.ExportFormat
import app.glbandme.ui.Theme.dp

class SettingsActivity : BaseActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val p = Prefs.of(this)
        val root = FrameLayout(this).apply { setBackgroundColor(Theme.BG) }
        val scroll = ScrollView(this)
        val content = vbox()
        scroll.addView(content)
        root.addView(scroll, flp(MATCH, MATCH))
        setContentView(root)
        trackInsets(root)
        onInsets { i -> content.setPadding(dp(18) + i.left, i.top + dp(8), dp(18) + i.right, i.bottom + dp(24)) }

        val header = hbox().apply { setPadding(0, 0, 0, dp(8)) }
        header.addView(IconButton(this, Icon.BACK).apply { onClick = { finish() } })
        header.addView(label("Settings", 22f, Theme.TEXT, bold = true).apply { setPadding(dp(6), 0, 0, 0) })
        content.addView(header)

        fun card(): android.widget.LinearLayout = vbox().apply {
            background = Theme.rounded(Theme.SURFACE, 18f)
            setPadding(dp(16), dp(6), dp(16), dp(10))
        }

        content.addView(sectionTitle("Appearance"))
        val app = card()
        app.addView(label("Accent color", 14f, Theme.TEXT).apply { setPadding(0, dp(10), 0, dp(10)) })
        val row = hbox(0, 10)
        val sw = ArrayList<Swatch>()
        for (c in Theme.accentChoices) {
            val s = Swatch(this, c, 38).apply { ring = c == p.accent; onClick = { p.accent = c; Theme.accent = c; sw.forEach { it.ring = it.color == c } } }
            sw.add(s); row.addView(s)
        }
        app.addView(row)
        app.addView(ToggleRow(this, "Haptic feedback", p.haptics).apply { onToggle = { p.haptics = it } })
        content.addView(app)

        content.addView(sectionTitle("Viewport"))
        val vp = card()
        vp.addView(ToggleRow(this, "Show scene stats", p.showStats, "Triangle and vertex counts").apply { onToggle = { p.showStats = it } })
        vp.addView(ToggleRow(this, "Show FPS", p.showFps).apply { onToggle = { p.showFps = it } })
        vp.addView(ToggleRow(this, "Anti-aliasing (MSAA 4x)", p.msaa, "Smoother edges; applies when the editor reopens").apply { onToggle = { p.msaa = it } })
        vp.addView(ToggleRow(this, "Invert vertical orbit", p.invertOrbit).apply { onToggle = { p.invertOrbit = it } })
        vp.addView(HSlider(this, "Orbit speed", 0.3f, 2.5f, p.orbitSpeed, 0.05f) { String.format("%.2f×", it) }.apply { onRelease = { v -> p.orbitSpeed = v } })
        content.addView(vp)

        content.addView(sectionTitle("Sculpting"))
        val sc = card()
        sc.addView(ToggleRow(this, "Stylus pressure", p.stylusPressure, "Pressure changes brush intensity").apply { onToggle = { p.stylusPressure = it } })
        sc.addView(ToggleRow(this, "Stylus-only sculpting", p.stylusOnly, "Fingers always navigate").apply { onToggle = { p.stylusOnly = it } })
        sc.addView(ToggleRow(this, "Tap with 2/3 fingers to undo/redo", p.tapUndo).apply { onToggle = { p.tapUndo = it } })
        sc.addView(HSlider(this, "Undo history", 10f, 200f, p.undoSteps.toFloat(), 10f) { "${it.toInt()} steps" }.apply { onRelease = { v -> p.undoSteps = v.toInt() } })
        content.addView(sc)

        content.addView(sectionTitle("Files"))
        val fl = card()
        fl.addView(ToggleRow(this, "Autosave when leaving the editor", p.autosave).apply { onToggle = { p.autosave = it } })
        fl.addView(label("Default export format", 14f, Theme.TEXT).apply { setPadding(0, dp(12), 0, dp(10)) })
        val fmts = ExportFormat.values().toList()
        fl.addView(Segmented(this, fmts.map { it.label }, fmts.indexOfFirst { it.name == p.defaultExport }.coerceAtLeast(0)).apply { onSelect = { p.defaultExport = fmts[it].name } })
        fl.addView(android.view.View(this), lp(MATCH, dp(8)))
        content.addView(fl)

        content.addView(sectionTitle("About"))
        val ab = card()
        ab.addView(hbox(0, 12).apply {
            setPadding(0, dp(10), 0, dp(10))
            addView(LogoView(this@SettingsActivity, 40))
            addView(vbox().apply {
                addView(label("GLB&ME ${BuildConfigInfo.versionName(this@SettingsActivity)}", 15f, Theme.TEXT, bold = true))
                addView(label("All premium features included · offline · no account", 12f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0) })
            })
        })
        ab.addView(PillButton(this, "Source code on GitHub", Icon.LINK).apply {
            onClick = { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/terpenesalad/GLB-ME"))) } }
        })
        ab.addView(android.view.View(this), lp(MATCH, dp(8)))
        content.addView(ab)
    }
}
