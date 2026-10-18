package app.glbandme.core.edit

import app.glbandme.core.mesh.FloatArrayList
import app.glbandme.core.mesh.IntArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.math.Vec3
import kotlin.math.sqrt

/**
 * Triangle selection for edit (box-modeling) mode plus the topology operations that act on it.
 * Bound to one mesh; resets automatically when the mesh topology changes.
 */
class FaceSelection {
    var mesh: Mesh? = null; private set
    private var topo = -1
    var selected = BooleanArray(0); private set
    var version = 0; private set
    private var cachedList: IntArray? = null

    fun bind(m: Mesh?) {
        if (m === mesh && m?.topologyVersion == topo) return
        mesh = m
        topo = m?.topologyVersion ?: -1
        selected = BooleanArray(m?.triangleCount ?: 0)
        changed()
    }

    /** Re-bind keeping a selection array for a mesh that was just rebuilt. */
    fun rebind(m: Mesh, sel: BooleanArray) {
        mesh = m; topo = m.topologyVersion
        selected = if (sel.size == m.triangleCount) sel else BooleanArray(m.triangleCount)
        changed()
    }

    private fun changed() { version++; cachedList = null }

    val count: Int get() = selected.count { it }
    fun isEmpty() = !selected.any { it }

    fun list(): IntArray {
        cachedList?.let { return it }
        val l = IntArrayList(64)
        for (i in selected.indices) if (selected[i]) l.add(i)
        return l.toArray().also { cachedList = it }
    }

    fun set(t: Int, v: Boolean) { if (t in selected.indices && selected[t] != v) { selected[t] = v; changed() } }
    fun selectAll() { selected.fill(true); changed() }
    fun clear() { selected.fill(false); changed() }
    fun invert() { for (i in selected.indices) selected[i] = !selected[i]; changed() }

    /** Brush-select triangles whose centroid is within r of c (local space). */
    fun paint(c: Vec3, r: Float, value: Boolean): Boolean {
        val m = mesh ?: return false
        val p = m.positions; val idx = m.indices
        val r2 = r * r
        var any = false
        for (t in 0 until m.triangleCount) {
            if (selected[t] == value) continue
            val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val cc = idx[t * 3 + 2] * 3
            val x = (p[a] + p[b] + p[cc]) / 3f - c.x
            val y = (p[a + 1] + p[b + 1] + p[cc + 1]) / 3f - c.y
            val z = (p[a + 2] + p[b + 2] + p[cc + 2]) / 3f - c.z
            if (x * x + y * y + z * z <= r2) { selected[t] = value; any = true }
        }
        if (any) changed()
        return any
    }

    /** Grow selection by one ring of triangles sharing a (welded) vertex. */
    fun grow() {
        val m = mesh ?: return
        val w = m.weld()
        val vsel = BooleanArray(m.vertexCount)
        for (t in selected.indices) if (selected[t]) for (k in 0 until 3) vsel[w.rep[m.indices[t * 3 + k]]] = true
        for (t in selected.indices) if (!selected[t]) for (k in 0 until 3) if (vsel[w.rep[m.indices[t * 3 + k]]]) { selected[t] = true; break }
        changed()
    }

    /** Select everything connected to the current selection. */
    fun selectLinked() {
        val m = mesh ?: return
        val w = m.weld()
        val adj = m.adjacency()
        val queue = ArrayDeque<Int>()
        for (t in selected.indices) if (selected[t]) queue.add(t)
        while (queue.isNotEmpty()) {
            val t = queue.removeFirst()
            for (k in 0 until 3) {
                val r = w.rep[m.indices[t * 3 + k]]
                for (g in w.groupStart[r] until w.groupStart[r + 1]) {
                    val v = w.groupList[g]
                    for (j in adj.vtStart[v] until adj.vtStart[v + 1]) {
                        val n = adj.vtList[j]
                        if (!selected[n]) { selected[n] = true; queue.add(n) }
                    }
                }
            }
        }
        changed()
    }

