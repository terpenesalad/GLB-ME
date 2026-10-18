package app.glbandme.editor

import android.view.View
import app.glbandme.core.mesh.MeshOps
import app.glbandme.ui.BaseActivity
import app.glbandme.ui.Dialogs
import app.glbandme.ui.EditorActivity
import app.glbandme.ui.Fmt
import app.glbandme.ui.HSlider
import app.glbandme.ui.Icon
import app.glbandme.ui.MenuItem
import app.glbandme.ui.PillButton
import app.glbandme.ui.Theme
import app.glbandme.ui.Theme.dp
import app.glbandme.ui.Theme.sp
import app.glbandme.ui.hbox
import app.glbandme.ui.label
import app.glbandme.ui.lp
import app.glbandme.ui.sectionTitle
import app.glbandme.ui.vbox

/** Topology tools: subdivision, decimation, smoothing, symmetry, normals, UVs. */
class MeshPanel(act: EditorActivity) : Panel(act) {
    override val title = "Mesh"
    override val icon = Icon.TOPOLOGY
    override val rebuildOn = setOf(Change.SELECTION, Change.TOPOLOGY, Change.UNDO, Change.OBJECTS)
    private var decimateRatio = 0.5f
    private var smoothIter = 3f

    override fun build(): View {
        val root = act.vbox()
        val o = ed.scene.selected
        if (o == null) {
            root.addView(act.label("Select an object to edit its mesh.", 13.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(8), 0, dp(8)) })
            return root
        }
        val m = o.mesh
        val stats = act.hbox(0, 8).apply { setPadding(0, dp(6), 0, dp(4)) }
        for ((k, v) in listOf("Triangles" to Fmt.count(m.triangleCount), "Vertices" to Fmt.count(m.vertexCount), "UVs" to if (m.uvs != null) "Yes" else "No")) {
            stats.addView(act.vbox().apply {
                background = Theme.rounded(Theme.SURFACE_2, 12f)
                setPadding(dp(12), dp(10), dp(12), dp(10))
                addView(act.label(v, 17f, Theme.TEXT, bold = true))
                addView(act.label(k, 11f, Theme.TEXT_MUTED).apply { setPadding(0, dp(2), 0, 0) })
            }, lp(0, WRAP_H, 1f))
        }
        root.addView(stats)
        if (o.primitive != null) root.addView(act.label("This is still a procedural ${o.primitive!!.type.label}. Mesh operations convert it to an editable mesh.", 11.5f, Theme.TEXT_MUTED).apply { setPadding(dp(2), dp(6), 0, 0) })

        root.addView(act.sectionTitle("Resolution"))
        root.addView(PanelUi.twoButtons(act,
            PanelUi.button(act, "Subdivide", Icon.SUBDIVIDE, PillButton.Style.PRIMARY) { heavy("Subdividing…") { ed.subdivide(true) } },
            PanelUi.button(act, "Simple split", Icon.GRID) { heavy("Subdividing…") { ed.subdivide(false) } }
        ))
        if (m.triangleCount * 4 > 2_000_000) root.addView(act.label("Heads up: another subdivision gives ${Fmt.count(m.triangleCount * 4)} triangles.", 11.5f, Theme.WARNING).apply { setPadding(dp(2), dp(6), 0, 0) })
        val dec = HSlider(act, "Decimate to", 0.05f, 0.95f, decimateRatio, 0.05f) { v -> "${(v * 100).toInt()}% · ${Fmt.count((m.triangleCount * v).toInt())} tris" }
        dec.onChange = { decimateRatio = it }
        root.addView(dec, lp().apply { topMargin = dp(10) })
        root.addView(PanelUi.button(act, "Decimate (keep shape)", Icon.DECIMATE) {
            heavy("Decimating…") { ed.decimate(decimateRatio) }
        }, lp())

        root.addView(act.sectionTitle("Shape"))
        val sm = HSlider(act, "Smooth iterations", 1f, 20f, smoothIter, 1f) { "${it.toInt()}" }
        sm.onChange = { smoothIter = it }
        root.addView(sm, lp())
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.SMOOTH, "Smooth") { heavy("Smoothing…") { ed.smoothMesh(smoothIter.toInt()) } },
            Triple(Icon.MIRROR, "Symmetrize") { symmetrizeMenu() },
            Triple(Icon.LINK, "Weld") { heavy("Welding…") { ed.weld() } },
            Triple(Icon.FLIP, "Flip") { ed.flipNormals() },
        )))

        root.addView(act.sectionTitle("Shading & UVs"))
        root.addView(PanelUi.actionGrid(act, listOf(
            Triple(Icon.DECIMATE, "Flat") { ed.shadeFlat() },
            Triple(Icon.SPHERE, "Smooth") { ed.shadeSmooth() },
            Triple(Icon.RESET, "Normals") { ed.recalcNormals() },
            Triple(Icon.IMAGE, "UV map") { uvMenu() },
        )))
        return root
    }

    private fun heavy(msg: String, work: () -> Unit) = act.heavy(msg, work)

    private fun symmetrizeMenu() {
        Dialogs.menu(act, "Symmetrize", listOf(
            MenuItem(Icon.MIRROR, "+X → −X", subtitle = "Copy the right side onto the left") { heavy("Symmetrizing…") { ed.symmetrize(0, true) } },
            MenuItem(Icon.MIRROR, "−X → +X") { heavy("Symmetrizing…") { ed.symmetrize(0, false) } },
            MenuItem(Icon.MIRROR, "+Y → −Y") { heavy("Symmetrizing…") { ed.symmetrize(1, true) } },
            MenuItem(Icon.MIRROR, "+Z → −Z") { heavy("Symmetrizing…") { ed.symmetrize(2, true) } },
        ))
    }

    private fun uvMenu() {
        Dialogs.menu(act, "Generate UVs", MeshOps.UvProjection.values().map { mode ->
            MenuItem(Icon.IMAGE, mode.label) { heavy("Unwrapping…") { ed.projectUvs(mode) } }
        })
    }

    companion object { private const val WRAP_H = android.view.ViewGroup.LayoutParams.WRAP_CONTENT }
}
