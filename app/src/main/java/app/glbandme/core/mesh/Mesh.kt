package app.glbandme.core.mesh

import app.glbandme.math.Mat4
import app.glbandme.math.Vec3
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Indexed triangle mesh. All attributes are per-vertex, flat float arrays.
 *  - positions: xyz
 *  - normals:   xyz (always kept in sync)
 *  - colors:    rgba linear 0..1 (optional, vertex paint)
 *  - uvs:       uv (optional)
 *  - mask:      0..1 sculpt mask (optional, editor only)
 *
 * Change tracking is used by the renderer to upload only what changed.
 */
class Mesh(
    positions: FloatArray,
    indices: IntArray,
    normals: FloatArray? = null,
    colors: FloatArray? = null,
    uvs: FloatArray? = null,
    mask: FloatArray? = null
) {
    var positions: FloatArray = positions; private set
    var indices: IntArray = indices; private set
    var normals: FloatArray = normals ?: FloatArray(positions.size); private set
    var colors: FloatArray? = colors
    var uvs: FloatArray? = uvs
    var mask: FloatArray? = mask

    /** Faceted mesh: every triangle owns its vertices, never smooth normals across seams. */
    var flatShading = false

    val vertexCount get() = positions.size / 3
    val triangleCount get() = indices.size / 3

    // ---- change tracking -------------------------------------------------------------------
    var topologyVersion = 0; private set
    var geometryVersion = 0; private set
    var colorVersion = 0; private set
    var maskVersion = 0; private set
    var uvVersion = 0; private set

    var geomDirtyLo = Int.MAX_VALUE; var geomDirtyHi = -1
    var colorDirtyLo = Int.MAX_VALUE; var colorDirtyHi = -1
    var maskDirtyLo = Int.MAX_VALUE; var maskDirtyHi = -1

    private var faceNormals: FloatArray? = null
    private var adjacency: Adjacency? = null
    private var edgeCache: IntArray? = null

    init {
        if (normals == null) computeNormals()
    }

    /** Replace the whole mesh content (topology change). */
    fun setData(
        positions: FloatArray, indices: IntArray, normals: FloatArray? = null,
        colors: FloatArray? = null, uvs: FloatArray? = null, mask: FloatArray? = null
    ) {
        this.positions = positions
        this.indices = indices
        this.normals = normals ?: FloatArray(positions.size)
        this.colors = colors
        this.uvs = uvs
        this.mask = mask
        topologyChanged()
        if (normals == null) computeNormals()
    }

    fun topologyChanged() {
        topologyVersion++
        faceNormals = null
        adjacency = null
        edgeCache = null
        geometryVersion++; colorVersion++; maskVersion++; uvVersion++
        resetDirty()
    }

    fun resetDirty() {
        geomDirtyLo = Int.MAX_VALUE; geomDirtyHi = -1
        colorDirtyLo = Int.MAX_VALUE; colorDirtyHi = -1
        maskDirtyLo = Int.MAX_VALUE; maskDirtyHi = -1
    }

    fun markGeometryDirty(lo: Int = 0, hi: Int = vertexCount - 1) {
        geometryVersion++
        geomDirtyLo = min(geomDirtyLo, lo); geomDirtyHi = max(geomDirtyHi, hi)
    }

    fun markColorsDirty(lo: Int = 0, hi: Int = vertexCount - 1) {
        colorVersion++
        colorDirtyLo = min(colorDirtyLo, lo); colorDirtyHi = max(colorDirtyHi, hi)
    }

    fun markMaskDirty(lo: Int = 0, hi: Int = vertexCount - 1) {
        maskVersion++
        maskDirtyLo = min(maskDirtyLo, lo); maskDirtyHi = max(maskDirtyHi, hi)
    }

    fun markUvsDirty() { uvVersion++ }

    // ---- attributes ------------------------------------------------------------------------
    fun ensureColors(r: Float = 1f, g: Float = 1f, b: Float = 1f, a: Float = 1f): FloatArray {
        colors?.let { if (it.size == vertexCount * 4) return it }
        val c = FloatArray(vertexCount * 4)
        for (i in 0 until vertexCount) { c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = a }
        colors = c
        colorVersion++
        colorDirtyLo = 0; colorDirtyHi = vertexCount - 1
        return c
    }

    fun ensureMask(): FloatArray {
        mask?.let { if (it.size == vertexCount) return it }
        val m = FloatArray(vertexCount)
        mask = m
        markMaskDirty()
        return m
    }

    fun hasMask(): Boolean {
        val m = mask ?: return false
        for (v in m) if (v > 0f) return true
        return false
    }

    // ---- geometry --------------------------------------------------------------------------
    fun bounds(): Pair<Vec3, Vec3> {
        if (vertexCount == 0) return Vec3() to Vec3()
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var minZ = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE; var maxZ = -Float.MAX_VALUE
        val p = positions
        var i = 0
        while (i < p.size) {
            val x = p[i]; val y = p[i + 1]; val z = p[i + 2]
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
            i += 3
        }
        return Vec3(minX, minY, minZ) to Vec3(maxX, maxY, maxZ)
    }

    /** Average edge length, useful for sizing brushes and merge tolerances. */
    fun averageEdgeLength(sample: Int = 2000): Float {
        val tris = triangleCount
        if (tris == 0) return 0f
        val step = max(1, tris / sample)
        var sum = 0.0; var n = 0
        var t = 0
        while (t < tris) {
            val a = indices[t * 3]; val b = indices[t * 3 + 1]
            val dx = positions[a * 3] - positions[b * 3]
            val dy = positions[a * 3 + 1] - positions[b * 3 + 1]
            val dz = positions[a * 3 + 2] - positions[b * 3 + 2]
            sum += sqrt(dx * dx + dy * dy + dz * dz); n++
            t += step
        }
        return (sum / n).toFloat()
    }

    fun computeNormals() {
        val vc = vertexCount
        if (normals.size != vc * 3) normals = FloatArray(vc * 3)
        val fn = FloatArray(triangleCount * 3)
        faceNormals = fn
        val n = normals
        n.fill(0f)
        val p = positions
        val idx = indices
        for (t in 0 until triangleCount) {
            val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val c = idx[t * 3 + 2] * 3
            val e1x = p[b] - p[a]; val e1y = p[b + 1] - p[a + 1]; val e1z = p[b + 2] - p[a + 2]
            val e2x = p[c] - p[a]; val e2y = p[c + 1] - p[a + 1]; val e2z = p[c + 2] - p[a + 2]
            val nx = e1y * e2z - e1z * e2y
            val ny = e1z * e2x - e1x * e2z
            val nz = e1x * e2y - e1y * e2x
            fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz
            n[a] += nx; n[a + 1] += ny; n[a + 2] += nz
            n[b] += nx; n[b + 1] += ny; n[b + 2] += nz
            n[c] += nx; n[c + 1] += ny; n[c + 2] += nz
        }
        val w = weld()
        if (w.hasDuplicates && !flatShading) {
            val all = IntArray(vc) { it }
            smoothAcrossSeams(all, vc)
        }
        for (v in 0 until vc) normalizeAt(n, v)
        markGeometryDirty()
    }

    /**
     * Vertices split only for UVs (same position, similar normal) are smoothed together, while
     * real hard edges (e.g. cube corners, > ~50 degrees apart) stay sharp. Operates on the raw,
     * unnormalised sums in [normals] for the given vertices.
     */
    private fun smoothAcrossSeams(verts: IntArray, count: Int) {
        val w = weld()
        val n = normals
        val raw = HashMap<Int, FloatArray>()
        for (k in 0 until count) {
            val v = verts[k]
            val r = w.rep[v]
            val gs = w.groupStart[r]; val ge = w.groupStart[r + 1]
            if (ge - gs <= 1) continue
            for (j in gs until ge) {
                val m = w.groupList[j]
                if (!raw.containsKey(m)) raw[m] = floatArrayOf(n[m * 3], n[m * 3 + 1], n[m * 3 + 2])
            }
        }
        if (raw.isEmpty()) return
        val cosLimit = 0.64f
        for ((v, nv) in raw) {
            val r = w.rep[v]
            val lv = sqrt(nv[0] * nv[0] + nv[1] * nv[1] + nv[2] * nv[2]).coerceAtLeast(1e-20f)
            var x = 0f; var y = 0f; var z = 0f
            for (j in w.groupStart[r] until w.groupStart[r + 1]) {
                val m = w.groupList[j]
                val nm = raw[m] ?: continue
                val lm = sqrt(nm[0] * nm[0] + nm[1] * nm[1] + nm[2] * nm[2]).coerceAtLeast(1e-20f)
                val c = (nv[0] * nm[0] + nv[1] * nm[1] + nv[2] * nm[2]) / (lv * lm)
                if (m == v || c > cosLimit) { x += nm[0]; y += nm[1]; z += nm[2] }
            }
            n[v * 3] = x; n[v * 3 + 1] = y; n[v * 3 + 2] = z
        }
    }

    // ---- position welding (UV seams) ------------------------------------------------------
    /**
     * rep[v] = smallest vertex index sharing v's exact position. groupStart/groupList list the
     * members of each representative's group (CSR indexed by vertex id; non-reps have empty ranges).
     */
    class WeldInfo(val rep: IntArray, val groupStart: IntArray, val groupList: IntArray, val hasDuplicates: Boolean)

    private var weldCache: WeldInfo? = null
    private var weldTopology = -1

    fun weld(): WeldInfo {
        val cached = weldCache
        if (cached != null && weldTopology == topologyVersion) return cached
        val vc = vertexCount
        val rep = IntArray(vc)
        val map = HashMap<Long, Int>(vc * 2)
        val p = positions
        var dup = false
        for (v in 0 until vc) {
            // "+ 0f" folds -0.0 into 0.0 so both hash identically
            val key = ((p[v * 3] + 0f).toRawBits().toLong() * 73856093L) xor
                ((p[v * 3 + 1] + 0f).toRawBits().toLong() * 19349663L) xor
                ((p[v * 3 + 2] + 0f).toRawBits().toLong() * 83492791L)
            var r = -1
            var probe = key
            while (true) {
                val e = map[probe]
                if (e == null) { map[probe] = v; break }
                if (p[e * 3] == p[v * 3] && p[e * 3 + 1] == p[v * 3 + 1] && p[e * 3 + 2] == p[v * 3 + 2]) { r = e; break }
                probe = probe * 31 + 7
            }
            if (r >= 0) { rep[v] = r; dup = true } else rep[v] = v
        }
        val count = IntArray(vc + 1)
        for (v in 0 until vc) count[rep[v] + 1]++
        for (i in 0 until vc) count[i + 1] += count[i]
        val start = count.copyOf()
        val fill = count.copyOf()
        val list = IntArray(vc)
        for (v in 0 until vc) list[fill[rep[v]]++] = v
        val info = WeldInfo(rep, start, list, dup)
        weldCache = info
        weldTopology = topologyVersion
        return info
    }

    private fun normalizeAt(n: FloatArray, v: Int) {
        val x = n[v * 3]; val y = n[v * 3 + 1]; val z = n[v * 3 + 2]
        val l = sqrt(x * x + y * y + z * z)
        if (l > 1e-20f) { n[v * 3] = x / l; n[v * 3 + 1] = y / l; n[v * 3 + 2] = z / l } else { n[v * 3 + 1] = 1f }
    }

    /**
     * Incrementally recompute normals after the given vertices moved.
     * [moved] holds vertex indices, [count] how many are valid.
     */
    fun updateNormals(moved: IntArray, count: Int, stamp: IntArray, stampId: Int) {
        val adj = adjacency()
        val fn = faceNormals ?: run { computeNormals(); return }
        val p = positions
        val idx = indices
        // 1. recompute face normals of faces touching moved vertices; collect affected vertices
        val touched = IntArrayList(count * 4)
        for (k in 0 until count) {
            val v = moved[k]
            for (j in adj.vtStart[v] until adj.vtStart[v + 1]) {
                val t = adj.vtList[j]
                val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val c = idx[t * 3 + 2] * 3
                val e1x = p[b] - p[a]; val e1y = p[b + 1] - p[a + 1]; val e1z = p[b + 2] - p[a + 2]
                val e2x = p[c] - p[a]; val e2y = p[c + 1] - p[a + 1]; val e2z = p[c + 2] - p[a + 2]
                fn[t * 3] = e1y * e2z - e1z * e2y
                fn[t * 3 + 1] = e1z * e2x - e1x * e2z
                fn[t * 3 + 2] = e1x * e2y - e1y * e2x
                for (q in 0 until 3) {
                    val w = idx[t * 3 + q]
                    if (stamp[w] != stampId) { stamp[w] = stampId; touched.add(w) }
                }
            }
        }
        // 1b. seam duplicates of touched vertices need their normals refreshed too
        val w = weld()
        if (w.hasDuplicates) {
            val base = touched.size
            for (k in 0 until base) {
                val r = w.rep[touched[k]]
                for (j in w.groupStart[r] until w.groupStart[r + 1]) {
                    val m = w.groupList[j]
                    if (stamp[m] != stampId) { stamp[m] = stampId; touched.add(m) }
                }
            }
        }
        // 2. vertex normals of affected vertices
        val n = normals
        var lo = Int.MAX_VALUE; var hi = -1
        for (k in 0 until touched.size) {
            val v = touched[k]
            var x = 0f; var y = 0f; var z = 0f
            for (j in adj.vtStart[v] until adj.vtStart[v + 1]) {
                val t = adj.vtList[j]
                x += fn[t * 3]; y += fn[t * 3 + 1]; z += fn[t * 3 + 2]
            }
            n[v * 3] = x; n[v * 3 + 1] = y; n[v * 3 + 2] = z
            if (v < lo) lo = v; if (v > hi) hi = v
        }
        if (w.hasDuplicates && !flatShading) smoothAcrossSeams(touched.data, touched.size)
        for (k in 0 until touched.size) normalizeAt(n, touched[k])
        if (hi >= 0) markGeometryDirty(lo, hi)
    }

    fun applyTransform(m: FloatArray) {
        val p = positions
        val tmp = FloatArray(3)
        for (v in 0 until vertexCount) {
            Mat4.transformPoint(m, p[v * 3], p[v * 3 + 1], p[v * 3 + 2], tmp)
            p[v * 3] = tmp[0]; p[v * 3 + 1] = tmp[1]; p[v * 3 + 2] = tmp[2]
        }
        // negative determinant flips winding
        val det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
        if (det < 0) flipWinding() else { faceNormals = null; computeNormals() }
    }

    fun translate(dx: Float, dy: Float, dz: Float) {
        val p = positions
        for (v in 0 until vertexCount) { p[v * 3] += dx; p[v * 3 + 1] += dy; p[v * 3 + 2] += dz }
        markGeometryDirty()
    }

    fun flipWinding() {
        val idx = indices
        for (t in 0 until triangleCount) {
            val tmp = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = tmp
        }
        topologyChanged()
        computeNormals()
    }

    fun copy(): Mesh {
        val m = Mesh(
            positions.copyOf(), indices.copyOf(), normals.copyOf(),
            colors?.copyOf(), uvs?.copyOf(), mask?.copyOf()
        )
        m.flatShading = flatShading
        return m
    }

    // ---- adjacency -------------------------------------------------------------------------
    class Adjacency(
        val vtStart: IntArray, val vtList: IntArray,     // vertex -> triangles (CSR)
        val nbStart: IntArray, val nbList: IntArray      // vertex -> neighbour vertices (CSR)
    )

    fun adjacency(): Adjacency {
        adjacency?.let { return it }
        val vc = vertexCount
        val tc = triangleCount
        val idx = indices
        val vtCount = IntArray(vc + 1)
        for (i in idx.indices) vtCount[idx[i] + 1]++
        for (i in 0 until vc) vtCount[i + 1] += vtCount[i]
        val vtStart = vtCount.copyOf()
        val fill = vtCount.copyOf()
        val vtList = IntArray(idx.size)
        for (t in 0 until tc) for (q in 0 until 3) {
            val v = idx[t * 3 + q]
            vtList[fill[v]++] = t
        }
        // neighbours: unique vertices of adjacent triangles
        val nbStart = IntArray(vc + 1)
        val nbTmp = IntArrayList(idx.size * 2)
        val seen = IntArray(vc) { -1 }
        for (v in 0 until vc) {
            nbStart[v] = nbTmp.size
            for (j in vtStart[v] until vtStart[v + 1]) {
                val t = vtList[j]
                for (q in 0 until 3) {
                    val w = idx[t * 3 + q]
                    if (w != v && seen[w] != v) { seen[w] = v; nbTmp.add(w) }
                }
            }
        }
        nbStart[vc] = nbTmp.size
        val a = Adjacency(vtStart, vtList, nbStart, nbTmp.toArray())
        adjacency = a
        return a
    }

    /** Unique undirected edges as pairs (a, b), a < b. */
    fun edges(): IntArray {
        edgeCache?.let { return it }
        val adj = adjacency()
        val out = IntArrayList(triangleCount * 3)
        for (v in 0 until vertexCount) {
            for (j in adj.nbStart[v] until adj.nbStart[v + 1]) {
                val w = adj.nbList[j]
                if (w > v) { out.add(v); out.add(w) }
            }
        }
        val e = out.toArray()
        edgeCache = e
        return e
    }

    companion object {
        fun empty() = Mesh(FloatArray(0), IntArray(0))
    }
}

