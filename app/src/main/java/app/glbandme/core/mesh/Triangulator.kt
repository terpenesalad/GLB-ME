package app.glbandme.core.mesh

import kotlin.math.abs

/**
 * Polygon triangulation with holes (ear clipping + hole bridging, after D. Eberly).
 * Contours are flat xy arrays; nesting is detected automatically (even-odd).
 */
object Triangulator {

    class Result(val positions: FloatArray, val indices: IntArray, val contours: List<FloatArray>)

    fun signedArea(c: FloatArray): Float {
        var a = 0f
        val n = c.size / 2
        for (i in 0 until n) {
            val j = (i + 1) % n
            a += c[i * 2] * c[j * 2 + 1] - c[j * 2] * c[i * 2 + 1]
        }
        return a / 2f
    }

    private fun reversed(c: FloatArray): FloatArray {
        val n = c.size / 2
        return FloatArray(c.size) { i -> val p = n - 1 - i / 2; c[p * 2 + (i % 2)] }
    }

    fun pointInPolygon(x: Float, y: Float, c: FloatArray): Boolean {
        var inside = false
        val n = c.size / 2
        var j = n - 1
        for (i in 0 until n) {
            val xi = c[i * 2]; val yi = c[i * 2 + 1]; val xj = c[j * 2]; val yj = c[j * 2 + 1]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
            j = i
        }
        return inside
    }

    /** Triangulate a set of (possibly nested) contours. Output contours are oriented: outers CCW, holes CW. */
    fun triangulate(input: List<FloatArray>): Result {
        val contours = input.filter { it.size >= 6 && abs(signedArea(it)) > 1e-10f }.map { dedupe(it) }.filter { it.size >= 6 }
        val depth = IntArray(contours.size)
        for (i in contours.indices) {
            val px = contours[i][0]; val py = contours[i][1]
            for (j in contours.indices) if (i != j && pointInPolygon(px, py, contours[j])) depth[i]++
        }
        val oriented = contours.mapIndexed { i, c ->
            val ccw = signedArea(c) > 0
            val wantCcw = depth[i] % 2 == 0
            if (ccw == wantCcw) c else reversed(c)
        }
        val pos = FloatArrayList(1024)
        val idx = IntArrayList(1024)
        for (i in oriented.indices) {
            if (depth[i] % 2 != 0) continue
            val outer = oriented[i]
            val holes = oriented.indices.filter { j ->
                depth[j] == depth[i] + 1 && pointInPolygon(oriented[j][0], oriented[j][1], outer)
            }.map { oriented[it] }
            val merged = bridgeHoles(outer, holes)
            val base = pos.size / 2
            for (k in merged.indices) pos.add(merged[k])
            earClip(merged, base, idx)
        }
        return Result(pos.toArray(), idx.toArray(), oriented)
    }

    private fun dedupe(c: FloatArray): FloatArray {
        val out = FloatArrayList(c.size)
        val n = c.size / 2
        for (i in 0 until n) {
            val x = c[i * 2]; val y = c[i * 2 + 1]
            if (out.size >= 2) {
                val px = out[out.size - 2]; val py = out[out.size - 1]
                if (abs(px - x) < 1e-7f && abs(py - y) < 1e-7f) continue
            }
            out.add(x, y)
        }
        if (out.size >= 4 && abs(out[0] - out[out.size - 2]) < 1e-7f && abs(out[1] - out[out.size - 1]) < 1e-7f) {
            return out.toArray().copyOf(out.size - 2)
        }
        return out.toArray()
    }

    private fun bridgeHoles(outer: FloatArray, holes: List<FloatArray>): FloatArray {
        var poly = outer
        val sorted = holes.sortedByDescending { h -> (0 until h.size / 2).maxOf { h[it * 2] } }
        for (h in sorted) poly = bridge(poly, h)
        return poly
    }

