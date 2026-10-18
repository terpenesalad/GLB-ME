package app.glbandme.core.mesh

import app.glbandme.core.scene.Color
import app.glbandme.math.Mat4
import app.glbandme.math.MathUtil
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Additional parametric shapes (all centred, sitting around the origin, Y up). */
object Shapes {

    private fun rot(m: Mesh, ex: Float, ey: Float, ez: Float): Mesh {
        m.applyTransform(Mat4.fromTRS(Vec3(), Quat.fromEulerDeg(ex, ey, ez), Vec3(1f, 1f, 1f)))
        return m
    }

    fun roundedBox(w: Float, h: Float, d: Float, radius: Float, res: Int): Mesh {
        val r = radius.coerceIn(0f, min(w, min(h, d)) / 2f * 0.999f)
        val hx = w / 2; val hy = h / 2; val hz = d / 2
        val ix = hx - r; val iy = hy - r; val iz = hz - r
        val m = Primitives.box(w, h, d, max(2, res))
        if (r <= 0f) return m
        // push every vertex to "inner box + radius" in the direction away from the inner box
        val p = m.positions
        for (v in 0 until m.vertexCount) {
            val x = p[v * 3]; val y = p[v * 3 + 1]; val z = p[v * 3 + 2]
            // remap uniformly-spaced face samples so more of them land on the rounded band
            val qx = x.coerceIn(-ix, ix); val qy = y.coerceIn(-iy, iy); val qz = z.coerceIn(-iz, iz)
            var dx = x - qx; var dy = y - qy; var dz = z - qz
            val l = sqrt(dx * dx + dy * dy + dz * dz)
            if (l > 1e-7f) { dx /= l; dy /= l; dz /= l; p[v * 3] = qx + dx * r; p[v * 3 + 1] = qy + dy * r; p[v * 3 + 2] = qz + dz * r }
        }
        val out = Mesh(p, m.indices, null, null, m.uvs)
        return out
    }

    fun dome(radius: Float, segments: Int, rings: Int): Mesh {
        val prof = ArrayList<FloatArray>()
        val n = max(2, rings)
        for (i in 0..n) { val a = i.toFloat() / n * PI.toFloat() / 2; prof.add(floatArrayOf(radius * cos(a), radius * sin(a))) }
        prof.last()[0] = 0f
        val base = listOf(floatArrayOf(0f, 0f), floatArrayOf(radius, 0f))
        return Primitives.lathe(listOf(base, prof), segments)
    }

    fun prism(radius: Float, height: Float, sides: Int): Mesh =
        MeshOps.flatShaded(Primitives.cylinder(radius, radius, height, max(3, sides), 1))

    fun wedge(w: Float, h: Float, d: Float): Mesh {
        // right-triangle profile in the z/y plane, extruded along x
        val c = floatArrayOf(-d / 2, -h / 2, d / 2, -h / 2, -d / 2, h / 2)
        val m = Extruder.extrude(listOf(c), w, 0f) ?: Primitives.box(w, h, d)
        return rot(m, 0f, -90f, 0f)
    }

    fun starOutline(points: Int, outer: Float, inner: Float): FloatArray {
        val n = max(3, points)
        val out = FloatArray(n * 4)
        for (i in 0 until n * 2) {
            val a = PI.toFloat() / 2 + i * PI.toFloat() / n
            val r = if (i % 2 == 0) outer else inner
            out[i * 2] = r * cos(a); out[i * 2 + 1] = r * sin(a)
        }
        return out
    }

    fun star(points: Int, outer: Float, innerRatio: Float, depth: Float, bevel: Float): Mesh =
        Extruder.extrude(listOf(starOutline(points, outer, outer * innerRatio.coerceIn(0.1f, 0.95f))), depth, bevel) ?: Primitives.box(1f, 1f, 1f)

    fun heartOutline(size: Float, samples: Int = 96): FloatArray {
        val out = FloatArray(samples * 2)
        for (i in 0 until samples) {
            val t = i.toFloat() / samples * 2f * PI.toFloat()
            val st = sin(t); val x = 16f * st * (st * st * 0.9f + 0.1f) // no cusp at the tip (keeps bevels clean)
            val y = 13f * cos(t) - 5f * cos(2 * t) - 2f * cos(3 * t) - cos(4 * t)
            out[i * 2] = x / 34f * size; out[i * 2 + 1] = (y + 2.5f) / 34f * size
        }
        return out
    }

    fun heart(size: Float, depth: Float, bevel: Float): Mesh =
        Extruder.extrude(listOf(heartOutline(size)), depth, bevel, 4) ?: Primitives.box(1f, 1f, 1f)

    fun gear(teeth: Int, radius: Float, toothDepth: Float, depth: Float, hole: Float, bevel: Float): Mesh {
        val n = max(4, teeth)
        val pts = FloatArrayList(n * 16)
        val rRoot = radius - toothDepth
        val step = 2f * PI.toFloat() / n
        for (i in 0 until n) {
            val a0 = i * step
            // root -> rising flank -> tip -> falling flank
            val segs = listOf(0f to rRoot, 0.18f to rRoot, 0.32f to radius, 0.68f to radius, 0.82f to rRoot)
            for ((f, r) in segs) { val a = a0 + f * step; pts.add(r * cos(a), r * sin(a)) }
        }
        val contours = arrayListOf(pts.toArray())
        if (hole > 0f) {
            val hs = 32
            val h = FloatArray(hs * 2) { k -> val a = (k / 2).toFloat() / hs * 2f * PI.toFloat(); if (k % 2 == 0) hole * cos(a) else hole * sin(a) }
            contours.add(h)
        }
        return Extruder.extrude(contours, depth, bevel, 2) ?: Primitives.cylinder(radius, radius, depth, 32, 1)
    }

