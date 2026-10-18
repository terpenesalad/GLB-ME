package app.glbandme.math

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Unit quaternion (x, y, z, w) as used by glTF. */
class Quat(@JvmField var x: Float = 0f, @JvmField var y: Float = 0f, @JvmField var z: Float = 0f, @JvmField var w: Float = 1f) {

    fun set(x: Float, y: Float, z: Float, w: Float): Quat { this.x = x; this.y = y; this.z = z; this.w = w; return this }
    fun set(q: Quat) = set(q.x, q.y, q.z, q.w)
    fun copy() = Quat(x, y, z, w)
    fun identity() = set(0f, 0f, 0f, 1f)

    fun normalize(): Quat {
        val l = sqrt(x * x + y * y + z * z + w * w)
        if (l > 1e-12f) { x /= l; y /= l; z /= l; w /= l } else identity()
        return this
    }

    /** this * o (apply o first, then this). */
    operator fun times(o: Quat) = Quat(
        w * o.x + x * o.w + y * o.z - z * o.y,
        w * o.y - x * o.z + y * o.w + z * o.x,
        w * o.z + x * o.y - y * o.x + z * o.w,
        w * o.w - x * o.x - y * o.y - z * o.z
    )

    fun conjugate() = Quat(-x, -y, -z, w)

    fun rotate(v: Vec3): Vec3 {
        // v' = q v q*
        val tx = 2f * (y * v.z - z * v.y)
        val ty = 2f * (z * v.x - x * v.z)
        val tz = 2f * (x * v.y - y * v.x)
        return Vec3(
            v.x + w * tx + (y * tz - z * ty),
            v.y + w * ty + (z * tx - x * tz),
            v.z + w * tz + (x * ty - y * tx)
        )
    }

    fun setFromRotationMatrix(
        m00: Float, m01: Float, m02: Float,
        m10: Float, m11: Float, m12: Float,
        m20: Float, m21: Float, m22: Float
    ): Quat {
        val tr = m00 + m11 + m22
        if (tr > 0) {
            val s = 0.5f / sqrt(tr + 1f)
            w = 0.25f / s
            x = (m21 - m12) * s
            y = (m02 - m20) * s
            z = (m10 - m01) * s
        } else if (m00 > m11 && m00 > m22) {
            val s = 2f * sqrt(1f + m00 - m11 - m22)
            w = (m21 - m12) / s
            x = 0.25f * s
            y = (m01 + m10) / s
            z = (m02 + m20) / s
        } else if (m11 > m22) {
            val s = 2f * sqrt(1f + m11 - m00 - m22)
            w = (m02 - m20) / s
            x = (m01 + m10) / s
            y = 0.25f * s
            z = (m12 + m21) / s
        } else {
            val s = 2f * sqrt(1f + m22 - m00 - m11)
            w = (m10 - m01) / s
            x = (m02 + m20) / s
            y = (m12 + m21) / s
            z = 0.25f * s
        }
        return normalize()
    }

    /** Euler angles in degrees, XYZ order (applied X then Y then Z). */
    fun toEulerDeg(): Vec3 {
        // rotation matrix elements
        val m00 = 1 - 2 * (y * y + z * z)
        val m10 = 2 * (x * y + w * z)
        val m20 = 2 * (x * z - w * y)
        val m21 = 2 * (y * z + w * x)
        val m22 = 1 - 2 * (x * x + y * y)
        val m11 = 1 - 2 * (x * x + z * z)
        val m12 = 2 * (y * z - w * x)
        val ey = asin(MathUtil.clamp(-m20, -1f, 1f))
        val ex: Float
        val ez: Float
        if (abs(m20) < 0.99999f) {
            ex = atan2(m21, m22)
            ez = atan2(m10, m00)
        } else {
            ex = atan2(-m12, m11)
            ez = 0f
        }
        return Vec3(ex / MathUtil.DEG, ey / MathUtil.DEG, ez / MathUtil.DEG)
    }

    companion object {
        fun axisAngle(axis: Vec3, rad: Float): Quat {
            val a = axis.normalized()
            val s = sin(rad / 2f)
            return Quat(a.x * s, a.y * s, a.z * s, cos(rad / 2f)).normalize()
        }

        /** XYZ euler degrees -> quaternion (R = Rz * Ry * Rx). */
        fun fromEulerDeg(ex: Float, ey: Float, ez: Float): Quat {
            val qx = axisAngle(Vec3(1f, 0f, 0f), ex * MathUtil.DEG)
            val qy = axisAngle(Vec3(0f, 1f, 0f), ey * MathUtil.DEG)
            val qz = axisAngle(Vec3(0f, 0f, 1f), ez * MathUtil.DEG)
            return (qz * (qy * qx)).normalize()
        }

        fun slerp(a: Quat, b: Quat, t: Float): Quat {
            var bx = b.x; var by = b.y; var bz = b.z; var bw = b.w
            var cosom = a.x * bx + a.y * by + a.z * bz + a.w * bw
            if (cosom < 0f) { cosom = -cosom; bx = -bx; by = -by; bz = -bz; bw = -bw }
            val s0: Float
            val s1: Float
            if (1f - cosom > 1e-5f) {
                val omega = acos(MathUtil.clamp(cosom, -1f, 1f))
                val sinom = sin(omega)
                s0 = sin((1f - t) * omega) / sinom
                s1 = sin(t * omega) / sinom
            } else {
                s0 = 1f - t; s1 = t
            }
            return Quat(s0 * a.x + s1 * bx, s0 * a.y + s1 * by, s0 * a.z + s1 * bz, s0 * a.w + s1 * bw).normalize()
        }

        /** Shortest rotation taking unit vector a onto unit vector b. */
        fun fromTo(a: Vec3, b: Vec3): Quat {
            val d = a.dot(b)
            if (d < -0.99999f) {
                var axis = Vec3(1f, 0f, 0f).cross(a)
                if (axis.lengthSq() < 1e-6f) axis = Vec3(0f, 1f, 0f).cross(a)
                return axisAngle(axis, MathUtil.PI)
            }
            val c = a.cross(b)
            return Quat(c.x, c.y, c.z, 1f + d).normalize()
        }
    }

    override fun toString() = "Quat($x, $y, $z, $w)"
}
