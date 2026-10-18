package app.glbandme.core.mesh

import app.glbandme.math.Vec3
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Solid extrusion of 2D outlines (text, logos, drawn shapes) along Z, with an optional rounded
 * bevel. Contours may be nested (holes are detected automatically).
 */
object Extruder {

    /**
     * @param contours closed xy polylines (any orientation)
     * @param depth total thickness along Z (centered on z = 0)
     * @param bevel bevel size (clamped to a safe value), 0 = sharp edges
     * @param bevelSegments rounding steps of the bevel
     */
    fun extrude(contours: List<FloatArray>, depth: Float, bevel: Float = 0f, bevelSegments: Int = 3): Mesh? {
        val base = Triangulator.triangulate(contours)
        if (base.indices.isEmpty()) return null
        val oriented = base.contours
        // keep the bevel smaller than the thinnest feature we can cheaply estimate
        val maxBevel = min(depth * 0.45f, oriented.minOf { minFeature(it) } * 0.35f)
        val b = bevel.coerceIn(0f, max(0f, maxBevel))
        val segs = if (b > 0f) max(1, bevelSegments) else 0
        val half = depth / 2f
        val inner = half - b
        // rings ordered back -> front: (inset, z)
        val ringsInset = ArrayList<Float>()
        val ringsZ = ArrayList<Float>()
        for (k in segs downTo 0) { val t = k.toFloat() / max(1, segs) * (PI.toFloat() / 2); ringsInset.add(if (segs == 0) 0f else b * (1 - cos(t))); ringsZ.add(-(inner + (if (segs == 0) 0f else b * sin(t)))) }
        for (k in 0..segs) { val t = k.toFloat() / max(1, segs) * (PI.toFloat() / 2); ringsInset.add(if (segs == 0) 0f else b * (1 - cos(t))); ringsZ.add(inner + (if (segs == 0) 0f else b * sin(t))) }

        val mb = MeshBuilder().also { it.hasUv = true }
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (c in oriented) for (i in 0 until c.size / 2) {
            minX = min(minX, c[i * 2]); maxX = max(maxX, c[i * 2]); minY = min(minY, c[i * 2 + 1]); maxY = max(maxY, c[i * 2 + 1])
        }
        val w = max(maxX - minX, 1e-6f); val h = max(maxY - minY, 1e-6f)

        // caps (at full inset)
        val capContours = if (b > 0f) oriented.map { offset(it, b) } else oriented
        val cap = if (b > 0f) Triangulator.triangulate(capContours) else base
        val n = cap.positions.size / 2
        val front = mb.vertexCount
        for (i in 0 until n) mb.vertex(cap.positions[i * 2], cap.positions[i * 2 + 1], half, (cap.positions[i * 2] - minX) / w, 1f - (cap.positions[i * 2 + 1] - minY) / h)
        val back = mb.vertexCount
        for (i in 0 until n) mb.vertex(cap.positions[i * 2], cap.positions[i * 2 + 1], -half, (cap.positions[i * 2] - minX) / w, 1f - (cap.positions[i * 2 + 1] - minY) / h)
        for (t in 0 until cap.indices.size / 3) {
            val a = cap.indices[t * 3]; val c1 = cap.indices[t * 3 + 1]; val c2 = cap.indices[t * 3 + 2]
            mb.tri(front + a, front + c1, front + c2)
            mb.tri(back + a, back + c2, back + c1)
        }

        // walls: one column of vertices per contour edge so sharp corners stay sharp
        // (auto-smoothing re-joins gentle curves)
        val rings = ringsZ.size
        for (c in oriented) {
            val pts = c.size / 2
            val ringPts = Array(rings) { r -> if (ringsInset[r] > 0f) offset(c, ringsInset[r]) else c }
            var len = 0f
            for (i in 0 until pts) {
                val j = (i + 1) % pts
                val seg = sqrt((c[j * 2] - c[i * 2]).let { it * it } + (c[j * 2 + 1] - c[i * 2 + 1]).let { it * it })
                val u0 = len; val u1 = len + seg
                len = u1
                val col0 = IntArray(rings); val col1 = IntArray(rings)
                for (r in 0 until rings) {
                    val rp = ringPts[r]
                    val v = (ringsZ[r] + half) / max(depth, 1e-6f)
                    col0[r] = mb.vertex(rp[i * 2], rp[i * 2 + 1], ringsZ[r], u0, 1f - v)
                    col1[r] = mb.vertex(rp[j * 2], rp[j * 2 + 1], ringsZ[r], u1, 1f - v)
                }
                for (r in 0 until rings - 1) mb.quad(col0[r], col1[r], col1[r + 1], col0[r + 1])
            }
        }
        return MeshOps.removeDegenerate(mb.build())
    }