    fun arrow(length: Float, width: Float, depth: Float, bevel: Float): Mesh {
        val hw = width / 2; val sw = width * 0.22f; val head = min(length * 0.45f, width * 1.1f)
        val x0 = -length / 2; val x1 = length / 2 - head
        val c = floatArrayOf(x0, -sw, x1, -sw, x1, -hw, length / 2, 0f, x1, hw, x1, sw, x0, sw)
        return Extruder.extrude(listOf(c), depth, bevel, 2) ?: Primitives.box(length, width, depth)
    }

    fun spring(radius: Float, wire: Float, turns: Float, height: Float, sides: Int): Mesh {
        val samples = max(24, (turns * 48).toInt())
        val path = (0..samples).map { i ->
            val t = i.toFloat() / samples
            val a = t * turns * 2f * PI.toFloat()
            Vec3(radius * cos(a), -height / 2 + t * height, radius * sin(a))
        }
        return Sweep.tube(path, wire, sides, closed = false) ?: Primitives.torus(radius, wire, 32, 12)
    }

    fun knot(p: Int, q: Int, radius: Float, tube: Float, sides: Int): Mesh {
        val samples = 64 * max(p, q)
        val path = (0 until samples).map { i ->
            val t = i.toFloat() / samples * 2f * PI.toFloat()
            val r = cos(q * t) + 2f
            Vec3(r * cos(p * t) * radius / 3f, -sin(q * t) * radius / 3f, r * sin(p * t) * radius / 3f)
        }
        return Sweep.tube(path, tube, sides, closed = true) ?: Primitives.torus(radius, tube, 64, 12)
    }

    fun stairs(steps: Int, width: Float, stepHeight: Float, stepDepth: Float): Mesh {
        val n = max(1, steps)
        val pts = FloatArrayList(n * 4 + 4)
        val totalD = n * stepDepth; val totalH = n * stepHeight
        val z0 = -totalD / 2; val y0 = -totalH / 2
        // profile in (z, y): start at back-bottom, go along bottom to front, then climb the steps backwards
        pts.add(totalD / 2, y0)
        for (i in 0 until n) {
            val zf = totalD / 2 - i * stepDepth
            pts.add(zf, y0 + (i + 1) * stepHeight)
            pts.add(zf - stepDepth, y0 + (i + 1) * stepHeight)
        }
        pts.add(z0, y0)
        val m = Extruder.extrude(listOf(pts.toArray()), width, 0f) ?: Primitives.box(width, totalH, totalD)
        return rot(m, 0f, -90f, 0f)
    }

    fun arch(width: Float, height: Float, opening: Float, depth: Float, segments: Int): Mesh {
        val a = (opening / 2).coerceAtMost(width / 2 * 0.9f)
        val spring = (height - a - height * 0.12f).coerceAtLeast(0f)
        val pts = FloatArrayList(64)
        val y0 = -height / 2
        pts.add(-width / 2, y0); pts.add(-a, y0); pts.add(-a, y0 + spring)
        val s = max(4, segments)
        for (i in 1 until s) { val t = PI.toFloat() - i.toFloat() / s * PI.toFloat(); pts.add(a * cos(t), y0 + spring + a * sin(t)) }
        pts.add(a, y0 + spring); pts.add(a, y0); pts.add(width / 2, y0); pts.add(width / 2, height / 2); pts.add(-width / 2, height / 2)
        return Extruder.extrude(listOf(pts.toArray()), depth, 0f) ?: Primitives.box(width, height, depth)
    }

    fun octahedron(radius: Float): Mesh {
        val v = floatArrayOf(radius, 0f, 0f, -radius, 0f, 0f, 0f, radius, 0f, 0f, -radius, 0f, 0f, 0f, radius, 0f, 0f, -radius)
        val f = intArrayOf(0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5)
        return MeshOps.flatShaded(Mesh(v, f))
    }

    /** Height-field terrain with altitude colors (sand, grass, rock, snow). */
    fun terrain(size: Float, height: Float, roughness: Float, seed: Int, res: Int): Mesh {
        val noise = Noise(seed)
        val m = Primitives.plane(size, size, max(4, res))
        val p = m.positions
        val freq = 1.6f / size
        val oct = (3 + roughness * 4).toInt().coerceIn(2, 7)
        for (v in 0 until m.vertexCount) {
            val x = p[v * 3]; val z = p[v * 3 + 2]
            val e = noise.fbm(x * freq * 2f, 0.37f, z * freq * 2f, oct, 2f, 0.45f + roughness * 0.2f)
            // gentle falloff near the border so it reads as a "tile"
            val edge = MathUtil.smoothstep(size * 0.5f, size * 0.38f, max(abs(x), abs(z)))
            p[v * 3 + 1] = (e * 0.5f + 0.5f).pow(1.4f) * height * (0.35f + 0.65f * edge)
        }
        val out = Mesh(p, m.indices, null, null, m.uvs)
        val c = out.ensureColors()
        val pos = out.positions
        for (v in 0 until out.vertexCount) {
            val t = (pos[v * 3 + 1] / max(height, 1e-6f)).coerceIn(0f, 1f)
            val hex = when {
                t < 0.12f -> 0xD9C79A
                t < 0.45f -> 0x5E9E3E
                t < 0.75f -> 0x7B7468
                else -> 0xF2F4F7
            }
            val lin = Color.hexToLinear(hex)
            c[v * 4] = lin[0]; c[v * 4 + 1] = lin[1]; c[v * 4 + 2] = lin[2]; c[v * 4 + 3] = 1f
        }
        out.markColorsDirty()
        return out
    }

    @Suppress("unused")
    private fun ang(x: Float, y: Float) = atan2(y, x)
}
