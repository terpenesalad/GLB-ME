package app.glbandme.core.io

import app.glbandme.core.mesh.IntArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import kotlin.math.roundToInt

class ImportResult(
    val objects: List<SceneObject>,
    val warnings: List<String>,
    /** scene.extras.glbandme when the file was saved by GLB&ME */
    val editorExtras: Map<String, Any?>? = null,
    val fps: Int = 30,
    val frameCount: Int = 0
)

class UnsupportedModelException(msg: String) : Exception(msg)

/** glTF 2.0 reader for .glb and .gltf (embedded / data-uri or resolver-provided buffers). */
class GltfReader(private val resolver: ((String) -> ByteArray?)? = null) {

    private lateinit var root: Map<String, Any?>
    private val buffers = ArrayList<ByteArray?>()
    private val warnings = ArrayList<String>()
    private val textureCache = HashMap<Int, Texture?>()
    private val materialCache = HashMap<Int, Material>()

    fun read(data: ByteArray, fps: Int = 30): ImportResult {
        var binChunk: ByteArray? = null
        val jsonText: String
        if (data.size >= 12 && readU32(data, 0) == 0x46546C67L) {
            val bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
            val version = bb.getInt(4)
            if (version != 2) throw UnsupportedModelException("Only glTF 2.0 binary files are supported (found version $version)")
            var off = 12
            var json: String? = null
            while (off + 8 <= data.size) {
                val len = bb.getInt(off); val type = bb.getInt(off + 4)
                val start = off + 8
                if (start + len > data.size) break
                if (type == 0x4E4F534A) json = String(data, start, len, Charsets.UTF_8)
                else if (type == 0x004E4942 && binChunk == null) binChunk = data.copyOfRange(start, start + len)
                off = start + len
            }
            jsonText = json ?: throw UnsupportedModelException("GLB has no JSON chunk")
        } else {
            jsonText = String(data, Charsets.UTF_8).trimStart('﻿')
        }
        root = Json.parse(jsonText).obj() ?: throw UnsupportedModelException("Not a glTF file")
        val asset = root.o("asset")
        val ver = asset?.s("version") ?: "2.0"
        if (!ver.startsWith("2")) throw UnsupportedModelException("glTF $ver isn't supported, only 2.0")
        val required = root.a("extensionsRequired")?.mapNotNull { it as? String } ?: emptyList()
        val supported = setOf("KHR_materials_unlit", "KHR_mesh_quantization", "KHR_texture_transform", "KHR_materials_emissive_strength", "EXT_texture_webp")
        for (e in required) {
            if (e == "KHR_draco_mesh_compression") throw UnsupportedModelException("This file uses Draco mesh compression, which isn't supported yet. Re-export it without Draco.")
            if (e == "EXT_meshopt_compression") throw UnsupportedModelException("This file uses meshopt compression, which isn't supported yet.")
            if (e !in supported) warnings.add("Required extension $e is not supported; the model may look different.")
        }

        root.a("buffers")?.forEachIndexed { i, b ->
            val m = b.obj()!!
            val uri = m.s("uri")
            buffers.add(
                when {
                    uri == null -> if (i == 0) binChunk else null
                    uri.startsWith("data:") -> decodeDataUri(uri)
                    else -> resolver?.invoke(uri) ?: run { warnings.add("External buffer '$uri' couldn't be loaded. Use a .glb or embedded .gltf."); null }
                }
            )
        }

        val objects = ArrayList<SceneObject>()
        val nodeObjects = HashMap<Int, MutableList<SceneObject>>()
        val nodes = root.a("nodes") ?: emptyList()
        val parent = IntArray(nodes.size) { -1 }
        nodes.forEachIndexed { i, n -> n.obj()?.a("children")?.forEach { c -> (c as? Number)?.toInt()?.let { if (it in parent.indices) parent[it] = i } } }
        val sceneIdx = root.i("scene", 0)
        val scenes = root.a("scenes")
        val rootNodes: List<Int> = scenes?.getOrNull(sceneIdx)?.obj()?.a("nodes")?.mapNotNull { (it as? Number)?.toInt() }
            ?: nodes.indices.filter { parent[it] < 0 }
        val world = arrayOfNulls<FloatArray>(nodes.size)

        fun visit(ni: Int, parentWorld: FloatArray, depth: Int) {
            if (ni !in nodes.indices || depth > 64) return
            val n = nodes[ni].obj() ?: return
            val local = nodeLocal(n)
            val wm = Mat4.mul(parentWorld, local)
            world[ni] = wm
            n.iOrNull("mesh")?.let { mi ->
                val created = buildMeshObjects(mi, n, wm)
                if (created.isNotEmpty()) { objects.addAll(created); nodeObjects[ni] = created.toMutableList() }
            }
            n.a("children")?.forEach { c -> (c as? Number)?.toInt()?.let { visit(it, wm, depth + 1) } }
        }
        for (r in rootNodes) visit(r, Mat4.identity(), 0)

        var frameCount = 0
        val editor = scenes?.getOrNull(sceneIdx)?.obj()?.o("extras")?.o("glbandme")
        val animFps = editor?.i("fps", fps) ?: fps
        root.a("animations")?.firstOrNull()?.obj()?.let { anim ->
            frameCount = readAnimation(anim, nodes.size, parent, world, nodeObjects, animFps)
        }
        if ((root.a("animations")?.size ?: 0) > 1) warnings.add("Only the first animation clip was imported.")
        if (objects.isEmpty()) warnings.add("No triangle meshes were found in this file.")
        return ImportResult(objects, warnings, editor, animFps, frameCount)
    }