    /** Smallest edge-to-opposite distance proxy: shortest contour bounding dimension. */
    private fun minFeature(c: FloatArray): Float {
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (i in 0 until c.size / 2) { minX = min(minX, c[i * 2]); maxX = max(maxX, c[i * 2]); minY = min(minY, c[i * 2 + 1]); maxY = max(maxY, c[i * 2 + 1]) }
        return min(maxX - minX, maxY - minY)
    }

    /**
     * Offset a contour toward the material side (left of travel for outer CCW / hole CW
     * contours) by [d], using clamped miter joins.
     */
    fun offset(c: FloatArray, d: Float): FloatArray {
        val n = c.size / 2
        val out = FloatArray(c.size)
        for (i in 0 until n) {
            val p = (i - 1 + n) % n; val q = (i + 1) % n
            var e1x = c[i * 2] - c[p * 2]; var e1y = c[i * 2 + 1] - c[p * 2 + 1]
            var e2x = c[q * 2] - c[i * 2]; var e2y = c[q * 2 + 1] - c[i * 2 + 1]
            val l1 = sqrt(e1x * e1x + e1y * e1y).coerceAtLeast(1e-9f); val l2 = sqrt(e2x * e2x + e2y * e2y).coerceAtLeast(1e-9f)
            e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2
            // left normals
            val n1x = -e1y; val n1y = e1x; val n2x = -e2y; val n2y = e2x
            var mx = n1x + n2x; var my = n1y + n2y
            val ml = sqrt(mx * mx + my * my)
            val k: Float
            if (ml < 0.35f) {
                // cusp / needle tip: move straight back along the spike
                mx = e2x - e1x; my = e2y - e1y
                val l = sqrt(mx * mx + my * my).coerceAtLeast(1e-9f)
                mx /= l; my /= l
                // pick the side that points into the material (left of travel)
                if (mx * (n1x + n2x) + my * (n1y + n2y) < 0f && ml > 1e-4f) { mx = -mx; my = -my }
                k = d * 2.5f
            } else {
                mx /= ml; my /= ml
                val cosHalf = (mx * n1x + my * n1y).coerceAtLeast(0.3f)
                k = d / cosHalf
            }
            out[i * 2] = c[i * 2] + mx * k
            out[i * 2 + 1] = c[i * 2 + 1] + my * k
        }
        // collapse edges that flipped direction (offset larger than a needle's half-width)
        for (pass in 0 until 4) {
            var changed = false
            for (i in 0 until n) {
                val j = (i + 1) % n
                val ox = c[j * 2] - c[i * 2]; val oy = c[j * 2 + 1] - c[i * 2 + 1]
                val nx = out[j * 2] - out[i * 2]; val ny = out[j * 2 + 1] - out[i * 2 + 1]
                if (ox * nx + oy * ny < 0f) {
                    val mxp = (out[i * 2] + out[j * 2]) / 2; val myp = (out[i * 2 + 1] + out[j * 2 + 1]) / 2
                    out[i * 2] = mxp; out[i * 2 + 1] = myp; out[j * 2] = mxp; out[j * 2 + 1] = myp
                    changed = true
                }
            }
            if (!changed) break
        }
        removeLocalLoops(out)
        return out
    }

