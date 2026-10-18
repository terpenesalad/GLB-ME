package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.TextSpec
import app.glbandme.math.Vec3
import app.glbandme.ui.Chip
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.FontStore
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.Icons
import app.glbandme.ui.MenuItem
import app.glbandme.ui.PressableView
import app.glbandme.ui.Segmented
import app.glbandme.ui.Swatch
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import java.util.concurrent.atomic.AtomicInteger

/**
 * Text studio: type, pick a font (system or imported .ttf/.otf), style, depth and bevel –
 * the 3D text updates live in the viewport above the sheet.
 */
object TextStudio {
    /** Create a new text object and open the studio for it. */
    fun create(act: EditorActivity, initial: String = "Title") {
        val ed = act.editor
        val spec = TextSpec(text = initial, font = lastFont ?: "sys:sans-serif-black")
        val mesh = TextMesh.build(act, spec) ?: return
        val o = SceneObject(initial.take(16), mesh, Material.preset(MaterialPreset.GLOSSY_PAINT).apply { name = "Text" })
        o.text = spec
        val (mn, _) = mesh.bounds()
        o.position.y = -mn.y
        ed.scene.bounds()?.let { (_, hi) -> if (ed.scene.objects.any { it.visible }) o.position.z = hi.z + 0.4f }
        ed.addObject(o, "Add text")
        act.selectTool(Tool.TRANSFORM)
        edit(act, o, fresh = true)
    }

    fun edit(act: EditorActivity, o: SceneObject, fresh: Boolean = false) {
        if (o.text == null) return
        act.openPanel("text", TextStudioPanel(act, o, fresh))
    }

    var lastFont: String? = null
}

class TextStudioPanel(act: EditorActivity, private val o: SceneObject, private val fresh: Boolean) : Panel(act) {
    override val title = "3D Text"
    override val icon = Icon.TEXT
    override val rebuildOn = emptySet<Change>()

    private val spec: TextSpec = o.text!!.copy()
    private val beforeMesh: Mesh = o.mesh
    private val beforeSpec: TextSpec? = o.text?.copy()
    private val beforePos: Vec3 = o.position.copy()
    private val gen = AtomicInteger()
    private var fontRow: LinearLayout? = null

    private val rebuildRunnable = Runnable { rebuildNow() }

    private fun schedule() {
        val v = act.sheet
        v.removeCallbacks(rebuildRunnable)
        v.postDelayed(rebuildRunnable, 140)
    }

    private fun rebuildNow() {
        val id = gen.incrementAndGet()
        val s = spec.copy()
        act.async({ TextMesh.build(act, s) }, onError = { act.status("Couldn't build that text", 1200) }) { m ->
            if (id != gen.get()) return@async
            if (m == null) { if (s.text.isNotBlank()) act.status("This font has no shapes for that text", 1400); return@async }
            ed.setTextMesh(o, s, m)
            if (fresh) ed.locked { o.name = s.text.lines().first().take(16).ifBlank { "Text" } }
        }
    }

    override fun onClosed() {
        act.sheet.removeCallbacks(rebuildRunnable)
        if (o.text != beforeSpec || o.mesh !== beforeMesh) {
            if (!fresh) ed.commitText(o, beforeMesh, beforeSpec, beforePos)
            ed.notify(Change.OBJECTS)
        }
    }

    override fun headerActions(): List<View> = emptyList()

