package app.glbandme.editor

import android.app.Dialog
import android.graphics.Bitmap
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.texture.Pattern
import app.glbandme.core.texture.PatternSpec
import app.glbandme.ui.ColorPickerView
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.FlowLayout
import app.glbandme.ui.GroupCard
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.IconButton
import app.glbandme.ui.PillButton
import app.glbandme.ui.PressableView
import app.glbandme.ui.Segmented
import app.glbandme.ui.Swatch
import app.glbandme.ui.TextureFactory
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.ToggleRow
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import java.util.concurrent.atomic.AtomicInteger

/**
 * Gallery of seamless procedural textures. Pick one, tweak colours / scale / detail with a
 * live preview, then apply colour + bump (+ roughness) maps in one step.
 */
object TextureLibrary {
    private val thumbs = HashMap<Pattern, Bitmap>()

    fun show(act: EditorActivity, o: SceneObject) {
        val body = act.vbox()
        lateinit var d: Dialog
        body.addView(act.label("Seamless textures made on your phone – they tile perfectly and export with your model.", 13f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(2), 0, dp(10)); setLineSpacing(0f, 1.15f) })
        val grid = FlowLayout(act, 10, 12)
        for (p in Pattern.values()) {
            val cell = act.vbox().apply { gravity = Gravity.CENTER_HORIZONTAL }
            val img = ImageView(act).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = Theme.rounded(Theme.SURFACE_2, 14f)
                clipToOutline = true
                outlineProvider = object : android.view.ViewOutlineProvider() {
                    override fun getOutline(v: View, outline: android.graphics.Outline) { outline.setRoundRect(0, 0, v.width, v.height, dp(14f)) }
                }
                contentDescription = "${p.label} texture"
                isClickable = true; isFocusable = true
                setOnClickListener { d.dismiss(); configure(act, o, p) }
            }
            thumbs[p]?.let { img.setImageBitmap(it) } ?: act.async({ TextureFactory.preview(PatternSpec(p).also { it.scale = minOf(it.scale, 8f) }, 128) }, onError = {}) { b -> thumbs[p] = b; img.setImageBitmap(b) }
            cell.addView(img, LinearLayout.LayoutParams(dp(84), dp(84)))
            cell.addView(act.label(p.label, 11.5f, Theme.TEXT_DIM).apply { gravity = Gravity.CENTER; setPadding(0, dp(5), 0, 0); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO })
            grid.addView(cell, LinearLayout.LayoutParams(dp(84), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        body.addView(grid)
        d = Dialogs.sheet(act, "Built-in textures", body, action = null, tall = true)
    }

    private fun configure(act: EditorActivity, o: SceneObject, p: Pattern) {
        val spec = PatternSpec(p)
        val body = act.vbox()
        val preview = ImageView(act).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = Theme.rounded(Theme.SURFACE_2, 18f)
            clipToOutline = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            outlineProvider = object : android.view.ViewOutlineProvider() {
                override fun getOutline(v: View, outline: android.graphics.Outline) { outline.setRoundRect(0, 0, v.width, v.height, dp(18f)) }
            }
        }
        val frame = FrameLayout(act)
        frame.addView(preview, FrameLayout.LayoutParams(dp(220), dp(220), Gravity.CENTER))
        body.addView(frame, lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(230)))
        val gen = AtomicInteger()
        fun refresh() {
            val id = gen.incrementAndGet()
            val s = PatternSpec(p, spec.colorA, spec.colorB, spec.scale, spec.seed, spec.detail)
            act.async({ TextureFactory.preview(s, 256) }, onError = {}) { b -> if (id == gen.get()) preview.setImageBitmap(b) }
        }
        refresh()