    // ------------------------------------------------------------------------------------------
    private fun nodeLocal(n: Map<String, Any?>): FloatArray {
        n.floats("matrix")?.let { if (it.size == 16) return it }
        val t = n.floats("translation") ?: floatArrayOf(0f, 0f, 0f)
        val r = n.floats("rotation") ?: floatArrayOf(0f, 0f, 0f, 1f)
        val s = n.floats("scale") ?: floatArrayOf(1f, 1f, 1f)
        return Mat4.fromTRS(Vec3(t[0], t[1], t[2]), Quat(r[0], r[1], r[2], r[3]).normalize(), Vec3(s[0], s[1], s[2]))
    }

    private fun buildMeshObjects(meshIndex: Int, node: Map<String, Any?>, worldM: FloatArray): List<SceneObject> {
        val mesh = root.a("meshes")?.getOrNull(meshIndex).obj() ?: return emptyList()
        val prims = mesh.a("primitives") ?: return emptyList()
        val baseName = node.s("name") ?: mesh.s("name") ?: "Mesh"
        val ex = node.o("extras")?.o("glbandme")
        val out = ArrayList<SceneObject>()
        prims.forEachIndexed { pi, pAny ->
            val p = pAny.obj() ?: return@forEachIndexed
            val m = try { buildPrimitive(p) } catch (e: Exception) { warnings.add("Skipped a primitive of '$baseName': ${e.message}"); null } ?: return@forEachIndexed
            val matIdx = p.iOrNull("material")
            val material = if (matIdx != null) material(matIdx).copy() else Material(name = "Default")
            val name = if (prims.size > 1) "$baseName.${pi + 1}" else baseName
            val o = SceneObject(name, m, material)
            o.setTransform(worldM)
            if (ex != null) {
                o.visible = ex.b("visible", true)
                o.locked = ex.b("locked", false)
                if (ex.b("flat")) m.flatShading = true
                ex.o("text")?.let { o.text = app.glbandme.core.scene.TextSpec.fromMap(it) }
                ex.o("primitive")?.let { ps ->
                    val type = runCatching { PrimType.valueOf(ps.s("type") ?: "") }.getOrNull()
                    if (type != null) {
                        val params = HashMap<String, Float>()
                        ps.o("params")?.forEach { (k, v) -> (v as? Number)?.let { params[k] = it.toFloat() } }
                        o.primitive = PrimitiveSpec(type, params)
                    }
                }
            }
            out.add(o)
        }
        return out
    }

