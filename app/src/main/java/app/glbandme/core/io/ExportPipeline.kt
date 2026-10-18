package app.glbandme.core.io

import app.glbandme.core.mesh.Decimator
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3

enum class ExportScope(val label: String) { VISIBLE("Visible objects"), SELECTED("Selected object"), ALL("Everything, incl. hidden") }
enum class ExportOrigin(val label: String) { KEEP("As placed"), CENTER("Centred"), GROUND("Centred on the ground") }
enum class UpAxis(val label: String) { Y("Y up"), Z("Z up") }
enum class ExportUnit(val label: String, val scale: Float) { M("Metres", 1f), CM("Centimetres", 100f), MM("Millimetres", 1000f), IN("Inches", 39.3701f) }

/** Everything that shapes an export. */
class ExportSettings(
    var format: ExportFormat = ExportFormat.GLB,
    var scope: ExportScope = ExportScope.VISIBLE,
    var unit: ExportUnit = ExportUnit.M,
    var up: UpAxis = UpAxis.Y,
    var origin: ExportOrigin = ExportOrigin.KEEP,
    /** 0 = keep every triangle */
    var maxTriangles: Int = 0,
    /** 0 = original size */
    var maxTextureSize: Int = 0,
    var textures: Boolean = true,
    var vertexColors: Boolean = true,
    var animations: Boolean = true,
    /** OBJ only: also write .mtl + textures (delivered as a .zip) */
    var objMaterials: Boolean = true,
) {
    fun copy() = ExportSettings(format, scope, unit, up, origin, maxTriangles, maxTextureSize, textures, vertexColors, animations, objMaterials)
}

enum class ExportPreset(val label: String, val subtitle: String) {
    GAME("Game engine", "Unity · Unreal · Godot · Roblox – GLB, metres, full detail"),
    WEB("Web & sharing", "Small GLB for websites, Discord and model viewers"),
    AR_ANDROID("AR – Android", "GLB for Scene Viewer, ≤ 100k triangles"),
    AR_APPLE("AR – iPhone", "USDZ for AR Quick Look"),
    PRINT("3D printing", "STL in millimetres, Z up, sitting on the bed"),
    CUSTOM("Custom", "Pick every option yourself");

    fun apply(s: ExportSettings) {
        when (this) {
            GAME -> { s.format = ExportFormat.GLB; s.unit = ExportUnit.M; s.up = UpAxis.Y; s.origin = ExportOrigin.KEEP; s.maxTriangles = 0; s.maxTextureSize = 2048; s.textures = true; s.vertexColors = true; s.animations = true }
            WEB -> { s.format = ExportFormat.GLB; s.unit = ExportUnit.M; s.up = UpAxis.Y; s.origin = ExportOrigin.GROUND; s.maxTriangles = 150_000; s.maxTextureSize = 1024; s.textures = true; s.vertexColors = true; s.animations = true }
            AR_ANDROID -> { s.format = ExportFormat.GLB; s.unit = ExportUnit.M; s.up = UpAxis.Y; s.origin = ExportOrigin.GROUND; s.maxTriangles = 100_000; s.maxTextureSize = 2048; s.textures = true; s.vertexColors = true; s.animations = true }
            AR_APPLE -> { s.format = ExportFormat.USDZ; s.unit = ExportUnit.M; s.up = UpAxis.Y; s.origin = ExportOrigin.GROUND; s.maxTriangles = 100_000; s.maxTextureSize = 2048; s.textures = true; s.vertexColors = true; s.animations = true }
            PRINT -> { s.format = ExportFormat.STL; s.unit = ExportUnit.MM; s.up = UpAxis.Z; s.origin = ExportOrigin.GROUND; s.maxTriangles = 0; s.textures = false; s.vertexColors = false; s.animations = false }
            CUSTOM -> {}
        }
    }
}

/** Selection, simplification and placement applied to every export format. */
object ExportPipeline {

    class Prepared(val objects: List<SceneObject>, val root: FloatArray?, val triangles: Int)

    fun select(scene: Scene, s: ExportSettings): List<SceneObject> = scene.objects.filter { o ->
        o.mesh.triangleCount > 0 && (o.light == null || s.format == ExportFormat.GLB || s.format == ExportFormat.GLTF) && when (s.scope) {
            ExportScope.VISIBLE -> o.visible
            ExportScope.SELECTED -> o === scene.selected
            ExportScope.ALL -> true
        }
    }

    /** World bounds of [objs] at the current pose. */
    fun bounds(objs: List<SceneObject>): Pair<Vec3, Vec3>? {
        var lo: Vec3? = null; var hi: Vec3? = null
        for (o in objs) { val (a, b) = o.worldBounds(); lo = lo?.minLocal(a) ?: a.copy(); hi = hi?.maxLocal(b) ?: b.copy() }
        return if (lo != null && hi != null) lo to hi else null
    }

