package app.glbandme.math

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Small mutable 3-component vector. Hot loops work on raw FloatArrays instead. */
class Vec3(@JvmField var x: Float = 0f, @JvmField var y: Float = 0f, @JvmField var z: Float = 0f) {

    fun set(x: Float, y: Float, z: Float): Vec3 { this.x = x; this.y = y; this.z = z; return this }
    fun set(o: Vec3): Vec3 = set(o.x, o.y, o.z)
    fun setFrom(a: FloatArray, i: Int): Vec3 = set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2])
    fun copy() = Vec3(x, y, z)

    operator fun plus(o: Vec3) = Vec3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Float) = Vec3(x * s, y * s, z * s)
    operator fun div(s: Float) = Vec3(x / s, y / s, z / s)
    operator fun unaryMinus() = Vec3(-x, -y, -z)
    operator fun get(i: Int): Float = when (i) { 0 -> x; 1 -> y; else -> z }
    operator fun set(i: Int, v: Float) { when (i) { 0 -> x = v; 1 -> y = v; else -> z = v } }

    fun addLocal(o: Vec3): Vec3 { x += o.x; y += o.y; z += o.z; return this }
    fun addScaled(o: Vec3, s: Float): Vec3 { x += o.x * s; y += o.y * s; z += o.z * s; return this }
    fun subLocal(o: Vec3): Vec3 { x -= o.x; y -= o.y; z -= o.z; return this }
    fun scaleLocal(s: Float): Vec3 { x *= s; y *= s; z *= s; return this }

    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    fun cross(o: Vec3) = Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun length() = sqrt(x * x + y * y + z * z)
    fun lengthSq() = x * x + y * y + z * z
    fun distance(o: Vec3): Float { val dx = x - o.x; val dy = y - o.y; val dz = z - o.z; return sqrt(dx * dx + dy * dy + dz * dz) }

    fun normalize(): Vec3 {
        val l = length()
        if (l > 1e-12f) { x /= l; y /= l; z /= l }
        return this
    }
    fun normalized() = copy().normalize()

    fun lerp(o: Vec3, t: Float) = Vec3(x + (o.x - x) * t, y + (o.y - y) * t, z + (o.z - z) * t)
    fun minLocal(o: Vec3): Vec3 { x = min(x, o.x); y = min(y, o.y); z = min(z, o.z); return this }
    fun maxLocal(o: Vec3): Vec3 { x = max(x, o.x); y = max(y, o.y); z = max(z, o.z); return this }
    fun maxComponent() = max(abs(x), max(abs(y), abs(z)))
    fun toArray() = floatArrayOf(x, y, z)

    override fun toString() = "($x, $y, $z)"
    override fun equals(other: Any?) = other is Vec3 && other.x == x && other.y == y && other.z == z
    override fun hashCode() = (x.hashCode() * 31 + y.hashCode()) * 31 + z.hashCode()

    companion object {
        val ZERO get() = Vec3(0f, 0f, 0f)
        val ONE get() = Vec3(1f, 1f, 1f)
        val UP get() = Vec3(0f, 1f, 0f)
        fun of(a: FloatArray, i: Int = 0) = Vec3(a[i], a[i + 1], a[i + 2])
    }
}

object MathUtil {
    const val PI = Math.PI.toFloat()
    const val DEG = PI / 180f
    fun clamp(v: Float, lo: Float, hi: Float) = if (v < lo) lo else if (v > hi) hi else v
    fun clamp(v: Int, lo: Int, hi: Int) = if (v < lo) lo else if (v > hi) hi else v
    fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
    fun smoothstep(e0: Float, e1: Float, x: Float): Float {
        val t = clamp((x - e0) / (e1 - e0), 0f, 1f)
        return t * t * (3f - 2f * t)
    }
}