    private fun buildPrimitive(p: Map<String, Any?>): Mesh? {
        val mode = p.i("mode", 4)
        if (mode !in 4..6) { warnings.add("Skipped points/lines primitive (mode $mode)."); return null }
        val attrs = p.o("attributes") ?: return null
        val posAcc = attrs.iOrNull("POSITION") ?: return null
        val pos = readAccessor(posAcc)
        val vc = pos.size / 3
        if (vc == 0) return null
        val uv = attrs.iOrNull("TEXCOORD_0")?.let { readAccessor(it) }?.takeIf { it.size == vc * 2 }
        val col = attrs.iOrNull("COLOR_0")?.let { idx ->
            val raw = readAccessor(idx)
            val comps = raw.size / vc
            when (comps) {
                4 -> raw
                3 -> FloatArray(vc * 4) { i -> if (i % 4 == 3) 1f else raw[(i / 4) * 3 + i % 4] }
                else -> null
            }
        }
        val mask = attrs.iOrNull("_MASK")?.let { readAccessor(it) }?.takeIf { it.size == vc }
        val normals = attrs.iOrNull("NORMAL")?.let { readAccessor(it) }?.takeIf { it.size == vc * 3 }
        var idx: IntArray = p.iOrNull("indices")?.let { readIndices(it) } ?: IntArray(vc) { it }
        idx = when (mode) {
            5 -> stripToList(idx)
            6 -> fanToList(idx)
            else -> idx
        }
        val n = idx.size - idx.size % 3
        if (n == 0) return null
        if (n != idx.size) idx = idx.copyOf(n)
        for (i in idx) if (i < 0 || i >= vc) throw UnsupportedModelException("Index out of range")
        val m = Mesh(pos, idx, normals, col, uv, mask)
        if (normals == null) m.computeNormals()
        return if (normals == null) MeshOps.removeDegenerate(m) else m
    }

    private fun stripToList(s: IntArray): IntArray {
        val out = IntArrayList(s.size * 3)
        for (i in 0 until s.size - 2) {
            if (i % 2 == 0) { out.add(s[i]); out.add(s[i + 1]); out.add(s[i + 2]) } else { out.add(s[i + 1]); out.add(s[i]); out.add(s[i + 2]) }
        }
        return out.toArray()
    }

    private fun fanToList(s: IntArray): IntArray {
        val out = IntArrayList(s.size * 3)
        for (i in 1 until s.size - 1) { out.add(s[0]); out.add(s[i]); out.add(s[i + 1]) }
        return out.toArray()
    }

    // ------------------------------------------------------------------------------------------
    private fun material(i: Int): Material = materialCache.getOrPut(i) {
        val m = root.a("materials")?.getOrNull(i).obj() ?: return@getOrPut Material()
        val mat = Material(name = m.s("name") ?: "Material ${i + 1}")
        val pbr = m.o("pbrMetallicRoughness")
        if (pbr != null) {
            pbr.floats("baseColorFactor")?.let { if (it.size == 4) it.copyInto(mat.baseColor) }
            mat.metallic = pbr.f("metallicFactor", 1f)
            mat.roughness = pbr.f("roughnessFactor", 1f)
            mat.baseColorTexture = pbr.o("baseColorTexture")?.let { texture(it) }
            mat.metallicRoughnessTexture = pbr.o("metallicRoughnessTexture")?.let { texture(it) }
        } else { mat.metallic = 1f; mat.roughness = 1f; mat.baseColor.fill(1f) }
        m.o("normalTexture")?.let { mat.normalTexture = texture(it); mat.normalScale = it.f("scale", 1f) }
        m.o("occlusionTexture")?.let { mat.occlusionTexture = texture(it); mat.occlusionStrength = it.f("strength", 1f) }
        m.o("emissiveTexture")?.let { mat.emissiveTexture = texture(it) }
        m.floats("emissiveFactor")?.let { if (it.size == 3) it.copyInto(mat.emissive) }
        mat.alphaMode = when (m.s("alphaMode")) { "BLEND" -> AlphaMode.BLEND; "MASK" -> AlphaMode.MASK; else -> AlphaMode.OPAQUE }
        mat.alphaCutoff = m.f("alphaCutoff", 0.5f)
        mat.doubleSided = m.b("doubleSided")
        // tiling: take the transform of the first textured slot (GLB&ME shares one per material)
        val firstRef = pbr?.o("baseColorTexture") ?: m.o("normalTexture") ?: m.o("emissiveTexture") ?: pbr?.o("metallicRoughnessTexture") ?: m.o("occlusionTexture")
        firstRef?.o("extensions")?.o("KHR_texture_transform")?.let { tt ->
            tt.floats("offset")?.let { if (it.size == 2) it.copyInto(mat.uvOffset) }
            tt.floats("scale")?.let { if (it.size == 2) it.copyInto(mat.uvScale) }
            mat.uvRotation = Math.toDegrees(tt.f("rotation", 0f).toDouble()).toFloat()
            if (tt.iOrNull("texCoord") != null && tt.i("texCoord") != 0) warnings.add("A texture transform uses a second UV set; it may look wrong.")
        }
        firstRef?.iOrNull("index")?.let { ti ->
            val samplerIdx = root.a("textures")?.getOrNull(ti).obj()?.iOrNull("sampler")
            val sampler = samplerIdx?.let { root.a("samplers")?.getOrNull(it).obj() }
            if (sampler != null && sampler.i("magFilter", 9729) == 9728) mat.pixelated = true
        }
        val ext = m.o("extensions")
        if (ext?.containsKey("KHR_materials_unlit") == true) mat.unlit = true
        ext?.o("KHR_materials_emissive_strength")?.let { mat.emissiveStrength = it.f("emissiveStrength", 1f) }
        mat
    }

