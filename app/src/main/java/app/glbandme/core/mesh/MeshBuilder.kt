package app.glbandme.core.mesh

import app.glbandme.math.Mat4
import app.glbandme.math.Vec3

/** Incremental mesh construction with optional per-vertex color and uv. */
class MeshBuilder {
    val pos = FloatArrayList(1024)
    val uv = FloatArrayList(1024)
    val col = FloatArrayList(1024)
    val idx = IntArrayList(2048)
    var hasUv = false
    var hasColor = false
    var r = 1f; var g = 1f; var b = 1f; var a = 1f

    val vertexCount get() = pos.size / 3

    fun color(r: Float, g: Float, b: Float, a: Float = 1f): MeshBuilder {
        this.r = r; this.g = g; this.b = b; this.a = a; hasColor = true; return this
    }

    fun vertex(x: Float, y: Float, z: Float, u: Float = 0f, v: Float = 0f): Int {
        pos.add(x, y, z)
        uv.add(u, v)
        col.add(r, g, b, a)
        return vertexCount - 1
    }

    fun tri(a: Int, b: Int, c: Int) { idx.add(a); idx.add(b); idx.add(c) }

    /** Quad a-b-c-d counter-clockwise. */
    fun quad(a: Int, b: Int, c: Int, d: Int) { tri(a, b, c); tri(a, c, d) }

    /** Append a whole mesh, optionally transformed. */
    fun append(m: Mesh, transform: FloatArray? = null) {
        val base = vertexCount
        val tmp = FloatArray(3)
        val mc = m.colors
        val mu = m.uvs
        if (mc != null) hasColor = true
        if (mu != null) hasUv = true
        for (v in 0 until m.vertexCount) {
            if (transform != null) {
                Mat4.transformPoint(transform, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2], tmp)
                pos.add(tmp[0], tmp[1], tmp[2])
            } else pos.add(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
            if (mu != null) uv.add(mu[v * 2], mu[v * 2 + 1]) else uv.add(0f, 0f)
            if (mc != null) col.add(mc[v * 4], mc[v * 4 + 1], mc[v * 4 + 2], mc[v * 4 + 3]) else col.add(r, g, b, a)
        }
        val flip = transform != null && det3(transform) < 0
        for (t in 0 until m.triangleCount) {
            val i0 = m.indices[t * 3] + base
            val i1 = m.indices[t * 3 + 1] + base
            val i2 = m.indices[t * 3 + 2] + base
            if (flip) tri(i0, i2, i1) else tri(i0, i1, i2)
        }
    }

    fun build(): Mesh {
        return Mesh(
            pos.toArray(), idx.toArray(),
            colors = if (hasColor) col.toArray() else null,
            uvs = if (hasUv) uv.toArray() else null
        )
    }

    companion object {
        fun det3(m: FloatArray) =
            m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

        fun merge(parts: List<Pair<Mesh, FloatArray?>>): Mesh {
            val b = MeshBuilder()
            for ((m, t) in parts) b.append(m, t)
            return b.build()
        }

        fun transformOf(t: Vec3 = Vec3(), euler: Vec3 = Vec3(), s: Vec3 = Vec3(1f, 1f, 1f)): FloatArray =
            Mat4.fromTRS(t, app.glbandme.math.Quat.fromEulerDeg(euler.x, euler.y, euler.z), s)
    }
}
