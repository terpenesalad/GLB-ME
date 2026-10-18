package app.glbandme.core.io

import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.zip.CRC32

/**
 * USDZ (AR Quick Look on iPhone / iPad / Vision Pro): a USDA layer using UsdPreviewSurface
 * materials plus PNG/JPEG textures, packed in an uncompressed zip with 64-byte aligned data.
 */
object UsdzWriter {

    class Options(
        var vertexColors: Boolean = true,
        var animations: Boolean = true,
        var root: FloatArray? = null,
        /** must return PNG or JPEG bytes */
        var textureEncoder: ((Texture) -> Pair<ByteArray, String>)? = null,
        var textures: Boolean = true,
    )

    fun write(scene: Scene, objects: List<SceneObject>, opt: Options = Options()): ByteArray {
        val files = LinkedHashMap<String, ByteArray>()
        val texPath = HashMap<Long, String>()
        fun texture(t: Texture): String = texPath.getOrPut(t.uid) {
            val (bytes, mime) = opt.textureEncoder?.invoke(t) ?: (t.bytes to t.mimeType)
            val ext = if (mime == "image/jpeg") "jpg" else "png"
            val path = "textures/tex${texPath.size}.$ext"
            files[path] = bytes
            path
        }

        val sb = StringBuilder(1 shl 16)
        val fps = scene.fps.coerceAtLeast(1)
        val animated = opt.animations && objects.any { it.keys.size > 1 }
        val endFrame = if (animated) objects.maxOf { if (it.keys.isEmpty()) 0 else it.keys.lastKey() } else 0
        sb.append("#usda 1.0\n(\n    customLayerData = {\n        string creator = \"GLB&ME\"\n    }\n    defaultPrim = \"Root\"\n    metersPerUnit = 1\n    upAxis = \"Y\"\n")
        if (animated) sb.append("    startTimeCode = 0\n    endTimeCode = $endFrame\n    timeCodesPerSecond = $fps\n")
        sb.append(")\n\n")
        sb.append("def Xform \"Root\" (\n    kind = \"component\"\n)\n{\n")
        opt.root?.let { sb.append("    matrix4d xformOp:transform = ").append(matrix(it)).append("\n    uniform token[] xformOpOrder = [\"xformOp:transform\"]\n\n") }

        // ---- materials ----------------------------------------------------------------------------
        val matIndex = LinkedHashMap<Material, Int>()
        for (o in objects) if (o.material !in matIndex) matIndex[o.material] = matIndex.size
        sb.append("    def Scope \"Materials\"\n    {\n")
        for ((m, i) in matIndex) material(sb, if (opt.textures) m else m.copy().apply {
            baseColorTexture = null; metallicRoughnessTexture = null; normalTexture = null; occlusionTexture = null; emissiveTexture = null
        }, "M$i", ::texture)
        sb.append("    }\n\n")

        // ---- meshes --------------------------------------------------------------------------------
        val used = HashSet<String>()
        for ((oi, o) in objects.withIndex()) {
            var name = sanitize(o.name).ifEmpty { "Object" }
            if (!used.add(name)) { name = "${name}_$oi"; used.add(name) }
            sb.append("    def Xform \"").append(name).append("\"\n    {\n")
            if (animated && o.keys.size > 1) {
                sb.append("        matrix4d xformOp:transform.timeSamples = {\n")
                val saved = o.currentKeyframe()
                for (f in 0..endFrame) {
                    o.evaluate(f.toFloat())
                    sb.append("            ").append(f).append(": ").append(matrix(o.localMatrix())).append(",\n")
                }
                o.applyKeyframe(saved)
                sb.append("        }\n")
            } else sb.append("        matrix4d xformOp:transform = ").append(matrix(o.localMatrix())).append("\n")
            sb.append("        uniform token[] xformOpOrder = [\"xformOp:transform\"]\n\n")
            mesh(sb, o, "M${matIndex[o.material]}", opt.vertexColors)
            sb.append("    }\n\n")
        }
        sb.append("}\n")
        val usda = sb.toString().toByteArray(Charsets.UTF_8)
        val all = LinkedHashMap<String, ByteArray>()
        all["model.usda"] = usda
        all.putAll(files)
        return zip(all)
    }

