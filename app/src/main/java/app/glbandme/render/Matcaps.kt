package app.glbandme.render

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

/** Procedurally generated matcaps (sRGB RGBA8). */
object Matcaps {
    const val SIZE = 256

    class Def(val name: String, val swatch: Int, val shade: (nx: Float, ny: Float, nz: Float) -> FloatArray)

    private fun mix(a: FloatArray, b: FloatArray, t: Float) = floatArrayOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)
    private fun rgb(hex: Int) = floatArrayOf(((hex shr 16) and 255) / 255f, ((hex shr 8) and 255) / 255f, (hex and 255) / 255f)
    private fun sat(x: Float) = x.coerceIn(0f, 1f)

    private fun clay(baseHex: Int, highlight: Float, rim: Float, specPow: Float = 24f): (Float, Float, Float) -> FloatArray {
        val base = rgb(baseHex)
        return { nx, ny, nz ->
            // key light top-left-front, soft wrap diffuse
            val lx = -0.45f; val ly = 0.6f; val lz = 0.66f
            val ndl = nx * lx + ny * ly + nz * lz
            val diff = sat((ndl + 0.35f) / 1.35f)
            val hx = lx; val hy = ly; val hz = lz + 1f
            val hl = sqrt(hx * hx + hy * hy + hz * hz)
            val ndh = sat((nx * hx + ny * hy + nz * hz) / hl)
            val spec = ndh.pow(specPow) * highlight
            val fres = (1f - sat(nz)).pow(3f) * rim
            val occ = 0.55f + 0.45f * sat(ny * 0.5f + 0.6f)
            val c = FloatArray(3)
            for (i in 0 until 3) c[i] = sat(base[i] * (0.18f + 0.95f * diff) * occ + spec + fres * (0.6f + base[i] * 0.4f))
            c
        }
    }

    val defs: List<Def> = listOf(
        Def("Red Clay", 0xC0624E, clay(0xC0624E, 0.28f, 0.22f)),
        Def("Gray Clay", 0xA9A9AE, clay(0xA9A9AE, 0.22f, 0.18f)),
        Def("White Clay", 0xE6E1D8, clay(0xE6E1D8, 0.18f, 0.12f, 18f)),
        Def("Skin", 0xD9A07F, clay(0xD9A07F, 0.25f, 0.35f, 16f)),
        Def("Jade", 0x3F9C74) { nx, ny, nz ->
            val base = clay(0x3F9C74, 0.55f, 0.1f, 60f)(nx, ny, nz)
            val sss = (1f - sat(nz)).pow(1.5f) * 0.35f
            floatArrayOf(sat(base[0] + sss * 0.2f), sat(base[1] + sss * 0.6f), sat(base[2] + sss * 0.4f))
        },
        Def("Pearl", 0xF1E9EF) { nx, ny, nz ->
            val base = clay(0xEDE6EA, 0.35f, 0f, 40f)(nx, ny, nz)
            val f = (1f - sat(nz)).pow(2f)
            val irid = mix(floatArrayOf(1f, 0.75f, 0.85f), floatArrayOf(0.7f, 0.85f, 1f), sat(ny * 0.5f + 0.5f))
            mix(base, irid, f * 0.7f)
        },
        Def("Gold", 0xE8B04A) { nx, ny, nz ->
            val env = sat(ny * 0.5f + 0.5f)
            val band = (1f - kotlin.math.abs(ny - 0.15f) * 2.2f).let { sat(it) }.pow(3f)
            val base = mix(rgb(0x5A3A0E), rgb(0xFFD27A), env)
            val spec = sat(-0.45f * nx + 0.6f * ny + 0.66f * nz).pow(40f)
            floatArrayOf(sat(base[0] + band * 0.35f + spec), sat(base[1] + band * 0.28f + spec * 0.9f), sat(base[2] + band * 0.12f + spec * 0.6f))
        },
        Def("Chrome", 0xC8D2DC) { nx, ny, nz ->
            val sky = mix(rgb(0x6B7A8C), rgb(0xF4F8FF), sat(ny * 1.2f + 0.3f))
            val ground = mix(rgb(0x2A2320), rgb(0x8C7B6A), sat(ny + 1f))
            val c = if (ny > -0.05f) sky else ground
            val horizon = sat(1f - kotlin.math.abs(ny + 0.05f) * 12f)
            val spec = sat(-0.3f * nx + 0.5f * ny + 0.8f * nz).pow(120f)
            floatArrayOf(sat(c[0] + horizon * 0.3f + spec), sat(c[1] + horizon * 0.3f + spec), sat(c[2] + horizon * 0.3f + spec))
        },
        Def("Toon", 0xFFB74D) { nx, ny, nz ->
            val ndl = nx * -0.45f + ny * 0.6f + nz * 0.66f
            val band = if (ndl > 0.55f) 1f else if (ndl > 0.1f) 0.72f else 0.45f
            val base = rgb(0xFFB74D)
            val rim = if (nz < 0.25f) 0.25f else 0f
            floatArrayOf(sat(base[0] * band + rim), sat(base[1] * band + rim), sat(base[2] * band + rim))
        },
        Def("Normal-ish", 0x8080FF) { nx, ny, nz -> floatArrayOf(nx * 0.5f + 0.5f, ny * 0.5f + 0.5f, nz * 0.5f + 0.5f) },
    )

    fun pixels(index: Int): ByteBuffer {
        val d = defs[index.coerceIn(0, defs.size - 1)]
        val bb = ByteBuffer.allocateDirect(SIZE * SIZE * 4).order(ByteOrder.nativeOrder())
        for (y in 0 until SIZE) for (x in 0 until SIZE) {
            var nx = (x + 0.5f) / SIZE * 2f - 1f
            var ny = 1f - (y + 0.5f) / SIZE * 2f
            val r2 = nx * nx + ny * ny
            if (r2 > 1f) { val r = sqrt(r2); nx /= r; ny /= r }
            val nz = sqrt(max(0f, 1f - nx * nx - ny * ny))
            val c = d.shade(nx, ny, nz)
            bb.put((sat(c[0]) * 255f + 0.5f).toInt().toByte())
            bb.put((sat(c[1]) * 255f + 0.5f).toInt().toByte())
            bb.put((sat(c[2]) * 255f + 0.5f).toInt().toByte())
            bb.put(255.toByte())
        }
        bb.position(0)
        return bb
    }
}
