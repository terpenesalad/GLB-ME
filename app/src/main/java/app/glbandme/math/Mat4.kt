package app.glbandme.math

import kotlin.math.abs
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Column-major 4x4 matrix helpers operating on FloatArray(16), matching OpenGL / glTF layout.
 * m[col * 4 + row].
 */
object Mat4 {
    fun identity(out: FloatArray = FloatArray(16)): FloatArray {
        out.fill(0f); out[0] = 1f; out[5] = 1f; out[10] = 1f; out[15] = 1f; return out
    }

    fun copy(a: FloatArray) = a.copyOf()

    /** out = a * b (out may alias neither). */
    fun mul(a: FloatArray, b: FloatArray, out: FloatArray = FloatArray(16)): FloatArray {
        val r = if (out === a || out === b) FloatArray(16) else out
        for (c in 0 until 4) {
            for (row in 0 until 4) {
                var s = 0f
                for (k in 0 until 4) s += a[k * 4 + row] * b[c * 4 + k]
                r[c * 4 + row] = s
            }
        }
        if (r !== out) r.copyInto(out)
        return out
    }

    fun perspective(fovYRad: Float, aspect: Float, near: Float, far: Float, out: FloatArray = FloatArray(16)): FloatArray {
        val f = 1f / tan(fovYRad / 2f)
        out.fill(0f)
        out[0] = f / aspect
        out[5] = f
        out[10] = (far + near) / (near - far)
        out[11] = -1f
        out[14] = 2f * far * near / (near - far)
        return out
    }

    fun ortho(l: Float, r: Float, b: Float, t: Float, n: Float, f: Float, out: FloatArray = FloatArray(16)): FloatArray {
        out.fill(0f)
        out[0] = 2f / (r - l); out[5] = 2f / (t - b); out[10] = -2f / (f - n)
        out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1f
        return out
    }

    fun lookAt(eye: Vec3, target: Vec3, up: Vec3, out: FloatArray = FloatArray(16)): FloatArray {
        val f = (target - eye).normalize()
        var s = f.cross(up)
        if (s.lengthSq() < 1e-10f) s = f.cross(Vec3(0f, 0f, 1f))
        s.normalize()
        val u = s.cross(f)
        out[0] = s.x; out[4] = s.y; out[8] = s.z
        out[1] = u.x; out[5] = u.y; out[9] = u.z
        out[2] = -f.x; out[6] = -f.y; out[10] = -f.z
        out[3] = 0f; out[7] = 0f; out[11] = 0f
        out[12] = -s.dot(eye); out[13] = -u.dot(eye); out[14] = f.dot(eye); out[15] = 1f
        return out
    }