    // -------------------------------------------------------------------------------------------
    private fun material(sb: StringBuilder, m: Material, id: String, tex: (Texture) -> String) {
        val p = "/Root/Materials/$id"
        sb.append("        def Material \"").append(id).append("\"\n        {\n")
        sb.append("            token outputs:surface.connect = <$p/Surface.outputs:surface>\n\n")
        sb.append("            def Shader \"Surface\"\n            {\n")
        sb.append("                uniform token info:id = \"UsdPreviewSurface\"\n")
        val hasTex = m.textures().isNotEmpty()
        if (m.baseColorTexture != null) sb.append("                color3f inputs:diffuseColor.connect = <$p/BaseTex.outputs:rgb>\n")
        else sb.append("                color3f inputs:diffuseColor = ").append(vec3(m.baseColor)).append("\n")
        if (m.metallicRoughnessTexture != null) {
            sb.append("                float inputs:metallic.connect = <$p/MRTex.outputs:b>\n")
            sb.append("                float inputs:roughness.connect = <$p/MRTex.outputs:g>\n")
        } else {
            sb.append("                float inputs:metallic = ").append(f(m.metallic)).append("\n")
            sb.append("                float inputs:roughness = ").append(f(if (m.unlit) 1f else m.roughness)).append("\n")
        }
        val es = m.emissiveStrength
        when {
            m.emissiveTexture != null -> sb.append("                color3f inputs:emissiveColor.connect = <$p/EmissiveTex.outputs:rgb>\n")
            m.unlit -> sb.append("                color3f inputs:emissiveColor = ").append(vec3(m.baseColor)).append("\n")
            m.emissive.any { it > 0f } -> sb.append("                color3f inputs:emissiveColor = (").append(f(m.emissive[0] * es)).append(", ").append(f(m.emissive[1] * es)).append(", ").append(f(m.emissive[2] * es)).append(")\n")
        }
        if (m.normalTexture != null) sb.append("                normal3f inputs:normal.connect = <$p/NormalTex.outputs:rgb>\n")
        if (m.occlusionTexture != null) sb.append("                float inputs:occlusion.connect = <$p/OcclusionTex.outputs:r>\n")
        when (m.alphaMode) {
            AlphaMode.BLEND -> if (m.baseColorTexture != null) sb.append("                float inputs:opacity.connect = <$p/BaseTex.outputs:a>\n") else sb.append("                float inputs:opacity = ").append(f(m.baseColor[3])).append("\n")
            AlphaMode.MASK -> {
                if (m.baseColorTexture != null) sb.append("                float inputs:opacity.connect = <$p/BaseTex.outputs:a>\n")
                sb.append("                float inputs:opacityThreshold = ").append(f(m.alphaCutoff)).append("\n")
            }
            else -> {}
        }
        sb.append("                int inputs:useSpecularWorkflow = 0\n")
        sb.append("                token outputs:surface\n            }\n\n")
        if (hasTex) {
            sb.append("            def Shader \"UV\"\n            {\n                uniform token info:id = \"UsdPrimvarReader_float2\"\n                string inputs:varname = \"st\"\n                float2 outputs:result\n            }\n\n")
        }
        fun texShader(name: String, t: Texture?, srgb: Boolean, normal: Boolean = false, scale: FloatArray? = null) {
            if (t == null) return
            sb.append("            def Shader \"").append(name).append("\"\n            {\n")
            sb.append("                uniform token info:id = \"UsdUVTexture\"\n")
            sb.append("                asset inputs:file = @").append(tex(t)).append("@\n")
            sb.append("                float2 inputs:st.connect = <$p/UV.outputs:result>\n")
            sb.append("                token inputs:wrapS = \"repeat\"\n                token inputs:wrapT = \"repeat\"\n")
            sb.append("                token inputs:sourceColorSpace = \"").append(if (srgb) "sRGB" else "raw").append("\"\n")
            if (normal) sb.append("                float4 inputs:scale = (2, 2, 2, 1)\n                float4 inputs:bias = (-1, -1, -1, 0)\n")
            else if (scale != null) sb.append("                float4 inputs:scale = (").append(f(scale[0])).append(", ").append(f(scale[1])).append(", ").append(f(scale[2])).append(", ").append(f(scale[3])).append(")\n")
            sb.append("                float3 outputs:rgb\n                float outputs:r\n                float outputs:g\n                float outputs:b\n                float outputs:a\n            }\n\n")
        }
        val tint = m.baseColor
        texShader("BaseTex", m.baseColorTexture, true, scale = if (tint[0] < 0.999f || tint[1] < 0.999f || tint[2] < 0.999f || tint[3] < 0.999f) tint else null)
        texShader("MRTex", m.metallicRoughnessTexture, false, scale = floatArrayOf(1f, m.roughness, m.metallic, 1f).takeIf { m.roughness < 0.999f || m.metallic < 0.999f })
        texShader("EmissiveTex", m.emissiveTexture, true, scale = floatArrayOf(m.emissive[0] * es, m.emissive[1] * es, m.emissive[2] * es, 1f))
        texShader("NormalTex", m.normalTexture, false, normal = true)
        texShader("OcclusionTex", m.occlusionTexture, false)
        sb.append("        }\n\n")
    }