    /** up * scale * translate(-anchor), or null when it is the identity. */
    fun rootMatrix(objs: List<SceneObject>, s: ExportSettings): FloatArray? {
        val b = bounds(objs)
        val t = Vec3()
        if (b != null) when (s.origin) {
            ExportOrigin.CENTER -> t.set(-(b.first.x + b.second.x) / 2, -(b.first.y + b.second.y) / 2, -(b.first.z + b.second.z) / 2)
            ExportOrigin.GROUND -> t.set(-(b.first.x + b.second.x) / 2, -b.first.y, -(b.first.z + b.second.z) / 2)
            ExportOrigin.KEEP -> {}
        }
        val k = s.unit.scale
        val up = if (s.up == UpAxis.Z) Quat.fromEulerDeg(90f, 0f, 0f) else Quat()
        val translate = Mat4.fromTRS(t, Quat(), Vec3(1f, 1f, 1f))
        val scaleRot = Mat4.fromTRS(Vec3(), up, Vec3(k, k, k))
        val m = Mat4.mul(scaleRot, translate)
        val identity = t.x == 0f && t.y == 0f && t.z == 0f && k == 1f && s.up == UpAxis.Y
        return if (identity) null else m
    }

    /**
     * Objects to write (shallow copies when simplified so the scene is untouched) plus the
     * root transform. Call while holding the scene lock.
     */
    fun prepare(scene: Scene, s: ExportSettings, progress: ((Float) -> Unit)? = null): Prepared {
        val objs = select(scene, s)
        val total = objs.sumOf { if (it.light != null) 0 else it.mesh.triangleCount }
        val budget = s.maxTriangles
        val out = if (budget in 1 until total) {
            val ratio = budget.toFloat() / total
            objs.mapIndexed { i, o ->
                val target = (o.mesh.triangleCount * ratio).toInt().coerceAtLeast(8)
                if (target >= o.mesh.triangleCount || o.light != null) o else {
                    val c = o.duplicate(copyMesh = false)
                    c.name = o.name
                    c.mesh = Decimator.decimate(o.mesh, target) { f -> progress?.invoke((i + f) / objs.size) }
                    c
                }
            }
        } else objs
        return Prepared(out, rootMatrix(objs.filter { it.light == null }.ifEmpty { objs }, s), out.sumOf { if (it.light != null) 0 else it.mesh.triangleCount })
    }

    fun export(scene: Scene, s: ExportSettings, textureFilter: ((Texture) -> Pair<ByteArray, String>)? = null, progress: ((Float) -> Unit)? = null): ExportResult {
        val p = prepare(scene, s, progress)
        val files = LinkedHashMap<String, ByteArray>()
        val main: ByteArray = when (s.format) {
            ExportFormat.GLB, ExportFormat.GLTF -> GltfWriter.write(scene, GltfExportOptions(
                binary = s.format == ExportFormat.GLB, vertexColors = s.vertexColors, animations = s.animations,
                textures = s.textures, textureFilter = textureFilter, objects = p.objects, rootTransform = p.root, projectData = false
            ))
            ExportFormat.USDZ -> UsdzWriter.write(scene, p.objects, UsdzWriter.Options(
                vertexColors = s.vertexColors, animations = s.animations, root = p.root,
                textureEncoder = textureFilter, textures = s.textures
            ))
            ExportFormat.OBJ -> {
                if (s.objMaterials) {
                    val names = LinkedHashMap<SceneObject, String>()
                    val mtl = MtlWriter.build(p.objects, s.textures, textureFilter, names, files)
                    files["materials.mtl"] = mtl
                    MeshFormats.writeObj(p.objects, s.vertexColors, p.root, "materials.mtl", names)
                } else MeshFormats.writeObj(p.objects, s.vertexColors, p.root)
            }
            // the root already carries the chosen up axis, so never apply the writer's default
            ExportFormat.STL -> MeshFormats.writeStl(p.objects, p.root ?: FloatArray(16).also { Mat4.identity(it) })
            ExportFormat.PLY -> MeshFormats.writePly(p.objects, s.vertexColors, p.root)
        }
        return ExportResult(main, files, p.triangles)
    }

