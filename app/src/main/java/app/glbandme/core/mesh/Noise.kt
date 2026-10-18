package app.glbandme.core.mesh

import kotlin.math.floor

/** Deterministic 3D gradient noise + fBm (used for procedural templates). */
class Noise(seed: Int = 1337) {
    private val perm = IntArray(512)

    init {
        val p = IntArray(256) { it }
        var s = seed.toLong() and 0xffffffffL
        for (i in 255 downTo 1) {
            s = (s * 1103515245L + 12345L) and 0x7fffffffL
            val j = (s % (i + 1)).toInt()
            val t = p[i]; p[i] = p[j]; p[j] = t
        }
        for (i in 0 until 512) perm[i] = p[i and 255]
    }

    private fun fade(t: Float) = t * t * t * (t * (t * 6 - 15) + 10)
    private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
    private fun grad(h: Int, x: Float, y: Float, z: Float): Float {
        val hh = h and 15
        val u = if (hh < 8) x else y
        val v = if (hh < 4) y else if (hh == 12 || hh == 14) x else z
        return (if (hh and 1 == 0) u else -u) + (if (hh and 2 == 0) v else -v)
    }

    /** Perlin noise in roughly [-1, 1]. */
    fun noise(x: Float, y: Float, z: Float): Float {
        val xi = floor(x).toInt(); val yi = floor(y).toInt(); val zi = floor(z).toInt()
        val X = xi and 255; val Y = yi and 255; val Z = zi and 255
        val xf = x - xi; val yf = y - yi; val zf = z - zi
        val u = fade(xf); val v = fade(yf); val w = fade(zf)
        val a = perm[X] + Y; val aa = perm[a] + Z; val ab = perm[a + 1] + Z
        val b = perm[X + 1] + Y; val ba = perm[b] + Z; val bb = perm[b + 1] + Z
        return lerp(
            lerp(lerp(grad(perm[aa], xf, yf, zf), grad(perm[ba], xf - 1, yf, zf), u),
                lerp(grad(perm[ab], xf, yf - 1, zf), grad(perm[bb], xf - 1, yf - 1, zf), u), v),
            lerp(lerp(grad(perm[aa + 1], xf, yf, zf - 1), grad(perm[ba + 1], xf - 1, yf, zf - 1), u),
                lerp(grad(perm[ab + 1], xf, yf - 1, zf - 1), grad(perm[bb + 1], xf - 1, yf - 1, zf - 1), u), v),
            w
        )
    }

    fun fbm(x: Float, y: Float, z: Float, octaves: Int = 4, lacunarity: Float = 2f, gain: Float = 0.5f): Float {
        var amp = 1f; var freq = 1f; var sum = 0f; var norm = 0f
        for (i in 0 until octaves) {
            sum += noise(x * freq, y * freq, z * freq) * amp
            norm += amp; amp *= gain; freq *= lacunarity
        }
        return sum / norm
    }

    /** Deterministic pseudo-random float in [0, 1). */
    fun hash(i: Int): Float {
        var x = i * 374761393 + 668265263
        x = (x xor (x ushr 13)) * 1274126177
        return ((x xor (x ushr 16)) and 0xffffff) / 16777216f
    }
}