    private fun texture(ref: Map<String, Any?>): Texture? {
        if (ref.i("texCoord", 0) != 0) warnings.add("A texture uses a second UV set; it may look wrong.")
        val ti = ref.iOrNull("index") ?: return null
        return textureCache.getOrPut(ti) {
            val t = root.a("textures")?.getOrNull(ti).obj() ?: return@getOrPut null
            val src = t.o("extensions")?.o("EXT_texture_webp")?.iOrNull("source") ?: t.iOrNull("source") ?: return@getOrPut null
            val img = root.a("images")?.getOrNull(src).obj() ?: return@getOrPut null
            val name = img.s("name") ?: "Image $src"
            val bytes: ByteArray? = when {
                img.iOrNull("bufferView") != null -> viewBytes(img.i("bufferView"))
                img.s("uri")?.startsWith("data:") == true -> decodeDataUri(img.s("uri")!!)
                img.s("uri") != null -> resolver?.invoke(img.s("uri")!!)
                else -> null
            }
            if (bytes == null) { warnings.add("Image '$name' couldn't be loaded."); return@getOrPut null }
            val mime = img.s("mimeType") ?: sniffMime(bytes)
            Texture(name, bytes, mime)
        }
    }

    private fun sniffMime(b: ByteArray): String = when {
        b.size > 4 && b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() -> "image/png"
        b.size > 3 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() -> "image/jpeg"
        b.size > 12 && String(b, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
        else -> "image/png"
    }

    // ------------------------------------------------------------------------------------------
    private fun readAnimation(
        anim: Map<String, Any?>, nodeCount: Int, parent: IntArray, world: Array<FloatArray?>,
        nodeObjects: Map<Int, List<SceneObject>>, fps: Int
    ): Int {
        val samplers = anim.a("samplers") ?: return 0
        val channels = anim.a("channels") ?: return 0
        class Track(val times: FloatArray, val values: FloatArray, val comps: Int, val interp: String)
        val tracks = HashMap<Int, HashMap<String, Track>>()
        for (cAny in channels) {
            val c = cAny.obj() ?: continue
            val target = c.o("target") ?: continue
            val node = target.iOrNull("node") ?: continue
            val path = target.s("path") ?: continue
            if (path !in setOf("translation", "rotation", "scale")) continue
            if (!nodeObjects.containsKey(node)) continue
            val s = samplers.getOrNull(c.i("sampler")).obj() ?: continue
            val times = readAccessor(s.i("input"))
            var values = readAccessor(s.i("output"))
            val comps = if (path == "rotation") 4 else 3
            val interp = s.s("interpolation") ?: "LINEAR"
            if (interp == "CUBICSPLINE") {
                // keep only the value of each (in-tangent, value, out-tangent) triple
                val k = times.size
                values = FloatArray(k * comps) { i -> values[((i / comps) * 3 + 1) * comps + i % comps] }
            }
            if (times.isEmpty() || values.size < times.size * comps) continue
            tracks.getOrPut(node) { HashMap() }[path] = Track(times, values, comps, interp)
        }
        var maxFrame = 0
        val nodes = root.a("nodes") ?: return 0
        for ((node, byPath) in tracks) {
            val n = nodes[node].obj() ?: continue
            val baseLocal = nodeLocal(n)
            val bt = Vec3(); val br = Quat(); val bs = Vec3()
            Mat4.decompose(baseLocal, bt, br, bs)
            val parentWorld = if (parent[node] >= 0) world[parent[node]] ?: Mat4.identity() else Mat4.identity()
            val allTimes = sortedSetOf<Float>()
            for (t in byPath.values) for (x in t.times) allTimes.add(x)
            val objs = nodeObjects[node] ?: continue
            for (time in allTimes) {
                val frame = (time * fps).roundToInt()
                val t = byPath["translation"]?.let { sample(it.times, it.values, 3, it.interp, time) }?.let { Vec3(it[0], it[1], it[2]) } ?: bt
                val r = byPath["rotation"]?.let { sampleRot(it.times, it.values, it.interp, time) } ?: br
                val s = byPath["scale"]?.let { sample(it.times, it.values, 3, it.interp, time) }?.let { Vec3(it[0], it[1], it[2]) } ?: bs
                val local = Mat4.fromTRS(t, r, s)
                val w = Mat4.mul(parentWorld, local)
                for (o in objs) {
                    val k = Keyframe(Vec3(), Quat(), Vec3())
                    Mat4.decompose(w, k.position, k.rotation, k.scale)
                    o.keys[frame] = k
                }
                if (frame > maxFrame) maxFrame = frame
            }
            for (o in objs) o.keys.firstEntry()?.value?.let { o.applyKeyframe(it) }
        }
        return maxFrame
    }

    private fun locate(times: FloatArray, t: Float): Pair<Int, Float> {
        if (t <= times[0]) return 0 to 0f
        if (t >= times.last()) return times.size - 1 to 0f
        var lo = 0; var hi = times.size - 1
        while (hi - lo > 1) { val mid = (lo + hi) / 2; if (times[mid] <= t) lo = mid else hi = mid }
        val span = times[hi] - times[lo]
        return lo to (if (span > 0) (t - times[lo]) / span else 0f)
    }

    private fun sample(times: FloatArray, values: FloatArray, comps: Int, interp: String, t: Float): FloatArray {
        val (i, f) = locate(times, t)
        val out = FloatArray(comps)
        for (c in 0 until comps) {
            val a = values[i * comps + c]
            out[c] = if (interp == "STEP" || i + 1 >= times.size) a else a + (values[(i + 1) * comps + c] - a) * f
        }
        return out
    }

    private fun sampleRot(times: FloatArray, values: FloatArray, interp: String, t: Float): Quat {
        val (i, f) = locate(times, t)
        val a = Quat(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]).normalize()
        if (interp == "STEP" || i + 1 >= times.size || f == 0f) return a
        val b = Quat(values[(i + 1) * 4], values[(i + 1) * 4 + 1], values[(i + 1) * 4 + 2], values[(i + 1) * 4 + 3]).normalize()
        return Quat.slerp(a, b, f)
    }

