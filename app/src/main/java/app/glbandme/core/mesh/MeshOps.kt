package app.glbandme.core.mesh

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sqrt

/** Topology & attribute operations. All functions return new meshes unless stated otherwise. */
object MeshOps {

    // ---------------------------------------------------------------------------------------
    // cleanup
    // ---------------------------------------------------------------------------------------

    fun removeDegenerate(m: Mesh): Mesh {
        val idx = m.indices
        val p = m.positions
        val out = IntArrayList(idx.size)
        var removed = 0
        for (t in 0 until m.triangleCount) {
            val a = idx[t * 3]; val b = idx[t * 3 + 1]; val c = idx[t * 3 + 2]
            if (a == b || b == c || a == c || samePos(p, a, b) || samePos(p, b, c) || samePos(p, a, c)) { removed++; continue }
            out.add(a); out.add(b); out.add(c)
        }
        if (removed == 0) return m
        return removeUnused(Mesh(m.positions, out.toArray(), null, m.colors, m.uvs, m.mask))
    }

    private fun samePos(p: FloatArray, a: Int, b: Int) =
        p[a * 3] == p[b * 3] && p[a * 3 + 1] == p[b * 3 + 1] && p[a * 3 + 2] == p[b * 3 + 2]

    /** Drops vertices not referenced by any triangle. */
    fun removeUnused(m: Mesh): Mesh {
        val used = IntArray(m.vertexCount) { -1 }
        var n = 0
        for (i in m.indices) if (used[i] < 0) used[i] = -2
        for (v in 0 until m.vertexCount) if (used[v] == -2) used[v] = n++
        if (n == m.vertexCount) return m
        val idx = IntArray(m.indices.size) { used[m.indices[it]] }
        return remapVertices(m, used, n, idx)
    }

    private fun remapVertices(m: Mesh, map: IntArray, n: Int, newIdx: IntArray): Mesh {
        val p = FloatArray(n * 3)
        val nr = FloatArray(n * 3)
        val c = m.colors?.let { FloatArray(n * 4) }
        val uv = m.uvs?.let { FloatArray(n * 2) }
        val mk = m.mask?.let { FloatArray(n) }
        for (v in 0 until m.vertexCount) {
            val t = map[v]
            if (t < 0) continue
            System.arraycopy(m.positions, v * 3, p, t * 3, 3)
            System.arraycopy(m.normals, v * 3, nr, t * 3, 3)
            if (c != null) System.arraycopy(m.colors!!, v * 4, c, t * 4, 4)
            if (uv != null) System.arraycopy(m.uvs!!, v * 2, uv, t * 2, 2)
            if (mk != null) mk[t] = m.mask!![v]
        }
        return Mesh(p, newIdx, null, c, uv, mk)
    }

    /** Merge vertices closer than [tolerance]. Loses UV seams (keeps first vertex's attributes). */
    fun weld(m: Mesh, tolerance: Float = 1e-5f): Mesh {
        val vc = m.vertexCount
        val cell = max(tolerance * 2f, 1e-9f)
        val grid = HashMap<Long, IntArrayList>()
        val map = IntArray(vc)
        val p = m.positions
        var n = 0
        val tol2 = tolerance * tolerance
        val remapIdx = IntArray(vc)
        for (v in 0 until vc) {
            val gx = floor(p[v * 3] / cell).toLong(); val gy = floor(p[v * 3 + 1] / cell).toLong(); val gz = floor(p[v * 3 + 2] / cell).toLong()
            var found = -1
            loop@ for (dx in -1..1) for (dy in -1..1) for (dz in -1..1) {
                val list = grid[key(gx + dx, gy + dy, gz + dz)] ?: continue
                for (k in 0 until list.size) {
                    val w = list[k]
                    val ex = p[w * 3] - p[v * 3]; val ey = p[w * 3 + 1] - p[v * 3 + 1]; val ez = p[w * 3 + 2] - p[v * 3 + 2]
                    if (ex * ex + ey * ey + ez * ez <= tol2) { found = w; break@loop }
                }
            }
            if (found >= 0) {
                remapIdx[v] = remapIdx[found]
                map[v] = -1
            } else {
                grid.getOrPut(key(gx, gy, gz)) { IntArrayList(4) }.add(v)
                remapIdx[v] = n
                map[v] = n
                n++
            }
        }
        val idx = IntArray(m.indices.size) { remapIdx[m.indices[it]] }
        return removeDegenerate(remapVertices(m, map, n, idx))
    }

