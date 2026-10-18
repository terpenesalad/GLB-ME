package app.glbandme.core.sculpt

import app.glbandme.core.mesh.IntArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.scene.SceneObject
import app.glbandme.math.Vec3
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

enum class BrushType(val label: String, val sculpts: Boolean = true) {
    CLAY("Clay"),
    DRAW("Draw"),
    INFLATE("Inflate"),
    SMOOTH("Smooth"),
    FLATTEN("Flatten"),
    PINCH("Pinch"),
    CREASE("Crease"),
    MOVE("Move"),
    DRAG("Drag"),
    LAYER("Layer"),
    MASK("Mask", sculpts = false),
    PAINT("Paint", sculpts = false);
}

enum class Falloff(val label: String) { SMOOTH("Smooth"), SPHERE("Sphere"), SHARP("Sharp"), LINEAR("Linear"), FLAT("Flat") }

class BrushSettings {
    var radiusPx = 70f
    var intensity = 0.5f
    var negative = false
    var falloff = Falloff.SMOOTH
    val symmetry = booleanArrayOf(true, false, false)
    /** linear rgba */
    val color = floatArrayOf(0.8f, 0.2f, 0.2f, 1f)
    var usePressure = true
    /** Spacing between dabs as a fraction of the radius. */
    var spacing = 0.12f
    var paintRoughnessMetal = false

    fun copyFrom(o: BrushSettings) {
        radiusPx = o.radiusPx; intensity = o.intensity; negative = o.negative; falloff = o.falloff
        o.symmetry.copyInto(symmetry); o.color.copyInto(color); usePressure = o.usePressure; spacing = o.spacing
    }
}

/**
 * Nomad-style sculpting on a single mesh in its local space. Works on seam-welded vertex groups
 * so UV seams never tear, records sparse undo data, and incrementally updates normals.
 */
class SculptEngine {

    private var mesh: Mesh? = null
    private var obj: SceneObject? = null
    private var type = BrushType.CLAY
    private val settings = BrushSettings()

    // weld info
    private var rep = IntArray(0)
    private var groupStart = IntArray(0)
    private var groupList = IntArray(0)
    private var nbStart = IntArray(0)
    private var nbList = IntArray(0)   // welded neighbours (reps)

    // spatial hash over representative vertices
    private val grid = HashMap<Long, IntArrayList>()
    private var cellSize = 1f
    private var cellOf = LongArray(0)

    // undo capture
    private var slot = IntArray(0)   // vertex -> index in undo arrays, -1 if untouched
    private val undoIdx = IntArrayList(1024)
    private var undoPos = FloatArray(0)
    private var undoCol = FloatArray(0)
    private var undoMask = FloatArray(0)
    private var undoNormal = FloatArray(0)

    // per stroke state
    private var lastCenter: Vec3? = null
    private var layerHeight = FloatArray(0)
    private var grabVerts = IntArray(0)
    private var grabWeights = FloatArray(0)
    private var grabOrig = FloatArray(0)
    private var grabCount = 0
    private var grabSym = IntArray(0)

    // scratch
    private val found = IntArrayList(4096)
    private val moved = IntArrayList(4096)
    private var stamp = IntArray(0)
    private var stampId = 1
    private var tmpTarget = FloatArray(0)

    val active get() = mesh != null

    private var cacheMesh: Mesh? = null
    private var cacheTopo = -1
    private var cacheGeom = -1

    fun begin(o: SceneObject, brush: BrushType, s: BrushSettings, localRadius: Float) {
        val m = o.mesh
        obj = o
        mesh = m
        type = brush
        settings.copyFrom(s)
        o.primitive = null // procedural shape becomes a sculpt
        val vc = m.vertexCount
        // Reuse topology caches and the spatial grid when sculpting the same mesh again and
        // nothing else moved its vertices since our last stroke (keeps stroke start instant).
        val sameTopo = cacheMesh === m && cacheTopo == m.topologyVersion
        if (!sameTopo) {
            val w = m.weld()
            rep = w.rep; groupStart = w.groupStart; groupList = w.groupList
            buildWeldedNeighbours(m)
            stamp = IntArray(vc)
            tmpTarget = FloatArray(vc * 3)
        }
        if (brush == BrushType.PAINT) m.ensureColors()
        if (brush == BrushType.MASK) m.ensureMask()
        if (slot.size != vc) slot = IntArray(vc) { -1 } else slot.fill(-1)
        undoIdx.clear()
        undoPos = FloatArray(1024 * 3); undoCol = FloatArray(1024 * 4); undoMask = FloatArray(1024); undoNormal = FloatArray(1024 * 3)
        layerHeight = if (brush == BrushType.LAYER) FloatArray(vc) else FloatArray(0)
        val wantCell = max(localRadius * 0.8f, 1e-5f)
        val gridValid = sameTopo && cacheGeom == m.geometryVersion && grid.isNotEmpty() && wantCell < cellSize * 3f && wantCell > cellSize / 3f
        if (!gridValid) buildGrid(m, wantCell)
        cacheMesh = m; cacheTopo = m.topologyVersion
        lastCenter = null
        grabCount = 0
    }