        body.addView(act.sectionTitle("Colours"))
        val colors = act.hbox(0, 14).apply { gravity = Gravity.CENTER_VERTICAL }
        val a = Swatch(act, spec.colorA or 0xFF000000.toInt(), 44).apply { describe("First colour") }
        a.onClick = { ColorPickerView.show(act, "First colour", a.color, live = { c -> spec.colorA = c and 0xFFFFFF; a.color = c; refresh() }) { c -> spec.colorA = c and 0xFFFFFF; a.color = c; refresh() } }
        colors.addView(a)
        if (p.usesB) {
            val b = Swatch(act, spec.colorB or 0xFF000000.toInt(), 44).apply { describe("Second colour") }
            b.onClick = { ColorPickerView.show(act, "Second colour", b.color, live = { c -> spec.colorB = c and 0xFFFFFF; b.color = c; refresh() }) { c -> spec.colorB = c and 0xFFFFFF; b.color = c; refresh() } }
            colors.addView(b)
            colors.addView(IconButton(act, Icon.FLIP, sizeDp = 40).apply {
                filled = true; describe("Swap colours")
                onClick = { val t = spec.colorA; spec.colorA = spec.colorB; spec.colorB = t; a.color = spec.colorA or 0xFF000000.toInt(); b.color = spec.colorB or 0xFF000000.toInt(); refresh() }
            })
        }
        colors.addView(View(act), lp(0, 1, 1f))
        colors.addView(PillButton(act, "Shuffle", Icon.DICE, PillButton.Style.TINTED).apply { onClick = { spec.seed = (spec.seed * 31 + 17) % 9973; refresh() } }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)))
        body.addView(colors)

        body.addView(act.sectionTitle("Pattern"))
        body.addView(HSlider(act, "Scale", 1f, 32f, spec.scale, 1f) { "${it.toInt()} per tile" }.apply { onChange = { spec.scale = it }; onRelease = { refresh() } }, lp())
        body.addView(HSlider(act, "Detail", 0f, 1f, spec.detail, 0.05f) { "${(it * 100).toInt()}%" }.apply { onChange = { spec.detail = it }; onRelease = { refresh() } }, lp())

        body.addView(act.sectionTitle("Apply"))
        val card = GroupCard(act)
        val bump = ToggleRow(act, "Bump detail", true, "Adds a matching normal map")
        val rough = ToggleRow(act, "Roughness detail", p in setOf(Pattern.BRICKS, Pattern.TILES, Pattern.STONE, Pattern.WOOD), "Grooves look duller than the surface")
        card.row(bump); card.row(rough)
        body.addView(card)
        val size = Segmented(act, listOf("512", "1024", "2048"), 1)
        body.addView(act.label("Resolution", 13f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(12), 0, dp(6)) })
        body.addView(size)
        body.addView(act.label("Then use Mapping › Repeat to tile it as often as you like.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(10), 0, 0) })

        Dialogs.sheet(act, p.label, body, action = "Apply", tall = false, onAction = {
            val px = intArrayOf(512, 1024, 2048)[size.selected]
            val s = PatternSpec(p, spec.colorA, spec.colorB, spec.scale, spec.seed, spec.detail)
            act.heavyResult("Painting ${p.label.lowercase()}…", { TextureFactory.pattern(s, px, bump.checked, rough.checked) }) { set ->
                val ed = act.editor
                if (ed.scene.selected !== o) ed.select(o)
                if (o.mesh.uvs == null) ed.projectUvs(MeshOps.UvProjection.BOX)
                ed.editMaterial("${p.label} texture") { m ->
                    m.baseColorTexture = set.color
                    m.baseColor[0] = 1f; m.baseColor[1] = 1f; m.baseColor[2] = 1f
                    m.normalTexture = set.normal
                    m.normalScale = 1f
                    m.metallicRoughnessTexture = set.roughness
                    when (p) {
                        Pattern.METAL, Pattern.CARBON -> { m.metallic = if (p == Pattern.METAL) 1f else 0.3f; m.roughness = 0.38f }
                        Pattern.MARBLE, Pattern.TILES -> { m.metallic = 0f; m.roughness = 0.18f }
                        Pattern.LAVA -> { m.emissiveTexture = set.color; m.emissive.fill(1f); m.emissiveStrength = 1.6f; m.roughness = 0.8f }
                        Pattern.PIXELS -> m.pixelated = true
                        else -> { m.metallic = 0f; if (set.roughness != null) m.roughness = 1f }
                    }
                    m.name = p.label
                }
                act.status("${p.label} applied", 1200)
            }
            true
        })
    }
}

/** Stickers / decals: an image projected onto the surface where you tap. */
object Stickers {
    fun start(act: EditorActivity) {
        if (act.editor.scene.objects.none { it.visible }) { act.status("Add a shape first", 1200); return }
        act.pickImage { tex -> place(act, tex) }
    }

    private fun place(act: EditorActivity, tex: app.glbandme.core.scene.Texture) {
        act.beginPlacement("Tap the model where the sticker goes") { hit, _, _ ->
            if (hit == null) { act.status("Tap on a model", 900); false } else {
                act.openPanel("sticker", StickerPanel(act, tex, hit))
                true
            }
        }
    }
}

class StickerPanel(act: EditorActivity, private val tex: app.glbandme.core.scene.Texture, hit: app.glbandme.core.sculpt.Picking.SceneHit) : Panel(act) {
    override val title = "Sticker"
    override val icon = Icon.STICKER
    override val rebuildOn = emptySet<Change>()