    private fun key(x: Long, y: Long, z: Long) = (x * 73856093L) xor (y * 19349663L) xor (z * 83492791L)

    /** Every triangle gets its own vertices -> faceted look. */
    fun flatShaded(m: Mesh): Mesh {
        val tc = m.triangleCount
        val p = FloatArray(tc * 9)
        val c = m.colors?.let { FloatArray(tc * 12) }
        val uv = m.uvs?.let { FloatArray(tc * 6) }
        val mk = m.mask?.let { FloatArray(tc * 3) }
        for (t in 0 until tc) for (q in 0 until 3) {
            val v = m.indices[t * 3 + q]
            val o = t * 3 + q
            System.arraycopy(m.positions, v * 3, p, o * 3, 3)
            if (c != null) System.arraycopy(m.colors!!, v * 4, c, o * 4, 4)
            if (uv != null) System.arraycopy(m.uvs!!, v * 2, uv, o * 2, 2)
            if (mk != null) mk[o] = m.mask!![v]
        }
        val mesh = Mesh(p, IntArray(tc * 3) { it }, null, c, uv, mk)
        // flat normals: no seam smoothing because every corner of a face is a different direction
        val n = mesh.normals
        for (t in 0 until tc) {
            val a = t * 9
            val e1x = p[a + 3] - p[a]; val e1y = p[a + 4] - p[a + 1]; val e1z = p[a + 5] - p[a + 2]
            val e2x = p[a + 6] - p[a]; val e2y = p[a + 7] - p[a + 1]; val e2z = p[a + 8] - p[a + 2]
            var nx = e1y * e2z - e1z * e2y; var ny = e1z * e2x - e1x * e2z; var nz = e1x * e2y - e1y * e2x
            val l = sqrt(nx * nx + ny * ny + nz * nz).coerceAtLeast(1e-20f)
            nx /= l; ny /= l; nz /= l
            for (q in 0 until 3) { n[a + q * 3] = nx; n[a + q * 3 + 1] = ny; n[a + q * 3 + 2] = nz }
        }
        mesh.flatShading = true
        return mesh
    }

    /** Re-welds a faceted mesh back into a smooth one. */
    fun smoothShaded(m: Mesh): Mesh = weld(m, m.averageEdgeLength() * 1e-4f + 1e-7f)

    // ---------------------------------------------------------------------------------------
    // subdivision
    // ---------------------------------------------------------------------------------------

