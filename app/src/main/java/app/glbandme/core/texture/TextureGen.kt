package app.glbandme.core.texture

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Seamless (tileable) procedural textures. Pure Kotlin so they can be generated off the UI
 * thread and unit-tested; the Android layer only encodes the result to PNG.
 */
enum class Pattern(val label: String, val defA: Int, val defB: Int, val defScale: Float, val usesB: Boolean = true) {
    CHECKER("Checker", 0xEDEDED, 0x2B2B30, 8f),
    UV_GRID("UV Grid", 0xFFFFFF, 0x1C1C1F, 8f, usesB = false),
    BRICKS("Bricks", 0xA8553A, 0xD9D2C5, 4f),
    TILES("Tiles", 0xF2F2F2, 0x8E8E93, 4f),
    WOOD("Wood", 0xB07A45, 0x6B4226, 3f),
    MARBLE("Marble", 0xF4F1EC, 0x7A7A82, 2f),
    STONE("Stone", 0x8D8A84, 0x4B4843, 5f),
    CLOUDS("Noise", 0xFFFFFF, 0x000000, 4f),
    STRIPES("Stripes", 0xFFD60A, 0x1C1C1F, 6f),
    DOTS("Dots", 0xFF375F, 0xFFF4F6, 6f),
    HEX("Hexagons", 0x64D2FF, 0x0A3D57, 5f),
    CAMO("Camo", 0x6B7F4A, 0x3B4A2B, 3f),
    FABRIC("Fabric", 0x3A5BA0, 0x223a6e, 24f),
    CARBON("Carbon", 0x3A3A3E, 0x111113, 16f),
    METAL("Brushed", 0xC9CDD2, 0x8E9399, 1f),
    GRADIENT("Gradient", 0x5E5CE6, 0xFF375F, 1f),
    PIXELS("Pixel Grass", 0x5DBB63, 0x3E8E41, 16f),
    LAVA("Lava", 0xFF6A00, 0x1A0A05, 3f);
}

class PatternSpec(
    val pattern: Pattern,
    var colorA: Int = pattern.defA,
    var colorB: Int = pattern.defB,
    var scale: Float = pattern.defScale,
    var seed: Int = 7,
    /** 0..1, pattern-specific (mortar width, vein contrast, dot size ...) */
    var detail: Float = 0.5f,
)

class GeneratedTexture(val size: Int, val argb: IntArray, val height: FloatArray)

object TextureGen {
    private val HEX_H = sqrt(3f) / 2f

    fun generate(spec: PatternSpec, size: Int): GeneratedTexture {
        val n = size
        val px = IntArray(n * n)
        val h = FloatArray(n * n)
        val noise = TileNoise(spec.seed)
        val hOut = FloatArray(1)
        for (y in 0 until n) for (x in 0 until n) {
            px[y * n + x] = sample(spec, noise, (x + 0.5f) / n, (y + 0.5f) / n, hOut)
            h[y * n + x] = hOut[0]
        }
        return GeneratedTexture(n, px, h)
    }

    /** Integer repeat count; parity-based patterns need an even (or 4x) count to tile. */
    fun repeats(spec: PatternSpec): Int {
        val sc = max(1, spec.scale.toInt())
        return when (spec.pattern) {
            Pattern.CHECKER, Pattern.FABRIC -> (sc + 1) / 2 * 2
            Pattern.CARBON -> (sc + 3) / 4 * 4
            else -> sc
        }
    }