    /**
     * An inset of a tight curve folds over itself (the "swallow-tail"). Find edge pairs that cross
     * within a local window and collapse the loop between them onto the crossing point, which is
     * exactly where the true offset curve has its corner.
     */
    private fun removeLocalLoops(o: FloatArray) {
        val n = o.size / 2
        if (n < 4) return
        val window = min(n / 3, 48)
        var i = 0
        while (i < n) {
            val a0 = i; val a1 = (i + 1) % n
            var hit = -1; var hx = 0f; var hy = 0f
            for (s in window downTo 2) {
                val b0 = (i + s) % n; val b1 = (b0 + 1) % n
                if (b1 == a0) continue
                val ax = o[a0 * 2]; val ay = o[a0 * 2 + 1]; val bx = o[a1 * 2]; val by = o[a1 * 2 + 1]
                val cx = o[b0 * 2]; val cy = o[b0 * 2 + 1]; val dx = o[b1 * 2]; val dy = o[b1 * 2 + 1]
                val rX = bx - ax; val rY = by - ay; val sX = dx - cx; val sY = dy - cy
                val den = rX * sY - rY * sX
                if (abs(den) < 1e-12f) continue
                val t = ((cx - ax) * sY - (cy - ay) * sX) / den
                val u = ((cx - ax) * rY - (cy - ay) * rX) / den
                if (t in 0f..1f && u in 0f..1f) { hit = s; hx = ax + rX * t; hy = ay + rY * t; break }
            }
            if (hit > 0) {
                for (k in 1..hit) { val v = (i + k) % n; o[v * 2] = hx; o[v * 2 + 1] = hy }
                i += hit
            } else i++
        }
    }