    private fun mesh(sb: StringBuilder, o: SceneObject, matId: String, vertexColors: Boolean) {
        val m = o.mesh
        val n = m.vertexCount
        val flip = app.glbandme.core.mesh.MeshBuilder.det3(o.localMatrix()) < 0
        sb.append("        def Mesh \"Mesh\"\n        {\n")
        sb.append("            uniform bool doubleSided = ").append(if (o.material.doubleSided) "1" else "0").append("\n")
        sb.append("            int[] faceVertexCounts = [")
        for (t in 0 until m.triangleCount) { if (t > 0) sb.append(", "); sb.append('3') }
        sb.append("]\n            int[] faceVertexIndices = [")
        // USD default orientation is right-handed (counter-clockwise), like glTF
        for (t in 0 until m.triangleCount) {
            val a = m.indices[t * 3]; val b = m.indices[t * 3 + 1]; val c = m.indices[t * 3 + 2]
            if (t > 0) sb.append(", ")
            if (flip) sb.append(a).append(", ").append(c).append(", ").append(b) else sb.append(a).append(", ").append(b).append(", ").append(c)
        }
        sb.append("]\n")
        sb.append("            rel material:binding = </Root/Materials/$matId>\n")
        val (mn, mx) = m.bounds()
        sb.append("            float3[] extent = [(").append(f(mn.x)).append(", ").append(f(mn.y)).append(", ").append(f(mn.z)).append("), (").append(f(mx.x)).append(", ").append(f(mx.y)).append(", ").append(f(mx.z)).append(")]\n")
        sb.append("            point3f[] points = [")
        for (i in 0 until n) { if (i > 0) sb.append(", "); sb.append('(').append(f(m.positions[i * 3])).append(", ").append(f(m.positions[i * 3 + 1])).append(", ").append(f(m.positions[i * 3 + 2])).append(')') }
        sb.append("]\n")
        sb.append("            normal3f[] normals = [")
        for (i in 0 until n) { if (i > 0) sb.append(", "); sb.append('(').append(f(m.normals[i * 3])).append(", ").append(f(m.normals[i * 3 + 1])).append(", ").append(f(m.normals[i * 3 + 2])).append(')') }
        sb.append("] (\n                interpolation = \"vertex\"\n            )\n")
        val uv = m.uvs
        if (uv != null) {
            // glTF UVs have v down from the image top; USD st has t up from the bottom. Bake tiling.
            val um = if (o.material.hasUvTransform()) o.material.uvMatrix() else null
            sb.append("            texCoord2f[] primvars:st = [")
            for (i in 0 until n) {
                var u = uv[i * 2]; var v = uv[i * 2 + 1]
                if (um != null) { val nu = um[0] * u + um[3] * v + um[6]; val nv = um[1] * u + um[4] * v + um[7]; u = nu; v = nv }
                if (i > 0) sb.append(", ")
                sb.append('(').append(f(u)).append(", ").append(f(1f - v)).append(')')
            }
            sb.append("] (\n                interpolation = \"vertex\"\n            )\n")
        }
        val c = m.colors
        if (vertexColors && c != null) {
            sb.append("            color3f[] primvars:displayColor = [")
            for (i in 0 until n) { if (i > 0) sb.append(", "); sb.append('(').append(f(c[i * 4])).append(", ").append(f(c[i * 4 + 1])).append(", ").append(f(c[i * 4 + 2])).append(')') }
            sb.append("] (\n                interpolation = \"vertex\"\n            )\n")
        }
        sb.append("            uniform token subdivisionScheme = \"none\"\n        }\n")
    }