    /** Vertices touched by the selection, expanded to seam duplicates. */
    fun selectedVertices(): IntArray {
        val m = mesh ?: return IntArray(0)
        val w = m.weld()
        val mark = BooleanArray(m.vertexCount)
        for (t in selected.indices) if (selected[t]) for (k in 0 until 3) {
            val r = w.rep[m.indices[t * 3 + k]]
            for (g in w.groupStart[r] until w.groupStart[r + 1]) mark[w.groupList[g]] = true
        }
        val out = IntArrayList(64)
        for (v in mark.indices) if (mark[v]) out.add(v)
        return out.toArray()
    }

    fun centroid(): Vec3? {
        val m = mesh ?: return null
        val vs = selectedVertices()
        if (vs.isEmpty()) return null
        var x = 0.0; var y = 0.0; var z = 0.0
        for (v in vs) { x += m.positions[v * 3]; y += m.positions[v * 3 + 1]; z += m.positions[v * 3 + 2] }
        return Vec3((x / vs.size).toFloat(), (y / vs.size).toFloat(), (z / vs.size).toFloat())
    }

    fun averageNormal(): Vec3 {
        val m = mesh ?: return Vec3(0f, 1f, 0f)
        val p = m.positions
        val n = Vec3()
        for (t in selected.indices) if (selected[t]) {
            val a = m.indices[t * 3] * 3; val b = m.indices[t * 3 + 1] * 3; val c = m.indices[t * 3 + 2] * 3
            val e1 = Vec3(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2])
            val e2 = Vec3(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2])
            n.addLocal(e1.cross(e2))
        }
        return if (n.lengthSq() < 1e-20f) Vec3(0f, 1f, 0f) else n.normalize()
    }

    // ------------------------------------------------------------------------------------------
    // topology operations (return new meshes; caller swaps them in with undo)
    // ------------------------------------------------------------------------------------------

    /** Delete selected triangles. */
    fun deleteFaces(): Mesh? {
        val m = mesh ?: return null
        if (isEmpty()) return null
        val idx = IntArrayList(m.indices.size)
        for (t in 0 until m.triangleCount) if (!selected[t]) for (k in 0 until 3) idx.add(m.indices[t * 3 + k])
        val out = MeshOps.removeUnused(Mesh(m.positions.copyOf(), idx.toArray(), null, m.colors?.copyOf(), m.uvs?.copyOf(), m.mask?.copyOf()))
        out.flatShading = m.flatShading
        return out
    }

    /** Selected triangles copied into their own mesh. */
    fun extract(): Mesh? {
        val m = mesh ?: return null
        if (isEmpty()) return null
        val idx = IntArrayList(64)
        for (t in 0 until m.triangleCount) if (selected[t]) for (k in 0 until 3) idx.add(m.indices[t * 3 + k])
        val out = MeshOps.removeUnused(Mesh(m.positions.copyOf(), idx.toArray(), null, m.colors?.copyOf(), m.uvs?.copyOf(), m.mask?.copyOf()))
        out.flatShading = m.flatShading
        return out
    }

    fun flipFaces(): Mesh? {
        val m = mesh ?: return null
        if (isEmpty()) return null
        val idx = m.indices.copyOf()
        for (t in 0 until m.triangleCount) if (selected[t]) { val tmp = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = tmp }
        val out = Mesh(m.positions.copyOf(), idx, null, m.colors?.copyOf(), m.uvs?.copyOf(), m.mask?.copyOf())
        out.flatShading = m.flatShading
        return out
    }

    /**
     * Extrude the selected region along its average normal by [distance]. Side walls are created
     * along the region border (computed on welded topology so UV seams inside the region don't
     * produce walls). Returns the new mesh and the selection (the extruded cap) for it.
     */
    fun extrude(distance: Float): Pair<Mesh, BooleanArray>? {
        val m = mesh ?: return null
        if (isEmpty()) return null
        val w = m.weld()
        val tc = m.triangleCount
        // border edges in welded space: count selected-triangle usage
        val edgeUse = HashMap<Long, Int>()
        fun key(a: Int, b: Int): Long { val ra = w.rep[a]; val rb = w.rep[b]; return if (ra < rb) (ra.toLong() shl 32) or rb.toLong() else (rb.toLong() shl 32) or ra.toLong() }
        for (t in 0 until tc) if (selected[t]) for (k in 0 until 3) {
            val a = m.indices[t * 3 + k]; val b = m.indices[t * 3 + (k + 1) % 3]
            edgeUse.merge(key(a, b), 1, Int::plus)
        }
        val normal = averageNormal()
        val vc = m.vertexCount
        val dup = IntArray(vc) { -1 }
        val pos = FloatArrayList(m.positions.size + 64); for (f in m.positions) pos.add(f)
        val col = m.colors?.let { c -> FloatArrayList(c.size + 64).also { l -> for (f in c) l.add(f) } }
        val uv = m.uvs?.let { c -> FloatArrayList(c.size + 64).also { l -> for (f in c) l.add(f) } }
        val mk = m.mask?.let { c -> FloatArrayList(c.size + 64).also { l -> for (f in c) l.add(f) } }
        var next = vc
        fun dupOf(v: Int): Int {
            if (dup[v] >= 0) return dup[v]
            pos.add(m.positions[v * 3] + normal.x * distance, m.positions[v * 3 + 1] + normal.y * distance, m.positions[v * 3 + 2] + normal.z * distance)
            m.colors?.let { c -> col!!.add(c[v * 4], c[v * 4 + 1], c[v * 4 + 2], c[v * 4 + 3]) }
            m.uvs?.let { c -> uv!!.add(c[v * 2], c[v * 2 + 1]) }
            m.mask?.let { c -> mk!!.add(c[v]) }
            dup[v] = next++
            return dup[v]
        }
        val idx = IntArrayList(m.indices.size + 64)
        val newSel = ArrayList<Boolean>(tc + 64)
        for (t in 0 until tc) {
            if (selected[t]) {
                idx.add(dupOf(m.indices[t * 3])); idx.add(dupOf(m.indices[t * 3 + 1])); idx.add(dupOf(m.indices[t * 3 + 2]))
                newSel.add(true)
            } else {
                idx.add(m.indices[t * 3]); idx.add(m.indices[t * 3 + 1]); idx.add(m.indices[t * 3 + 2])
                newSel.add(false)
            }
        }
        // side walls along the border, oriented like the selected triangle's edge
        for (t in 0 until tc) if (selected[t]) for (k in 0 until 3) {
            val a = m.indices[t * 3 + k]; val b = m.indices[t * 3 + (k + 1) % 3]
            if (edgeUse[key(a, b)] != 1) continue
            val a2 = dupOf(a); val b2 = dupOf(b)
            idx.add(a); idx.add(b); idx.add(b2); newSel.add(false)
            idx.add(a); idx.add(b2); idx.add(a2); newSel.add(false)
        }
        // duplicated seam vertices inside the region must stay together: dupOf works per index,
        // and both copies moved by the same offset, so positions remain identical.
        val out = Mesh(pos.toArray(), idx.toArray(), null, col?.toArray(), uv?.toArray(), mk?.toArray())
        out.flatShading = m.flatShading
        return out to newSel.toBooleanArray()
    }

    /** Inset selected region toward its centroid by [amount] (0..1), creating a ring of faces. */
    fun inset(amount: Float): Pair<Mesh, BooleanArray>? {
        val r = extrude(0f) ?: return null
        val (mesh2, sel) = r
        // shrink the cap toward its centroid
        val vs = HashSet<Int>()
        for (t in sel.indices) if (sel[t]) for (k in 0 until 3) vs.add(mesh2.indices[t * 3 + k])
        var cx = 0f; var cy = 0f; var cz = 0f
        for (v in vs) { cx += mesh2.positions[v * 3]; cy += mesh2.positions[v * 3 + 1]; cz += mesh2.positions[v * 3 + 2] }
        val n = vs.size.coerceAtLeast(1)
        cx /= n; cy /= n; cz /= n
        for (v in vs) {
            mesh2.positions[v * 3] += (cx - mesh2.positions[v * 3]) * amount
            mesh2.positions[v * 3 + 1] += (cy - mesh2.positions[v * 3 + 1]) * amount
            mesh2.positions[v * 3 + 2] += (cz - mesh2.positions[v * 3 + 2]) * amount
        }
        mesh2.computeNormals()
        return mesh2 to sel
    }

    companion object {
        fun distanceTo(a: Vec3, b: Vec3) = sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z))
    }
}
