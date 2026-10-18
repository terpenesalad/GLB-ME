package app.glbandme.core.io

import app.glbandme.core.mesh.FloatArrayList
import app.glbandme.core.mesh.IntArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.scene.Color
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.SceneObject
import app.glbandme.math.Mat4
import java.io.ByteArrayOutputStream
import java.io.OutputStreamWriter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale

/** Wavefront OBJ, STL and PLY import/export. */
object MeshFormats {

    // =========================================================================================
    // OBJ
    // =========================================================================================
    fun readObj(data: ByteArray): ImportResult {
        val text = String(data, Charsets.UTF_8)
        val v = FloatArrayList(4096); val vc = FloatArrayList(4096); var hasVc = false
        val vt = FloatArrayList(4096)
        val objects = ArrayList<SceneObject>()
        val warnings = ArrayList<String>()
        var curName = "Object"
        var mtlName: String? = null
        // per-object builders
        var map = HashMap<Long, Int>()
        var pos = FloatArrayList(4096); var uv = FloatArrayList(4096); var col = FloatArrayList(4096)
        var idx = IntArrayList(8192)
        var usesUv = false

        fun flush() {
            if (idx.size >= 3) {
                val m = Mesh(pos.toArray(), idx.toArray(), null, if (hasVc) col.toArray() else null, if (usesUv) uv.toArray() else null)
                val mat = Material(name = mtlName ?: "Material")
                objects.add(SceneObject(curName, MeshOps.removeDegenerate(m), mat))
            }
            map = HashMap(); pos = FloatArrayList(4096); uv = FloatArrayList(4096); col = FloatArrayList(4096); idx = IntArrayList(8192); usesUv = false
        }

        val face = IntArrayList(16)
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty() || line[0] == '#') continue
            val parts = line.split(WS)
            when (parts[0]) {
                "v" -> {
                    v.add(parts[1].toFloat(), parts[2].toFloat(), parts[3].toFloat())
                    if (parts.size >= 7) {
                        hasVc = true
                        var r = parts[4].toFloat(); var g = parts[5].toFloat(); var b = parts[6].toFloat()
                        if (r > 1f || g > 1f || b > 1f) { r /= 255f; g /= 255f; b /= 255f }
                        vc.add(Color.srgbToLinear(r), Color.srgbToLinear(g), Color.srgbToLinear(b))
                    } else vc.add(1f, 1f, 1f)
                }
                "vt" -> vt.add(parts[1].toFloat(), if (parts.size > 2) 1f - parts[2].toFloat() else 0f)
                "o", "g" -> {
                    val name = parts.drop(1).joinToString(" ").ifBlank { "Object" }
                    if (idx.size > 0) flush()
                    curName = name
                }
                "usemtl" -> mtlName = parts.drop(1).joinToString(" ")
                "f" -> {
                    face.clear()
                    for (k in 1 until parts.size) {
                        val refs = parts[k].split('/')
                        var vi = refs[0].toInt(); vi = if (vi < 0) v.size / 3 + vi else vi - 1
                        var ti = -1
                        if (refs.size > 1 && refs[1].isNotEmpty()) { ti = refs[1].toInt(); ti = if (ti < 0) vt.size / 2 + ti else ti - 1 }
                        if (vi < 0 || vi >= v.size / 3) continue
                        val key = (vi.toLong() shl 32) or (ti.toLong() and 0xffffffffL)
                        val id = map.getOrPut(key) {
                            pos.add(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2])
                            if (ti >= 0 && ti < vt.size / 2) { uv.add(vt[ti * 2], vt[ti * 2 + 1]); usesUv = true } else uv.add(0f, 0f)
                            col.add(vc[vi * 3], vc[vi * 3 + 1], vc[vi * 3 + 2], 1f)
                            pos.size / 3 - 1
                        }
                        face.add(id)
                    }
                    for (k in 1 until face.size - 1) { idx.add(face[0]); idx.add(face[k]); idx.add(face[k + 1]) }
                }
            }
        }
        flush()
        if (objects.isEmpty()) warnings.add("No faces found in OBJ file.")
        return ImportResult(objects, warnings)
    }

    fun writeObj(objects: List<SceneObject>, vertexColors: Boolean = true, root: FloatArray? = null, mtlName: String? = null, materialNames: Map<SceneObject, String>? = null): ByteArray {
        val out = ByteArrayOutputStream()
        val w = OutputStreamWriter(out, Charsets.UTF_8).buffered(1 shl 16)
        w.write("# Exported by GLB&ME\n")
        if (mtlName != null) w.write("mtllib $mtlName\n")
        var vBase = 1
        val tmp = FloatArray(3)
        for (o in objects) {
            val m = o.mesh
            val mat = if (root != null) Mat4.mul(root, o.localMatrix()) else o.localMatrix()
            val nm = Mat4.normalMatrix(mat)
            w.write("o ${o.name.replace(' ', '_')}\n")
            materialNames?.get(o)?.let { w.write("usemtl $it\n") }
            val c = if (vertexColors) m.colors else null
            for (i in 0 until m.vertexCount) {
                Mat4.transformPoint(mat, m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], tmp)
                if (c != null) w.write(String.format(Locale.US, "v %.6f %.6f %.6f %.4f %.4f %.4f\n", tmp[0], tmp[1], tmp[2],
                    Color.linearToSrgb(c[i * 4]), Color.linearToSrgb(c[i * 4 + 1]), Color.linearToSrgb(c[i * 4 + 2])))
                else w.write(String.format(Locale.US, "v %.6f %.6f %.6f\n", tmp[0], tmp[1], tmp[2]))
            }
            val uv = m.uvs
            // bake the material's tiling into the coordinates (OBJ/MTL has no texture transform)
            val um = if (o.material.hasUvTransform()) o.material.uvMatrix() else null
            if (uv != null) for (i in 0 until m.vertexCount) {
                var u = uv[i * 2]; var v = uv[i * 2 + 1]
                if (um != null) { val nu = um[0] * u + um[3] * v + um[6]; val nv = um[1] * u + um[4] * v + um[7]; u = nu; v = nv }
                w.write(String.format(Locale.US, "vt %.6f %.6f\n", u, 1f - v))
            }
            for (i in 0 until m.vertexCount) {
                val nx = m.normals[i * 3]; val ny = m.normals[i * 3 + 1]; val nz = m.normals[i * 3 + 2]
                var x = nm[0] * nx + nm[3] * ny + nm[6] * nz
                var y = nm[1] * nx + nm[4] * ny + nm[7] * nz
                var z = nm[2] * nx + nm[5] * ny + nm[8] * nz
                val l = kotlin.math.sqrt(x * x + y * y + z * z).coerceAtLeast(1e-20f)
                x /= l; y /= l; z /= l
                w.write(String.format(Locale.US, "vn %.5f %.5f %.5f\n", x, y, z))
            }
            val flip = app.glbandme.core.mesh.MeshBuilder.det3(mat) < 0
            for (t in 0 until m.triangleCount) {
                var a = m.indices[t * 3] + vBase; var b = m.indices[t * 3 + 1] + vBase; val cc = m.indices[t * 3 + 2] + vBase
                if (flip) { val s = a; a = b; b = s }
                if (uv != null) w.write("f $a/$a/$a $b/$b/$b $cc/$cc/$cc\n") else w.write("f $a//$a $b//$b $cc//$cc\n")
            }
            vBase += m.vertexCount
        }
        w.flush()
        return out.toByteArray()
    }

    // =========================================================================================
    // STL
    // =========================================================================================
    fun readStl(data: ByteArray, name: String = "STL Model"): ImportResult {
        val isBinary = data.size >= 84 && run {
            val n = ByteBuffer.wrap(data, 80, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
            84L + n * 50L == data.size.toLong()
        } || (data.size >= 5 && !String(data, 0, 5, Charsets.US_ASCII).equals("solid", ignoreCase = true))
        val pos = FloatArrayList(30000)
        if (isBinary) {
            val bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
            val n = bb.getInt(80)
            var o = 84
            for (t in 0 until n) {
                if (o + 50 > data.size) break
                for (k in 0 until 3) {
                    val p = o + 12 + k * 12
                    pos.add(bb.getFloat(p), bb.getFloat(p + 4), bb.getFloat(p + 8))
                }
                o += 50
            }
        } else {
            val text = String(data, Charsets.US_ASCII)
            for (raw in text.lineSequence()) {
                val line = raw.trim()
                if (line.startsWith("vertex")) {
                    val p = line.split(WS)
                    pos.add(p[1].toFloat(), p[2].toFloat(), p[3].toFloat())
                }
            }
        }
        val count = pos.size / 3 - (pos.size / 3) % 3
        val m = Mesh(pos.toArray().copyOf(count * 3), IntArray(count) { it })
        val welded = MeshOps.weld(m, 1e-6f * (m.bounds().let { (a, b) -> (b - a).length() }.coerceAtLeast(1e-3f)))
        // STL is commonly Z-up (3D printing); convert to glTF's Y-up
        val zUp = Mat4.fromTRS(app.glbandme.math.Vec3(), app.glbandme.math.Quat.fromEulerDeg(-90f, 0f, 0f), app.glbandme.math.Vec3(1f, 1f, 1f))
        welded.applyTransform(zUp)
        val warnings = if (count == 0) listOf("No triangles found in STL file.") else emptyList()
        return ImportResult(if (count > 0) listOf(SceneObject(name, welded, Material(name = "STL"))) else emptyList(), warnings)
    }

    /** Default STL orientation: glTF Y-up -> Z-up. */
    val Y_TO_Z_UP: FloatArray get() = Mat4.fromTRS(app.glbandme.math.Vec3(), app.glbandme.math.Quat.fromEulerDeg(90f, 0f, 0f), app.glbandme.math.Vec3(1f, 1f, 1f))

    fun writeStl(objects: List<SceneObject>, root: FloatArray? = null): ByteArray {
        val tris = objects.sumOf { it.mesh.triangleCount }
        val bb = ByteBuffer.allocate(84 + tris * 50).order(ByteOrder.LITTLE_ENDIAN)
        val header = "GLB&ME binary STL (Z-up)".toByteArray(Charsets.US_ASCII)
        bb.put(header); repeat(80 - header.size) { bb.put(0) }
        bb.putInt(tris)
        // glTF Y-up -> STL Z-up
        val toZUp = root ?: Y_TO_Z_UP
        val p = FloatArray(9)
        for (o in objects) {
            val mat = Mat4.mul(toZUp, o.localMatrix())
            val flip = app.glbandme.core.mesh.MeshBuilder.det3(mat) < 0
            val m = o.mesh
            for (t in 0 until m.triangleCount) {
                for (k in 0 until 3) {
                    val v = m.indices[t * 3 + (if (flip && k > 0) 3 - k else k)]
                    Mat4.transformPoint(mat, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2], p, k * 3)
                }
                val e1x = p[3] - p[0]; val e1y = p[4] - p[1]; val e1z = p[5] - p[2]
                val e2x = p[6] - p[0]; val e2y = p[7] - p[1]; val e2z = p[8] - p[2]
                var nx = e1y * e2z - e1z * e2y; var ny = e1z * e2x - e1x * e2z; var nz = e1x * e2y - e1y * e2x
                val l = kotlin.math.sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(1e-20f)
                nx /= l; ny /= l; nz /= l
                bb.putFloat(nx); bb.putFloat(ny); bb.putFloat(nz)
                for (f in p) bb.putFloat(f)
                bb.putShort(0)
            }
        }
        return bb.array()
    }

    // =========================================================================================
    // PLY
    // =========================================================================================
    fun readPly(data: ByteArray, name: String = "PLY Model"): ImportResult {
        // header
        val probe = String(data, 0, minOf(data.size, 64 * 1024), Charsets.ISO_8859_1)
        val endIdx = probe.indexOf("end_header")
        if (!probe.startsWith("ply") || endIdx < 0) throw UnsupportedModelException("Not a PLY file")
        val headerEnd = probe.indexOf('\n', endIdx) + 1
        val header = probe.substring(0, headerEnd).lines()
        var format = "ascii"
        class Prop(val name: String, val type: String, val listCount: String? = null)
        class Elem(val name: String, val count: Int, val props: ArrayList<Prop> = ArrayList())
        val elems = ArrayList<Elem>()
        for (l in header) {
            val p = l.trim().split(WS)
            when (p.getOrNull(0)) {
                "format" -> format = p[1]
                "element" -> elems.add(Elem(p[1], p[2].toInt()))
                "property" -> if (p[1] == "list") elems.last().props.add(Prop(p[4], p[3], p[2])) else elems.last().props.add(Prop(p[2], p[1]))
            }
        }
        val vElem = elems.firstOrNull { it.name == "vertex" } ?: throw UnsupportedModelException("PLY has no vertices")
        val vc = vElem.count
        val pos = FloatArray(vc * 3)
        var col: FloatArray? = null
        var uv: FloatArray? = null
        val idx = IntArrayList(vc * 6)
        val pi = vElem.props.map { it.name }
        val ix = pi.indexOf("x"); val iy = pi.indexOf("y"); val iz = pi.indexOf("z")
        val ir = pi.indexOf("red").takeIf { it >= 0 } ?: pi.indexOf("r")
        val ig = pi.indexOf("green").takeIf { it >= 0 } ?: pi.indexOf("g")
        val ib = pi.indexOf("blue").takeIf { it >= 0 } ?: pi.indexOf("b")
        val ia = pi.indexOf("alpha")
        val iu = listOf("s", "u", "texture_u").map { pi.indexOf(it) }.firstOrNull { it >= 0 } ?: -1
        val iv = listOf("t", "v", "texture_v").map { pi.indexOf(it) }.firstOrNull { it >= 0 } ?: -1
        if (ir >= 0 && ig >= 0 && ib >= 0) col = FloatArray(vc * 4)
        if (iu >= 0 && iv >= 0) uv = FloatArray(vc * 2)
        val colorIsByte = ir >= 0 && vElem.props[ir].type.let { it == "uchar" || it == "uint8" || it == "char" || it == "int8" }

        val reader: PlyReader = if (format == "ascii") AsciiPly(String(data, headerEnd, data.size - headerEnd, Charsets.ISO_8859_1))
        else BinPly(ByteBuffer.wrap(data, headerEnd, data.size - headerEnd).order(if (format == "binary_big_endian") ByteOrder.BIG_ENDIAN else ByteOrder.LITTLE_ENDIAN))

        val values = DoubleArray(vElem.props.size)
        for (e in elems) {
            if (e === vElem) {
                for (v in 0 until vc) {
                    for ((k, p) in e.props.withIndex()) {
                        if (p.listCount != null) { val n = reader.next(p.listCount).toInt(); repeat(n) { reader.next(p.type) }; values[k] = 0.0 }
                        else values[k] = reader.next(p.type)
                    }
                    pos[v * 3] = values[ix].toFloat(); pos[v * 3 + 1] = values[iy].toFloat(); pos[v * 3 + 2] = values[iz].toFloat()
                    if (col != null) {
                        val s = if (colorIsByte) 255f else 1f
                        col[v * 4] = Color.srgbToLinear(values[ir].toFloat() / s)
                        col[v * 4 + 1] = Color.srgbToLinear(values[ig].toFloat() / s)
                        col[v * 4 + 2] = Color.srgbToLinear(values[ib].toFloat() / s)
                        col[v * 4 + 3] = if (ia >= 0) values[ia].toFloat() / s else 1f
                    }
                    if (uv != null) { uv[v * 2] = values[iu].toFloat(); uv[v * 2 + 1] = 1f - values[iv].toFloat() }
                }
            } else if (e.name == "face") {
                val face = IntArrayList(8)
                for (f in 0 until e.count) {
                    for (p in e.props) {
                        if (p.listCount != null) {
                            val n = reader.next(p.listCount).toInt()
                            if (p.name == "vertex_indices" || p.name == "vertex_index") {
                                face.clear()
                                repeat(n) { face.add(reader.next(p.type).toInt()) }
                                for (k in 1 until face.size - 1) {
                                    if (face[0] < vc && face[k] < vc && face[k + 1] < vc) { idx.add(face[0]); idx.add(face[k]); idx.add(face[k + 1]) }
                                }
                            } else repeat(n) { reader.next(p.type) }
                        } else reader.next(p.type)
                    }
                }
            } else {
                for (x in 0 until e.count) for (p in e.props) {
                    if (p.listCount != null) { val n = reader.next(p.listCount).toInt(); repeat(n) { reader.next(p.type) } } else reader.next(p.type)
                }
            }
        }
        if (idx.size == 0) throw UnsupportedModelException("This PLY is a point cloud (no faces); only meshes can be imported.")
        val m = MeshOps.removeDegenerate(Mesh(pos, idx.toArray(), null, col, uv))
        return ImportResult(listOf(SceneObject(name, m, Material(name = "PLY"))), emptyList())
    }

    private interface PlyReader { fun next(type: String): Double }

    private class AsciiPly(text: String) : PlyReader {
        private val tokens = text.split(WS).filter { it.isNotEmpty() }
        private var i = 0
        override fun next(type: String): Double = tokens.getOrNull(i++)?.toDouble() ?: 0.0
    }

    private class BinPly(val bb: ByteBuffer) : PlyReader {
        override fun next(type: String): Double = when (type) {
            "char", "int8" -> bb.get().toDouble()
            "uchar", "uint8" -> (bb.get().toInt() and 0xff).toDouble()
            "short", "int16" -> bb.short.toDouble()
            "ushort", "uint16" -> (bb.short.toInt() and 0xffff).toDouble()
            "int", "int32" -> bb.int.toDouble()
            "uint", "uint32" -> (bb.int.toLong() and 0xffffffffL).toDouble()
            "float", "float32" -> bb.float.toDouble()
            "double", "float64" -> bb.double
            else -> throw UnsupportedModelException("Unknown PLY type $type")
        }
    }

    fun writePly(objects: List<SceneObject>, vertexColors: Boolean = true, root: FloatArray? = null): ByteArray {
        val vc = objects.sumOf { it.mesh.vertexCount }
        val tc = objects.sumOf { it.mesh.triangleCount }
        val header = buildString {
            append("ply\nformat binary_little_endian 1.0\ncomment Exported by GLB&ME\n")
            append("element vertex $vc\nproperty float x\nproperty float y\nproperty float z\n")
            append("property float nx\nproperty float ny\nproperty float nz\n")
            if (vertexColors) append("property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\n")
            append("element face $tc\nproperty list uchar int vertex_indices\nend_header\n")
        }.toByteArray(Charsets.US_ASCII)
        val per = 24 + (if (vertexColors) 4 else 0)
        val bb = ByteBuffer.allocate(header.size + vc * per + tc * 13).order(ByteOrder.LITTLE_ENDIAN)
        bb.put(header)
        val tmp = FloatArray(3)
        for (o in objects) {
            val m = o.mesh
            val mat = if (root != null) Mat4.mul(root, o.localMatrix()) else o.localMatrix()
            val nm = Mat4.normalMatrix(mat)
            val c = m.colors
            for (i in 0 until m.vertexCount) {
                Mat4.transformPoint(mat, m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], tmp)
                bb.putFloat(tmp[0]); bb.putFloat(tmp[1]); bb.putFloat(tmp[2])
                val nx = m.normals[i * 3]; val ny = m.normals[i * 3 + 1]; val nz = m.normals[i * 3 + 2]
                var x = nm[0] * nx + nm[3] * ny + nm[6] * nz
                var y = nm[1] * nx + nm[4] * ny + nm[7] * nz
                var z = nm[2] * nx + nm[5] * ny + nm[8] * nz
                val l = kotlin.math.sqrt(x * x + y * y + z * z).coerceAtLeast(1e-20f)
                x /= l; y /= l; z /= l
                bb.putFloat(x); bb.putFloat(y); bb.putFloat(z)
                if (vertexColors) {
                    val base = o.material.baseColor
                    for (k in 0 until 3) {
                        val lin = (c?.get(i * 4 + k) ?: 1f) * base[k]
                        bb.put((Color.linearToSrgb(lin) * 255f + 0.5f).toInt().coerceIn(0, 255).toByte())
                    }
                    bb.put(((c?.get(i * 4 + 3) ?: 1f) * base[3] * 255f + 0.5f).toInt().coerceIn(0, 255).toByte())
                }
            }
        }
        var base = 0
        for (o in objects) {
            val m = o.mesh
            val flip = app.glbandme.core.mesh.MeshBuilder.det3(if (root != null) Mat4.mul(root, o.localMatrix()) else o.localMatrix()) < 0
            for (t in 0 until m.triangleCount) {
                bb.put(3)
                val a = m.indices[t * 3]; val b = m.indices[t * 3 + 1]; val cc = m.indices[t * 3 + 2]
                bb.putInt(base + a)
                if (flip) { bb.putInt(base + cc); bb.putInt(base + b) } else { bb.putInt(base + b); bb.putInt(base + cc) }
            }
            base += m.vertexCount
        }
        return bb.array()
    }

    private val WS = Regex("\\s+")
}