    /** Colour at (u, v); repeats exactly with period 1 in both directions. */
    fun sample(spec: PatternSpec, noise: TileNoise, u: Float, v: Float, heightOut: FloatArray): Int {
            val a = spec.colorA; val b = spec.colorB
            val k = spec.detail.coerceIn(0f, 1f)
            val sc = repeats(spec)
            var t: Float  // mix factor A(0) .. B(1)
            var ht: Float  // height 0..1
            var c: Int? = null
            when (spec.pattern) {
                Pattern.CHECKER -> {
                    val cx = floor(u * sc).toInt(); val cy = floor(v * sc).toInt()
                    t = if ((cx + cy) and 1 == 0) 0f else 1f; ht = 1f - t
                }
                Pattern.UV_GRID -> {
                    val cx = floor(u * sc).toInt(); val cy = floor(v * sc).toInt()
                    val hue = ((cx.mod(sc) + cy.mod(sc) * sc).toFloat() / (sc * sc)) * 0.85f
                    val base = hsv(hue, 0.55f, if ((cx.mod(sc) + cy.mod(sc)) and 1 == 0) 0.95f else 0.8f)
                    val fu = u * sc - cx; val fv = v * sc - cy
                    val line = min(min(fu, 1 - fu), min(fv, 1 - fv))
                    val sub = min(abs(fu - 0.5f), abs(fv - 0.5f))
                    c = when {
                        line < 0.03f -> b or 0xFF000000.toInt()
                        sub < 0.01f -> mix(base, a, 0.6f)
                        // a little arrow in each cell pointing to +u/+v so orientation is readable
                        fu in 0.18f..0.42f && abs(fv - 0.3f) < 0.025f -> mix(base, b, 0.7f)
                        fv in 0.18f..0.42f && abs(fu - 0.3f) < 0.025f -> mix(base, b, 0.4f)
                        else -> base
                    }
                    t = 0f; ht = if (line < 0.03f) 0f else 1f
                }
                Pattern.BRICKS -> {
                    val rows = sc * 2
                    val ry = v * rows
                    val row = floor(ry).toInt()
                    val bx = u * sc + if (row and 1 == 1) 0.5f else 0f
                    val col = floor(bx).toInt()
                    val fx = bx - col; val fy = ry - row
                    val mortar = 0.02f + k * 0.08f
                    val ex = min(fx, 1 - fx) * 2f; val ey = min(fy, 1 - fy)
                    val edge = min(ex / 2f, ey)
                    val tone = hash2(col.mod(sc), row.mod(rows), spec.seed) * 0.25f
                    val grain = noise.fbm(u * 16f, v * 16f, 16, 3) * 0.12f
                    if (edge < mortar) { t = 1f; ht = 0f } else {
                        t = 0f; ht = smooth(mortar, mortar + 0.05f, edge)
                        c = shade(a, 1f - tone + grain)
                    }
                }
                Pattern.TILES -> {
                    val fx = u * sc - floor(u * sc); val fy = v * sc - floor(v * sc)
                    val grout = 0.015f + k * 0.05f
                    val edge = min(min(fx, 1 - fx), min(fy, 1 - fy))
                    if (edge < grout) { t = 1f; ht = 0f } else {
                        t = 0f; ht = smooth(grout, grout + 0.06f, edge)
                        c = shade(a, 0.9f + 0.1f * ht)
                    }
                }
                Pattern.WOOD -> {
                    // planks: grain runs along v, rings drift slowly; a plank seam every 1/sc
                    val plank = floor(u * sc).toInt()
                    val off = hash1(plank.mod(sc), spec.seed) * 7f
                    val wob = noise.fbm(u * 4f, v * 2f + off, 4, 3, 2) * 0.9f
                    val g = u * sc * 9f + wob * 2.2f + off
                    val f = g - floor(g)
                    val ring = smooth(0.0f, 0.55f, f) * (1f - smooth(0.7f, 1f, f))
                    val streak = noise.fbm(u * 64f, v * 3f, 64, 3, 3) * 0.5f + 0.5f
                    val fu = u * sc - plank
                    val seam = min(fu, 1f - fu)
                    t = (ring * 0.65f + streak * 0.35f).coerceIn(0f, 1f) * (0.7f + k * 0.3f)
                    if (seam < 0.012f) { t = 1f; ht = 0f } else ht = 1f - t * 0.25f
                    c = shade(mix(a, b, t), 0.92f + hash1(plank.mod(sc) + 11, spec.seed) * 0.16f)
                }
                Pattern.MARBLE -> {
                    val turb = noise.turbulence(u * 2f, v * 2f, 2, 5)
                    val vein = abs(sin((u * sc + v * max(1, sc / 2) + turb * (2f + k * 2.5f)) * PI.toFloat()))
                    val cloud = noise.fbm(u * 3f, v * 3f, 3, 4) * 0.5f + 0.5f
                    val line = (1f - vein).let { val q = it * it; q * q * q }
                    t = (line * 0.9f + cloud * 0.12f).coerceIn(0f, 1f); ht = 1f - line * 0.3f
                }
                Pattern.STONE -> {
                    val (d1, d2, id) = noise.voronoi(u * sc, v * sc, sc)
                    val gap = d2 - d1
                    val crack = 0.04f + k * 0.08f
                    val tone = hash1(id, spec.seed) * 0.35f
                    val grain = noise.fbm(u * 24f, v * 24f, 24, 3) * 0.15f
                    if (gap < crack) { t = 1f; ht = 0f } else {
                        t = (tone + grain).coerceIn(0f, 1f) * 0.6f
                        ht = smooth(crack, crack + 0.15f, gap) * (0.8f + 0.2f * (1 - d1))
                    }
                }
                Pattern.CLOUDS -> {
                    t = (noise.fbm(u * sc, v * sc, sc, 2 + (k * 5).toInt()) * 0.5f + 0.5f).coerceIn(0f, 1f); ht = 1f - t
                }
                Pattern.STRIPES -> {
                    val f = (u + v) * sc - floor((u + v) * sc)
                    val w = 0.2f + k * 0.6f
                    t = if (f < w) 0f else 1f; ht = 1f - t
                }
                Pattern.DOTS -> {
                    val gx = u * sc; val gy = v * sc
                    val fx = gx - floor(gx) - 0.5f; val fy = gy - floor(gy) - 0.5f
                    val r = 0.15f + k * 0.3f
                    val d = sqrt(fx * fx + fy * fy)
                    t = smooth(r - 0.02f, r + 0.02f, d); ht = 1f - t
                }
                Pattern.HEX -> {
                    val rows = max(2, 2 * Math.round(sc / (2f * HEX_H)))
                    val (edge, _) = hexEdge(u * sc, v * rows * HEX_H, sc)
                    val bw = 0.04f + k * 0.12f
                    t = if (edge < bw) 1f else 0f; ht = smooth(bw, bw + 0.08f, edge)
                }
                Pattern.CAMO -> {
                    val n1 = noise.fbm(u * sc, v * sc, sc, 3)
                    val n2 = noise.fbm(u * sc + 5.3f, v * sc + 1.7f, sc, 3)
                    c = when {
                        n1 > 0.15f -> b
                        n2 > 0.1f -> mix(a, 0xD8C9A3, 0.55f)
                        n2 < -0.25f -> 0x2A2A22
                        else -> a
                    } or 0xFF000000.toInt()
                    t = 0f; ht = if (n1 > 0.15f) 0.6f else 1f
                }
                Pattern.FABRIC -> {
                    val gx = u * sc; val gy = v * sc
                    val cx = floor(gx).toInt(); val cy = floor(gy).toInt()
                    val fx = gx - cx; val fy = gy - cy
                    val over = (cx + cy) and 1 == 0
                    val thread = if (over) sin(fx * PI.toFloat()) else sin(fy * PI.toFloat())
                    t = if (over) 0.25f else 0.75f
                    ht = thread * 0.8f + 0.2f
                    c = shade(mix(a, b, t), 0.7f + 0.3f * thread + noise.fbm(u * 64f, v * 64f, 64, 2) * 0.05f)
                }
                Pattern.CARBON -> {
                    val gx = u * sc; val gy = v * sc
                    val cx = floor(gx).toInt(); val cy = floor(gy).toInt()
                    val fx = gx - cx; val fy = gy - cy
                    val dir = ((cx shr 1) + (cy shr 1)) and 1 == 0
                    val ph = if (dir) fx else fy
                    val sheen = sin(ph * PI.toFloat())
                    t = if (dir) 0.2f else 0.8f; ht = sheen
                    c = shade(mix(a, b, t), 0.6f + 0.5f * sheen)
                }
                Pattern.METAL -> {
                    val st = noise.fbm(u * 2f, v * 96f, 2, 3, 96) * 0.5f + 0.5f
                    t = st; ht = 1f - st * 0.2f
                }
                Pattern.GRADIENT -> { t = v; ht = 1f }
                Pattern.PIXELS -> {
                    val gx = floor(u * sc).toInt(); val gy = floor(v * sc).toInt()
                    val r = hash2(gx.mod(sc), gy.mod(sc), spec.seed)
                    t = if (r > 0.75f) 1f else if (r > 0.45f) 0.5f else 0f
                    c = shade(mix(a, b, t), 0.95f + r * 0.1f)
                    ht = 1f - t * 0.4f
                }
                Pattern.LAVA -> {
                    val (d1, d2, _) = noise.voronoi(u * sc, v * sc, sc)
                    val crack = 1f - smooth(0.0f, 0.12f + k * 0.15f, d2 - d1)
                    val glow = crack + noise.fbm(u * 8f, v * 8f, 8, 3) * 0.2f
                    t = 1f - glow.coerceIn(0f, 1f); ht = t
                    c = mix(b, a, glow.coerceIn(0f, 1f))
                }
            }
            heightOut[0] = ht
            return (c ?: mix(a, b, t)) or 0xFF000000.toInt()
    }

