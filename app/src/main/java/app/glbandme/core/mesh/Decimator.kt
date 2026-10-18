package app.glbandme.core.mesh

import java.util.PriorityQueue
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Quadric error metric edge-collapse simplification (Garland & Heckbert).
 * Works on a seam-welded copy so the result stays watertight; colors/mask/uv are interpolated.
 */
object Decimator {

    private class Cand(val a: Int, val b: Int, val cost: Double, val t: Float, val stampA: Int, val stampB: Int, val tries: Int = 0) : Comparable<Cand> {
        override fun compareTo(other: Cand) = cost.compareTo(other.cost)
    }

    fun decimate(input: Mesh, targetTriangles: Int, progress: ((Float) -> Unit)? = null): Mesh {
        val m = MeshOps.weldSeamsKeepAttributes(input)
        val vc = m.vertexCount
        val startTris = m.triangleCount
        if (targetTriangles >= startTris || startTris < 8) return input
        val pos = m.positions.copyOf()
        val col = m.colors?.copyOf()
        val uv = m.uvs?.copyOf()
        val msk = m.mask?.copyOf()
        val tris = m.indices.copyOf()
        val triAlive = BooleanArray(startTris) { true }
        val vAlive = BooleanArray(vc) { true }
        val stamp = IntArray(vc)
        val q = Array(vc) { DoubleArray(10) }

        // vertex -> triangles (growable lists)
        val vt = Array(vc) { IntArrayList(8) }
        for (t in 0 until startTris) for (k in 0 until 3) vt[tris[t * 3 + k]].add(t)

        // face quadrics
        for (t in 0 until startTris) {
            val a = tris[t * 3]; val b = tris[t * 3 + 1]; val c = tris[t * 3 + 2]
            val n = triNormal(pos, a, b, c) ?: continue
            val area = n[3]
            val d = -(n[0] * pos[a * 3] + n[1] * pos[a * 3 + 1] + n[2] * pos[a * 3 + 2])
            addPlane(q[a], n[0], n[1], n[2], d, area); addPlane(q[b], n[0], n[1], n[2], d, area); addPlane(q[c], n[0], n[1], n[2], d, area)
        }
        // boundary edge penalties keep open borders in place
        val edgeCount = HashMap<Long, Int>(startTris * 2)
        for (t in 0 until startTris) for (k in 0 until 3) {
            val a = tris[t * 3 + k]; val b = tris[t * 3 + (k + 1) % 3]
            edgeCount.merge(ek(a, b), 1, Int::plus)
        }
        for (t in 0 until startTris) for (k in 0 until 3) {
            val a = tris[t * 3 + k]; val b = tris[t * 3 + (k + 1) % 3]
            if (edgeCount[ek(a, b)] == 1) {
                val n = triNormal(pos, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]) ?: continue
                val ex = pos[b * 3] - pos[a * 3]; val ey = pos[b * 3 + 1] - pos[a * 3 + 1]; val ez = pos[b * 3 + 2] - pos[a * 3 + 2]
                // plane perpendicular to the face containing the edge
                var px = ey * n[2] - ez * n[1]; var py = ez * n[0] - ex * n[2]; var pz = ex * n[1] - ey * n[0]
                val l = sqrt(px * px + py * py + pz * pz)
                if (l < 1e-12) continue
                px /= l; py /= l; pz /= l
                val d = -(px * pos[a * 3] + py * pos[a * 3 + 1] + pz * pos[a * 3 + 2])
                val w = (ex * ex + ey * ey + ez * ez) * 10.0
                addPlane(q[a], px, py, pz, d, w); addPlane(q[b], px, py, pz, d, w)
            }
        }

        val heap = PriorityQueue<Cand>(edgeCount.size + 16)
        fun push(a: Int, b: Int) {
            val (cost, t) = evalCollapse(q[a], q[b], pos, a, b)
            heap.add(Cand(a, b, cost, t, stamp[a], stamp[b]))
        }
        for (k in edgeCount.keys) push((k ushr 32).toInt(), (k and 0xffffffffL).toInt())

        var alive = startTris
        val toRemove = IntArrayList(16)
        val newPos = FloatArray(3)
        var lastReport = 0
        while (alive > targetTriangles && heap.isNotEmpty()) {
            val c = heap.poll()!!
            val a = c.a; val b = c.b
            if (!vAlive[a] || !vAlive[b] || stamp[a] != c.stampA || stamp[b] != c.stampB) continue
            val t = c.t
            newPos[0] = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t
            newPos[1] = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t
            newPos[2] = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t
            if (flips(pos, tris, triAlive, vt[a], a, b, newPos) || flips(pos, tris, triAlive, vt[b], b, a, newPos)) {
                // retry later with a penalty: neighbours may move and make it valid
                if (c.tries < 3) heap.add(Cand(a, b, c.cost * 4 + 1e-9, t, c.stampA, c.stampB, c.tries + 1))
                continue
            }
            // collapse b into a
            pos[a * 3] = newPos[0]; pos[a * 3 + 1] = newPos[1]; pos[a * 3 + 2] = newPos[2]
            if (col != null) for (k in 0 until 4) col[a * 4 + k] += (col[b * 4 + k] - col[a * 4 + k]) * t
            if (uv != null) for (k in 0 until 2) uv[a * 2 + k] += (uv[b * 2 + k] - uv[a * 2 + k]) * t
            if (msk != null) msk[a] += (msk[b] - msk[a]) * t
            for (k in 0 until 10) q[a][k] += q[b][k]
            vAlive[b] = false
            toRemove.clear()
            val listB = vt[b]
            for (i in 0 until listB.size) {
                val tri = listB[i]
                if (!triAlive[tri]) continue
                var hasA = false
                for (k in 0 until 3) if (tris[tri * 3 + k] == a) hasA = true
                if (hasA) { triAlive[tri] = false; alive--; continue }
                for (k in 0 until 3) if (tris[tri * 3 + k] == b) tris[tri * 3 + k] = a
                vt[a].add(tri)
            }
            stamp[a]++
            // compact a's list & re-push neighbours
            val listA = vt[a]
            val compact = IntArrayList(listA.size)
            val nbrs = HashSet<Int>()
            for (i in 0 until listA.size) {
                val tri = listA[i]
                if (!triAlive[tri]) continue
                compact.add(tri)
                for (k in 0 until 3) { val v = tris[tri * 3 + k]; if (v != a) nbrs.add(v) }
            }
            vt[a] = compact
            for (nb in nbrs) push(a, nb)
            if (progress != null) {
                val done = ((startTris - alive) * 100) / max(1, startTris - targetTriangles)
                if (done - lastReport >= 5) { lastReport = done; progress(done / 100f) }
            }
        }

