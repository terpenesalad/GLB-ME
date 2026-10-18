package app.glbandme.editor

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.TextPaint
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.ExportOrigin
import app.glbandme.core.io.ExportPipeline
import app.glbandme.core.io.ExportPreset
import app.glbandme.core.io.ExportScope
import app.glbandme.core.io.ExportSettings
import app.glbandme.core.io.ExportUnit
import app.glbandme.core.io.UpAxis
import app.glbandme.core.scene.Texture
import app.glbandme.data.ShareProvider
import app.glbandme.ui.Chip
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Fmt
import app.glbandme.ui.GroupCard
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.Icons
import app.glbandme.ui.PillButton
import app.glbandme.ui.Prefs
import app.glbandme.ui.PressableView
import app.glbandme.ui.Segmented
import app.glbandme.ui.TextureFactory
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.ln
import kotlin.math.exp

/**
 * Pro export: presets for games / web / AR / printing, every option on one page, a live file
 * size estimate and plain-language checks before you save or share.
 */
object ExportSheet {
    private val presets = ExportPreset.values().toList()
    private val presetIcons = listOf(Icon.CUBE_PLUS, Icon.GLOBE, Icon.CAMERA, Icon.SPARKLES, Icon.LAYER, Icon.SLIDERS)

    fun show(act: EditorActivity) {
        val ed = act.editor
        val prefs = Prefs.of(act)
        val s = ExportSettings()
        var preset = presets.getOrElse(prefs.exportPreset) { ExportPreset.GAME }
        preset.apply(s)
        if (preset == ExportPreset.CUSTOM) s.format = runCatching { ExportFormat.valueOf(prefs.defaultExport) }.getOrDefault(ExportFormat.GLB)
        s.animations = s.animations && ed.scene.hasAnimation()
        if (ed.scene.selected != null && ed.scene.objects.count { it.visible } > 1) s.scope = ExportScope.VISIBLE

        val root = act.vbox()
        val name = Dialogs.editText(act, act.exportBaseName(), "File name")
        root.addView(name, lp().apply { topMargin = dp(4) })

        // ---- presets -------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Made for"))
        val presetRow = act.hbox(0, 10)
        val cards = ArrayList<PresetCard>()
        val options = act.vbox()
        val summary = Summary(act)
        lateinit var refreshAll: () -> Unit
        presets.forEachIndexed { i, p ->
            val c = PresetCard(act, p, presetIcons[i]).apply { active = p == preset }
            c.onClick = {
                preset = p; p.apply(s)
                if (!ed.scene.hasAnimation()) s.animations = false
                cards.forEach { it.active = it.preset == p }
                refreshAll()
            }
            cards.add(c); presetRow.addView(c)
        }
        root.addView(HorizontalScrollView(act).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; addView(presetRow) })
        root.addView(options)
        root.addView(summary, lp().apply { topMargin = dp(14) })

        // ---- estimate --------------------------------------------------------------------------------
        val gen = AtomicInteger()
        val texCache = HashMap<String, Pair<ByteArray, String>>()
        fun filterFor(set: ExportSettings): ((Texture) -> Pair<ByteArray, String>)? {
            val max = set.maxTextureSize
            val needPngJpeg = set.format == ExportFormat.USDZ
            if (max == 0 && !needPngJpeg) return null
            return { t ->
                synchronized(texCache) {
                    texCache.getOrPut("${t.uid}:$max:$needPngJpeg") {
                        val limit = if (max == 0) 16384 else max
                        TextureFactory.downscale(t, limit, pngOrJpegOnly = needPngJpeg)
                    }
                }
            }
        }
        val estimate = Runnable {
            val id = gen.incrementAndGet()
            val set = s.copy()
            summary.setPending(set)
            act.async({
                val warnings = ExportPipeline.validate(ed.scene, set)
                val res = if (ExportPipeline.select(ed.scene, set).isEmpty()) null else ExportPipeline.export(ed.scene, set, filterFor(set))
                Triple(warnings, res?.bundle("x", set.format.ext)?.first?.size ?: 0, res?.triangles ?: 0)
            }, onError = { if (id == gen.get()) summary.setError(it.message ?: "Couldn't estimate") }) { (w, size, tris) ->
                if (id == gen.get()) summary.setResult(set, size.toLong(), tris, w)
            }
        }
        fun scheduleEstimate() { summary.removeCallbacks(estimate); summary.postDelayed(estimate, 350) }

        fun buildOptions() {
            options.removeAllViews()
            // format
            options.addView(act.sectionTitle("Format"))
            val fr = act.hbox(0, 8)
            for (f in ExportFormat.values()) fr.addView(Chip(act, f.label).apply {
                active = f == s.format
                onClick = { s.format = f; preset = ExportPreset.CUSTOM; cards.forEach { it.active = it.preset == preset }; refreshAll() }
            })
            options.addView(HorizontalScrollView(act).apply { isHorizontalScrollBarEnabled = false; addView(fr) })
            options.addView(act.label(s.format.description, 12f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(6), 0, 0) })

