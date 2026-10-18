package app.glbandme.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import app.glbandme.BuildConfigInfo
import app.glbandme.ui.Theme.dp

/** Settings, grouped like iOS Settings: Appearance & Accessibility first. */
class SettingsActivity : BaseActivity() {
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Theme.BG) }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
        content = vbox()
        scroll.addView(content)
        root.addView(scroll, flp(MATCH, MATCH))
        setContentView(root)
        trackInsets(root)
        onInsets { i -> content.setPadding(dp(16) + i.left, i.top + dp(8), dp(16) + i.right, i.bottom + dp(28)) }
        build()
    }

    private fun build() {
        val p = Prefs.of(this)
        content.removeAllViews()
        val header = hbox().apply { setPadding(0, 0, 0, dp(4)); gravity = Gravity.CENTER_VERTICAL }
        header.addView(IconButton(this, Icon.BACK).apply { describe("Back"); onClick = { finish() } })
        content.addView(header)
        content.addView(label("Settings", 32f, Theme.TEXT, bold = true).apply { setPadding(dp(4), dp(2), 0, dp(4)); if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true })

        // ---- appearance -------------------------------------------------------------------------
        content.addView(sectionTitle("Appearance"))
        val app = GroupCard(this)
        app.row(label("Accent colour", 15f, Theme.TEXT).apply { setPadding(0, dp(14), 0, dp(8)) })
        val row = hbox(0, 10).apply { setPadding(0, 0, 0, dp(12)) }
        val sw = ArrayList<Swatch>()
        Theme.accentChoices.forEachIndexed { i, c ->
            val s = Swatch(this, c, 40).apply {
                describe("${Theme.accentNames[i]} accent")
                ring = c == p.accent
                onClick = { p.accent = c; Theme.accent = c; sw.forEach { it.ring = it.color == c }; Theme.load(this@SettingsActivity); recreate() }
            }
            sw.add(s); row.addView(s)
        }
        app.row(row)
        content.addView(app)

        // ---- accessibility -------------------------------------------------------------------------
        content.addView(sectionTitle("Accessibility"))
        val acc = GroupCard(this)
        acc.row(label("Interface size", 15f, Theme.TEXT).apply { setPadding(0, dp(14), 0, dp(8)) })
        acc.row(Segmented(this, listOf("Standard", "Large", "Extra large"), p.uiSize).apply {
            onSelect = { p.uiSize = it; Theme.load(this@SettingsActivity); recreate() }
        }.also { it.setPadding(dp(3), dp(3), dp(3), dp(3)) })
        acc.row(View(this).apply { minimumHeight = dp(10) })
        val sysText = p.textScale <= 0f
        acc.row(ToggleRow(this, "Use system text size", sysText, "Follows Android › Display › Font size").apply {
            onToggle = { v -> p.textScale = if (v) 0f else 1.1f; Theme.load(this@SettingsActivity); recreate() }
        })
        if (!sysText) acc.row(HSlider(this, "Text size", 0.85f, 1.5f, p.textScale, 0.05f) { "${(it * 100).toInt()}%" }.apply {
            onRelease = { v -> p.textScale = v; Theme.load(this@SettingsActivity); recreate() }
        })
        acc.row(ToggleRow(this, "Bold text", p.boldText).apply { onToggle = { p.boldText = it; Theme.load(this@SettingsActivity); recreate() } })
        acc.row(ToggleRow(this, "Reduce motion", p.reduceMotion, "No sliding or zooming animations").apply { onToggle = { p.reduceMotion = it; Theme.load(this@SettingsActivity) } })
        acc.row(ToggleRow(this, "Left-handed layout", p.leftHanded, "Tool rail on the left, brush sliders on the right").apply { onToggle = { p.leftHanded = it; Theme.load(this@SettingsActivity) } })
        acc.row(ToggleRow(this, "Haptic feedback", p.haptics, "Gentle taps when buttons and sliders change").apply { onToggle = { p.haptics = it } })
        content.addView(acc)
        content.addView(label("Every control has a spoken label for TalkBack, sliders can be adjusted with volume keys or swipe gestures, and all colours meet WCAG AA contrast.", 12f, Theme.TEXT_MUTED).apply { setPadding(dp(8), dp(8), dp(8), 0); setLineSpacing(0f, 1.2f) })

        // ---- editor ---------------------------------------------------------------------------------
        content.addView(sectionTitle("Editor"))
        val ed = GroupCard(this)
        ed.row(ToggleRow(this, "Show tips", p.showHints, "Short coach marks the first time you use each mode").apply { onToggle = { p.showHints = it } })
        ed.row(NavRow(this, Icon.RESET, "Show all tips again").apply { onClick = { p.resetHints(); p.showHints = true; Snack.show(content.parent.parent as FrameLayout, "Tips will show again") } })
        ed.row(label("Measurement units", 15f, Theme.TEXT).apply { setPadding(0, dp(14), 0, dp(8)) })
        ed.row(Segmented(this, Units.values().map { it.label }, p.units).apply { onSelect = { p.units = it } })
        ed.row(View(this).apply { minimumHeight = dp(10) })
        ed.row(ToggleRow(this, "Autosave", p.autosave, "Save automatically when you leave the editor").apply { onToggle = { p.autosave = it } })
        ed.row(HSlider(this, "Undo history", 10f, 200f, p.undoSteps.toFloat(), 10f) { "${it.toInt()} steps" }.apply { onRelease = { v -> p.undoSteps = v.toInt() } })
        content.addView(ed)

        // ---- viewport --------------------------------------------------------------------------------
        content.addView(sectionTitle("Viewport"))
        val vp = GroupCard(this)
        vp.row(ToggleRow(this, "Scene stats", p.showStats, "Triangle counts in the corner").apply { onToggle = { p.showStats = it } })
        vp.row(ToggleRow(this, "Frame rate", p.showFps).apply { onToggle = { p.showFps = it } })
        vp.row(ToggleRow(this, "Smooth edges (4× MSAA)", p.msaa, "Applies next time a project opens").apply { onToggle = { p.msaa = it } })
        vp.row(ToggleRow(this, "Invert vertical orbit", p.invertOrbit).apply { onToggle = { p.invertOrbit = it } })
        vp.row(HSlider(this, "Orbit speed", 0.3f, 2.5f, p.orbitSpeed, 0.05f) { String.format("%.2f×", it) }.apply { onRelease = { v -> p.orbitSpeed = v } })
        content.addView(vp)

        // ---- sculpting -------------------------------------------------------------------------------
        content.addView(sectionTitle("Pen & touch"))
        val sc = GroupCard(this)
        sc.row(ToggleRow(this, "Stylus pressure", p.stylusPressure, "Press harder for stronger strokes").apply { onToggle = { p.stylusPressure = it } })
        sc.row(ToggleRow(this, "Stylus only", p.stylusOnly, "Fingers always move the camera").apply { onToggle = { p.stylusOnly = it } })
        sc.row(ToggleRow(this, "Two-finger tap to undo", p.tapUndo, "Three fingers to redo").apply { onToggle = { p.tapUndo = it } })
        content.addView(sc)

        // ---- about -------------------------------------------------------------------------------------
        content.addView(sectionTitle("About"))
        val ab = GroupCard(this)
        ab.row(hbox(0, 12).apply {
            setPadding(0, dp(12), 0, dp(12)); gravity = Gravity.CENTER_VERTICAL
            addView(LogoView(this@SettingsActivity, 44))
            addView(vbox().apply {
                addView(label("GLB&ME ${BuildConfigInfo.versionName(this@SettingsActivity)}", 16f, Theme.TEXT, bold = true))
                addView(label("Every feature included · works offline · no account", 12.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0) })
            })
        })
        ab.row(NavRow(this, Icon.SPARKLES, "What's new").apply { onClick = { WelcomeSheet.whatsNew(this@SettingsActivity) } })
        ab.row(NavRow(this, Icon.HELP, "Gestures & tips").apply { onClick = { HelpSheet.show(this@SettingsActivity) } })
        ab.row(NavRow(this, Icon.LINK, "Source code on GitHub").apply { onClick = { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/terpenesalad/GLB-ME"))) } } })
        content.addView(ab)
    }
}