    fun invert(m: FloatArray, out: FloatArray = FloatArray(16)): Boolean {
        val inv = FloatArray(16)
        inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10]
        inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10]
        inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9]
        inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9]
        inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10]
        inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10]
        inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9]
        inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9]
        inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6]
        inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6]
        inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5]
        inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5]
        inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6]
        inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6]
        inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5]
        inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5]
        var det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
        if (abs(det) < 1e-20f) { identity(out); return false }
        det = 1f / det
        for (i in 0 until 16) out[i] = inv[i] * det
        return true
    }

    fun inverted(m: FloatArray): FloatArray { val o = FloatArray(16); invert(m, o); return o }

    /** Compose translation * rotation * scale. */
    fun fromTRS(t: Vec3, r: Quat, s: Vec3, out: FloatArray = FloatArray(16)): FloatArray {
        val x = r.x; val y = r.y; val z = r.z; val w = r.w
        val xx = x * x; val yy = y * y; val zz = z * z
        val xy = x * y; val xz = x * z; val yz = y * z
        val wx = w * x; val wy = w * y; val wz = w * z
        out[0] = (1f - 2f * (yy + zz)) * s.x
        out[1] = (2f * (xy + wz)) * s.x
        out[2] = (2f * (xz - wy)) * s.x
        out[3] = 0f
        out[4] = (2f * (xy - wz)) * s.y
        out[5] = (1f - 2f * (xx + zz)) * s.y
        out[6] = (2f * (yz + wx)) * s.y
        out[7] = 0f
        out[8] = (2f * (xz + wy)) * s.z
        out[9] = (2f * (yz - wx)) * s.z
        out[10] = (1f - 2f * (xx + yy)) * s.z
        out[11] = 0f
        out[12] = t.x; out[13] = t.y; out[14] = t.z; out[15] = 1f
        return out
    }

    /** Decompose an affine matrix into T, R, S (no shear support). */
    fun decompose(m: FloatArray, t: Vec3, r: Quat, s: Vec3) {
        t.set(m[12], m[13], m[14])
        var sx = sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2])
        val sy = sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6])
        val sz = sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10])
        val det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])
        if (det < 0) sx = -sx
        s.set(sx, sy, sz)
        val isx = if (sx != 0f) 1f / sx else 0f
        val isy = if (sy != 0f) 1f / sy else 0f
        val isz = if (sz != 0f) 1f / sz else 0f
        r.setFromRotationMatrix(
            m[0] * isx, m[4] * isy, m[8] * isz,
            m[1] * isx, m[5] * isy, m[9] * isz,
            m[2] * isx, m[6] * isy, m[10] * isz
        )
    }

    fun transformPoint(m: FloatArray, x: Float, y: Float, z: Float, out: FloatArray, o: Int = 0) {
        val w = m[3] * x + m[7] * y + m[11] * z + m[15]
        val iw = if (w != 0f) 1f / w else 1f
        out[o] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw
        out[o + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw
        out[o + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
    }

    fun transformPoint(m: FloatArray, p: Vec3): Vec3 {
        val o = FloatArray(3); transformPoint(m, p.x, p.y, p.z, o); return Vec3(o[0], o[1], o[2])
    }

    fun transformDir(m: FloatArray, d: Vec3): Vec3 = Vec3(
        m[0] * d.x + m[4] * d.y + m[8] * d.z,
        m[1] * d.x + m[5] * d.y + m[9] * d.z,
        m[2] * d.x + m[6] * d.y + m[10] * d.z
    )

    /** Projects a world point into clip space, returns w. out = (x, y, z) NDC. */
    fun project(viewProj: FloatArray, x: Float, y: Float, z: Float, out: FloatArray): Float {
        val cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12]
        val cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13]
        val cz = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14]
        val cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15]
        val iw = if (abs(cw) > 1e-9f) 1f / cw else 0f
        out[0] = cx * iw; out[1] = cy * iw; out[2] = cz * iw
        return cw
    }

    /** Inverse-transpose of upper 3x3, written as mat3 column-major. */
    fun normalMatrix(m: FloatArray, out: FloatArray = FloatArray(9)): FloatArray {
        // A[row][col] = m[col*4+row]; N = cofactor(A) / det(A)
        val a = m[0]; val b = m[4]; val c = m[8]
        val d = m[1]; val e = m[5]; val f = m[9]
        val g = m[2]; val h = m[6]; val i = m[10]
        val c00 = e * i - f * h; val c01 = -(d * i - f * g); val c02 = d * h - e * g
        val c10 = -(b * i - c * h); val c11 = a * i - c * g; val c12 = -(a * h - b * g)
        val c20 = b * f - c * e; val c21 = -(a * f - c * d); val c22 = a * e - b * d
        var det = a * c00 + b * c01 + c * c02
        if (abs(det) < 1e-20f) det = 1e-20f
        val id = 1f / det
        out[0] = c00 * id; out[1] = c10 * id; out[2] = c20 * id
        out[3] = c01 * id; out[4] = c11 * id; out[5] = c21 * id
        out[6] = c02 * id; out[7] = c12 * id; out[8] = c22 * id
        return out
    }

    fun maxScale(m: FloatArray): Float {
        val sx = sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2])
        val sy = sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6])
        val sz = sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10])
        return maxOf(sx, sy, sz)
    }
}