    /**
     * Loop subdivision (smooth=true) or simple midpoint split (smooth=false). Simple mode keeps
     * UV seams intact; smooth mode welds first so the surface stays closed.
     */
    fun subdivide(input: Mesh, smooth: Boolean): Mesh {
        val m = if (smooth) weldSeamsKeepAttributes(input) else input
        val vc = m.vertexCount
        val tc = m.triangleCount
        val idx = m.indices
        val p = m.positions
        // edge table
        val edgeMap = HashMap<Long, Int>(tc * 2)
        val edgeA = IntArrayList(tc * 2); val edgeB = IntArrayList(tc * 2)
        val edgeOpp1 = IntArrayList(tc * 2); val edgeOpp2 = IntArrayList(tc * 2)
        val triEdges = IntArray(tc * 3)
        for (t in 0 until tc) for (q in 0 until 3) {
            val a = idx[t * 3 + q]; val b = idx[t * 3 + (q + 1) % 3]; val c = idx[t * 3 + (q + 2) % 3]
            val k = if (a < b) (a.toLong() shl 32) or b.toLong() else (b.toLong() shl 32) or a.toLong()
            val e = edgeMap[k]
            if (e == null) {
                val id = edgeA.size
                edgeMap[k] = id
                edgeA.add(a); edgeB.add(b); edgeOpp1.add(c); edgeOpp2.add(-1)
                triEdges[t * 3 + q] = id
            } else {
                if (edgeOpp2[e] == -1) edgeOpp2[e] = c else edgeOpp2[e] = -2 // non-manifold
                triEdges[t * 3 + q] = e
            }
        }
        val ec = edgeA.size
        val nv = vc + ec
        val np = FloatArray(nv * 3)
        val nc = m.colors?.let { FloatArray(nv * 4) }
        val nuv = m.uvs?.let { FloatArray(nv * 2) }
        val nmask = m.mask?.let { FloatArray(nv) }

        // boundary info for even vertices
        val boundaryNbr = if (smooth) IntArray(vc * 2) { -1 } else null
        val isBoundary = BooleanArray(vc)
        for (e in 0 until ec) {
            if (edgeOpp2[e] < 0) {
                val a = edgeA[e]; val b = edgeB[e]
                isBoundary[a] = true; isBoundary[b] = true
                if (boundaryNbr != null) {
                    if (boundaryNbr[a * 2] < 0) boundaryNbr[a * 2] = b else boundaryNbr[a * 2 + 1] = b
                    if (boundaryNbr[b * 2] < 0) boundaryNbr[b * 2] = a else boundaryNbr[b * 2 + 1] = a
                }
            }
        }
        // even vertices
        if (smooth) {
            val adj = m.adjacency()
            for (v in 0 until vc) {
                if (isBoundary[v]) {
                    val b1 = boundaryNbr!![v * 2]; val b2 = boundaryNbr[v * 2 + 1]
                    if (b1 >= 0 && b2 >= 0) {
                        for (c in 0 until 3) np[v * 3 + c] = 0.75f * p[v * 3 + c] + 0.125f * (p[b1 * 3 + c] + p[b2 * 3 + c])
                    } else System.arraycopy(p, v * 3, np, v * 3, 3)
                } else {
                    val s = adj.nbStart[v]; val e = adj.nbStart[v + 1]
                    val n = e - s
                    if (n < 3) { System.arraycopy(p, v * 3, np, v * 3, 3); continue }
                    val beta = if (n == 3) 3f / 16f else 3f / (8f * n)
                    var sx = 0f; var sy = 0f; var sz = 0f
                    for (j in s until e) { val w = adj.nbList[j]; sx += p[w * 3]; sy += p[w * 3 + 1]; sz += p[w * 3 + 2] }
                    val k = 1f - n * beta
                    np[v * 3] = k * p[v * 3] + beta * sx
                    np[v * 3 + 1] = k * p[v * 3 + 1] + beta * sy
                    np[v * 3 + 2] = k * p[v * 3 + 2] + beta * sz
                }
            }
        } else System.arraycopy(p, 0, np, 0, vc * 3)
        m.colors?.let { System.arraycopy(it, 0, nc!!, 0, vc * 4) }
        m.uvs?.let { System.arraycopy(it, 0, nuv!!, 0, vc * 2) }
        m.mask?.let { System.arraycopy(it, 0, nmask!!, 0, vc) }

        // odd vertices
        for (e in 0 until ec) {
            val a = edgeA[e]; val b = edgeB[e]
            val o = vc + e
            val c = edgeOpp1[e]; val d = edgeOpp2[e]
            for (k in 0 until 3) {
                np[o * 3 + k] = if (smooth && d >= 0)
                    0.375f * (p[a * 3 + k] + p[b * 3 + k]) + 0.125f * (p[c * 3 + k] + p[d * 3 + k])
                else 0.5f * (p[a * 3 + k] + p[b * 3 + k])
            }
            if (nc != null) { val cc = m.colors!!; for (k in 0 until 4) nc[o * 4 + k] = 0.5f * (cc[a * 4 + k] + cc[b * 4 + k]) }
            if (nuv != null) { val uu = m.uvs!!; for (k in 0 until 2) nuv[o * 2 + k] = 0.5f * (uu[a * 2 + k] + uu[b * 2 + k]) }
            if (nmask != null) { val mm = m.mask!!; nmask[o] = 0.5f * (mm[a] + mm[b]) }
        }
        // faces
        val ni = IntArray(tc * 12)
        for (t in 0 until tc) {
            val a = idx[t * 3]; val b = idx[t * 3 + 1]; val c = idx[t * 3 + 2]
            val ab = vc + triEdges[t * 3]; val bc = vc + triEdges[t * 3 + 1]; val ca = vc + triEdges[t * 3 + 2]
            val o = t * 12
            ni[o] = a; ni[o + 1] = ab; ni[o + 2] = ca
            ni[o + 3] = ab; ni[o + 4] = b; ni[o + 5] = bc
            ni[o + 6] = ca; ni[o + 7] = bc; ni[o + 8] = c
            ni[o + 9] = ab; ni[o + 10] = bc; ni[o + 11] = ca
        }
        return Mesh(np, ni, null, nc, nuv, nmask)
    }