    /** Resample a polyline so consecutive points are about [step] apart. */
    fun resample(pts: FloatArray, step: Float, closed: Boolean): FloatArray {
        val n = pts.size / 2
        if (n < 2) return pts
        val out = FloatArrayList(pts.size)
        out.add(pts[0], pts[1])
        var carry = 0f
        val last = if (closed) n else n - 1
        for (i in 0 until last) {
            val j = (i + 1) % n
            val ax = pts[i * 2]; val ay = pts[i * 2 + 1]; val bx = pts[j * 2]; val by = pts[j * 2 + 1]
            val seg = sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
            if (seg < 1e-9f) continue
            var t = step - carry
            while (t <= seg) {
                out.add(ax + (bx - ax) * t / seg, ay + (by - ay) * t / seg)
                t += step
            }
            carry = seg - (t - step)
        }
        if (!closed && (out[out.size - 2] != pts[(n - 1) * 2] || out[out.size - 1] != pts[(n - 1) * 2 + 1])) out.add(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
        var r = out.toArray()
        if (closed && r.size >= 4) {
            val dx = r[0] - r[r.size - 2]; val dy = r[1] - r[r.size - 1]
            if (sqrt(dx * dx + dy * dy) < step * 0.5f) r = r.copyOf(r.size - 2)
        }
        return r
    }

    /** Chaikin smoothing for hand-drawn strokes. */
    fun smooth(pts: FloatArray, iterations: Int, closed: Boolean): FloatArray {
        var p = pts
        repeat(iterations) {
            val n = p.size / 2
            if (n < 3) return p
            val out = FloatArrayList(p.size * 2)
            if (!closed) out.add(p[0], p[1])
            val last = if (closed) n else n - 1
            for (i in 0 until last) {
                val j = (i + 1) % n
                out.add(0.75f * p[i * 2] + 0.25f * p[j * 2], 0.75f * p[i * 2 + 1] + 0.25f * p[j * 2 + 1])
                out.add(0.25f * p[i * 2] + 0.75f * p[j * 2], 0.25f * p[i * 2 + 1] + 0.75f * p[j * 2 + 1])
            }
            if (!closed) out.add(p[(n - 1) * 2], p[(n - 1) * 2 + 1])
            p = out.toArray()
        }
        return p
    }

    @Suppress("unused")
    private fun angle(a: Vec3, b: Vec3) = acos((a.dot(b) / (a.length() * b.length())).coerceIn(-1f, 1f))

    @Suppress("unused")
    private fun nearlyZero(v: Float) = abs(v) < 1e-7f
}

/** Tubes swept along 3D paths (springs, knots, drawn strokes). */
object Sweep {
    /**
     * @param path points (x,y,z) along the centre line
     * @param radius tube radius (or per-point via [radiusAt] fraction 0..1)
     */
    fun tube(path: List<Vec3>, radius: Float, sides: Int, closed: Boolean, caps: Boolean = true, radiusAt: ((Float) -> Float)? = null): Mesh? {
        val n = path.size
        if (n < 2) return null
        val s = max(3, sides)
        // tangents
        val tan = Array(n) { i ->
            val a = if (closed) path[(i - 1 + n) % n] else path[max(0, i - 1)]
            val b = if (closed) path[(i + 1) % n] else path[min(n - 1, i + 1)]
            (b - a).let { if (it.lengthSq() < 1e-14f) Vec3(0f, 0f, 1f) else it.normalize() }
        }
        // parallel transport frames
        val nor = arrayOfNulls<Vec3>(n)
        var ref = if (abs(tan[0].y) < 0.9f) Vec3(0f, 1f, 0f) else Vec3(1f, 0f, 0f)
        nor[0] = ref.subLocal(tan[0] * ref.dot(tan[0])).normalize()
        for (i in 1 until n) {
            val prev = nor[i - 1]!!
            val v = prev - tan[i] * prev.dot(tan[i])
            nor[i] = if (v.lengthSq() < 1e-12f) prev.copy() else v.normalize()
        }
        // distribute the closing twist for loops
        var twist = 0f
        if (closed) {
            val last = nor[n - 1]!!
            val back = (last - tan[0] * last.dot(tan[0])).normalize()
            val c = back.dot(nor[0]!!).coerceIn(-1f, 1f)
            twist = acos(c)
            if (tan[0].cross(back).dot(nor[0]!!) < 0f) twist = -twist
        }
        val mb = MeshBuilder().also { it.hasUv = true }
        val rings = if (closed) n + 1 else n
        val totalLen = run { var l = 0f; for (i in 1 until n) l += path[i].distance(path[i - 1]); max(l, 1e-6f) }
        var acc = 0f
        for (r in 0 until rings) {
            val i = r % n
            if (r > 0) acc += path[i].distance(path[(r - 1) % n])
            val t = tan[i]
            var nn = nor[i]!!
            if (closed && twist != 0f) {
                val ang = -twist * r / n
                nn = rotateAround(nn, t, ang)
            }
            val bb = t.cross(nn).normalize()
            val f = r.toFloat() / (rings - 1)
            val rad = radius * (radiusAt?.invoke(f) ?: 1f)
            for (k in 0..s) {
                val a = (k % s).toFloat() / s * 2f * PI.toFloat()
                val off = nn * (cos(a) * rad) + bb * (sin(a) * rad)
                val p = path[i] + off
                mb.vertex(p.x, p.y, p.z, k.toFloat() / s, acc / totalLen)
            }
        }
        val row = s + 1
        for (r in 0 until rings - 1) for (k in 0 until s) {
            val a = r * row + k
            mb.quad(a, a + 1, a + row + 1, a + row)
        }
        if (!closed && caps) {
            // start cap faces -tangent, end cap faces +tangent
            val c0 = mb.vertex(path[0].x, path[0].y, path[0].z, 0.5f, 0.5f)
            for (k in 0 until s) mb.tri(c0, k + 1, k)
            val endRow = (rings - 1) * row
            val c1 = mb.vertex(path[n - 1].x, path[n - 1].y, path[n - 1].z, 0.5f, 0.5f)
            for (k in 0 until s) mb.tri(c1, endRow + k, endRow + k + 1)
        }
        // the start/end rings of closed loops coincide exactly only after twist correction,
        // so weld positions numerically close for a clean seam
        val m = mb.build()
        return MeshOps.removeDegenerate(m)
    }

    private fun rotateAround(v: Vec3, axis: Vec3, ang: Float): Vec3 {
        val c = cos(ang); val s = sin(ang)
        return v * c + axis.cross(v) * s + axis * (axis.dot(v) * (1 - c))
    }
}