    // -------------------------------------------------------------------------------------------
    /** USD matrices are row-major with row vectors, i.e. the transpose rows = our columns. */
    private fun matrix(m: FloatArray): String {
        val s = StringBuilder("( ")
        for (c in 0 until 4) {
            if (c > 0) s.append(", ")
            s.append('(').append(d(m[c * 4])).append(", ").append(d(m[c * 4 + 1])).append(", ").append(d(m[c * 4 + 2])).append(", ").append(d(m[c * 4 + 3])).append(')')
        }
        return s.append(" )").toString()
    }

    private fun vec3(c: FloatArray) = "(${f(c[0])}, ${f(c[1])}, ${f(c[2])})"
    private fun f(v: Float): String = if (v == v.toInt().toFloat() && kotlin.math.abs(v) < 1e7f) v.toInt().toString() else String.format(Locale.US, "%.6g", v)
    private fun d(v: Float): String = f(v)

    fun sanitize(name: String): String {
        val s = StringBuilder()
        for (ch in name) s.append(if (ch.isLetterOrDigit() && ch.code < 128 || ch == '_') ch else '_')
        var r = s.toString().trim('_')
        if (r.isNotEmpty() && r[0].isDigit()) r = "_$r"
        return r
    }

    // -------------------------------------------------------------------------------------------
    /** Stored (uncompressed) zip where every file's data starts on a 64-byte boundary. */
    fun zip(files: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        class Entry(val name: ByteArray, val crc: Long, val size: Int, val offset: Int)
        val entries = ArrayList<Entry>()
        fun le16(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff) }
        fun le32(v: Long) { for (i in 0 until 4) out.write(((v shr (8 * i)) and 0xff).toInt()) }
        for ((name, data) in files) {
            val nb = name.toByteArray(Charsets.UTF_8)
            val crc = CRC32().apply { update(data) }.value
            val offset = out.size()
            val headerLen = 30 + nb.size
            var pad = (64 - (offset + headerLen + 4) % 64) % 64
            val extraLen = 4 + pad
            le32(0x04034b50); le16(20); le16(0); le16(0); le16(0); le16(0x21)
            le32(crc); le32(data.size.toLong()); le32(data.size.toLong())
            le16(nb.size); le16(extraLen)
            out.write(nb)
            le16(0x1986); le16(pad)
            while (pad-- > 0) out.write(0)
            check(out.size() % 64 == 0)
            out.write(data)
            entries.add(Entry(nb, crc, data.size, offset))
        }
        val cdStart = out.size()
        for (e in entries) {
            le32(0x02014b50); le16(20); le16(20); le16(0); le16(0); le16(0); le16(0x21)
            le32(e.crc); le32(e.size.toLong()); le32(e.size.toLong())
            le16(e.name.size); le16(0); le16(0); le16(0); le16(0); le32(0); le32(e.offset.toLong())
            out.write(e.name)
        }
        val cdSize = out.size() - cdStart
        le32(0x06054b50); le16(0); le16(0); le16(entries.size); le16(entries.size); le32(cdSize.toLong()); le32(cdStart.toLong()); le16(0)
        return out.toByteArray()
    }
}
