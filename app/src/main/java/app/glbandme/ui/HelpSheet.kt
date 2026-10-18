package app.glbandme.ui

import android.app.Activity
import android.view.Gravity
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp

object HelpSheet {
    private val gestures = listOf(
        Icon.ROTATE_VIEW to ("1 finger on background" to "Orbit the camera"),
        Icon.MOVE to ("2 fingers drag" to "Pan the view"),
        Icon.SCALE to ("Pinch" to "Zoom in and out"),
        Icon.DRAW to ("1 finger on a model" to "Sculpt / paint / select with the active tool"),
        Icon.UNDO to ("Tap with 2 fingers" to "Undo"),
        Icon.REDO to ("Tap with 3 fingers" to "Redo"),
        Icon.FOCUS to ("Double tap" to "Frame the selected object"),
        Icon.GLOBE to ("Tap the axis navigator" to "Snap to front / side / top views"),
    )

    fun show(act: Activity) {
        val body = act.vbox()
        body.addView(act.label("Gestures", 13f, Theme.TEXT_MUTED, bold = true).apply { setPadding(0, 0, 0, dp(8)) })
        for ((icon, t) in gestures) {
            val row = act.hbox(0, 14).apply { setPadding(0, dp(8), 0, dp(8)) }
            row.addView(IconButton(act, icon, sizeDp = 38).apply { filled = true; isEnabled = true })
            val col = act.vbox()
            col.addView(act.label(t.first, 14.5f, Theme.TEXT, bold = true))
            col.addView(act.label(t.second, 12.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0) })
            row.addView(col, lp(0, WRAP, 1f))
            body.addView(row)
        }
        body.addView(act.label("Tips", 13f, Theme.TEXT_MUTED, bold = true).apply { setPadding(0, dp(16), 0, dp(8)) })
        for (tip in listOf(
            "The left sliders set brush Radius and Intensity. The minus button inverts the brush (dig instead of add).",
            "Symmetry (X) mirrors every stroke across the model's center.",
            "Mask protects areas from sculpting – paint it with the Mask tool, then Invert / Blur from the bottom bar.",
            "Shapes stay editable (size, segments…) in the Scene panel until you sculpt them.",
            "Everything is saved as GLB with your editor state, so projects reopen exactly as you left them.",
            "Export to GLB, glTF, OBJ, STL or PLY from the ⋮ menu – or share directly to other apps.",
        )) body.addView(act.label("•  $tip", 13.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(4), 0, dp(4)); setLineSpacing(0f, 1.2f) })
        body.addView(act.label("GLB&ME – every feature unlocked, no account, works offline.", 12f, Theme.TEXT_MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(18), 0, 0) })
        Dialogs.custom(act, "How to use GLB&ME", body, "Got it", null)
    }
}