/** Minimal growable int list (avoids boxing). */
class IntArrayList(capacity: Int = 16) {
    var data = IntArray(maxOf(4, capacity)); private set
    var size = 0; private set
    fun add(v: Int) {
        if (size == data.size) data = data.copyOf(data.size * 2)
        data[size++] = v
    }
    operator fun get(i: Int) = data[i]
    operator fun set(i: Int, v: Int) { data[i] = v }
    fun clear() { size = 0 }
    fun dropLast() { if (size > 0) size-- }
    /** O(1) unordered removal. */
    fun swapRemove(i: Int) { data[i] = data[size - 1]; size-- }
    fun toArray(): IntArray = data.copyOf(size)
}

/** Minimal growable float list. */
class FloatArrayList(capacity: Int = 16) {
    var data = FloatArray(maxOf(4, capacity)); private set
    var size = 0; private set
    fun add(v: Float) {
        if (size == data.size) data = data.copyOf(data.size * 2)
        data[size++] = v
    }
    fun add(x: Float, y: Float) { add(x); add(y) }
    fun add(x: Float, y: Float, z: Float) { add(x); add(y); add(z) }
    fun add(x: Float, y: Float, z: Float, w: Float) { add(x); add(y); add(z); add(w) }
    operator fun get(i: Int) = data[i]
    operator fun set(i: Int, v: Float) { data[i] = v }
    fun clear() { size = 0 }
    fun toArray(): FloatArray = data.copyOf(size)
}