    private fun buildWeldedNeighbours(m: Mesh) {
        val adj = m.adjacency()
        val vc = m.vertexCount
        val start = IntArray(vc + 1)
        val list = IntArrayList(adj.nbList.size)
        val seen = IntArray(vc) { -1 }
        for (v in 0 until vc) {
            start[v] = list.size
            if (rep[v] != v) continue
            for (g in groupStart[v] until groupStart[v + 1]) {
                val member = groupList[g]
                for (j in adj.nbStart[member] until adj.nbStart[member + 1]) {
                    val r = rep[adj.nbList[j]]
                    if (r != v && seen[r] != v) { seen[r] = v; list.add(r) }
                }
            }
        }
        start[vc] = list.size
        nbStart = start
        nbList = list.toArray()
    }

    private fun key(x: Long, y: Long, z: Long) = (x * 73856093L) xor (y * 19349663L) xor (z * 83492791L)
    private fun cell(v: Float) = floor(v / cellSize).toLong()

    private fun buildGrid(m: Mesh, cs: Float) {
        grid.clear()
        cellSize = cs
        val p = m.positions
        cellOf = LongArray(m.vertexCount)
        for (v in 0 until m.vertexCount) {
            if (rep[v] != v) continue
            val k = key(cell(p[v * 3]), cell(p[v * 3 + 1]), cell(p[v * 3 + 2]))
            cellOf[v] = k
            grid.getOrPut(k) { IntArrayList(8) }.add(v)
        }
    }

    private fun regrid(v: Int, p: FloatArray) {
        val k = key(cell(p[v * 3]), cell(p[v * 3 + 1]), cell(p[v * 3 + 2]))
        if (k == cellOf[v]) return
        grid[cellOf[v]]?.let { l ->
            for (i in 0 until l.size) if (l[i] == v) { l.swapRemove(i); break }
        }
        grid.getOrPut(k) { IntArrayList(8) }.add(v)
        cellOf[v] = k
    }