    @SuppressLint("SetTextI18n")
    override fun build(): View {
        val root = act.vbox()
        // ---- text input ------------------------------------------------------------------------
        val et = Dialogs.editText(act, spec.text, "Type something").apply {
            isSingleLine = false
            maxLines = 4
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            textSize = 20f * Theme.uiScale
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { spec.text = s?.toString() ?: ""; if (spec.text.isNotBlank()) schedule() }
            })
        }
        root.addView(et, lp().apply { topMargin = dp(6) })

        // ---- fonts --------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Font"))
        val row = act.hbox(0, 8)
        fontRow = row
        fillFonts(row)
        root.addView(HorizontalScrollView(act).apply { isHorizontalScrollBarEnabled = false; clipToPadding = false; addView(row) })
        root.addView(act.label("Have a font file for your game title? Tap Import and pick its .ttf or .otf.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(8), 0, 0) })

        // ---- style -------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Style"))
        val style = act.hbox(0, 8).apply { gravity = Gravity.CENTER_VERTICAL }
        style.addView(Chip(act, "Bold", Icon.BOLD).apply { active = spec.bold; onClick = { spec.bold = !spec.bold; active = spec.bold; schedule() } })
        style.addView(Chip(act, "Italic", Icon.ITALIC).apply { active = spec.italic; onClick = { spec.italic = !spec.italic; active = spec.italic; schedule() } })
        root.addView(style)
        root.addView(Segmented(act, listOf("Left", "Centre", "Right"), spec.align, listOf(Icon.ALIGN_LEFT, Icon.ALIGN_CENTER, Icon.ALIGN_RIGHT)).apply {
            onSelect = { spec.align = it; schedule() }
        }, lp().apply { topMargin = dp(10) })

        // ---- shape ---------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Shape"))
        fun slider(title: String, min: Float, max: Float, v: Float, step: Float, fmt: (Float) -> String, set: (Float) -> Unit) =
            root.addView(HSlider(act, title, min, max, v, step, fmt).apply { onChange = { set(it); schedule() } }, lp())
        slider("Depth", 0.01f, 1.5f, spec.depth, 0.01f, { String.format("%.2f", it) }) { spec.depth = it }
        slider("Bevel", 0f, 0.12f, spec.bevel, 0.002f, { if (it == 0f) "Sharp" else String.format("%.3f", it) }) { spec.bevel = it }
        slider("Bevel smoothness", 1f, 6f, spec.bevelSegments.toFloat(), 1f, { "${it.toInt()}" }) { spec.bevelSegments = it.toInt() }
        slider("Letter spacing", -0.1f, 0.6f, spec.letterSpacing, 0.01f, { String.format("%.2f", it) }) { spec.letterSpacing = it }
        slider("Line spacing", 0.6f, 2f, spec.lineSpacing, 0.05f, { String.format("%.2f", it) }) { spec.lineSpacing = it }
        slider("Smoothness", 0.15f, 2f, 2.15f - spec.quality, 0.05f, { if (it > 1.6f) "High" else if (it > 0.9f) "Medium" else "Low" }) { spec.quality = 2.15f - it }

        // ---- colour ----------------------------------------------------------------------------------
        root.addView(act.sectionTitle("Look"))
        val looks = act.hbox(0, 10)
        for (p in listOf(MaterialPreset.GLOSSY_PAINT, MaterialPreset.GOLD, MaterialPreset.CHROME, MaterialPreset.PLASTIC, MaterialPreset.NEON, MaterialPreset.WOOD, MaterialPreset.TOON)) {
            looks.addView(Swatch(act, p.color or 0xFF000000.toInt(), 40).apply {
                describe(p.label)
                ring = o.material.name == p.label
                onClick = { ed.editMaterial("Text look") { m -> p.apply(m); m.name = p.label }; act.rebuildPanel() }
            })
        }
        root.addView(HorizontalScrollView(act).apply { isHorizontalScrollBarEnabled = false; addView(looks) })
        root.addView(PanelUi.button(act, "More materials & textures", Icon.MATERIAL) { act.openInspector(EditorActivity.INSPECT_MATERIAL) }, lp().apply { topMargin = dp(12) })
        return root
    }

    private fun fillFonts(row: LinearLayout) {
        row.removeAllViews()
        row.addView(FontCard(act, null, "Import", Icon.IMPORT).apply {
            describe("Import a font file")
            onClick = { importFont() }
        })
        for (f in FontStore.all(act)) {
            row.addView(FontCard(act, f.id, f.name, null).apply {
                chosen = spec.font == f.id
                onClick = { spec.font = f.id; TextStudio.lastFont = f.id; schedule(); fillFonts(row) }
                if (f.imported) onLongClick = {
                    Dialogs.menu(act, f.name, listOf(MenuItem(Icon.TRASH, "Remove font", danger = true) {
                        FontStore.delete(act, f.id)
                        if (spec.font == f.id) { spec.font = "sys:sans-serif"; schedule() }
                        fillFonts(row)
                    }))
                }
            })
        }
    }

    private fun importFont() {
        act.pickFont { uri ->
            act.async({ FontStore.import(act, uri) }, onError = { Dialogs.message(act, "Couldn't add font", it.message ?: "Unsupported file") }) { id ->
                spec.font = id
                TextStudio.lastFont = id
                fontRow?.let { fillFonts(it) }
                schedule()
                act.status("Font added: ${FontStore.name(act, id)}", 1600)
            }
        }
    }
}

/** Font tile rendering "Aa" in its own typeface. */
@SuppressLint("ViewConstructor")
class FontCard(ctx: Context, private val fontId: String?, private val name: String, private val icon: Icon?) : PressableView(ctx) {
    var chosen = false; set(v) { field = v; isSelected = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val r = RectF()
    private val face = fontId?.let { runCatching { FontStore.typeface(ctx, it) }.getOrNull() }

    init { describe("$name font") }

    override fun onMeasure(w: Int, h: Int) = setMeasuredDimension(dp(78), (dp(56f) + sp(11f) + dp(10f)).toInt())

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        r.set(dp(1f), dp(1f), w - dp(1f), h - dp(1f))
        p.color = if (chosen) Theme.withAlpha(Theme.accent, 0.25f) else Theme.SURFACE_2
        c.drawRoundRect(r, dp(14f), dp(14f), p)
        if (chosen) { p.style = Paint.Style.STROKE; p.strokeWidth = dp(2f); p.color = Theme.accent; c.drawRoundRect(r, dp(14f), dp(14f), p); p.style = Paint.Style.FILL }
        if (pressedNow) { p.color = 0x22FFFFFF; c.drawRoundRect(r, dp(14f), dp(14f), p) }
        if (icon != null) Icons.draw(c, icon, w / 2, dp(30f), dp(24f), Theme.accentLight())
        else {
            tp.typeface = face; tp.textSize = sp(24f); tp.color = Theme.TEXT
            c.drawText("Aa", w / 2, dp(30f) + sp(24f) * 0.35f, tp)
        }
        tp.typeface = Theme.regular; tp.textSize = sp(11f); tp.color = if (chosen) Theme.TEXT else Theme.TEXT_DIM
        c.drawText(TextUtils.ellipsize(name, android.text.TextPaint(tp), w - dp(8f), TextUtils.TruncateAt.END).toString(), w / 2, h - dp(9f), tp)
    }
}
