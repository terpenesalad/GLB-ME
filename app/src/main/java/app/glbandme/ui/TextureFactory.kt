package app.glbandme.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import app.glbandme.core.scene.Texture
import app.glbandme.core.texture.PatternSpec
import app.glbandme.core.texture.TextureGen
import java.io.ByteArrayOutputStream

/** Android-side texture helpers: decoding picked images, encoding generated ones. */
object TextureFactory {

    /** Keep PNG/JPEG bytes as they are; re-encode anything else (HEIC, WebP, GIF…) as PNG. */
    fun fromBytes(name: String, bytes: ByteArray): Texture {
        val isPng = bytes.size > 8 && bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte()
        val isJpeg = bytes.size > 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()
        if (isPng) return Texture(name, bytes, "image/png")
        if (isJpeg) return Texture(name, bytes, "image/jpeg")
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("That image format isn't supported")
        return Texture(name.substringBeforeLast('.') + ".png", png(bmp), "image/png")
    }

    fun png(bmp: Bitmap): ByteArray = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()

    fun fromArgb(name: String, argb: IntArray, size: Int): Texture {
        val bmp = Bitmap.createBitmap(argb, size, size, Bitmap.Config.ARGB_8888)
        return Texture("$name.png", png(bmp), "image/png").also { bmp.recycle() }
    }

    class PatternSet(val color: Texture, val normal: Texture?, val roughness: Texture?)

    fun pattern(spec: PatternSpec, size: Int, withNormal: Boolean, withRoughness: Boolean): PatternSet {
        val g = TextureGen.generate(spec, size)
        val base = spec.pattern.label
        val color = fromArgb(base, g.argb, size)
        val normal = if (withNormal) fromArgb("$base normal", TextureGen.normalMap(g.height, size, 2.5f), size) else null
        val rough = if (withRoughness) fromArgb("$base roughness", TextureGen.roughnessMap(g.height, 0.55f, 0f), size) else null
        return PatternSet(color, normal, rough)
    }

    fun preview(spec: PatternSpec, size: Int): Bitmap {
        val g = TextureGen.generate(spec, size)
        return Bitmap.createBitmap(g.argb, size, size, Bitmap.Config.ARGB_8888)
    }

    /** A normal map derived from an image's brightness (bump from photo). */
    fun normalFromImage(t: Texture, strength: Float): Texture {
        val src = decodeSquare(t, 1024)
        val n = src.width
        val px = IntArray(n * n)
        src.getPixels(px, 0, n, 0, 0, n, n)
        src.recycle()
        val nm = TextureGen.normalMap(TextureGen.luminance(px), n, strength)
        return fromArgb(t.name.substringBeforeLast('.') + " normal", nm, n)
    }

    /** Decode and resample to a square power-of-two-ish size (used for derived maps). */
    private fun decodeSquare(t: Texture, max: Int): Bitmap {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o)
        var sample = 1
        while (o.outWidth / (sample * 2) >= max && o.outHeight / (sample * 2) >= max) sample *= 2
        val b = BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalStateException("Couldn't read the image")
        var s = 1
        while (s * 2 <= minOf(maxOf(b.width, b.height), max)) s *= 2
        val sq = Bitmap.createScaledBitmap(b, s, s, true)
        if (sq !== b) b.recycle()
        return sq
    }

    /** Re-encode a texture no larger than [maxSize] (export option). Returns the original when already small. */
    fun downscale(t: Texture, maxSize: Int, forceJpeg: Boolean = false, pngOrJpegOnly: Boolean = false): Pair<ByteArray, String> {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o)
        if (o.outWidth <= 0) return t.bytes to t.mimeType
        val okFormat = !pngOrJpegOnly || t.mimeType == "image/png" || t.mimeType == "image/jpeg"
        if (o.outWidth <= maxSize && o.outHeight <= maxSize && !forceJpeg && okFormat) return t.bytes to t.mimeType
        var sample = 1
        while (o.outWidth / (sample * 2) >= maxSize && o.outHeight / (sample * 2) >= maxSize) sample *= 2
        val b = BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return t.bytes to t.mimeType
        val k = minOf(1f, maxSize.toFloat() / maxOf(b.width, b.height))
        val sb = if (k < 1f) Bitmap.createScaledBitmap(b, (b.width * k).toInt().coerceAtLeast(1), (b.height * k).toInt().coerceAtLeast(1), true) else b
        val out = ByteArrayOutputStream()
        val jpeg = forceJpeg && !sb.hasAlpha() || (t.mimeType == "image/jpeg")
        sb.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, if (jpeg) 90 else 100, out)
        if (sb !== b) sb.recycle()
        b.recycle()
        return out.toByteArray() to (if (jpeg) "image/jpeg" else "image/png")
    }

    fun aspect(t: Texture): Float {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o)
        return if (o.outHeight > 0) o.outWidth.toFloat() / o.outHeight else 1f
    }

    fun hasAlpha(t: Texture): Boolean {
        if (t.mimeType == "image/jpeg") return false
        val o = BitmapFactory.Options().apply { inSampleSize = 8 }
        val b = BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, o) ?: return false
        val px = IntArray(b.width * b.height)
        b.getPixels(px, 0, b.width, 0, 0, b.width, b.height)
        b.recycle()
        return px.any { (it ushr 24) < 250 }
    }
}
