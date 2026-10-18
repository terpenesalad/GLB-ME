package app.glbandme.ui

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import app.glbandme.core.io.ImportResult
import app.glbandme.core.io.SceneIO
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.ShadingMode
import app.glbandme.data.FileIO
import app.glbandme.data.ProjectStore
import app.glbandme.math.MathUtil
import app.glbandme.render.OffscreenRenderer
import kotlin.math.max
import kotlin.math.sin

/** Building starting scenes and opening them in the editor. */
object SceneFactory {

    fun primitiveObject(scene: Scene, type: PrimType, material: Material? = null): SceneObject {
        val spec = PrimitiveSpec(type)
        val o = SceneObject(scene.uniqueName(type.label), spec.build(), material ?: Material.preset(MaterialPreset.CLAY).apply { name = "Material" })
        o.primitive = spec
        return o
    }

    fun withPrimitive(type: PrimType): Scene {
        val s = Scene()
        val o = primitiveObject(s, type)
        if (type == PrimType.SCULPT_SPHERE) {
            o.primitive = null
            o.mesh = PrimitiveSpec(PrimType.SCULPT_SPHERE, mutableMapOf("radius" to 0.5f, "res" to 48f)).build()
            o.name = "Sculpt"
            s.render.shading = ShadingMode.MATCAP
        }
        // stand on the floor
        val (mn, _) = o.mesh.bounds()
        o.position.y = -mn.y
        s.add(o)
        frame(s)
        return s
    }

    fun empty(): Scene = Scene().also { it.camera.distance = 4f; it.camera.target.set(0f, 0.5f, 0f) }

    fun fromImport(r: ImportResult): Scene {
        val s = Scene()
        for (o in r.objects) s.add(o, select = false)
        s.selected = s.objects.firstOrNull()
        s.fps = r.fps
        if (r.frameCount > 0) s.frameCount = r.frameCount
        frame(s)
        return s
    }

    fun frame(s: Scene) {
        val b = s.bounds() ?: return
        val (mn, mx) = b
        val c = (mn + mx) * 0.5f
        val r = max((mx - mn).length() * 0.5f, 0.05f)
        s.camera.target.set(c)
        s.camera.distance = r / sin(s.render.fov * MathUtil.DEG / 2f) * 1.1f
    }

    fun thumbnail(scene: Scene, size: Int = 384): Bitmap? = OffscreenRenderer.render(scene, size, size, frameCamera = true)

    /** Persist a new project (with thumbnail) off the main thread, then open the editor. */
    fun createAndOpen(act: BaseActivity, name: String, action: String? = null, build: () -> Scene) {
        val store = ProjectStore(act)
        val progress = Dialogs.progress(act, "Preparing scene…")
        act.async({
            val scene = build()
            val thumb = thumbnail(scene)
            store.create(store.uniqueName(name), scene, thumb)
        }, onError = { progress.dismiss(); act.showError(it) }) { meta ->
            progress.dismiss()
            openEditor(act, meta.id, action)
        }
    }

    fun openEditor(act: Activity, id: String, action: String? = null) {
        act.startActivity(Intent(act, EditorActivity::class.java).putExtra(EditorActivity.EXTRA_ID, id).apply { if (action != null) putExtra(EditorActivity.EXTRA_ACTION, action) })
    }

    /** Import a model file as a new project. */
    fun importAsProject(act: BaseActivity, uri: Uri) {
        val store = ProjectStore(act)
        val progress = Dialogs.progress(act, "Importing…")
        act.async({
            val name = FileIO.displayName(act, uri) ?: "Imported"
            val bytes = FileIO.read(act, uri)
            val res = SceneIO.import(name, bytes)
            if (res.objects.isEmpty()) throw IllegalStateException(res.warnings.firstOrNull() ?: "No meshes found in this file.")
            val scene = fromImport(res)
            val thumb = thumbnail(scene)
            store.create(store.uniqueName(name.substringBeforeLast('.')), scene, thumb) to res.warnings
        }, onError = { progress.dismiss(); act.showError(it) }) { (meta, warnings) ->
            progress.dismiss()
            act.startActivity(Intent(act, EditorActivity::class.java).putExtra(EditorActivity.EXTRA_ID, meta.id)
                .putExtra(EditorActivity.EXTRA_WARNINGS, warnings.joinToString("\n")))
        }
    }

    fun importIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("model/gltf-binary", "model/gltf+json", "model/obj", "model/stl", "application/sla", "application/octet-stream", "text/plain", "application/json", "*/*"))
    }
}