    // ------------------------------------------------------------------------------------------
    private fun decodeDataUri(uri: String): ByteArray? {
        val comma = uri.indexOf(',')
        if (comma < 0) return null
        val meta = uri.substring(5, comma)
        val payload = uri.substring(comma + 1)
        return if (meta.endsWith(";base64")) Base64.getMimeDecoder().decode(payload)
        else java.net.URLDecoder.decode(payload, "UTF-8").toByteArray(Charsets.ISO_8859_1)
    }

    private fun viewBytes(viewIndex: Int): ByteArray? {
        val v = root.a("bufferViews")?.getOrNull(viewIndex).obj() ?: return null
        val buf = buffers.getOrNull(v.i("buffer")) ?: return null
        val off = v.i("byteOffset", 0)
        val len = v.i("byteLength")
        if (off + len > buf.size) return null
        return buf.copyOfRange(off, off + len)
    }

    private fun compCount(type: String) = when (type) {
        "SCALAR" -> 1; "VEC2" -> 2; "VEC3" -> 3; "VEC4" -> 4; "MAT2" -> 4; "MAT3" -> 9; "MAT4" -> 16
        else -> throw UnsupportedModelException("Unknown accessor type $type")
    }

    private fun compSize(ct: Int) = when (ct) { 5120, 5121 -> 1; 5122, 5123 -> 2; 5125, 5126 -> 4; else -> throw UnsupportedModelException("Bad component type $ct") }

