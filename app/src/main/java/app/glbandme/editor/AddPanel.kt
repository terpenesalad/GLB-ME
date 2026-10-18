package app.glbandme.editor

import android.view.View
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.core.templates.Templates
import app.glbandme.math.Quat
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Icon
import app.glbandme.ui.MenuItem
import app.glbandme.ui.SceneFactory
import app.glbandme.ui.TextureFactory
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.label
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** Everything you can add: shapes, 3D text, drawn shapes, images, stickers, models, parts. */
class AddPanel(act: EditorActivity) : Panel(act) {
    override val title = "Add"
    override val icon = Icon.PLUS
    override val rebuildOn = emptySet<Change>()

    override fun build(): View {
        val root = act.vbox()
        root.addView(act.sectionTitle("Create"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.TEXT, "3D Text") { act.closeSheet(); TextStudio.create(act) },
            Triple(Icon.PEN, "Draw") { ShapeStudio.show(act) },
            Triple(Icon.IMAGE, "Image") { act.pickImage { tex -> addImagePlane(tex) } },
            Triple(Icon.STICKER, "Sticker") { Stickers.start(act) },
        )))
        root.addView(act.sectionTitle("Basic shapes"))
        root.addView(PanelUi.actionGrid(act, basic.map { (t, i) -> Triple(i, short(t)) { addPrimitive(t) } }))
        root.addView(act.sectionTitle("More shapes"))
        root.addView(PanelUi.actionGrid(act, more.map { (t, i) -> Triple(i, short(t)) { addPrimitive(t) } }))
        root.addView(act.sectionTitle("Lights"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.BULB, "Point") { addLight(app.glbandme.core.scene.LightType.POINT) },
            Triple(Icon.SPOT, "Spot") { addLight(app.glbandme.core.scene.LightType.SPOT) },
            Triple(Icon.SUN, "Sun") { addLight(app.glbandme.core.scene.LightType.SUN) },
        )))
        root.addView(act.sectionTitle("Bring in"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.IMPORT, "Model file") { act.importIntoScene() },
            Triple(Icon.TEMPLATES, "Template") { templateMenu() },
        )))
        root.addView(act.label("New shapes stay adjustable – change their size and detail in Inspect.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(4), dp(12), 0, 0) })
        return root
    }

    private fun short(t: PrimType) = when (t) {
        PrimType.SCULPT_SPHERE -> "Sculpt ball"; PrimType.SPHERE -> "Sphere"; PrimType.ICOSPHERE -> "Ico ball"
        PrimType.ROUNDED_BOX -> "Rounded"; else -> t.label
    }

    private fun addPrimitive(t: PrimType) {
        val o = SceneFactory.primitiveObject(ed.scene, t, Material.preset(MaterialPreset.CLAY).apply { name = "Clay" })
        val (mn, _) = o.mesh.bounds()
        if (t != PrimType.PLANE && t != PrimType.TERRAIN) o.position.y = -mn.y
        if (t == PrimType.SCULPT_SPHERE) { o.primitive = null; o.name = "Sculpt" }
        if (ed.scene.objects.any { it.visible }) o.position.x = nextSlot()
        ed.addObject(o)
        act.closeSheet()
        if (t == PrimType.SCULPT_SPHERE) act.selectTool(Tool.CLAY) else if (act.editor.tool.isBrush) act.selectTool(Tool.TRANSFORM)
        act.viewport.frameSelection()
    }

    private fun addLight(t: app.glbandme.core.scene.LightType) {
        ed.addLight(t)
        act.closeSheet()
        act.selectTool(Tool.TRANSFORM)
        if (ed.scene.render.env != app.glbandme.core.scene.EnvPreset.DARK && ed.scene.objects.count { it.light != null } == 1)
            act.status("Tip: View › Lighting › Lights only shows just your lights", 2600)
        else act.status("${t.label} light added", 1200)
    }

    private fun nextSlot(): Float {
        val b = ed.scene.bounds() ?: return 0f
        return b.second.x + 0.7f
    }

    private fun addImagePlane(tex: Texture) {
        val aspect = TextureFactory.aspect(tex)
        val w = if (aspect >= 1f) 1.6f else 1.6f * aspect
        val h = if (aspect >= 1f) 1.6f / aspect else 1.6f
        val mesh = Primitives.plane(w, h, 1)
        val mat = Material(name = tex.name.substringBeforeLast('.')).apply {
            baseColor.fill(1f); roughness = 0.9f; doubleSided = true; baseColorTexture = tex
            if (TextureFactory.hasAlpha(tex)) { alphaMode = app.glbandme.core.scene.AlphaMode.MASK; alphaCutoff = 0.5f }
        }
        val o = SceneObject(tex.name.substringBeforeLast('.').ifBlank { "Image" }, mesh, mat)
        o.rotation.set(Quat.fromEulerDeg(90f, 0f, 0f))
        o.position.y = h / 2f
        ed.addObject(o, "Add image")
        act.closeSheet()
        act.selectTool(Tool.TRANSFORM)
        act.viewport.frameSelection()
    }

    private fun templateMenu() {
        Dialogs.menu(act, "Add parts from a template", Templates.all.map { t ->
            MenuItem(Icon.TEMPLATES, t.name, subtitle = t.category) {
                val objs = t.build().objects.toList()
                val off = nextSlot()
                for (o in objs) { o.position.x += off; for (k in o.keys.values) k.position.x += off }
                ed.addObjects(objs, "Add ${t.name}")
                act.closeSheet()
                act.viewport.frameSelection()
            }
        })
    }

    companion object {
        val basic = listOf(
            PrimType.SCULPT_SPHERE to Icon.SCULPT_SPHERE, PrimType.CUBE to Icon.CUBE, PrimType.SPHERE to Icon.SPHERE, PrimType.ICOSPHERE to Icon.ICOSPHERE,
            PrimType.CYLINDER to Icon.CYLINDER, PrimType.CONE to Icon.CONE, PrimType.TORUS to Icon.TORUS, PrimType.CAPSULE to Icon.CAPSULE,
            PrimType.TUBE to Icon.TUBE, PrimType.PLANE to Icon.PLANE, PrimType.PYRAMID to Icon.PYRAMID, PrimType.ROUNDED_BOX to Icon.ROUNDED_BOX,
        )
        val more = listOf(
            PrimType.DOME to Icon.DOME, PrimType.PRISM to Icon.PRISM, PrimType.WEDGE to Icon.WEDGE, PrimType.OCTAHEDRON to Icon.GEM,
            PrimType.STAR to Icon.STAR, PrimType.HEART to Icon.HEART, PrimType.GEAR to Icon.GEAR, PrimType.ARROW to Icon.ARROW,
            PrimType.SPRING to Icon.SPRING, PrimType.KNOT to Icon.KNOT, PrimType.STAIRS to Icon.STAIRS, PrimType.ARCH to Icon.ARCH,
            PrimType.TERRAIN to Icon.TERRAIN,
        )
        fun iconFor(t: PrimType): Icon = (basic + more).firstOrNull { it.first == t }?.second ?: Icon.SHAPES
    }
}
