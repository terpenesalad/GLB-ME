package app.glbandme.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import app.glbandme.core.io.Json
import app.glbandme.core.io.SceneIO
import app.glbandme.core.io.b
import app.glbandme.core.io.d
import app.glbandme.core.io.i
import app.glbandme.core.io.obj
import app.glbandme.core.io.s
import app.glbandme.core.scene.Scene
import java.io.File
import java.util.UUID

class ProjectMeta(
    val id: String,
    var name: String,
    val created: Long,
    var modified: Long,
    var triangles: Int,
    var objects: Int,
    var animated: Boolean
)

/** Local project library: each project is a folder with a GLB (+ editor extras), thumbnail and metadata. */
class ProjectStore(ctx: Context) {
    private val root = File(ctx.filesDir, "projects").apply { mkdirs() }

    private fun dir(id: String) = File(root, id)
    fun sceneFile(id: String) = File(dir(id), "scene.glb")
    fun thumbFile(id: String) = File(dir(id), "thumb.png")
    private fun metaFile(id: String) = File(dir(id), "meta.json")

    fun list(): List<ProjectMeta> = (root.listFiles() ?: emptyArray())
        .filter { it.isDirectory && File(it, "scene.glb").exists() }
        .mapNotNull { meta(it.name) }

    fun meta(id: String): ProjectMeta? {
        val f = metaFile(id)
        if (!f.exists()) {
            val sf = sceneFile(id)
            if (!sf.exists()) return null
            return ProjectMeta(id, "Untitled", sf.lastModified(), sf.lastModified(), 0, 0, false)
        }
        return runCatching {
            val m = Json.parse(f.readText()).obj()!!
            ProjectMeta(id, m.s("name") ?: "Untitled", m.d("created").toLong(), m.d("modified").toLong(), m.i("triangles"), m.i("objects"), m.b("animated"))
        }.getOrNull()
    }

    private fun writeMeta(m: ProjectMeta) {
        val json = Json.write(mapOf(
            "name" to m.name, "created" to m.created, "modified" to m.modified,
            "triangles" to m.triangles, "objects" to m.objects, "animated" to m.animated
        ))
        atomicWrite(metaFile(m.id), json.toByteArray())
    }

    private fun atomicWrite(f: File, bytes: ByteArray) {
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    fun create(name: String, scene: Scene, thumb: Bitmap? = null): ProjectMeta {
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val m = ProjectMeta(id, name, now, now, 0, 0, false)
        save(m, scene, thumb)
        return m
    }

    /** Serialises under the scene lock (caller should not hold other locks). */
    fun save(m: ProjectMeta, scene: Scene, thumb: Bitmap? = null) {
        val bytes = synchronized(scene) {
            m.triangles = scene.totalTriangles()
            m.objects = scene.objects.size
            m.animated = scene.hasAnimation()
            SceneIO.saveProject(scene)
        }
        m.modified = System.currentTimeMillis()
        atomicWrite(sceneFile(m.id), bytes)
        writeMeta(m)
        if (thumb != null) saveThumb(m.id, thumb)
    }

    fun saveThumb(id: String, bmp: Bitmap) {
        val tmp = File(dir(id), "thumb.png.tmp")
        tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 92, it) }
        tmp.renameTo(thumbFile(id))
    }

    fun loadThumb(id: String): Bitmap? = thumbFile(id).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.absolutePath) }

    fun load(id: String): Scene = SceneIO.loadProject(sceneFile(id).readBytes())

    fun rename(id: String, name: String) {
        val m = meta(id) ?: return
        m.name = name
        writeMeta(m)
    }

    fun duplicate(id: String): ProjectMeta? {
        val src = meta(id) ?: return null
        val nid = UUID.randomUUID().toString()
        val nd = dir(nid).apply { mkdirs() }
        dir(id).listFiles()?.forEach { f -> if (!f.name.endsWith(".tmp")) f.copyTo(File(nd, f.name), overwrite = true) }
        val now = System.currentTimeMillis()
        val m = ProjectMeta(nid, "${src.name} copy", now, now, src.triangles, src.objects, src.animated)
        writeMeta(m)
        return m
    }

    fun delete(id: String) { dir(id).deleteRecursively() }

    fun uniqueName(base: String): String {
        val names = list().map { it.name }.toHashSet()
        if (base !in names) return base
        var i = 2
        while ("$base $i" in names) i++
        return "$base $i"
    }
}
