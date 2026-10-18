package app.glbandme.core.io

import app.glbandme.core.scene.EnvPreset
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.ShadingMode

enum class ExportFormat(val label: String, val ext: String, val mime: String, val description: String) {
    GLB("GLB", "glb", "model/gltf-binary", "Binary glTF – materials, textures, colors & animation in one file"),
    GLTF("glTF", "gltf", "model/gltf+json", "Text glTF with embedded data"),
    USDZ("USDZ", "usdz", "model/vnd.usdz+zip", "Apple AR Quick Look – iPhone, iPad, Vision Pro"),
    OBJ("OBJ", "obj", "text/plain", "Wavefront OBJ with vertex colors"),
    STL("STL", "stl", "model/stl", "Binary STL for 3D printing (Z-up)"),
    PLY("PLY", "ply", "application/octet-stream", "Binary PLY with vertex colors");
}

/** Format detection + project (editor state) persistence on top of glTF. */
object SceneIO {

    val importExtensions = listOf("glb", "gltf", "obj", "stl", "ply")

    fun detectFormat(name: String?, data: ByteArray): String? {
        val ext = name?.substringAfterLast('.', "")?.lowercase()
        if (ext != null && ext in importExtensions) return ext
        if (data.size >= 4 && data[0] == 'g'.code.toByte() && data[1] == 'l'.code.toByte() && data[2] == 'T'.code.toByte() && data[3] == 'F'.code.toByte()) return "glb"
        val head = String(data, 0, minOf(256, data.size), Charsets.ISO_8859_1).trimStart()
        return when {
            head.startsWith("ply") -> "ply"
            head.startsWith("{") && head.contains("\"asset\"") -> "gltf"
            head.startsWith("{") -> "gltf"
            head.startsWith("solid") -> "stl"
            head.startsWith("v ") || head.startsWith("#") || head.startsWith("o ") || head.startsWith("mtllib") -> "obj"
            data.size > 84 -> "stl"
            else -> null
        }
    }

    fun import(name: String?, data: ByteArray): ImportResult {
        val base = name?.substringAfterLast('/')?.substringBeforeLast('.')?.ifBlank { null } ?: "Model"
        return when (detectFormat(name, data)) {
            "glb", "gltf" -> GltfReader().read(data)
            "obj" -> MeshFormats.readObj(data).let { r ->
                if (r.objects.size == 1 && r.objects[0].name == "Object") r.objects[0].name = base
                r
            }
            "stl" -> MeshFormats.readStl(data, base)
            "ply" -> MeshFormats.readPly(data, base)
            else -> throw UnsupportedModelException("Unrecognised file. Supported: GLB, glTF, OBJ, STL, PLY.")
        }
    }

    fun export(scene: Scene, format: ExportFormat, opt: GltfExportOptions = GltfExportOptions()): ByteArray {
        val objs: List<SceneObject> = scene.objects.filter { (opt.includeHidden || it.visible) && (!opt.onlySelected || it === scene.selected) && it.mesh.triangleCount > 0 && it.light == null }
        return when (format) {
            ExportFormat.GLB -> GltfWriter.write(scene, opt.apply { binary = true; projectData = false })
            ExportFormat.GLTF -> GltfWriter.write(scene, opt.apply { binary = false; projectData = false })
            ExportFormat.USDZ -> UsdzWriter.write(scene, objs, UsdzWriter.Options(vertexColors = opt.vertexColors, animations = opt.animations, textureEncoder = opt.textureFilter))
            ExportFormat.OBJ -> MeshFormats.writeObj(objs, opt.vertexColors)
            ExportFormat.STL -> MeshFormats.writeStl(objs)
            ExportFormat.PLY -> MeshFormats.writePly(objs, opt.vertexColors)
        }
    }

    // ---------------------------------------------------------------------------------------
    // project files: a GLB with editor extras
    // ---------------------------------------------------------------------------------------
    fun saveProject(scene: Scene): ByteArray {
        val r = scene.render
        val extras = linkedMapOf<String, Any?>(
            "version" to 1,
            "fps" to scene.fps,
            "frameCount" to scene.frameCount,
            "selected" to scene.objects.indexOf(scene.selected),
            "camera" to mapOf(
                "yaw" to scene.camera.yaw, "pitch" to scene.camera.pitch, "distance" to scene.camera.distance,
                "target" to listOf(scene.camera.target.x, scene.camera.target.y, scene.camera.target.z)
            ),
            "render" to mapOf(
                "shading" to r.shading.name, "matcap" to r.matcap, "env" to r.env.name, "exposure" to r.exposure,
                "lightAngle" to r.lightAngle, "lightHeight" to r.lightHeight, "shadows" to r.shadows, "grid" to r.showGrid,
                "wireframe" to r.wireframe, "bgTop" to r.bgTop, "bgBottom" to r.bgBottom, "ortho" to r.orthographic,
                "fov" to r.fov, "axes" to r.showAxes
            )
        )
        val opt = GltfExportOptions(binary = true, includeHidden = true, projectData = true, animations = true)
        return GltfWriter.write(scene, opt, extras)
    }

    fun loadProject(data: ByteArray): Scene {
        val res = GltfReader().read(data)
        val scene = Scene()
        for (o in res.objects) scene.add(o, select = false)
        val ex = res.editorExtras
        if (ex != null) {
            scene.fps = ex.i("fps", 30)
            scene.frameCount = ex.i("frameCount", 90)
            scene.selected = scene.objects.getOrNull(ex.i("selected", -1))
            ex.o("camera")?.let { c ->
                scene.camera.yaw = c.f("yaw", 35f); scene.camera.pitch = c.f("pitch", 20f); scene.camera.distance = c.f("distance", 3.2f)
                c.floats("target")?.let { if (it.size == 3) scene.camera.target.set(it[0], it[1], it[2]) }
            }
            ex.o("render")?.let { m ->
                val r = scene.render
                r.shading = runCatching { ShadingMode.valueOf(m.s("shading")!!) }.getOrDefault(ShadingMode.PBR)
                r.matcap = m.i("matcap", 0)
                r.env = runCatching { EnvPreset.valueOf(m.s("env")!!) }.getOrDefault(EnvPreset.STUDIO)
                r.exposure = m.f("exposure", 1f); r.lightAngle = m.f("lightAngle", -40f); r.lightHeight = m.f("lightHeight", 45f)
                r.shadows = m.b("shadows", true); r.showGrid = m.b("grid", true); r.wireframe = m.b("wireframe", false)
                r.bgTop = m.i("bgTop", r.bgTop); r.bgBottom = m.i("bgBottom", r.bgBottom); r.orthographic = m.b("ortho", false)
                r.fov = m.f("fov", 45f); r.showAxes = m.b("axes", true)
            }
        } else {
            scene.fps = res.fps
            if (res.frameCount > 0) scene.frameCount = res.frameCount
        }
        if (scene.hasAnimation()) scene.frameCount = maxOf(scene.frameCount, scene.objects.maxOf { if (it.keys.isEmpty()) 0 else it.keys.lastKey() })
        return scene
    }
}
