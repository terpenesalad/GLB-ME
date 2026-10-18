package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.label
import kotlin.math.roundToInt

/** Keyframe timeline docked above the bottom bar while the Animate panel is open. */
@SuppressLint("ViewConstructor")
class Timeline(private val act: EditorActivity, private val ed: Editor) : LinearLayout(act) {
    private val play = IconButton(act, Icon.PLAY, sizeDp = 38)
    private val frameLabel: TextView
    private val track = Track(act)
    private val auto = IconButton(act, Icon.AUTO, sizeDp = 38)

    init {
        orientation = VERTICAL
        background = GradientDrawable().apply { setColor(0xE6161821.toInt()); cornerRadius = dp(16f); setStroke(1, 0x22FFFFFF) }
        setPadding(dp(6), dp(2), dp(6), dp(4))
        val row = LinearLayout(act).apply { orientation = HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        play.onClick = { act.togglePlayback() }
        row.addView(play)
        row.addView(IconButton(act, Icon.PREV, sizeDp = 38).apply { onClick = { jumpKey(-1) } })
        row.addView(IconButton(act, Icon.NEXT, sizeDp = 38).apply { onClick = { jumpKey(1) } })
        frameLabel = act.label("", 12.5f, Theme.TEXT, bold = true).apply { typeface = Theme.mono; setPadding(dp(6), 0, dp(6), 0) }
        row.addView(frameLabel, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        row.addView(IconButton(act, Icon.KEY, sizeDp = 38).apply { onClick = { if (ed.scene.selected == null) act.status("Select an object to key", 1200) else { ed.keySelected(); act.status("Keyframe @ ${ed.scene.currentFrame.toInt()}", 900) } } })
        row.addView(IconButton(act, Icon.KEY_DELETE, sizeDp = 38).apply { onClick = { ed.deleteKey() } })
        auto.onClick = { ed.autoKey = !ed.autoKey; auto.active = ed.autoKey; act.status(if (ed.autoKey) "Auto-key on: transforms create keyframes" else "Auto-key off", 1400) }
        auto.active = ed.autoKey
        row.addView(auto)
        addView(row)
        addView(track, LayoutParams(LayoutParams.MATCH_PARENT, dp(42)))
        refresh()
    }

    private fun jumpKey(dir: Int) {
        val frames = (ed.scene.selected?.keys?.keys ?: ed.scene.objects.flatMap { it.keys.keys }.toSortedSet()).toList().sorted()
        if (frames.isEmpty()) return
        val cur = ed.scene.currentFrame.roundToInt()
        val target = if (dir > 0) frames.firstOrNull { it > cur } ?: frames.first() else frames.lastOrNull { it < cur } ?: frames.last()
        ed.setFrame(target.toFloat())
    }

    fun onChanged(c: Set<Change>) {
        if (c.any { it == Change.FRAME || it == Change.ANIMATION || it == Change.SELECTION || it == Change.UNDO || it == Change.OBJECTS }) refresh()
    }

    private fun refresh() {
        val s = ed.scene
        play.icon = if (ed.playing) Icon.PAUSE else Icon.PLAY
        play.active = ed.playing
        play.invalidate()
        val secs = s.currentFrame / s.fps.coerceAtLeast(1)
        frameLabel.text = String.format("%3d / %d  ·  %.2fs", s.currentFrame.roundToInt(), s.frameCount, secs)
        track.invalidate()
    }

    private inner class Track(ctx: Context) : View(ctx) {
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        private val path = Path()

        private fun xOf(f: Float): Float {
            val pad = dp(12f)
            return pad + (width - 2 * pad) * (f / ed.scene.frameCount.coerceAtLeast(1))
        }

        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            val s = ed.scene
            r.set(dp(4f), h * 0.3f, w - dp(4f), h * 0.85f)
            p.color = Theme.SURFACE_2
            c.drawRoundRect(r, dp(8f), dp(8f), p)
            // ticks
            val n = s.frameCount.coerceAtLeast(1)
            val step = when { n <= 60 -> 5; n <= 180 -> 10; n <= 600 -> 30; else -> 60 }
            p.textSize = dp(9f); p.textAlign = Paint.Align.CENTER
            var f = 0
            while (f <= n) {
                val x = xOf(f.toFloat())
                p.color = 0x33FFFFFF
                c.drawRect(x - 0.5f, h * 0.3f, x + 0.5f, h * 0.45f, p)
                if (f % (step * 2) == 0) { p.color = Theme.TEXT_MUTED; c.drawText("$f", x, h * 0.24f, p) }
                f += step
            }
            // keys for all objects (faint) and the selected one
            val sel = s.selected
            for (o in s.objects) {
                val mine = o === sel
                p.color = if (mine) Theme.WARNING else 0x55FFFFFF
                val y = h * 0.575f
                val rad = dp(if (mine) 6f else 3.5f)
                for (k in o.keys.keys) {
                    val x = xOf(k.toFloat())
                    path.reset(); path.moveTo(x, y - rad); path.lineTo(x + rad, y); path.lineTo(x, y + rad); path.lineTo(x - rad, y); path.close()
                    c.drawPath(path, p)
                }
            }
            // playhead
            val px = xOf(s.currentFrame)
            p.color = Theme.accent
            c.drawRect(px - dp(1.5f), h * 0.18f, px + dp(1.5f), h * 0.95f, p)
            c.drawCircle(px, h * 0.18f, dp(5f), p)
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            parent?.requestDisallowInterceptTouchEvent(true)
            if (e.actionMasked == MotionEvent.ACTION_DOWN && ed.playing) act.stopPlayback()
            val pad = dp(12f)
            val t = ((e.x - pad) / (width - 2 * pad)).coerceIn(0f, 1f)
            ed.setFrame((t * ed.scene.frameCount).roundToInt().toFloat())
            return true
        }
    }
}
