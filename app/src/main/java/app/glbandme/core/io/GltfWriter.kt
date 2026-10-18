package app.glbandme.core.io

import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

class GltfExportOptions(
    var binary: Boolean = true,
    var includeHidden: Boolean = false,
    var onlySelected: Boolean = false,
    var vertexColors: Boolean = true,
    var normals: Boolean = true,
    var uvs: Boolean = true,
    var animations: Boolean = true,
    /** Editor data (mask, primitive params, camera) for project files. */
    var projectData: Boolean = false,
    var generator: String = "GLB&ME"
)

/** glTF 2.0 writer (.glb or .gltf with embedded buffers). */
object GltfWriter {

    private const val FLOAT = 5126
    private const val USHORT = 5123
    private const val UINT = 5125
    private const val ARRAY_BUFFER = 34962
    private const val ELEMENT_ARRAY_BUFFER = 34963

    fun write(scene: Scene, opt: GltfExportOptions, editorExtras: Map<String, Any?>? = null): ByteArray {
        val objects = scene.objects.filter { o ->
            (opt.includeHidden || opt.projectData || o.visible) && (!opt.onlySelected || o === scene.selected) && o.mesh.triangleCount > 0
        }
        val w = Builder(opt)
        val nodeIds = ArrayList<Int>()
        val nodeOf = HashMap<SceneObject, Int>()
        for (o in objects) {
            val mesh = w.mesh(o)
            val node = LinkedHashMap<String, Any?>()
            node["name"] = o.name
            node["mesh"] = mesh
            if (o.position.x != 0f || o.position.y != 0f || o.position.z != 0f) node["translation"] = listOf(o.position.x, o.position.y, o.position.z)
            if (o.rotation.x != 0f || o.rotation.y != 0f || o.rotation.z != 0f || o.rotation.w != 1f) node["rotation"] = listOf(o.rotation.x, o.rotation.y, o.rotation.z, o.rotation.w)
            if (o.scale.x != 1f || o.scale.y != 1f || o.scale.z != 1f) node["scale"] = listOf(o.scale.x, o.scale.y, o.scale.z)
            if (opt.projectData) {
                val ex = LinkedHashMap<String, Any?>()
                ex["visible"] = o.visible
                if (o.locked) ex["locked"] = true
                o.primitive?.let { ex["primitive"] = mapOf("type" to it.type.name, "params" to it.params.toMap()) }
                if (o.mesh.flatShading) ex["flat"] = true
                node["extras"] = mapOf("glbandme" to ex)
            }
            nodeOf[o] = w.nodes.size
            nodeIds.add(w.nodes.size)
            w.nodes.add(node)
        }
        if (opt.animations && objects.any { it.keys.isNotEmpty() }) w.animation(scene, objects, nodeOf)

        val root = LinkedHashMap<String, Any?>()
        root["asset"] = mapOf("version" to "2.0", "generator" to opt.generator)
        if (w.extensionsUsed.isNotEmpty()) root["extensionsUsed"] = w.extensionsUsed.toList()
        root["scene"] = 0
        val sceneObj = LinkedHashMap<String, Any?>()
        sceneObj["name"] = "Scene"
        sceneObj["nodes"] = nodeIds
        if (editorExtras != null) sceneObj["extras"] = mapOf("glbandme" to editorExtras)
        root["scenes"] = listOf(sceneObj)
        root["nodes"] = w.nodes
        root["meshes"] = w.meshes
        if (w.materials.isNotEmpty()) root["materials"] = w.materials
        if (w.textures.isNotEmpty()) {
            root["textures"] = w.textures
            root["images"] = w.images
            root["samplers"] = listOf(mapOf("magFilter" to 9729, "minFilter" to 9987, "wrapS" to 10497, "wrapT" to 10497))
        }
        if (w.animations.isNotEmpty()) root["animations"] = w.animations
        root["accessors"] = w.accessors
        root["bufferViews"] = w.bufferViews
        val bin = w.bin.toByteArray()
        val buffer = LinkedHashMap<String, Any?>()
        buffer["byteLength"] = bin.size
        if (!opt.binary) buffer["uri"] = "data:application/octet-stream;base64," + Base64.getEncoder().encodeToString(bin)
        root["buffers"] = listOf(buffer)

        if (!opt.binary) return Json.write(root, pretty = true).toByteArray(Charsets.UTF_8)
        return packGlb(Json.write(root).toByteArray(Charsets.UTF_8), bin)
    }

