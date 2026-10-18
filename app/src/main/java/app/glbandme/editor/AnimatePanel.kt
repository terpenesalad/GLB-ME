package app.glbandme.editor

import android.view.View
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.MenuItem
import app.glbandme.ui.Segmented
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** Keyframe animation settings; the timeline itself docks at the bottom. */
class AnimatePanel(act: EditorActivity) : Panel(act) {
    override val title = "Animate"
    override val icon = Icon.ANIMATE
    override val rebuildOn = setOf(Change.SELECTION, Change.UNDO)

    override fun build(): View {
        val root = act.vbox()
        val s = ed.scene
        root.addView(act.label("Pose objects with the Transform tool, then tap ◆ on the timeline to key them. Exported GLBs keep the animation (glTF channels).", 12.5f, Theme.TEXT_DIM).apply { setPadding(dp(2), dp(4), 0, dp(4)); setLineSpacing(0f, 1.15f) })
        root.addView(act.sectionTitle("Timing"))
        val fpsOpts = listOf(12, 24, 30, 60)
        root.addView(Segmented(act, fpsOpts.map { "$it fps" }, fpsOpts.indexOf(s.fps).coerceAtLeast(0)).apply {
            onSelect = { i -> ed.locked { s.fps = fpsOpts[i] }; ed.notify(Change.ANIMATION) }
        })
        root.addView(HSlider(act, "Length", 10f, 600f, s.frameCount.toFloat(), 1f) { v -> "${v.toInt()} frames · ${String.format("%.1f", v / s.fps)}s" }.apply {
            onRelease = { v -> ed.locked { s.frameCount = v.toInt() }; ed.notify(Change.ANIMATION) }
        }, lp().apply { topMargin = dp(6) })
        root.addView(ToggleRow(act, "Loop playback", ed.loop).apply { onToggle = { ed.loop = it } }, lp())
        root.addView(ToggleRow(act, "Auto-key", ed.autoKey, "Transform changes record keyframes").apply { onToggle = { ed.autoKey = it; ed.notify(Change.ANIMATION) } }, lp())

        root.addView(act.sectionTitle("Quick animations"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.ROTATE, "Turntable") { if (s.selected == null) act.status("Select an object", 1000) else { ed.turntable(); act.status("360° spin over ${s.frameCount} frames", 1400) } },
            Triple(Icon.MOVE, "Transform") { act.selectTool(Tool.TRANSFORM) },
            Triple(Icon.PLAY, "Play") { act.togglePlayback() },
            Triple(Icon.TRASH, "Clear") {
                Dialogs.menu(act, "Clear animation", listOf(
                    MenuItem(Icon.TRASH, "Selected object", danger = true) { ed.clearAnimation(false) },
                    MenuItem(Icon.TRASH, "All objects", danger = true) { ed.clearAnimation(true) },
                ))
            },
        )))
        val o = s.selected
        if (o != null) root.addView(act.label("${o.name}: ${o.keys.size} keyframe(s)", 12f, Theme.TEXT_MUTED).apply { setPadding(dp(2), dp(10), 0, 0) })
        return root
    }
}