    private val target = hit.obj
    private val aspect = TextureFactory.aspect(tex)
    private val alpha = TextureFactory.hasAlpha(tex)
    private var center = hit.localPos
    private var normal = hit.localNormal
    private val scaleK = app.glbandme.math.Mat4.maxScale(target.localMatrix()).coerceAtLeast(1e-6f)
    private var size = app.glbandme.core.mesh.Decal.suggestedSize(target.mesh).coerceAtLeast(0.02f) // local units
    private var stretch = 1f
    private var rotation = 0f
    private var wrap = 0.5f
    private val sticker: SceneObject
    private val gen = AtomicInteger()

    init {
        val m = app.glbandme.core.scene.Material(name = "Sticker").apply {
            baseColor.fill(1f); roughness = 0.45f; baseColorTexture = tex
            if (alpha) { alphaMode = app.glbandme.core.scene.AlphaMode.MASK; alphaCutoff = 0.5f }
        }
        sticker = SceneObject("Sticker", app.glbandme.core.mesh.Mesh.empty(), m)
        sticker.position.set(target.position); sticker.rotation.set(target.rotation); sticker.scale.set(target.scale)
        buildMesh(sync = true)
        if (sticker.mesh.triangleCount > 0) act.editor.addObject(sticker, "Add sticker")
        else act.status("Couldn't place a sticker there", 1400)
    }

    private fun frame(): app.glbandme.core.mesh.Decal.Frame {
        val inv = app.glbandme.math.Mat4.inverted(target.localMatrix())
        val upLocal = app.glbandme.math.Mat4.transformDir(inv, app.glbandme.math.Vec3(0f, 1f, 0f))
        return app.glbandme.core.mesh.Decal.frame(center, normal, upLocal, rotation)
    }

    private fun buildMesh(sync: Boolean = false) {
        val w = size * if (aspect >= 1f) 1f else aspect
        val h = size / (if (aspect >= 1f) aspect else 1f) * stretch
        val f = frame()
        val lift = size * 0.004f + 0.0005f / scaleK
        val work = { app.glbandme.core.mesh.Decal.build(target.mesh, f, w, h, size * wrap, lift) }
        if (sync) { work()?.let { sticker.mesh = it }; return }
        val id = gen.incrementAndGet()
        // debounce slider ticks; only the newest request does any work
        act.sheet.postDelayed({
            if (id != gen.get()) return@postDelayed
            act.async({ if (id != gen.get()) null else work() }, onError = {}) { m ->
                if (id != gen.get() || m == null) return@async
                act.editor.locked { sticker.mesh = m }
                act.editor.notify(Change.TOPOLOGY)
            }
        }, 50)
    }

    override fun build(): View {
        val root = act.vbox()
        root.addView(act.label("Wraps around curved surfaces and exports as part of your GLB.", 12.5f, Theme.TEXT_DIM).apply { setPadding(dp(4), dp(4), 0, dp(6)) })
        fun s(title: String, min: Float, max: Float, v: Float, step: Float, fmt: (Float) -> String, set: (Float) -> Unit) =
            root.addView(HSlider(act, title, min, max, v, step, fmt).apply { onChange = { set(it); buildMesh() } }, lp())
        val base = size
        s("Size", base * 0.1f, base * 4f, size, 0f, { "${(it / base * 100).toInt()}%" }) { size = it }
        s("Stretch", 0.25f, 4f, stretch, 0.05f, { String.format("×%.2f", it) }) { stretch = it }
        s("Rotation", -180f, 180f, rotation, 1f, { "${it.toInt()}°" }) { rotation = it }
        s("Wrap depth", 0.05f, 2f, wrap, 0.05f, { "${(it * 100).toInt()}%" }) { wrap = it }
        root.addView(PanelUi.twoButtons(act,
            PanelUi.button(act, "Move", Icon.MOVE) {
                act.beginPlacement("Tap a new spot for the sticker") { hit, _, _ ->
                    if (hit == null || (hit.obj !== target && hit.obj !== sticker)) { act.status("Tap the same model", 900); false } else {
                        center = hit.localPos; normal = hit.localNormal; buildMesh()
                        act.openPanel("sticker", this); true
                    }
                }
            },
            PanelUi.button(act, "Done", Icon.CHECK, PillButton.Style.PRIMARY) { act.closeSheet() }
        ), lp().apply { topMargin = dp(14) })
        return root
    }
}
