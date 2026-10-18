package app.glbandme.editor

import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.Typeface
import android.view.View
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.mesh.Triangulator
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.core.templates.Templates
import app.glbandme.math.Quat
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.MenuItem
import app.glbandme.ui.SceneFactory
import app.glbandme.ui.Segmented
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox
import kotlin.math.max

/** Add primitives, 3D text, image planes, imported models and template parts. */
class AddPanel(act: EditorActivity) : Panel(act) {
    override val title = "Add"
    override val icon = Icon.PLUS
    override val rebuildOn = emptySet<Change>()

    private val prims = listOf(
        PrimType.SCULPT_SPHERE to Icon.SCULPT_SPHERE, PrimType.CUBE to Icon.CUBE, PrimType.SPHERE to Icon.SPHERE,
        PrimType.ICOSPHERE to Icon.ICOSPHERE, PrimType.CYLINDER to Icon.CYLINDER, PrimType.CONE to Icon.CONE,
        PrimType.TORUS to Icon.TORUS, PrimType.CAPSULE to Icon.CAPSULE, PrimType.TUBE to Icon.TUBE,
        PrimType.PLANE to Icon.PLANE, PrimType.PYRAMID to Icon.PYRAMID
    )

    override fun build(): View {
        val root = act.vbox()
        root.addView(act.sectionTitle("Shapes"))
        root.addView(PanelUi.actionGrid(act, prims.map { (t, i) -> Triple(i, t.label.replace("Sculpt Sphere", "Sculpt")) { addPrimitive(t) } }))
        root.addView(act.sectionTitle("More"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.TEXT, "3D Text") { textDialog() },
            Triple(Icon.IMAGE, "Image") { act.pickImage { tex -> addImagePlane(tex) } },
            Triple(Icon.IMPORT, "Model file") { act.importIntoScene() },
            Triple(Icon.TEMPLATES, "Template") { templateMenu() },
        )))
        root.addView(act.label("New objects appear at the scene center and stay editable (sizes, segments) in the Scene panel.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(2), dp(12), 0, 0) })
        return root
    }

    private fun addPrimitive(t: PrimType) {
        val o = SceneFactory.primitiveObject(ed.scene, t, Material.preset(MaterialPreset.CLAY).apply { name = t.label })
        val (mn, _) = o.mesh.bounds()
        if (t != PrimType.PLANE) o.position.y = -mn.y
        if (t == PrimType.SCULPT_SPHERE) { o.primitive = null; o.name = "Sculpt" }
        // offset a little if something is already at the origin
        if (ed.scene.objects.any { it.position.x == 0f && it.position.z == 0f && it.visible }) o.position.x = nextSlot()
        ed.addObject(o)
        if (ed.tool.isBrush && t != PrimType.SCULPT_SPHERE) act.selectTool(Tool.TRANSFORM)
    }

    private fun nextSlot(): Float {
        val b = ed.scene.bounds() ?: return 0f
        return b.second.x + 0.7f
    }

    private fun addImagePlane(tex: Texture) {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(tex.bytes, 0, tex.bytes.size, opts)
        val aspect = if (opts.outHeight > 0) opts.outWidth.toFloat() / opts.outHeight else 1f
        val w = if (aspect >= 1f) 1.6f else 1.6f * aspect
        val h = if (aspect >= 1f) 1.6f / aspect else 1.6f
        val mesh = Primitives.plane(w, h, 1)
        val mat = Material(name = tex.name.substringBeforeLast('.')).apply {
            baseColor.fill(1f); roughness = 0.9f; doubleSided = true; baseColorTexture = tex
        }
        val o = SceneObject(tex.name.substringBeforeLast('.').ifBlank { "Image" }, mesh, mat)
        o.rotation.set(Quat.fromEulerDeg(90f, 0f, 0f))
        o.position.y = h / 2f
        ed.addObject(o, "Add image")
        act.selectTool(Tool.TRANSFORM)
    }

    private fun templateMenu() {
        Dialogs.menu(act, "Add parts from a template", Templates.all.map { t ->
            MenuItem(Icon.TEMPLATES, t.name, subtitle = t.category) {
                val objs = t.build().objects.toList()
                val off = nextSlot()
                for (o in objs) { o.position.x += off; for (k in o.keys.values) k.position.x += off }
                ed.addObjects(objs, "Add ${t.name}")
            }
        })
    }

    private fun textDialog() {
        val content = act.vbox()
        val et = Dialogs.editText(act, "GLB&ME", "Your text")
        content.addView(et)
        val font = Segmented(act, listOf("Bold", "Serif", "Rounded", "Mono"), 0)
        content.addView(font, lp().apply { topMargin = dp(12) })
        val depth = HSlider(act, "Depth", 0.02f, 0.6f, 0.15f, 0.01f) { String.format("%.2f", it) }
        content.addView(depth, lp().apply { topMargin = dp(8) })
        Dialogs.custom(act, "3D Text", content, "Create", "Cancel", scroll = false, onPositive = {
            val text = et.text.toString().trim()
            if (text.isEmpty()) false else {
                val tf = when (font.selected) {
                    1 -> Typeface.create(Typeface.SERIF, Typeface.BOLD)
                    2 -> Typeface.create("sans-serif-black", Typeface.NORMAL)
                    3 -> Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                    else -> Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                }
                val mesh = textMesh(text, tf, depth.value)
                if (mesh == null || mesh.triangleCount == 0) { act.status("Couldn't build that text", 1400); true } else {
                    val o = SceneObject(text.take(16), mesh, Material.preset(MaterialPreset.GLOSSY_PAINT).apply { name = "Text" })
                    val (mn, _) = mesh.bounds()
                    o.position.y = -mn.y
                    ed.addObject(o, "Add text")
                    act.selectTool(Tool.TRANSFORM)
                    true
                }
            }
        })
    }

    companion object {
        /** Extruded text mesh, ~1 unit tall per line. */
        fun textMesh(text: String, tf: Typeface, depth: Float): Mesh? {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = tf; textSize = 100f }
            val path = Path()
            val lines = text.split('\n')
            for ((i, line) in lines.withIndex()) {
                val lp = Path()
                paint.getTextPath(line, 0, line.length, 0f, i * 115f, lp)
                path.addPath(lp)
            }
            val contours = ArrayList<FloatArray>()
            val pm = PathMeasure(path, true)
            do {
                val len = pm.length
                if (len < 0.5f) continue
                val n = max(8, (len / 2.2f).toInt()).coerceAtMost(600)
                val pts = FloatArray(n * 2)
                val pos = FloatArray(2)
                for (k in 0 until n) {
                    pm.getPosTan(len * k / n, pos, null)
                    pts[k * 2] = pos[0] / 100f
                    pts[k * 2 + 1] = -pos[1] / 100f
                }
                contours.add(pts)
            } while (pm.nextContour())
            if (contours.isEmpty()) return null
            val tri = Triangulator.triangulate(contours)
            if (tri.indices.isEmpty()) return null
            val m = MeshOps.extrudeCap(tri.positions, tri.indices, tri.contours, depth)
            MeshOps.centerToOrigin(m)
            return m
        }
    }
}