    /** Weld exact-position duplicates (UV seams) keeping the first vertex's attributes. */
    fun weldSeamsKeepAttributes(m: Mesh): Mesh {
        val w = m.weld()
        if (!w.hasDuplicates) return m
        val map = IntArray(m.vertexCount) { -1 }
        val newId = IntArray(m.vertexCount)
        var n = 0
        for (v in 0 until m.vertexCount) if (w.rep[v] == v) { map[v] = n; newId[v] = n; n++ }
        for (v in 0 until m.vertexCount) if (w.rep[v] != v) newId[v] = newId[w.rep[v]]
        val idx = IntArray(m.indices.size) { newId[m.indices[it]] }
        return removeDegenerate(remapVertices(m, map, n, idx))
    }

    // ---------------------------------------------------------------------------------------
    // smoothing / symmetry
    // ---------------------------------------------------------------------------------------

    /** Taubin smoothing in place (keeps volume). Respects mask. */
    fun smoothInPlace(m: Mesh, iterations: Int, strength: Float = 0.5f) {
        val adj = m.adjacency()
        val w = m.weld()
        val p = m.positions
        val vc = m.vertexCount
        val mask = m.mask
        val tmp = FloatArray(vc * 3)
        // neighbour lists over welded groups
        repeat(iterations) {
            for (pass in 0 until 2) {
                val f = if (pass == 0) strength else -strength * 1.04f
                for (v in 0 until vc) {
                    if (w.rep[v] != v) continue
                    var sx = 0f; var sy = 0f; var sz = 0f; var cnt = 0
                    for (g in w.groupStart[v] until w.groupStart[v + 1]) {
                        val member = w.groupList[g]
                        for (j in adj.nbStart[member] until adj.nbStart[member + 1]) {
                            val nb = adj.nbList[j]
                            sx += p[nb * 3]; sy += p[nb * 3 + 1]; sz += p[nb * 3 + 2]; cnt++
                        }
                    }
                    val mf = if (mask != null) 1f - mask[v] else 1f
                    if (cnt == 0 || mf <= 0f) { System.arraycopy(p, v * 3, tmp, v * 3, 3); continue }
                    val k = f * mf
                    tmp[v * 3] = p[v * 3] + (sx / cnt - p[v * 3]) * k
                    tmp[v * 3 + 1] = p[v * 3 + 1] + (sy / cnt - p[v * 3 + 1]) * k
                    tmp[v * 3 + 2] = p[v * 3 + 2] + (sz / cnt - p[v * 3 + 2]) * k
                }
                for (v in 0 until vc) {
                    val r = w.rep[v]
                    p[v * 3] = tmp[r * 3]; p[v * 3 + 1] = tmp[r * 3 + 1]; p[v * 3 + 2] = tmp[r * 3 + 2]
                }
            }
        }
        m.computeNormals()
    }

