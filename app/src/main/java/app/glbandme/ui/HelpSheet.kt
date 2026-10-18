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
            "The bar at the bottom switches modes: Object (move & arrange), Sculpt, Paint, Edit (faces) and Animate. The strip above it only shows tools for that mode.",
            "The buttons on the side open Layers, Add, Inspect (object, material, mesh) and View. Drag a panel's handle to make it taller, or swipe it down to close.",
            "Add › 3D Text lets you type, choose a font – including your own .ttf / .otf files – and adjust depth and bevel live.",
            "Add › Draw turns a finger drawing into a 3D shape: extrude it, revolve it into a vase, or sweep a tube.",
            "Inspect › Material has photos, built-in seamless textures, stickers and tiling controls. To texture only part of a model, select faces in Edit mode and tap Material.",
            "In Sculpt, the side sliders set brush size and strength; the minus button digs in instead of building up. Mirror symmetry is on by default.",
            "Shapes and text stay adjustable in Inspect until you sculpt or edit them.",
            "Export creates GLB, glTF, USDZ (AR Quick Look), OBJ, STL or PLY with presets for games, web, AR and 3D printing.",
        )) body.addView(act.label("•  $tip", 13.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(4), 0, dp(4)); setLineSpacing(0f, 1.2f) })
        body.addView(act.label("GLB&ME – every feature unlocked, no account, works offline.", 12f, Theme.TEXT_MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(18), 0, 0) })
        Dialogs.custom(act, "How to use GLB&ME", body, "Got it", null)
    }
}