    /**
     * Tangent-space normal map from a height field (glTF/OpenGL convention, green up).
     * The field is treated as tiling so the normal map is seamless too.
     */
    fun normalMap(height: FloatArray, size: Int, strength: Float = 2f): IntArray {
        val n = size
        val out = IntArray(n * n)
        val s = strength * n / 256f
        for (y in 0 until n) for (x in 0 until n) {
            fun hh(xx: Int, yy: Int) = height[yy.mod(n) * n + xx.mod(n)]
            val dx = (hh(x + 1, y - 1) + 2 * hh(x + 1, y) + hh(x + 1, y + 1) - hh(x - 1, y - 1) - 2 * hh(x - 1, y) - hh(x - 1, y + 1)) / 8f
            val dy = (hh(x - 1, y + 1) + 2 * hh(x, y + 1) + hh(x + 1, y + 1) - hh(x - 1, y - 1) - 2 * hh(x, y - 1) - hh(x + 1, y - 1)) / 8f
            var nx = -dx * s; var ny = dy * s; var nz = 1f
            val l = sqrt(nx * nx + ny * ny + nz * nz)
            nx /= l; ny /= l; nz /= l
            val r = ((nx * 0.5f + 0.5f) * 255f + 0.5f).toInt().coerceIn(0, 255)
            val g = ((ny * 0.5f + 0.5f) * 255f + 0.5f).toInt().coerceIn(0, 255)
            val b = ((nz * 0.5f + 0.5f) * 255f + 0.5f).toInt().coerceIn(0, 255)
            out[y * n + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        return out
    }

    /** Height from luminance (for "normal map from this image"). */
    fun luminance(argb: IntArray): FloatArray = FloatArray(argb.size) { i ->
        val c = argb[i]
        (((c shr 16) and 255) * 0.299f + ((c shr 8) and 255) * 0.587f + (c and 255) * 0.114f) / 255f
    }

    /**
     * glTF metallic-roughness texture (G = roughness, B = metallic) from a height field:
     * low areas (mortar, cracks) get rougher.
     */
    fun roughnessMap(height: FloatArray, baseRough: Float, metallic: Float): IntArray = IntArray(height.size) { i ->
        val r = ((baseRough + (1f - height[i]) * 0.25f).coerceIn(0f, 1f) * 255f).toInt()
        val m = (metallic.coerceIn(0f, 1f) * 255f).toInt()
        (0xFF shl 24) or (255 shl 16) or (r shl 8) or m
    }

    // -------------------------------------------------------------------------------------------
    private fun smooth(e0: Float, e1: Float, x: Float): Float {
        val t = ((x - e0) / (e1 - e0)).coerceIn(0f, 1f)
        return t * t * (3 - 2 * t)
    }

    fun mix(a: Int, b: Int, t: Float): Int {
        val tt = t.coerceIn(0f, 1f)
        val r = (((a shr 16) and 255) * (1 - tt) + ((b shr 16) and 255) * tt).toInt()
        val g = (((a shr 8) and 255) * (1 - tt) + ((b shr 8) and 255) * tt).toInt()
        val bl = ((a and 255) * (1 - tt) + (b and 255) * tt).toInt()
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or bl
    }

    private fun shade(c: Int, f: Float): Int {
        val r = (((c shr 16) and 255) * f).toInt().coerceIn(0, 255)
        val g = (((c shr 8) and 255) * f).toInt().coerceIn(0, 255)
        val b = ((c and 255) * f).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    private fun hsv(h: Float, s: Float, v: Float): Int {
        val hh = (h - floor(h)) * 6f
        val i = hh.toInt(); val f = hh - i
        val p = v * (1 - s); val q = v * (1 - s * f); val t = v * (1 - s * (1 - f))
        val (r, g, b) = when (i % 6) { 0 -> Triple(v, t, p); 1 -> Triple(q, v, p); 2 -> Triple(p, v, t); 3 -> Triple(p, q, v); 4 -> Triple(t, p, v); else -> Triple(v, p, q) }
        return (0xFF shl 24) or ((r * 255).toInt() shl 16) or ((g * 255).toInt() shl 8) or (b * 255).toInt()
    }

    private fun hash1(i: Int, seed: Int): Float {
        var x = i * 374761393 + seed * 668265263
        x = (x xor (x ushr 13)) * 1274126177
        return ((x xor (x ushr 16)) and 0xFFFFFF) / 16777215f
    }

    private fun hash2(x: Int, y: Int, seed: Int) = hash1(x * 7919 + y * 104729, seed)

    /** Distance to the nearest hexagon edge (0 at the border, 0.5ish in the centre). */
    private fun hexEdge(x: Float, y: Float, period: Int): Pair<Float, Int> {
        // axial hex grid with point-up hexes; rows are sqrt(3)/2 apart and the period is kept even
        val h = sqrt(3f) / 2f
        val rowsF = y / h
        val r0 = floor(rowsF).toInt()
        var best = Float.MAX_VALUE; var second = Float.MAX_VALUE; var id = 0
        for (dr in -1..2) {
            val r = r0 + dr
            val off = if (r and 1 == 1) 0.5f else 0f
            val c0 = floor(x - off).toInt()
            for (dc in -1..2) {
                val cx = c0 + dc + off + 0.5f; val cy = (r + 0.5f) * h
                val d = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
                if (d < best) { second = best; best = d; id = (c0 + dc).mod(period) + r * 131 } else if (d < second) second = d
            }
        }
        return (second - best) / 2f to id
    }
}

/** Periodic value noise: every octave wraps at an integer lattice period. */
class TileNoise(seed: Int) {
    private val perm = IntArray(512)

    init {
        val p = IntArray(256) { it }
        var s = (seed.toLong() * 2654435761L) and 0x7fffffffL
        for (i in 255 downTo 1) {
            s = (s * 1103515245L + 12345L) and 0x7fffffffL
            val j = (s % (i + 1)).toInt()
            val t = p[i]; p[i] = p[j]; p[j] = t
        }
        for (i in 0 until 512) perm[i] = p[i and 255]
    }

    private fun lattice(ix: Int, iy: Int): Float = perm[(perm[ix and 255] + iy) and 511] / 127.5f - 1f

    /** Value noise in [-1, 1] that repeats every [px] units in x and [py] in y. */
    fun noise(x: Float, y: Float, px: Int, py: Int = px): Float {
        val p = max(1, px); val q = max(1, py)
        val x0 = floor(x).toInt(); val y0 = floor(y).toInt()
        val fx = x - x0; val fy = y - y0
        val ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10); val uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        val a = lattice(x0.mod(p), y0.mod(q)); val b = lattice((x0 + 1).mod(p), y0.mod(q))
        val c = lattice(x0.mod(p), (y0 + 1).mod(q)); val d = lattice((x0 + 1).mod(p), (y0 + 1).mod(q))
        return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy
    }

    /** x, y in "tile space" where one texture tile is [px] x [py] units. */
    fun fbm(x: Float, y: Float, px: Int, octaves: Int, py: Int = px): Float {
        var sum = 0f; var amp = 0.5f; var f = 1; var norm = 0f
        for (o in 0 until octaves) {
            sum += noise(x * f, y * f, px * f, py * f) * amp
            norm += amp; amp *= 0.5f; f *= 2
        }
        return sum / norm
    }

    fun turbulence(x: Float, y: Float, period: Int, octaves: Int): Float {
        var sum = 0f; var amp = 0.5f; var f = 1
        for (o in 0 until octaves) { sum += abs(noise(x * f, y * f, period * f)) * amp; amp *= 0.5f; f *= 2 }
        return sum
    }

    /** Periodic Worley noise: (nearest distance, second distance, cell id). */
    fun voronoi(x: Float, y: Float, period: Int): Triple<Float, Float, Int> {
        val p = max(1, period)
        val cx = floor(x).toInt(); val cy = floor(y).toInt()
        var d1 = Float.MAX_VALUE; var d2 = Float.MAX_VALUE; var id = 0
        for (j in -1..1) for (i in -1..1) {
            val gx = cx + i; val gy = cy + j
            val wx = gx.mod(p); val wy = gy.mod(p)
            val h = perm[(perm[wx and 255] + wy) and 511]
            val ox = perm[(h + 17) and 511] / 255f * 0.8f + 0.1f
            val oy = perm[(h + 91) and 511] / 255f * 0.8f + 0.1f
            val dx = gx + ox - x; val dy = gy + oy - y
            val d = sqrt(dx * dx + dy * dy)
            if (d < d1) { d2 = d1; d1 = d; id = wx + wy * p } else if (d < d2) d2 = d
        }
        return Triple(d1, d2, id)
    }
}
