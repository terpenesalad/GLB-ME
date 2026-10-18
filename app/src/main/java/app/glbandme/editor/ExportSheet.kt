package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.text.TextUtils
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.SceneIO
import app.glbandme.data.ShareProvider
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Fmt
import app.glbandme.ui.PillButton
import app.glbandme.ui.Prefs
import app.glbandme.ui.PressableView
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

object ExportSheet {
    fun show(act: EditorActivity) {
        val ed = act.editor
        val prefs = Prefs.of(act)
        var format = runCatching { ExportFormat.valueOf(prefs.defaultExport) }.getOrDefault(ExportFormat.GLB)
        val root = act.vbox()
        val name = Dialogs.editText(act, act.exportBaseName(), "File name")
        root.addView(name)
        root.addView(act.sectionTitle("Format"))
        val cards = ArrayList<FormatCard>()
        val grid = act.vbox(0, 8)
        for (f in ExportFormat.values()) {
            val c = FormatCard(act, f).apply { active = f == format }
            c.onClick = { format = f; cards.forEach { it.active = it.format == f } }
            cards.add(c); grid.addView(c, lp())
        }
        root.addView(grid)
        root.addView(act.sectionTitle("Options"))
        val onlySel = ToggleRow(act, "Selected object only", false)
        val hidden = ToggleRow(act, "Include hidden objects", false)
        val colors = ToggleRow(act, "Vertex colors (paint)", true)
        val anim = ToggleRow(act, "Animation", ed.scene.hasAnimation(), "GLB / glTF only")
        for (t in listOf(onlySel, hidden, colors, anim)) root.addView(t, lp())
        val stats = act.label("${ed.scene.objects.count { it.visible }} visible objects · ${Fmt.count(ed.scene.totalTriangles())} triangles · textures embedded", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(2), dp(8), 0, 0) }
        root.addView(stats)

        lateinit var dialog: android.app.Dialog
        fun build(then: (ByteArray, String, String) -> Unit) {
            val opt = GltfExportOptions(onlySelected = onlySel.checked, includeHidden = hidden.checked, vertexColors = colors.checked, animations = anim.checked)
            val f = format
            val base = name.text.toString().trim().ifEmpty { "model" }
            val progress = Dialogs.progress(act, "Exporting ${f.label}…")
            act.async({ ed.locked { SceneIO.export(ed.scene, f, opt) } }, onError = { progress.dismiss(); act.showError(it) }) { bytes ->
                progress.dismiss()
                prefs.defaultExport = f.name
                then(bytes, "$base.${f.ext}", f.mime)
            }
        }
        val row = act.hbox(0, 10).apply { setPadding(0, dp(16), 0, 0) }
        row.addView(PillButton(act, "Share", app.glbandme.ui.Icon.SHARE).apply {
            onClick = { dialog.dismiss(); build { b, n, _ -> ShareProvider.share(act, n, b, "Share model") } }
        }, lp(0, dp(46), 1f))
        row.addView(PillButton(act, "Save", app.glbandme.ui.Icon.SAVE, PillButton.Style.PRIMARY).apply {
            onClick = { dialog.dismiss(); build { b, n, m -> act.saveExport(b, n, m) } }
        }, lp(0, dp(46), 1f))
        root.addView(row)
        dialog = Dialogs.custom(act, "Export", root, null, null)
    }

    @SuppressLint("ViewConstructor")
    class FormatCard(ctx: Context, val format: ExportFormat) : PressableView(ctx) {
        var active = false; set(v) { field = v; invalidate() }
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(resolveSize(dp(300), w), dp(58))
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
            p.style = Paint.Style.FILL
            p.color = if (active) Theme.withAlpha(Theme.accent, 0.2f) else Theme.SURFACE_2
            c.drawRoundRect(r, dp(14f), dp(14f), p)
            if (active) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = Theme.accent; c.drawRoundRect(r, dp(14f), dp(14f), p) }
            p.style = Paint.Style.FILL
            if (pressedNow) { p.color = 0x18FFFFFF; c.drawRoundRect(r, dp(14f), dp(14f), p) }
            r.set(dp(10f), dp(11f), dp(62f), h - dp(11f))
            p.color = if (active) Theme.accent else Theme.SURFACE_3
            c.drawRoundRect(r, dp(9f), dp(9f), p)
            tp.typeface = Theme.bold; tp.textSize = sp(12.5f); tp.color = 0xFFFFFFFF.toInt(); tp.textAlign = Paint.Align.CENTER
            c.drawText(".${format.ext}", r.centerX(), r.centerY() + dp(4.5f), tp)
            tp.textAlign = Paint.Align.LEFT
            tp.typeface = Theme.medium; tp.textSize = sp(14.5f); tp.color = Theme.TEXT
            c.drawText(format.label, dp(74f), h / 2 - dp(3f), tp)
            tp.typeface = Theme.regular; tp.textSize = sp(11.5f); tp.color = Theme.TEXT_MUTED
            c.drawText(TextUtils.ellipsize(format.description, tp, w - dp(86f), TextUtils.TruncateAt.END).toString(), dp(74f), h / 2 + dp(14f), tp)
        }
    }
}