    /**
     * Copies one side of the mesh onto the other across local X=0 (or Y/Z via [axis]).
     * Returns how many vertices were mirrored.
     */
    fun symmetrizeInPlace(m: Mesh, axis: Int = 0, positiveToNegative: Boolean = true): Int {
        val p = m.positions
        val vc = m.vertexCount
        val tol = max(m.averageEdgeLength() * 0.35f, 1e-5f)
        val cell = tol * 2f
        val grid = HashMap<Long, IntArrayList>()
        fun cellOf(x: Float) = floor(x / cell).toLong()
        val srcSign = if (positiveToNegative) 1f else -1f
        for (v in 0 until vc) {
            if (p[v * 3 + axis] * srcSign >= -tol * 0.25f) {
                grid.getOrPut(key(cellOf(p[v * 3]), cellOf(p[v * 3 + 1]), cellOf(p[v * 3 + 2]))) { IntArrayList(4) }.add(v)
            }
        }
        var mirrored = 0
        val q = FloatArray(3)
        for (v in 0 until vc) {
            val coord = p[v * 3 + axis] * srcSign
            if (abs(p[v * 3 + axis]) < tol * 0.25f) { p[v * 3 + axis] = 0f; continue }
            if (coord > 0f) continue
            q[0] = p[v * 3]; q[1] = p[v * 3 + 1]; q[2] = p[v * 3 + 2]
            q[axis] = -q[axis]
            val gx = cellOf(q[0]); val gy = cellOf(q[1]); val gz = cellOf(q[2])
            var best = -1; var bestD = tol * tol
            for (dx in -1..1) for (dy in -1..1) for (dz in -1..1) {
                val list = grid[key(gx + dx, gy + dy, gz + dz)] ?: continue
                for (k in 0 until list.size) {
                    val w = list[k]
                    val ex = p[w * 3] - q[0]; val ey = p[w * 3 + 1] - q[1]; val ez = p[w * 3 + 2] - q[2]
                    val d = ex * ex + ey * ey + ez * ez
                    if (d < bestD) { bestD = d; best = w }
                }
            }
            if (best >= 0) {
                p[v * 3] = p[best * 3]; p[v * 3 + 1] = p[best * 3 + 1]; p[v * 3 + 2] = p[best * 3 + 2]
                p[v * 3 + axis] = -p[v * 3 + axis]
                m.colors?.let { c -> System.arraycopy(c, best * 4, c, v * 4, 4) }
                mirrored++
            }
        }
        m.computeNormals()
        m.markColorsDirty()
        return mirrored
    }

    // ---------------------------------------------------------------------------------------
    // UV generation
    // ---------------------------------------------------------------------------------------

    enum class UvProjection(val label: String) { BOX("Box"), SPHERE("Sphere"), CYLINDER("Cylinder"), PLANAR_Z("Front (Z)"), PLANAR_Y("Top (Y)"), PLANAR_X("Side (X)") }