    private fun readComponent(bb: ByteBuffer, pos: Int, ct: Int, normalized: Boolean): Float = when (ct) {
        5126 -> bb.getFloat(pos)
        5121 -> { val v = bb.get(pos).toInt() and 0xff; if (normalized) v / 255f else v.toFloat() }
        5120 -> { val v = bb.get(pos).toInt(); if (normalized) maxOf(v / 127f, -1f) else v.toFloat() }
        5123 -> { val v = bb.getShort(pos).toInt() and 0xffff; if (normalized) v / 65535f else v.toFloat() }
        5122 -> { val v = bb.getShort(pos).toInt(); if (normalized) maxOf(v / 32767f, -1f) else v.toFloat() }
        5125 -> (bb.getInt(pos).toLong() and 0xffffffffL).toFloat()
        else -> 0f
    }

    fun readAccessor(i: Int): FloatArray {
        val acc = root.a("accessors")?.getOrNull(i).obj() ?: throw UnsupportedModelException("Missing accessor $i")
        val count = acc.i("count")
        val comps = compCount(acc.s("type") ?: "SCALAR")
        val ct = acc.i("componentType")
        val normalized = acc.b("normalized")
        val out = FloatArray(count * comps)
        val viewIdx = acc.iOrNull("bufferView")
        if (viewIdx != null) {
            val v = root.a("bufferViews")?.getOrNull(viewIdx).obj() ?: throw UnsupportedModelException("Missing bufferView")
            val buf = buffers.getOrNull(v.i("buffer")) ?: throw UnsupportedModelException("Missing buffer data")
            val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
            val cs = compSize(ct)
            val stride = v.i("byteStride", 0).let { if (it == 0) cs * comps else it }
            val base = v.i("byteOffset", 0) + acc.i("byteOffset", 0)
            if (count > 0 && base + stride * (count - 1) + cs * comps > buf.size) throw UnsupportedModelException("Accessor exceeds buffer")
            for (e in 0 until count) for (c in 0 until comps) {
                out[e * comps + c] = readComponent(bb, base + e * stride + c * cs, ct, normalized)
            }
        }
        acc.o("sparse")?.let { sp ->
            val n = sp.i("count")
            val ind = sp.o("indices")!!; val vals = sp.o("values")!!
            val ib = viewBytes(ind.i("bufferView")) ?: return out
            val vb = viewBytes(vals.i("bufferView")) ?: return out
            val ibb = ByteBuffer.wrap(ib).order(ByteOrder.LITTLE_ENDIAN)
            val vbb = ByteBuffer.wrap(vb).order(ByteOrder.LITTLE_ENDIAN)
            val ict = ind.i("componentType"); val ics = compSize(ict); val ioff = ind.i("byteOffset", 0)
            val voff = vals.i("byteOffset", 0); val cs = compSize(ct)
            for (k in 0 until n) {
                val target = readComponent(ibb, ioff + k * ics, ict, false).toInt()
                for (c in 0 until comps) out[target * comps + c] = readComponent(vbb, voff + (k * comps + c) * cs, ct, normalized)
            }
        }
        return out
    }

    private fun readIndices(i: Int): IntArray {
        val acc = root.a("accessors")?.getOrNull(i).obj() ?: throw UnsupportedModelException("Missing index accessor")
        val ct = acc.i("componentType")
        if (ct == 5125) {
            // read as ints directly to keep precision above 2^24
            val count = acc.i("count")
            val v = root.a("bufferViews")?.getOrNull(acc.i("bufferView")).obj() ?: throw UnsupportedModelException("Missing bufferView")
            val buf = buffers.getOrNull(v.i("buffer")) ?: throw UnsupportedModelException("Missing buffer data")
            val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
            val base = v.i("byteOffset", 0) + acc.i("byteOffset", 0)
            val stride = v.i("byteStride", 0).let { if (it == 0) 4 else it }
            return IntArray(count) { bb.getInt(base + it * stride) }
        }
        val f = readAccessor(i)
        return IntArray(f.size) { f[it].toInt() }
    }

    private fun readU32(d: ByteArray, o: Int): Long =
        (d[o].toLong() and 0xff) or ((d[o + 1].toLong() and 0xff) shl 8) or ((d[o + 2].toLong() and 0xff) shl 16) or ((d[o + 3].toLong() and 0xff) shl 24)
}