    /** Collect representative vertices within radius of c (into [found]). */
    private fun query(m: Mesh, cx: Float, cy: Float, cz: Float, r: Float) {
        found.clear()
        val p = m.positions
        val r2 = r * r
        val x0 = cell(cx - r); val x1 = cell(cx + r)
        val y0 = cell(cy - r); val y1 = cell(cy + r)
        val z0 = cell(cz - r); val z1 = cell(cz + r)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) {
            // brush much larger than grid cells: brute force
            for (v in 0 until m.vertexCount) {
                if (rep[v] != v) continue
                val dx = p[v * 3] - cx; val dy = p[v * 3 + 1] - cy; val dz = p[v * 3 + 2] - cz
                if (dx * dx + dy * dy + dz * dz <= r2) found.add(v)
            }
            return
        }
        for (x in x0..x1) for (y in y0..y1) for (z in z0..z1) {
            val l = grid[key(x, y, z)] ?: continue
            for (i in 0 until l.size) {
                val v = l[i]
                val dx = p[v * 3] - cx; val dy = p[v * 3 + 1] - cy; val dz = p[v * 3 + 2] - cz
                if (dx * dx + dy * dy + dz * dz <= r2) found.add(v)
            }
        }
    }

    private fun falloff(x: Float): Float {
        val t = x.coerceIn(0f, 1f)
        return when (settings.falloff) {
            Falloff.SMOOTH -> 1f - t * t * (3f - 2f * t)
            Falloff.SPHERE -> sqrt(max(0f, 1f - t * t))
            Falloff.SHARP -> (1f - t) * (1f - t)
            Falloff.LINEAR -> 1f - t
            Falloff.FLAT -> if (t < 0.85f) 1f else (1f - t) / 0.15f
        }
    }

    private fun capture(v: Int, m: Mesh) {
        if (slot[v] >= 0) return
        val n = undoIdx.size
        slot[v] = n
        if (undoPos.size < (n + 1) * 3) {
            val cap = max(n * 2, 1024)
            undoPos = undoPos.copyOf(cap * 3); undoCol = undoCol.copyOf(cap * 4); undoMask = undoMask.copyOf(cap); undoNormal = undoNormal.copyOf(cap * 3)
        }
        undoIdx.add(v)
        System.arraycopy(m.positions, v * 3, undoPos, n * 3, 3)
        System.arraycopy(m.normals, v * 3, undoNormal, n * 3, 3)
        m.colors?.let { System.arraycopy(it, v * 4, undoCol, n * 4, 4) }
        m.mask?.let { undoMask[n] = it[v] }
    }

    /** Captures original position of v; for layer brush we need the starting normal too. */
    private fun originalIndex(v: Int): Int = slot[v]

    /** Mirror passes for the symmetry settings: list of sign triples. */
    private fun symmetryPasses(): List<FloatArray> {
        val out = ArrayList<FloatArray>()
        val sx = if (settings.symmetry[0]) listOf(1f, -1f) else listOf(1f)
        val sy = if (settings.symmetry[1]) listOf(1f, -1f) else listOf(1f)
        val sz = if (settings.symmetry[2]) listOf(1f, -1f) else listOf(1f)
        for (a in sx) for (b in sy) for (c in sz) out.add(floatArrayOf(a, b, c))
        return out
    }

    /**
     * Apply one dab at local-space [center] with local radius [r]. [delta] is the local-space drag
     * motion since the previous dab (used by Move/Drag).
     */
    fun dab(center: Vec3, r: Float, pressure: Float, delta: Vec3?) {
        val m = mesh ?: return
        if (r <= 0f) return
        if (r > cellSize * 4f || r < cellSize * 0.25f) buildGrid(m, max(r * 0.8f, 1e-5f))
        moved.clear()
        stampId++
        if (stampId == Int.MAX_VALUE) { stamp.fill(0); stampId = 1 }
        val press = if (settings.usePressure) pressure.coerceIn(0.05f, 1f) else 1f
        val strength = settings.intensity * press
        val sign = if (settings.negative) -1f else 1f
        for (s in symmetryPasses()) {
            val c = Vec3(center.x * s[0], center.y * s[1], center.z * s[2])
            val d = delta?.let { Vec3(it.x * s[0], it.y * s[1], it.z * s[2]) }
            applyBrush(m, c, r, strength, sign, d, s)
        }
        finishDab(m)
    }

    private fun finishDab(m: Mesh) {
        if (moved.size == 0) return
        val p = m.positions
        // propagate representative values to seam duplicates
        val n0 = moved.size
        for (k in 0 until n0) {
            val v = moved[k]
            val gs = groupStart[v]; val ge = groupStart[v + 1]
            if (ge - gs <= 1) continue
            for (g in gs until ge) {
                val d = groupList[g]
                if (d == v) continue
                capture(d, m)
                p[d * 3] = p[v * 3]; p[d * 3 + 1] = p[v * 3 + 1]; p[d * 3 + 2] = p[v * 3 + 2]
                m.colors?.let { c -> System.arraycopy(c, v * 4, c, d * 4, 4) }
                m.mask?.let { mk -> mk[d] = mk[v] }
                moved.add(d)
            }
        }
        var lo = Int.MAX_VALUE; var hi = -1
        for (k in 0 until moved.size) { val v = moved[k]; if (v < lo) lo = v; if (v > hi) hi = v }
        when (type) {
            BrushType.PAINT -> m.markColorsDirty(lo, hi)
            BrushType.MASK -> m.markMaskDirty(lo, hi)
            else -> {
                for (k in 0 until n0) regrid(moved[k], p)
                stampId++
                m.updateNormals(moved.data, moved.size, stamp, stampId)
            }
        }
    }

    private fun markMoved(v: Int) {
        if (stamp[v] != stampId) { stamp[v] = stampId; moved.add(v) }
    }

    private fun applyBrush(m: Mesh, c: Vec3, r: Float, strength: Float, sign: Float, delta: Vec3?, sym: FloatArray) {
        val p = m.positions
        val nrm = m.normals
        val mask = m.mask

        if (type == BrushType.MOVE) { applyGrab(m, c, r, delta, sym); return }

        query(m, c.x, c.y, c.z, r)
        if (found.size == 0) return

        // area normal and centre (weighted)
        var anx = 0f; var any = 0f; var anz = 0f
        var acx = 0f; var acy = 0f; var acz = 0f; var aw = 0f
        for (k in 0 until found.size) {
            val v = found[k]
            val dx = p[v * 3] - c.x; val dy = p[v * 3 + 1] - c.y; val dz = p[v * 3 + 2] - c.z
            val f = falloff(sqrt(dx * dx + dy * dy + dz * dz) / r)
            anx += nrm[v * 3] * f; any += nrm[v * 3 + 1] * f; anz += nrm[v * 3 + 2] * f
            acx += p[v * 3] * f; acy += p[v * 3 + 1] * f; acz += p[v * 3 + 2] * f; aw += f
        }
        val nl = sqrt(anx * anx + any * any + anz * anz)
        if (nl < 1e-12f || aw < 1e-12f) return
        anx /= nl; any /= nl; anz /= nl
        acx /= aw; acy /= aw; acz /= aw

        when (type) {
            BrushType.SMOOTH -> {
                for (k in 0 until found.size) {
                    val v = found[k]
                    var sx = 0f; var sy = 0f; var sz = 0f
                    val s = nbStart[v]; val e = nbStart[v + 1]
                    if (e == s) { tmpTarget[v * 3] = p[v * 3]; tmpTarget[v * 3 + 1] = p[v * 3 + 1]; tmpTarget[v * 3 + 2] = p[v * 3 + 2]; continue }
                    for (j in s until e) { val w = nbList[j]; sx += p[w * 3]; sy += p[w * 3 + 1]; sz += p[w * 3 + 2] }
                    val inv = 1f / (e - s)
                    tmpTarget[v * 3] = sx * inv; tmpTarget[v * 3 + 1] = sy * inv; tmpTarget[v * 3 + 2] = sz * inv
                }
                for (k in 0 until found.size) {
                    val v = found[k]
                    val w = weight(v, c, r, p, mask) * min(1f, strength * 1.6f)
                    if (w <= 0f) continue
                    capture(v, m)
                    p[v * 3] += (tmpTarget[v * 3] - p[v * 3]) * w
                    p[v * 3 + 1] += (tmpTarget[v * 3 + 1] - p[v * 3 + 1]) * w
                    p[v * 3 + 2] += (tmpTarget[v * 3 + 2] - p[v * 3 + 2]) * w
                    markMoved(v)
                }
            }
            BrushType.MASK -> {
                val mk = m.ensureMask()
                for (k in 0 until found.size) {
                    val v = found[k]
                    val dx = p[v * 3] - c.x; val dy = p[v * 3 + 1] - c.y; val dz = p[v * 3 + 2] - c.z
                    val w = falloff(sqrt(dx * dx + dy * dy + dz * dz) / r) * strength
                    if (w <= 0f) continue
                    capture(v, m)
                    mk[v] = (mk[v] + sign * w).coerceIn(0f, 1f)
                    markMoved(v)
                }
            }
            BrushType.PAINT -> {
                val col = m.ensureColors()
                val pc = settings.color
                for (k in 0 until found.size) {
                    val v = found[k]
                    val w = weight(v, c, r, p, mask) * strength
                    if (w <= 0f) continue
                    capture(v, m)
                    if (sign < 0f) {
                        // negative paint erases back to white
                        for (q in 0 until 4) col[v * 4 + q] += (1f - col[v * 4 + q]) * w
                    } else for (q in 0 until 4) col[v * 4 + q] += (pc[q] - col[v * 4 + q]) * w
                    markMoved(v)
                }
            }
            else -> {
                val h = r * 0.1f
                for (k in 0 until found.size) {
                    val v = found[k]
                    val w = weight(v, c, r, p, mask) * strength
                    if (w <= 0f) continue
                    capture(v, m)
                    val x = p[v * 3]; val y = p[v * 3 + 1]; val z = p[v * 3 + 2]
                    when (type) {
                        BrushType.DRAW -> {
                            val s = sign * w * h * 1.2f
                            p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s
                        }
                        BrushType.CLAY -> {
                            // pull everything below an offset plane up to it -> builds layers of clay
                            val off = r * 0.18f * sign
                            val d = (x - acx) * anx + (y - acy) * any + (z - acz) * anz - off
                            if ((sign > 0 && d < 0f) || (sign < 0 && d > 0f)) {
                                val s = -d * w * 0.5f
                                p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s
                            }
                        }
                        BrushType.INFLATE -> {
                            val s = sign * w * h * 0.9f
                            p[v * 3] = x + nrm[v * 3] * s; p[v * 3 + 1] = y + nrm[v * 3 + 1] * s; p[v * 3 + 2] = z + nrm[v * 3 + 2] * s
                        }
                        BrushType.FLATTEN -> {
                            val d = (x - acx) * anx + (y - acy) * any + (z - acz) * anz
                            val s = -d * w * 0.5f
                            p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s
                        }
                        BrushType.PINCH, BrushType.CREASE -> {
                            var tx = c.x - x; var ty = c.y - y; var tz = c.z - z
                            val dn = tx * anx + ty * any + tz * anz
                            tx -= anx * dn; ty -= any * dn; tz -= anz * dn
                            val k2 = sign * w * (if (type == BrushType.PINCH) 0.35f else 0.25f)
                            var nx = x + tx * k2; var ny = y + ty * k2; var nz = z + tz * k2
                            if (type == BrushType.CREASE) {
                                val s = -sign * w * h * 0.6f
                                nx += anx * s; ny += any * s; nz += anz * s
                            }
                            p[v * 3] = nx; p[v * 3 + 1] = ny; p[v * 3 + 2] = nz
                        }
                        BrushType.DRAG -> {
                            if (delta != null) {
                                p[v * 3] = x + delta.x * w; p[v * 3 + 1] = y + delta.y * w; p[v * 3 + 2] = z + delta.z * w
                            }
                        }
                        BrushType.LAYER -> {
                            val oi = originalIndex(v)
                            if (oi >= 0) {
                                val target = sign * h * 1.5f
                                val cur = layerHeight[v]
                                val next = if (sign > 0) min(target, cur + w * h * 0.6f) else max(target, cur - w * h * 0.6f)
                                layerHeight[v] = next
                                p[v * 3] = undoPos[oi * 3] + undoNormal[oi * 3] * next
                                p[v * 3 + 1] = undoPos[oi * 3 + 1] + undoNormal[oi * 3 + 1] * next
                                p[v * 3 + 2] = undoPos[oi * 3 + 2] + undoNormal[oi * 3 + 2] * next
                            }
                        }
                        else -> {}
                    }
                    markMoved(v)
                }
            }
        }
    }

    private fun weight(v: Int, c: Vec3, r: Float, p: FloatArray, mask: FloatArray?): Float {
        val dx = p[v * 3] - c.x; val dy = p[v * 3 + 1] - c.y; val dz = p[v * 3 + 2] - c.z
        val f = falloff(sqrt(dx * dx + dy * dy + dz * dz) / r)
        return if (mask != null) f * (1f - mask[v]) else f
    }

    /** Move/grab: capture the region once, then follow the finger. */
    private fun applyGrab(m: Mesh, c: Vec3, r: Float, delta: Vec3?, sym: FloatArray) {
        val p = m.positions
        val symId = ((if (sym[0] < 0) 1 else 0) or (if (sym[1] < 0) 2 else 0) or (if (sym[2] < 0) 4 else 0))
        if (delta == null) {
            // stroke start for this symmetry pass: capture weights
            query(m, c.x, c.y, c.z, r)
            val mask = m.mask
            val need = grabCount + found.size
            if (grabVerts.size < need) {
                grabVerts = grabVerts.copyOf(need * 2); grabWeights = grabWeights.copyOf(need * 2)
                grabOrig = grabOrig.copyOf(need * 6); grabSym = grabSym.copyOf(need * 2)
            }
            for (k in 0 until found.size) {
                val v = found[k]
                val w = weight(v, c, r, p, mask)
                if (w <= 0f) continue
                grabVerts[grabCount] = v; grabWeights[grabCount] = w; grabSym[grabCount] = symId
                System.arraycopy(p, v * 3, grabOrig, grabCount * 3, 3)
                grabCount++
            }
            return
        }
        for (i in 0 until grabCount) {
            if (grabSym[i] != symId) continue
            val v = grabVerts[i]
            val w = grabWeights[i] * settings.intensity.coerceAtLeast(0.15f) * 1.6f
            capture(v, m)
            p[v * 3] = grabOrig[i * 3] + delta.x * min(w, 1f)
            p[v * 3 + 1] = grabOrig[i * 3 + 1] + delta.y * min(w, 1f)
            p[v * 3 + 2] = grabOrig[i * 3 + 2] + delta.z * min(w, 1f)
            markMoved(v)
        }
    }

    /** For MOVE: call once at stroke start (delta = null captures), then [dab] with total delta. */
    fun grabStart(center: Vec3, r: Float) {
        val m = mesh ?: return
        grabCount = 0
        for (s in symmetryPasses()) applyGrab(m, Vec3(center.x * s[0], center.y * s[1], center.z * s[2]), r, null, s)
    }

    /** Ends the stroke and returns an undo action (or null if nothing changed). */
    fun end(): UndoAction? {
        val m = mesh ?: return null
        val o = obj
        mesh = null; obj = null
        cacheGeom = m.geometryVersion
        val n = undoIdx.size
        if (n == 0) return null
        val idx = undoIdx.toArray()
        val beforeP = undoPos.copyOf(n * 3)
        val beforeC = if (m.colors != null) undoCol.copyOf(n * 4) else null
        val beforeM = if (m.mask != null) undoMask.copyOf(n) else null
        val afterP = FloatArray(n * 3)
        val afterC = beforeC?.let { FloatArray(n * 4) }
        val afterM = beforeM?.let { FloatArray(n) }
        for (i in 0 until n) {
            val v = idx[i]
            System.arraycopy(m.positions, v * 3, afterP, i * 3, 3)
            if (afterC != null) System.arraycopy(m.colors!!, v * 4, afterC, i * 4, 4)
            if (afterM != null) afterM[i] = m.mask!![v]
        }
        val label = type.label
        val bytes = n * (4L + 24 + (if (beforeC != null) 32 else 0) + (if (beforeM != null) 8 else 0))
        return SculptUndo(label, o, m, m.topologyVersion, idx, beforeP, afterP, beforeC, afterC, beforeM, afterM, bytes)
    }

    private class SculptUndo(
        override val label: String, val obj: SceneObject?, val mesh: Mesh, val topo: Int, val idx: IntArray,
        val beforeP: FloatArray, val afterP: FloatArray, val beforeC: FloatArray?, val afterC: FloatArray?,
        val beforeM: FloatArray?, val afterM: FloatArray?, override val bytes: Long
    ) : UndoAction {
        override fun undo() = apply(beforeP, beforeC, beforeM)
        override fun redo() = apply(afterP, afterC, afterM)
        private fun apply(p: FloatArray, c: FloatArray?, mk: FloatArray?) {
            if (mesh.topologyVersion != topo) return
            var lo = Int.MAX_VALUE; var hi = -1
            for (i in idx.indices) {
                val v = idx[i]
                System.arraycopy(p, i * 3, mesh.positions, v * 3, 3)
                if (c != null) mesh.colors?.let { System.arraycopy(c, i * 4, it, v * 4, 4) }
                if (mk != null) mesh.mask?.let { it[v] = mk[i] }
                if (v < lo) lo = v; if (v > hi) hi = v
            }
            val stamp = IntArray(mesh.vertexCount)
            mesh.updateNormals(idx, idx.size, stamp, 1)
            if (c != null) mesh.markColorsDirty(lo, hi)
            if (mk != null) mesh.markMaskDirty(lo, hi)
        }
    }

    // ---------------------------------------------------------------------------------------
    // whole-mesh mask helpers
    // ---------------------------------------------------------------------------------------
    companion object {
        fun maskClear(m: Mesh) { m.mask?.fill(0f); m.markMaskDirty() }
        fun maskInvert(m: Mesh) { val mk = m.ensureMask(); for (i in mk.indices) mk[i] = 1f - mk[i]; m.markMaskDirty() }
        fun maskBlur(m: Mesh, iterations: Int = 2) {
            val mk = m.mask ?: return
            val adj = m.adjacency()
            repeat(iterations) {
                val tmp = mk.copyOf()
                for (v in 0 until m.vertexCount) {
                    var s = mk[v]; var n = 1
                    for (j in adj.nbStart[v] until adj.nbStart[v + 1]) { s += mk[adj.nbList[j]]; n++ }
                    tmp[v] = s / n
                }
                tmp.copyInto(mk)
            }
            m.markMaskDirty()
        }
        fun maskSharpen(m: Mesh) {
            val mk = m.mask ?: return
            for (i in mk.indices) mk[i] = ((mk[i] - 0.5f) * 2f + 0.5f).coerceIn(0f, 1f)
            m.markMaskDirty()
        }
    }
}