    fun projectUvs(m: Mesh, mode: UvProjection): Mesh {
        val (mn, mx) = m.bounds()
        val sx = max(mx.x - mn.x, 1e-6f); val sy = max(mx.y - mn.y, 1e-6f); val sz = max(mx.z - mn.z, 1e-6f)
        val cx = (mn.x + mx.x) / 2; val cy = (mn.y + mx.y) / 2; val cz = (mn.z + mx.z) / 2
        val p = m.positions
        val tc = m.triangleCount
        // For each triangle corner compute (u, v, splitKey); vertices are duplicated per distinct key.
        val keyMap = HashMap<Long, Int>(m.vertexCount * 2)
        val srcOf = IntArrayList(m.vertexCount * 2)
        val uvs = FloatArrayList(m.vertexCount * 4)
        val idx = IntArray(tc * 3)
        val cu = FloatArray(3); val cv = FloatArray(3)
        for (t in 0 until tc) {
            var axisKey = 0
            if (mode == UvProjection.BOX) {
                val a = m.indices[t * 3]; val b = m.indices[t * 3 + 1]; val c = m.indices[t * 3 + 2]
                val e1x = p[b * 3] - p[a * 3]; val e1y = p[b * 3 + 1] - p[a * 3 + 1]; val e1z = p[b * 3 + 2] - p[a * 3 + 2]
                val e2x = p[c * 3] - p[a * 3]; val e2y = p[c * 3 + 1] - p[a * 3 + 1]; val e2z = p[c * 3 + 2] - p[a * 3 + 2]
                val nx = e1y * e2z - e1z * e2y; val ny = e1z * e2x - e1x * e2z; val nz = e1x * e2y - e1y * e2x
                val ax = abs(nx); val ay = abs(ny); val az = abs(nz)
                axisKey = if (ax >= ay && ax >= az) (if (nx > 0) 1 else 2) else if (ay >= az) (if (ny > 0) 3 else 4) else (if (nz > 0) 5 else 6)
            }
            for (q in 0 until 3) {
                val v = m.indices[t * 3 + q]
                val x = p[v * 3]; val y = p[v * 3 + 1]; val z = p[v * 3 + 2]
                when (mode) {
                    UvProjection.PLANAR_Z -> { cu[q] = (x - mn.x) / sx; cv[q] = 1f - (y - mn.y) / sy }
                    UvProjection.PLANAR_Y -> { cu[q] = (x - mn.x) / sx; cv[q] = (z - mn.z) / sz }
                    UvProjection.PLANAR_X -> { cu[q] = (mx.z - z) / sz; cv[q] = 1f - (y - mn.y) / sy }
                    UvProjection.SPHERE -> {
                        val dx = x - cx; val dy = y - cy; val dz = z - cz
                        val r = sqrt(dx * dx + dy * dy + dz * dz).coerceAtLeast(1e-9f)
                        cu[q] = (atan2(dx, dz) / (2 * PI).toFloat()) + 0.5f
                        cv[q] = acos((dy / r).coerceIn(-1f, 1f)) / PI.toFloat()
                    }
                    UvProjection.CYLINDER -> {
                        cu[q] = (atan2(x - cx, z - cz) / (2 * PI).toFloat()) + 0.5f
                        cv[q] = 1f - (y - mn.y) / sy
                    }
                    UvProjection.BOX -> {
                        val s = max(sx, max(sy, sz))
                        when (axisKey) {
                            1 -> { cu[q] = (mx.z - z) / s; cv[q] = 1f - (y - mn.y) / s }
                            2 -> { cu[q] = (z - mn.z) / s; cv[q] = 1f - (y - mn.y) / s }
                            3 -> { cu[q] = (x - mn.x) / s; cv[q] = (z - mn.z) / s }
                            4 -> { cu[q] = (x - mn.x) / s; cv[q] = 1f - (z - mn.z) / s }
                            5 -> { cu[q] = (x - mn.x) / s; cv[q] = 1f - (y - mn.y) / s }
                            else -> { cu[q] = (mx.x - x) / s; cv[q] = 1f - (y - mn.y) / s }
                        }
                    }
                }
            }
            // wrap fix for angular projections
            var wrap = 0
            if (mode == UvProjection.SPHERE || mode == UvProjection.CYLINDER) {
                val maxU = max(cu[0], max(cu[1], cu[2])); val minU = minOf(cu[0], cu[1], cu[2])
                if (maxU - minU > 0.5f) { for (q in 0 until 3) if (cu[q] < 0.5f) cu[q] += 1f; wrap = 1 }
            }
            for (q in 0 until 3) {
                val v = m.indices[t * 3 + q]
                val wrapped = if (wrap == 1 && cu[q] >= 1f) 1 else 0
                val k = (v.toLong() shl 4) or (axisKey.toLong() shl 1) or wrapped.toLong()
                val id = keyMap.getOrPut(k) {
                    srcOf.add(v); uvs.add(cu[q], cv[q]); srcOf.size - 1
                }
                idx[t * 3 + q] = id
            }
        }
        val n = srcOf.size
        val np = FloatArray(n * 3)
        val nc = m.colors?.let { FloatArray(n * 4) }
        val nm = m.mask?.let { FloatArray(n) }
        for (i in 0 until n) {
            val v = srcOf[i]
            System.arraycopy(p, v * 3, np, i * 3, 3)
            if (nc != null) System.arraycopy(m.colors!!, v * 4, nc, i * 4, 4)
            if (nm != null) nm[i] = m.mask!![v]
        }
        return Mesh(np, idx, null, nc, uvs.toArray(), nm)
    }