    /** Connect hole into polygon via a mutually visible vertex pair. */
    private fun bridge(poly: FloatArray, hole: FloatArray): FloatArray {
        val hn = hole.size / 2
        var mi = 0
        for (i in 1 until hn) if (hole[i * 2] > hole[mi * 2]) mi = i
        val mx = hole[mi * 2]; val my = hole[mi * 2 + 1]
        val pn = poly.size / 2
        var bestX = Float.MAX_VALUE; var bestEdge = -1
        for (i in 0 until pn) {
            val j = (i + 1) % pn
            val ax = poly[i * 2]; val ay = poly[i * 2 + 1]; val bx = poly[j * 2]; val by = poly[j * 2 + 1]
            if ((ay > my) == (by > my) && ay != my && by != my) continue
            if (ay == by) continue
            val t = (my - ay) / (by - ay)
            if (t < 0f || t > 1f) continue
            val x = ax + t * (bx - ax)
            if (x >= mx && x < bestX) { bestX = x; bestEdge = i }
        }
        var vis: Int
        if (bestEdge < 0) {
            // fallback: nearest vertex
            vis = 0; var bd = Float.MAX_VALUE
            for (i in 0 until pn) {
                val dx = poly[i * 2] - mx; val dy = poly[i * 2 + 1] - my
                val d = dx * dx + dy * dy
                if (d < bd) { bd = d; vis = i }
            }
        } else {
            val j = (bestEdge + 1) % pn
            vis = if (poly[bestEdge * 2] > poly[j * 2]) bestEdge else j
            val px = poly[vis * 2]; val py = poly[vis * 2 + 1]
            // check reflex vertices inside triangle (M, I, P); choose the one with smallest angle
            var bestAngle = Float.MAX_VALUE
            val ix = bestX; val iy = my
            for (i in 0 until pn) {
                if (i == vis) continue
                val qx = poly[i * 2]; val qy = poly[i * 2 + 1]
                if (qx < mx) continue
                if (!pointInTri(qx, qy, mx, my, ix, iy, px, py)) continue
                val prev = (i - 1 + pn) % pn; val next = (i + 1) % pn
                if (!isReflex(poly, prev, i, next)) continue
                val ang = abs(qy - my) / (qx - mx + 1e-9f)
                if (ang < bestAngle) { bestAngle = ang; vis = i }
            }
        }
        val out = FloatArrayList(poly.size + hole.size + 4)
        for (i in 0..vis) out.add(poly[i * 2], poly[i * 2 + 1])
        for (k in 0..hn) { val i = (mi + k) % hn; out.add(hole[i * 2], hole[i * 2 + 1]) }
        out.add(poly[vis * 2], poly[vis * 2 + 1])
        for (i in vis + 1 until pn) out.add(poly[i * 2], poly[i * 2 + 1])
        return out.toArray()
    }

    private fun isReflex(p: FloatArray, a: Int, b: Int, c: Int): Boolean =
        cross(p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1], p[c * 2], p[c * 2 + 1]) <= 0f

    private fun cross(ax: Float, ay: Float, bx: Float, by: Float, cx: Float, cy: Float) =
        (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

    private fun pointInTri(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float, cx: Float, cy: Float): Boolean {
        val d1 = cross(px, py, ax, ay, bx, by)
        val d2 = cross(px, py, bx, by, cx, cy)
        val d3 = cross(px, py, cx, cy, ax, ay)
        val neg = d1 < 0 || d2 < 0 || d3 < 0
        val pos = d1 > 0 || d2 > 0 || d3 > 0
        return !(neg && pos)
    }

    private fun earClip(poly: FloatArray, base: Int, out: IntArrayList) {
        val n = poly.size / 2
        if (n < 3) return
        val prev = IntArray(n) { (it - 1 + n) % n }
        val next = IntArray(n) { (it + 1) % n }
        var remaining = n
        var cur = 0
        var guard = 0
        while (remaining > 3 && guard < n * n + 10) {
            guard++
            val a = prev[cur]; val b = cur; val c = next[cur]
            val ax = poly[a * 2]; val ay = poly[a * 2 + 1]
            val bx = poly[b * 2]; val by = poly[b * 2 + 1]
            val cx = poly[c * 2]; val cy = poly[c * 2 + 1]
            var ear = cross(ax, ay, bx, by, cx, cy) > 1e-12f
            if (ear) {
                var p = next[c]
                while (p != a) {
                    val px = poly[p * 2]; val py = poly[p * 2 + 1]
                    val samePt = (px == ax && py == ay) || (px == bx && py == by) || (px == cx && py == cy)
                    if (!samePt && pointInTri(px, py, ax, ay, bx, by, cx, cy)) { ear = false; break }
                    p = next[p]
                }
            }
            if (ear) {
                out.add(base + a); out.add(base + b); out.add(base + c)
                next[a] = c; prev[c] = a
                remaining--
                cur = c
                guard = 0
            } else {
                cur = next[cur]
                if (guard > remaining * 2) {
                    // no ear found (numerical trouble): clip anyway to guarantee progress
                    out.add(base + a); out.add(base + b); out.add(base + c)
                    next[a] = c; prev[c] = a
                    remaining--
                    cur = c
                    guard = 0
                }
            }
        }
        if (remaining == 3) {
            val a = prev[cur]; val b = cur; val c = next[cur]
            out.add(base + a); out.add(base + b); out.add(base + c)
        }
    }
}