            fun seg(title: String, labels: List<String>, sel: Int, set: (Int) -> Unit) {
                options.addView(act.label(title, 13f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(12), 0, dp(6)) })
                options.addView(Segmented(act, labels, sel).apply { onSelect = { set(it); preset = ExportPreset.CUSTOM; cards.forEach { c -> c.active = c.preset == preset }; scheduleEstimate() } })
            }
            options.addView(act.sectionTitle("What to include"))
            seg("Objects", listOf("Visible", "Selected", "Everything"), s.scope.ordinal) { s.scope = ExportScope.values()[it] }

            options.addView(act.sectionTitle("Placement"))
            seg("Origin", listOf("As placed", "Centred", "On ground"), s.origin.ordinal) { s.origin = ExportOrigin.values()[it] }
            seg("Units", listOf("m", "cm", "mm", "in"), s.unit.ordinal) { s.unit = ExportUnit.values()[it] }
            if (s.format in setOf(ExportFormat.STL, ExportFormat.OBJ, ExportFormat.PLY)) seg("Up axis", listOf("Y up", "Z up"), s.up.ordinal) { s.up = UpAxis.values()[it] }
            else if (s.up != UpAxis.Y) s.up = UpAxis.Y

            options.addView(act.sectionTitle("Detail"))
            val total = ExportPipeline.select(ed.scene, s).sumOf { it.mesh.triangleCount }.coerceAtLeast(1)
            // log slider: far left = keep everything
            val maxLog = ln(total.toFloat().coerceAtLeast(1001f))
            val minLog = ln(1000f)
            val startV = if (s.maxTriangles <= 0 || s.maxTriangles >= total) 1f else ((ln(s.maxTriangles.toFloat()) - minLog) / (maxLog - minLog)).coerceIn(0f, 0.99f)
            options.addView(HSlider(act, "Triangle limit", 0f, 1f, startV, 0f) { v ->
                if (v >= 0.995f) "Keep all ${Fmt.count(total)}" else Fmt.count(exp(minLog + (maxLog - minLog) * v).toInt())
            }.apply {
                onChange = { v -> s.maxTriangles = if (v >= 0.995f) 0 else exp(minLog + (maxLog - minLog) * v).toInt() }
                onRelease = { preset = ExportPreset.CUSTOM; cards.forEach { c -> c.active = c.preset == preset }; scheduleEstimate() }
            }, lp())
            options.addView(act.label("Lower limits make lighter files – shapes are simplified smartly, your project isn't changed.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(2), 0, 0) })

            if (s.format !in setOf(ExportFormat.STL, ExportFormat.PLY)) {
                options.addView(act.sectionTitle("Textures"))
                val sizes = listOf(0, 4096, 2048, 1024, 512)
                val texCard = GroupCard(act)
                texCard.row(ToggleRow(act, "Include textures", s.textures).apply { onToggle = { s.textures = it; preset = ExportPreset.CUSTOM; refreshAll() } })
                options.addView(texCard)
                if (s.textures) seg("Max texture size", listOf("Original", "4K", "2K", "1K", "512"), sizes.indexOf(s.maxTextureSize).coerceAtLeast(0)) { s.maxTextureSize = sizes[it] }
            }

            options.addView(act.sectionTitle("Extras"))
            val extras = GroupCard(act)
            if (s.format != ExportFormat.STL) extras.row(ToggleRow(act, "Painted colours", s.vertexColors, "Vertex colours from Paint mode").apply { onToggle = { s.vertexColors = it; scheduleEstimate() } })
            if (s.format in setOf(ExportFormat.GLB, ExportFormat.GLTF, ExportFormat.USDZ)) extras.row(ToggleRow(act, "Animation", s.animations && ed.scene.hasAnimation(), if (ed.scene.hasAnimation()) "Keyframes play in viewers & engines" else "This scene has no keyframes").apply {
                isEnabled = ed.scene.hasAnimation(); onToggle = { s.animations = it; scheduleEstimate() }
            })
            if (s.format == ExportFormat.OBJ) extras.row(ToggleRow(act, "Materials file (.mtl)", s.objMaterials, "Delivered as a .zip with textures").apply { onToggle = { s.objMaterials = it; scheduleEstimate() } })
            if (extras.childCount > 0) options.addView(extras)
        }
        refreshAll = { buildOptions(); scheduleEstimate() }
        refreshAll()

        // ---- actions -------------------------------------------------------------------------------
        lateinit var dialog: Dialog
        fun run(then: (ByteArray, String, String) -> Unit) {
            val set = s.copy()
            val base = name.text.toString().trim().ifEmpty { "model" }.replace(Regex("[\\\\/:*?\"<>|]"), "_")
            val progress = Dialogs.progress(act, "Exporting ${set.format.label}…")
            act.async({
                ed.locked { ExportPipeline.export(ed.scene, set, filterFor(set)) }.bundle(base, set.format.ext)
            }, onError = { progress.dismiss(); act.showError(it) }) { (bytes, fileName) ->
                progress.dismiss()
                prefs.defaultExport = set.format.name
                prefs.exportPreset = presets.indexOf(preset)
                val mime = if (fileName.endsWith(".zip")) "application/zip" else set.format.mime
                then(bytes, fileName, mime)
            }
        }
        val row = act.hbox(0, 10).apply { setPadding(0, dp(18), 0, 0) }
        row.addView(PillButton(act, "Share", Icon.SHARE).apply { onClick = { dialog.dismiss(); run { b, n, m -> ShareProvider.share(act, n, b, "Share model", m) } } }, lp(0, dp(50), 1f))
        row.addView(PillButton(act, "Save to Files", Icon.DOWNLOAD, PillButton.Style.PRIMARY).apply { onClick = { dialog.dismiss(); run { b, n, m -> act.saveExport(b, n, m) } } }, lp(0, dp(50), 1.3f))
        root.addView(row)
        dialog = Dialogs.sheet(act, "Export", root, action = null, tall = true)
        dialog.setOnDismissListener { gen.incrementAndGet(); summary.removeCallbacks(estimate) }
    }

    /** Preset tile. */
    @SuppressLint("ViewConstructor")
    class PresetCard(ctx: Context, val preset: ExportPreset, private val icon: Icon) : PressableView(ctx) {
        var active = false; set(v) { field = v; isSelected = v; invalidate() }
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)
        private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
        private val r = RectF()
        override val a11yClass = "android.widget.RadioButton"
        init { describe("${preset.label}. ${preset.subtitle}") }
        override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(dp(150), (dp(70f) + sp(14f) + sp(11f) * 2.6f).toInt())
        override fun onDraw(c: Canvas) {
            val w = width.toFloat(); val h = height.toFloat()
            r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
            p.style = Paint.Style.FILL
            p.color = if (active) Theme.withAlpha(Theme.accent, 0.22f) else Theme.SURFACE_2
            c.drawRoundRect(r, dp(16f), dp(16f), p)
            if (active) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(2f); p.color = Theme.accent; c.drawRoundRect(r, dp(16f), dp(16f), p); p.style = Paint.Style.FILL }
            if (pressedNow) { p.color = 0x1AFFFFFF; c.drawRoundRect(r, dp(16f), dp(16f), p) }
            r.set(dp(12f), dp(12f), dp(46f), dp(46f))
            p.color = if (active) Theme.accent else Theme.SURFACE_3
            c.drawRoundRect(r, dp(10f), dp(10f), p)
            Icons.draw(c, icon, r.centerX(), r.centerY(), dp(20f), 0xFFFFFFFF.toInt())
            tp.typeface = Theme.medium; tp.textSize = sp(14f); tp.color = Theme.TEXT
            c.drawText(TextUtils.ellipsize(preset.label, tp, w - dp(24f), TextUtils.TruncateAt.END).toString(), dp(12f), dp(62f) + sp(14f) * 0.7f, tp)
            tp.typeface = Theme.regular; tp.textSize = sp(11f); tp.color = Theme.TEXT_MUTED
            val layout = android.text.StaticLayout.Builder.obtain(preset.subtitle, 0, preset.subtitle.length, tp, (w - dp(24f)).toInt()).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
            c.save(); c.translate(dp(12f), dp(66f) + sp(14f)); layout.draw(c); c.restore()
        }
        override fun onInitializeAccessibilityNodeInfo(info: android.view.accessibility.AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.isCheckable = true; info.isChecked = active
        }
    }

    /** Live summary: size estimate + warnings. */
    @SuppressLint("ViewConstructor")
    class Summary(ctx: Context) : LinearLayout(ctx) {
        private val title = ctx.label("", 17f, Theme.TEXT, bold = true)
        private val detail = ctx.label("", 12.5f, Theme.TEXT_DIM)
        private val warn = ctx.vbox()
        init {
            orientation = VERTICAL
            background = Theme.rounded(Theme.SURFACE, 16f, Theme.STROKE, 1f)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            addView(title); addView(detail, lp().apply { topMargin = dp(4) }); addView(warn)
            accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
        }
        fun setPending(s: ExportSettings) { title.text = "${s.format.label} · estimating…"; title.alpha = 0.7f }
        fun setError(msg: String) { title.text = "Couldn't estimate"; title.alpha = 1f; detail.text = msg }
        fun setResult(s: ExportSettings, bytes: Long, tris: Int, warnings: List<String>) {
            title.alpha = 1f
            title.text = if (bytes > 0) "${s.format.label} · ${Fmt.bytes(bytes)}" else s.format.label
            detail.text = "${Fmt.count(tris)} triangles · ${s.unit.label.lowercase()} · ${s.up.label}${if (s.textures && s.maxTextureSize > 0) " · textures ≤ ${s.maxTextureSize}px" else ""}"
            warn.removeAllViews()
            for (w in warnings) {
                val row = context.hbox(0, 8).apply { setPadding(0, dp(8), 0, 0); gravity = Gravity.TOP }
                row.addView(object : View(context) {
                    override fun onDraw(c: Canvas) = Icons.draw(c, Icon.INFO, width / 2f, height / 2f, dp(16f), Theme.WARNING)
                }, LayoutParams(dp(18), dp(18)))
                row.addView(context.label(w, 12.5f, Theme.TEXT).apply { setLineSpacing(0f, 1.15f) }, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
                warn.addView(row)
            }
        }
    }
}
