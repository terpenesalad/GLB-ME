package app.glbandme.ui

import android.app.Activity
import android.graphics.Canvas
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import app.glbandme.ui.Theme.dp

/** First-run welcome and "What's new" sheets (Apple style feature lists). */
object WelcomeSheet {
    private fun feature(act: Activity, icon: Icon, color: Int, title: String, body: String): View = act.hbox(0, 16).apply {
        gravity = Gravity.TOP
        setPadding(0, dp(12), 0, dp(12))
        addView(object : View(act) {
            override fun onDraw(c: Canvas) = Icons.draw(c, icon, width / 2f, height / 2f, dp(30f), color)
        }.apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }, LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(act.vbox().apply {
            addView(act.label(title, 16f, Theme.TEXT, bold = true))
            addView(act.label(body, 14f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0); setLineSpacing(0f, 1.2f) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
    }

    private fun sheet(act: Activity, title: String, items: List<View>, button: String, onDone: () -> Unit) {
        val body = act.vbox().apply { setPadding(dp(8), dp(4), dp(8), dp(4)) }
        body.addView(LogoView(act, 64), LinearLayout.LayoutParams(dp(64), dp(64)).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(8) })
        body.addView(act.label(title, 26f, Theme.TEXT, bold = true).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(14)) }, lp())
        for (v in items) body.addView(v, lp())
        lateinit var d: android.app.Dialog
        body.addView(PillButton(act, button, style = PillButton.Style.PRIMARY).apply { onClick = { d.dismiss() } }, lp().apply { topMargin = dp(20) })
        d = Dialogs.custom(act, null, body, null, null)
        d.setOnDismissListener { onDone() }
    }

    fun welcome(act: Activity, onDone: () -> Unit = {}) = sheet(act, "Welcome to GLB&ME", listOf(
        feature(act, Icon.CLAY, Theme.accentLight(), "Sculpt like clay", "Push, pull, smooth and pinch with your finger or stylus – with symmetry and masks."),
        feature(act, Icon.SHAPES, Theme.CYAN, "Build anything", "25 shapes, 3D text in any font, drawings you can extrude or spin, images and stickers."),
        feature(act, Icon.TEXTURE, 0xFFFF9F0A.toInt(), "Paint & texture", "Colours, photos and seamless built-in textures – on the whole model or just one part."),
        feature(act, Icon.EXPORT, Theme.SUCCESS, "Export everywhere", "GLB, glTF, USDZ, OBJ, STL and PLY with presets for games, web, AR and 3D printing."),
    ), "Get started", onDone)

    fun whatsNew(act: Activity, onDone: () -> Unit = {}) = sheet(act, "What's new in 1.1", listOf(
        feature(act, Icon.SLIDERS, Theme.accentLight(), "A calmer, clearer editor", "Modes at the bottom, only the tools you need, and panels that slide up without hiding your model."),
        feature(act, Icon.TEXT, Theme.CYAN, "3D text with your fonts", "Import any .ttf or .otf, then shape it with depth, bevels, spacing and alignment – live."),
        feature(act, Icon.TEXTURE, 0xFFFF9F0A.toInt(), "Textures for every part", "Built-in seamless textures, tiling, stickers that wrap around curves, and per-part materials."),
        feature(act, Icon.SPARKLES, 0xFFFF375F.toInt(), "Create more", "14 new shapes, finger drawing to 3D, arrays, and one-tap animations."),
        feature(act, Icon.EXPORT, Theme.SUCCESS, "Pro export", "USDZ for iPhone AR, OBJ with materials, units, triangle limits and a live file size."),
        feature(act, Icon.ACCESSIBILITY, 0xFF64D2FF.toInt(), "Made for everyone", "Larger interface and text, bold text, reduced motion, left-handed layout and full TalkBack support."),
    ), "Continue", onDone)
}