        // compact
        val map = IntArray(vc) { -1 }
        var n = 0
        val outIdx = IntArrayList(alive * 3)
        for (t in 0 until startTris) {
            if (!triAlive[t]) continue
            for (k in 0 until 3) {
                val v = tris[t * 3 + k]
                if (map[v] < 0) map[v] = n++
                outIdx.add(map[v])
            }
        }
        val np = FloatArray(n * 3)
        val nc = col?.let { FloatArray(n * 4) }
        val nu = uv?.let { FloatArray(n * 2) }
        val nm = msk?.let { FloatArray(n) }
        for (v in 0 until vc) {
            val o = map[v]
            if (o < 0) continue
            System.arraycopy(pos, v * 3, np, o * 3, 3)
            if (nc != null) System.arraycopy(col!!, v * 4, nc, o * 4, 4)
            if (nu != null) System.arraycopy(uv!!, v * 2, nu, o * 2, 2)
            if (nm != null) nm[o] = msk!![v]
        }
        return MeshOps.removeDegenerate(Mesh(np, outIdx.toArray(), null, nc, nu, nm))
    }

    private fun ek(a: Int, b: Int): Long = if (a < b) (a.toLong() shl 32) or b.toLong() else (b.toLong() shl 32) or a.toLong()

    /** Returns unit normal + area in [3], or null when degenerate. */
    private fun triNormal(p: FloatArray, a: Int, b: Int, c: Int): DoubleArray? {
        val e1x = (p[b * 3] - p[a * 3]).toDouble(); val e1y = (p[b * 3 + 1] - p[a * 3 + 1]).toDouble(); val e1z = (p[b * 3 + 2] - p[a * 3 + 2]).toDouble()
        val e2x = (p[c * 3] - p[a * 3]).toDouble(); val e2y = (p[c * 3 + 1] - p[a * 3 + 1]).toDouble(); val e2z = (p[c * 3 + 2] - p[a * 3 + 2]).toDouble()
        val nx = e1y * e2z - e1z * e2y; val ny = e1z * e2x - e1x * e2z; val nz = e1x * e2y - e1y * e2x
        val l = sqrt(nx * nx + ny * ny + nz * nz)
        if (l < 1e-20) return null
        return doubleArrayOf(nx / l, ny / l, nz / l, l * 0.5)
    }

    // quadric stored as upper triangle: a2 ab ac ad b2 bc bd c2 cd d2
    private fun addPlane(q: DoubleArray, a: Double, b: Double, c: Double, d: Double, w: Double) {
        q[0] += w * a * a; q[1] += w * a * b; q[2] += w * a * c; q[3] += w * a * d
        q[4] += w * b * b; q[5] += w * b * c; q[6] += w * b * d
        q[7] += w * c * c; q[8] += w * c * d; q[9] += w * d * d
    }

    private fun err(q1: DoubleArray, q2: DoubleArray, x: Double, y: Double, z: Double): Double {
        fun e(q: DoubleArray) = q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
            q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9]
        return e(q1) + e(q2)
    }

    private fun evalCollapse(qa: DoubleArray, qb: DoubleArray, p: FloatArray, a: Int, b: Int): Pair<Double, Float> {
        var best = Double.MAX_VALUE; var bestT = 0f
        for (t in floatArrayOf(0f, 0.5f, 1f, 0.25f, 0.75f)) {
            val x = (p[a * 3] + (p[b * 3] - p[a * 3]) * t).toDouble()
            val y = (p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * t).toDouble()
            val z = (p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * t).toDouble()
            val e = err(qa, qb, x, y, z)
            if (e < best - 1e-15) { best = e; bestT = t }
        }
        return max(best, 0.0) to bestT
    }

    /** Would moving vertex [v] (merging with [other]) to [np] flip any surviving adjacent triangle? */
    private fun flips(p: FloatArray, tris: IntArray, alive: BooleanArray, list: IntArrayList, v: Int, other: Int, np: FloatArray): Boolean {
        for (i in 0 until list.size) {
            val t = list[i]
            if (!alive[t]) continue
            var hasOther = false
            for (k in 0 until 3) if (tris[t * 3 + k] == other) hasOther = true
            if (hasOther) continue
            val before = triNormal(p, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]) ?: continue
            val px = FloatArray(9)
            for (k in 0 until 3) {
                val w = tris[t * 3 + k]
                if (w == v) { px[k * 3] = np[0]; px[k * 3 + 1] = np[1]; px[k * 3 + 2] = np[2] }
                else System.arraycopy(p, w * 3, px, k * 3, 3)
            }
            val after = triNormal(px, 0, 1, 2) ?: return true
            if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.2) return true
        }
        return false
    }
}
