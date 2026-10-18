package app.glbandme.core.mesh

import app.glbandme.math.Vec3
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Mesh decals: the part of a target surface inside an oriented box is clipped out, lifted a hair
 * off the surface and given 0..1 UVs across the box, so an image (sticker, logo, label) wraps
 * over curved geometry and exports as plain glTF.
 */
object Decal {

    class Frame(val center: Vec3, val normal: Vec3, val right: Vec3, val up: Vec3)

    /** Build a decal frame from a surface hit. [upHint] is usually world +Y in local space. */
    fun frame(center: Vec3, normal: Vec3, upHint: Vec3, rotationDeg: Float): Frame {
        val n = normal.normalized()
        var hint = upHint.normalized()
        if (abs(hint.dot(n)) > 0.95f) hint = if (abs(n.z) < 0.9f) Vec3(0f, 0f, 1f) else Vec3(1f, 0f, 0f)
        var right = hint.cross(n).normalize()
        var up = n.cross(right).normalize()
        if (rotationDeg != 0f) {
            val a = Math.toRadians(rotationDeg.toDouble()).toFloat()
            val c = cos(a); val s = sin(a)
            val r2 = right * c + up * s
            val u2 = up * c - right * s
            right = r2; up = u2
        }
        return Frame(center.copy(), n, right, up)
    }

    /**
     * @param width,height decal size in the target's local units
     * @param depth how far in front of / behind the hit the projection reaches
     * @param lift distance the result is pushed off the surface (avoids z-fighting)
     */
    fun build(target: Mesh, f: Frame, width: Float, height: Float, depth: Float, lift: Float, facing: Float = 0.15f): Mesh? {
        val p = target.positions
        val nrm = target.normals
        val idx = target.indices
        val hw = width / 2f; val hh = height / 2f
        val out = FloatArrayList(1024)
        val outN = FloatArrayList(1024)
        val outUv = FloatArrayList(1024)
        val tris = IntArrayList(1024)
        // polygon buffers: x y z (decal space) nx ny nz (local)
        var poly = ArrayList<FloatArray>(12)
        var next = ArrayList<FloatArray>(12)
        val cx = f.center.x; val cy = f.center.y; val cz = f.center.z
        for (t in 0 until target.triangleCount) {
            val a = idx[t * 3]; val b = idx[t * 3 + 1]; val c = idx[t * 3 + 2]
            // geometric facing test
            val e1x = p[b * 3] - p[a * 3]; val e1y = p[b * 3 + 1] - p[a * 3 + 1]; val e1z = p[b * 3 + 2] - p[a * 3 + 2]
            val e2x = p[c * 3] - p[a * 3]; val e2y = p[c * 3 + 1] - p[a * 3 + 1]; val e2z = p[c * 3 + 2] - p[a * 3 + 2]
            val gx = e1y * e2z - e1z * e2y; val gy = e1z * e2x - e1x * e2z; val gz = e1x * e2y - e1y * e2x
            val gl = sqrt(gx * gx + gy * gy + gz * gz)
            if (gl < 1e-12f) continue
            if ((gx * f.normal.x + gy * f.normal.y + gz * f.normal.z) / gl < facing) continue
            poly.clear()
            var anyInside = false
            var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxY = -Float.MAX_VALUE; var minZ = Float.MAX_VALUE; var maxZ = -Float.MAX_VALUE
            for (v in intArrayOf(a, b, c)) {
                val dx = p[v * 3] - cx; val dy = p[v * 3 + 1] - cy; val dz = p[v * 3 + 2] - cz
                val x = dx * f.right.x + dy * f.right.y + dz * f.right.z
                val y = dx * f.up.x + dy * f.up.y + dz * f.up.z
                val z = dx * f.normal.x + dy * f.normal.y + dz * f.normal.z
                minX = minOf(minX, x); maxX = maxOf(maxX, x); minY = minOf(minY, y); maxY = maxOf(maxY, y); minZ = minOf(minZ, z); maxZ = maxOf(maxZ, z)
                poly.add(floatArrayOf(x, y, z, nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]))
            }
            if (maxX < -hw || minX > hw || maxY < -hh || minY > hh || maxZ < -depth || minZ > depth) continue
            anyInside = true
            // clip against the 6 box planes
            for (plane in 0 until 6) {
                val axis = plane / 2
                val sign = if (plane % 2 == 0) 1f else -1f
                val lim = when (axis) { 0 -> hw; 1 -> hh; else -> depth }
                next.clear()
                if (poly.isEmpty()) break
                for (i in poly.indices) {
                    val cur = poly[i]; val prev = poly[(i + poly.size - 1) % poly.size]
                    val dc = lim - sign * cur[axis]; val dp = lim - sign * prev[axis]
                    if (dc >= 0f) {
                        if (dp < 0f) next.add(lerp(prev, cur, dp / (dp - dc)))
                        next.add(cur)
                    } else if (dp >= 0f) next.add(lerp(prev, cur, dp / (dp - dc)))
                }
                val tmp = poly; poly = next; next = tmp
            }
            if (!anyInside || poly.size < 3) continue
            val base = out.size / 3
            for (q in poly) {
                val ln = sqrt(q[3] * q[3] + q[4] * q[4] + q[5] * q[5]).let { if (it < 1e-9f) 1f else it }
                val nx = q[3] / ln; val ny = q[4] / ln; val nz = q[5] / ln
                val lx = cx + f.right.x * q[0] + f.up.x * q[1] + f.normal.x * q[2] + nx * lift
                val ly = cy + f.right.y * q[0] + f.up.y * q[1] + f.normal.y * q[2] + ny * lift
                val lz = cz + f.right.z * q[0] + f.up.z * q[1] + f.normal.z * q[2] + nz * lift
                out.add(lx, ly, lz); outN.add(nx, ny, nz)
                outUv.add(q[0] / width + 0.5f, 0.5f - q[1] / height)
            }
            for (i in 1 until poly.size - 1) { tris.add(base); tris.add(base + i); tris.add(base + i + 1) }
        }
        if (tris.size == 0) return null
        return Mesh(out.toArray(), tris.toArray(), outN.toArray(), null, outUv.toArray())
    }

    private fun lerp(a: FloatArray, b: FloatArray, t: Float) = FloatArray(6) { i -> a[i] + (b[i] - a[i]) * t }

    /** Rough size suggestion: a quarter of the target's largest dimension. */
    fun suggestedSize(target: Mesh): Float {
        val (mn, mx) = target.bounds()
        return max(mx.x - mn.x, max(mx.y - mn.y, mx.z - mn.z)) * 0.35f
    }
}