    fun packGlb(json: ByteArray, bin: ByteArray): ByteArray {
        val jsonPad = (4 - json.size % 4) % 4
        val binPad = (4 - bin.size % 4) % 4
        val jsonLen = json.size + jsonPad
        val binLen = bin.size + binPad
        val total = 12 + 8 + jsonLen + (if (bin.isNotEmpty()) 8 + binLen else 0)
        val bb = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN)
        bb.putInt(0x46546C67); bb.putInt(2); bb.putInt(total)
        bb.putInt(jsonLen); bb.putInt(0x4E4F534A); bb.put(json); repeat(jsonPad) { bb.put(0x20) }
        if (bin.isNotEmpty()) {
            bb.putInt(binLen); bb.putInt(0x004E4942); bb.put(bin); repeat(binPad) { bb.put(0) }
        }
        return bb.array()
    }

    private class Builder(val opt: GltfExportOptions) {
        val bin = ByteArrayOutputStream()
        val bufferViews = ArrayList<Map<String, Any?>>()
        val accessors = ArrayList<Map<String, Any?>>()
        val meshes = ArrayList<Map<String, Any?>>()
        val materials = ArrayList<Map<String, Any?>>()
        val textures = ArrayList<Map<String, Any?>>()
        val images = ArrayList<Map<String, Any?>>()
        val nodes = ArrayList<MutableMap<String, Any?>>()
        val animations = ArrayList<Map<String, Any?>>()
        val extensionsUsed = LinkedHashSet<String>()
        private val textureIndex = HashMap<Long, Int>()

        private fun align() { while (bin.size() % 4 != 0) bin.write(0) }

        fun view(bytes: ByteArray, target: Int? = null, stride: Int? = null): Int {
            align()
            val offset = bin.size()
            bin.write(bytes)
            val v = LinkedHashMap<String, Any?>()
            v["buffer"] = 0
            v["byteOffset"] = offset
            v["byteLength"] = bytes.size
            if (stride != null) v["byteStride"] = stride
            if (target != null) v["target"] = target
            bufferViews.add(v)
            return bufferViews.size - 1
        }

        fun floatAccessor(data: FloatArray, comps: Int, type: String, target: Int?, minMax: Boolean = false, normalizedUShort: Boolean = false): Int {
            val count = data.size / comps
            val acc = LinkedHashMap<String, Any?>()
            if (normalizedUShort) {
                val bb = ByteBuffer.allocate(data.size * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (f in data) bb.putShort((f.coerceIn(0f, 1f) * 65535f + 0.5f).toInt().toShort())
                acc["bufferView"] = view(bb.array(), target)
                acc["componentType"] = USHORT
                acc["normalized"] = true
            } else {
                val bb = ByteBuffer.allocate(data.size * 4).order(ByteOrder.LITTLE_ENDIAN)
                for (f in data) bb.putFloat(f)
                acc["bufferView"] = view(bb.array(), target)
                acc["componentType"] = FLOAT
            }
            acc["count"] = count
            acc["type"] = type
            if (minMax && count > 0) {
                val mn = FloatArray(comps) { Float.MAX_VALUE }
                val mx = FloatArray(comps) { -Float.MAX_VALUE }
                for (i in 0 until count) for (c in 0 until comps) {
                    val v = data[i * comps + c]
                    if (v < mn[c]) mn[c] = v
                    if (v > mx[c]) mx[c] = v
                }
                acc["min"] = mn.toList(); acc["max"] = mx.toList()
            }
            accessors.add(acc)
            return accessors.size - 1
        }

        fun indexAccessor(idx: IntArray, vertexCount: Int): Int {
            val acc = LinkedHashMap<String, Any?>()
            if (vertexCount <= 65535) {
                val bb = ByteBuffer.allocate(idx.size * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (i in idx) bb.putShort(i.toShort())
                acc["bufferView"] = view(bb.array(), ELEMENT_ARRAY_BUFFER)
                acc["componentType"] = USHORT
            } else {
                val bb = ByteBuffer.allocate(idx.size * 4).order(ByteOrder.LITTLE_ENDIAN)
                for (i in idx) bb.putInt(i)
                acc["bufferView"] = view(bb.array(), ELEMENT_ARRAY_BUFFER)
                acc["componentType"] = UINT
            }
            acc["count"] = idx.size
            acc["type"] = "SCALAR"
            accessors.add(acc)
            return accessors.size - 1
        }

        fun mesh(o: SceneObject): Int {
            val m = o.mesh
            val attrs = LinkedHashMap<String, Any?>()
            attrs["POSITION"] = floatAccessor(m.positions, 3, "VEC3", ARRAY_BUFFER, minMax = true)
            if (opt.normals) attrs["NORMAL"] = floatAccessor(m.normals, 3, "VEC3", ARRAY_BUFFER)
            val uv = m.uvs
            if (opt.uvs && uv != null) attrs["TEXCOORD_0"] = floatAccessor(uv, 2, "VEC2", ARRAY_BUFFER)
            val col = m.colors
            if (opt.vertexColors && col != null && !isAllWhite(col)) attrs["COLOR_0"] = floatAccessor(col, 4, "VEC4", ARRAY_BUFFER, normalizedUShort = true)
            val mask = m.mask
            if (opt.projectData && mask != null && m.hasMask()) attrs["_MASK"] = floatAccessor(mask, 1, "SCALAR", ARRAY_BUFFER)
            val prim = LinkedHashMap<String, Any?>()
            prim["attributes"] = attrs
            prim["indices"] = indexAccessor(m.indices, m.vertexCount)
            prim["material"] = material(o.material)
            prim["mode"] = 4
            meshes.add(mapOf("name" to o.name, "primitives" to listOf(prim)))
            return meshes.size - 1
        }

        private fun isAllWhite(c: FloatArray): Boolean {
            for (v in c) if (v < 0.999f) return false
            return true
        }

        private fun texRef(t: Texture?, extra: Map<String, Any?> = emptyMap()): Map<String, Any?>? {
            if (t == null) return null
            val idx = textureIndex.getOrPut(t.uid) {
                val view = view(t.bytes)
                images.add(mapOf("name" to t.name, "bufferView" to view, "mimeType" to t.mimeType))
                if (t.mimeType == "image/webp") extensionsUsed.add("EXT_texture_webp")
                val tex = if (t.mimeType == "image/webp")
                    mapOf("sampler" to 0, "extensions" to mapOf("EXT_texture_webp" to mapOf("source" to images.size - 1)))
                else mapOf("sampler" to 0, "source" to images.size - 1)
                textures.add(tex)
                textures.size - 1
            }
            return LinkedHashMap<String, Any?>().apply { put("index", idx); putAll(extra) }
        }

        fun material(m: Material): Int {
            val pbr = LinkedHashMap<String, Any?>()
            pbr["baseColorFactor"] = m.baseColor.toList()
            pbr["metallicFactor"] = m.metallic
            pbr["roughnessFactor"] = m.roughness
            texRef(m.baseColorTexture)?.let { pbr["baseColorTexture"] = it }
            texRef(m.metallicRoughnessTexture)?.let { pbr["metallicRoughnessTexture"] = it }
            val mat = LinkedHashMap<String, Any?>()
            mat["name"] = m.name
            mat["pbrMetallicRoughness"] = pbr
            texRef(m.normalTexture, if (m.normalScale != 1f) mapOf("scale" to m.normalScale) else emptyMap())?.let { mat["normalTexture"] = it }
            texRef(m.occlusionTexture, if (m.occlusionStrength != 1f) mapOf("strength" to m.occlusionStrength) else emptyMap())?.let { mat["occlusionTexture"] = it }
            texRef(m.emissiveTexture)?.let { mat["emissiveTexture"] = it }
            if (m.emissive.any { it > 0f } || m.emissiveTexture != null) {
                mat["emissiveFactor"] = m.emissive.toList()
            }
            val ext = LinkedHashMap<String, Any?>()
            if (m.emissiveStrength != 1f && (m.emissive.any { it > 0f } || m.emissiveTexture != null)) {
                ext["KHR_materials_emissive_strength"] = mapOf("emissiveStrength" to m.emissiveStrength)
                extensionsUsed.add("KHR_materials_emissive_strength")
            }
            if (m.unlit) {
                ext["KHR_materials_unlit"] = emptyMap<String, Any?>()
                extensionsUsed.add("KHR_materials_unlit")
            }
            if (ext.isNotEmpty()) mat["extensions"] = ext
            if (m.alphaMode != AlphaMode.OPAQUE) mat["alphaMode"] = m.alphaMode.name
            if (m.alphaMode == AlphaMode.MASK) mat["alphaCutoff"] = m.alphaCutoff
            if (m.doubleSided) mat["doubleSided"] = true
            materials.add(mat)
            return materials.size - 1
        }

        fun animation(scene: Scene, objects: List<SceneObject>, nodeOf: Map<SceneObject, Int>) {
            val channels = ArrayList<Map<String, Any?>>()
            val samplers = ArrayList<Map<String, Any?>>()
            val fps = scene.fps.coerceAtLeast(1).toFloat()
            for (o in objects) {
                if (o.keys.isEmpty()) continue
                val node = nodeOf[o] ?: continue
                val frames = o.keys.keys.toList()
                val times = FloatArray(frames.size) { frames[it] / fps }
                val input = floatAccessor(times, 1, "SCALAR", null, minMax = true)
                val keys = frames.map { o.keys[it]!! }
                val t = FloatArray(keys.size * 3); val r = FloatArray(keys.size * 4); val s = FloatArray(keys.size * 3)
                keys.forEachIndexed { i, k ->
                    t[i * 3] = k.position.x; t[i * 3 + 1] = k.position.y; t[i * 3 + 2] = k.position.z
                    r[i * 4] = k.rotation.x; r[i * 4 + 1] = k.rotation.y; r[i * 4 + 2] = k.rotation.z; r[i * 4 + 3] = k.rotation.w
                    s[i * 3] = k.scale.x; s[i * 3 + 1] = k.scale.y; s[i * 3 + 2] = k.scale.z
                }
                // keep quaternion signs continuous so LINEAR interpolation takes the short path
                for (i in 1 until keys.size) {
                    val d = r[i * 4] * r[(i - 1) * 4] + r[i * 4 + 1] * r[(i - 1) * 4 + 1] + r[i * 4 + 2] * r[(i - 1) * 4 + 2] + r[i * 4 + 3] * r[(i - 1) * 4 + 3]
                    if (d < 0) for (c in 0 until 4) r[i * 4 + c] = -r[i * 4 + c]
                }
                for ((path, data, comps, type) in listOf(
                    Quad("translation", t, 3, "VEC3"), Quad("rotation", r, 4, "VEC4"), Quad("scale", s, 3, "VEC3")
                )) {
                    val out = floatAccessor(data, comps, type, null)
                    samplers.add(mapOf("input" to input, "output" to out, "interpolation" to "LINEAR"))
                    channels.add(mapOf("sampler" to samplers.size - 1, "target" to mapOf("node" to node, "path" to path)))
                }
            }
            if (channels.isNotEmpty()) animations.add(mapOf("name" to "Animation", "channels" to channels, "samplers" to samplers))
        }
    }

    private data class Quad(val path: String, val data: FloatArray, val comps: Int, val type: String)
}