    /** Human-friendly checks shown before exporting. */
    fun validate(scene: Scene, s: ExportSettings): List<String> {
        val w = ArrayList<String>()
        val objs = select(scene, s)
        if (objs.isEmpty()) { w.add(if (s.scope == ExportScope.SELECTED) "Nothing is selected." else "There's nothing visible to export."); return w }
        val tris = objs.sumOf { if (it.light != null) 0 else it.mesh.triangleCount }
        val budget = if (s.maxTriangles > 0) minOf(s.maxTriangles, tris) else tris
        if (s.format in setOf(ExportFormat.USDZ) && budget > 200_000) w.add("${budget / 1000}k triangles is heavy for AR – set a triangle limit.")
        if (s.format == ExportFormat.GLB && budget > 1_000_000) w.add("Over a million triangles – many apps will struggle. Consider a triangle limit.")
        val animated = objs.any { it.keys.size > 1 }
        if (animated && s.animations && s.format in setOf(ExportFormat.OBJ, ExportFormat.STL, ExportFormat.PLY)) w.add("${s.format.label} can't store animation – only the current pose is exported.")
        val textured = objs.any { it.material.textures().isNotEmpty() }
        if (textured && s.format in setOf(ExportFormat.STL, ExportFormat.PLY)) w.add("${s.format.label} has no materials or textures – colours are lost.")
        if (s.format == ExportFormat.USDZ && objs.any { it.mesh.colors != null } && s.vertexColors) w.add("AR Quick Look ignores painted vertex colours – use a material colour or texture for parts that must show colour.")
        if (s.format == ExportFormat.STL && objs.size > 1) w.add("STL merges all ${objs.size} objects into one solid.")
        val big = scene.textures().filter { t -> objs.any { o -> t in o.material.textures() } }.sumOf { it.bytes.size.toLong() }
        if (s.textures && s.maxTextureSize == 0 && big > 30L * 1024 * 1024) w.add("Textures add ${big / (1024 * 1024)} MB – a texture size limit makes the file much smaller.")
        return w
    }
}

class ExportResult(val main: ByteArray, val extraFiles: Map<String, ByteArray>, val triangles: Int) {
    /** OBJ with materials is delivered as a zip (model.obj + materials.mtl + textures). */
    fun bundle(baseName: String, ext: String): Pair<ByteArray, String> {
        if (extraFiles.isEmpty()) return main to "$baseName.$ext"
        val all = LinkedHashMap<String, ByteArray>()
        all["$baseName.$ext"] = main
        all.putAll(extraFiles)
        return UsdzWriter.zip(all) to "$baseName.zip"
    }
}

/** Wavefront MTL for OBJ exports. */
object MtlWriter {
    fun build(objs: List<SceneObject>, textures: Boolean, enc: ((Texture) -> Pair<ByteArray, String>)?, names: MutableMap<SceneObject, String>, files: MutableMap<String, ByteArray>): ByteArray {
        val sb = StringBuilder("# GLB&ME materials\n")
        val done = HashMap<app.glbandme.core.scene.Material, String>()
        val texNames = HashMap<Long, String>()
        fun tex(t: Texture): String = texNames.getOrPut(t.uid) {
            val (b, mime) = enc?.invoke(t) ?: (t.bytes to t.mimeType)
            val ext = when (mime) { "image/jpeg" -> "jpg"; "image/webp" -> "webp"; else -> "png" }
            val n = "tex${texNames.size}.$ext"
            files[n] = b
            n
        }
        for (o in objs) {
            val m = o.material
            val name = done.getOrPut(m) {
                val n = UsdzWriter.sanitize(m.name).ifEmpty { "Material" } + "_${done.size}"
                val c = m.baseColor
                fun srgb(v: Float) = app.glbandme.core.scene.Color.linearToSrgb(v)
                sb.append("\nnewmtl ").append(n).append('\n')
                sb.append(String.format(java.util.Locale.US, "Kd %.4f %.4f %.4f\n", srgb(c[0]), srgb(c[1]), srgb(c[2])))
                sb.append(String.format(java.util.Locale.US, "Ks %.3f %.3f %.3f\n", 0.04f + m.metallic * 0.6f, 0.04f + m.metallic * 0.6f, 0.04f + m.metallic * 0.6f))
                sb.append(String.format(java.util.Locale.US, "Ns %.1f\n", (1f - m.roughness) * (1f - m.roughness) * 900f + 4f))
                if (m.emissive.any { it > 0f }) sb.append(String.format(java.util.Locale.US, "Ke %.4f %.4f %.4f\n", m.emissive[0] * m.emissiveStrength, m.emissive[1] * m.emissiveStrength, m.emissive[2] * m.emissiveStrength))
                if (c[3] < 1f) sb.append(String.format(java.util.Locale.US, "d %.3f\n", c[3]))
                sb.append("illum 2\n")
                // PBR extension keys understood by Blender & most importers
                sb.append(String.format(java.util.Locale.US, "Pr %.3f\nPm %.3f\n", m.roughness, m.metallic))
                if (textures) {
                    m.baseColorTexture?.let { sb.append("map_Kd ").append(tex(it)).append('\n') }
                    m.normalTexture?.let { sb.append("norm ").append(tex(it)).append('\n') }
                    m.emissiveTexture?.let { sb.append("map_Ke ").append(tex(it)).append('\n') }
                    if (m.alphaMode != app.glbandme.core.scene.AlphaMode.OPAQUE) m.baseColorTexture?.let { sb.append("map_d ").append(tex(it)).append('\n') }
                }
                n
            }
            names[o] = name
        }
        return sb.toString().toByteArray(Charsets.UTF_8)
    }
}