    // ---------------------------------------------------------------------------------------
    // misc
    // ---------------------------------------------------------------------------------------

    fun fillColor(m: Mesh, r: Float, g: Float, b: Float, a: Float = 1f, respectMask: Boolean = true) {
        val c = m.ensureColors()
        val mask = if (respectMask) m.mask else null
        for (v in 0 until m.vertexCount) {
            val f = if (mask != null) 1f - mask[v] else 1f
            c[v * 4] += (r - c[v * 4]) * f
            c[v * 4 + 1] += (g - c[v * 4 + 1]) * f
            c[v * 4 + 2] += (b - c[v * 4 + 2]) * f
            c[v * 4 + 3] += (a - c[v * 4 + 3]) * f
        }
        m.markColorsDirty()
    }

    /** Offset that moves the mesh's bounding-box center to the origin (already applied). */
    fun centerToOrigin(m: Mesh, bottom: Boolean = false): FloatArray {
        val (mn, mx) = m.bounds()
        val cx = (mn.x + mx.x) / 2; val cz = (mn.z + mx.z) / 2
        val cy = if (bottom) mn.y else (mn.y + mx.y) / 2
        m.translate(-cx, -cy, -cz)
        return floatArrayOf(cx, cy, cz)
    }

    /** Extrude 2D outlines (already triangulated cap) into a solid. */
    fun extrudeCap(capPositions2D: FloatArray, capIndices: IntArray, contours: List<FloatArray>, depth: Float, bevel: Float = 0f): Mesh {
        val b = MeshBuilder().also { it.hasUv = true }
        val z0 = -depth / 2; val z1 = depth / 2
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (i in 0 until capPositions2D.size / 2) {
            minX = minOf(minX, capPositions2D[i * 2]); maxX = max(maxX, capPositions2D[i * 2])
            minY = minOf(minY, capPositions2D[i * 2 + 1]); maxY = max(maxY, capPositions2D[i * 2 + 1])
        }
        val w = max(maxX - minX, 1e-6f); val h = max(maxY - minY, 1e-6f)
        val nCap = capPositions2D.size / 2
        val front = b.vertexCount
        for (i in 0 until nCap) b.vertex(capPositions2D[i * 2], capPositions2D[i * 2 + 1], z1, (capPositions2D[i * 2] - minX) / w, 1f - (capPositions2D[i * 2 + 1] - minY) / h)
        val back = b.vertexCount
        for (i in 0 until nCap) b.vertex(capPositions2D[i * 2], capPositions2D[i * 2 + 1], z0, (capPositions2D[i * 2] - minX) / w, 1f - (capPositions2D[i * 2 + 1] - minY) / h)
        for (t in 0 until capIndices.size / 3) {
            val a = capIndices[t * 3]; val c1 = capIndices[t * 3 + 1]; val c2 = capIndices[t * 3 + 2]
            b.tri(front + a, front + c1, front + c2)
            b.tri(back + a, back + c2, back + c1)
        }
        // side walls: contours are CCW for outer, CW for holes -> outward normals either way
        for (c in contours) {
            val n = c.size / 2
            var len = 0f
            for (i in 0 until n) {
                val j = (i + 1) % n
                val x0 = c[i * 2]; val y0 = c[i * 2 + 1]; val x1 = c[j * 2]; val y1 = c[j * 2 + 1]
                val segLen = sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0))
                val u0 = len; len += segLen
                val a = b.vertex(x0, y0, z0, u0, 1f)
                val bb = b.vertex(x1, y1, z0, len, 1f)
                val cc = b.vertex(x1, y1, z1, len, 0f)
                val d = b.vertex(x0, y0, z1, u0, 0f)
                b.quad(a, bb, cc, d)
            }
        }
        return removeDegenerate(b.build())
    }
}
