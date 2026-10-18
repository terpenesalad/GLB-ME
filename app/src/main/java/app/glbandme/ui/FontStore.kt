package app.glbandme.ui

import android.content.Context
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import app.glbandme.data.FileIO
import java.io.File

/**
 * System font families plus fonts the user imports (.ttf / .otf), e.g. a game title font
 * downloaded from a font site. Imported files are copied into app storage.
 */
object FontStore {
    class FontEntry(val id: String, val name: String, val imported: Boolean)

    /** Android's built-in families (always available, no licensing questions). */
    val system = listOf(
        FontEntry("sys:sans-serif", "Sans", false),
        FontEntry("sys:sans-serif-black", "Heavy", false),
        FontEntry("sys:sans-serif-condensed", "Condensed", false),
        FontEntry("sys:sans-serif-light", "Light", false),
        FontEntry("sys:serif", "Serif", false),
        FontEntry("sys:monospace", "Mono", false),
        FontEntry("sys:serif-monospace", "Typewriter", false),
        FontEntry("sys:casual", "Casual", false),
        FontEntry("sys:cursive", "Script", false),
        FontEntry("sys:sans-serif-smallcaps", "Small caps", false),
    )

    private fun dir(ctx: Context) = File(ctx.filesDir, "fonts").apply { mkdirs() }

    fun imported(ctx: Context): List<FontEntry> = (dir(ctx).listFiles() ?: emptyArray())
        .filter { it.isFile && (it.name.endsWith(".ttf", true) || it.name.endsWith(".otf", true)) }
        .sortedBy { it.name.lowercase() }
        .map { FontEntry("file:${it.name}", it.nameWithoutExtension.replace('_', ' '), true) }

    fun all(ctx: Context) = imported(ctx) + system

    fun name(ctx: Context, id: String): String = all(ctx).firstOrNull { it.id == id }?.name ?: id.substringAfter(':').substringBeforeLast('.')

    private val cache = HashMap<String, Typeface>()

    /** Typeface for an id; missing imported fonts fall back to the default sans. */
    fun typeface(ctx: Context, id: String, bold: Boolean = false, italic: Boolean = false): Typeface {
        val base = cache.getOrPut(id) {
            when {
                id.startsWith("file:") -> {
                    val f = File(dir(ctx), id.removePrefix("file:"))
                    (if (f.exists()) runCatching { Typeface.Builder(f).build() }.getOrNull() else null) ?: Typeface.SANS_SERIF
                }
                id == "sys:sans-serif-black" -> if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.SANS_SERIF, 900, false) else Typeface.create("sans-serif-black", Typeface.NORMAL)
                id == "sys:sans-serif-light" -> if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.SANS_SERIF, 300, false) else Typeface.create("sans-serif-light", Typeface.NORMAL)
                else -> Typeface.create(id.removePrefix("sys:"), Typeface.NORMAL)
            }
        }
        val style = (if (bold) Typeface.BOLD else 0) or (if (italic) Typeface.ITALIC else 0)
        return if (style == 0) base else Typeface.create(base, style)
    }

    /**
     * Copy a picked font file into app storage. Returns the new font id, or throws with a
     * friendly message when the file isn't a usable font.
     */
    fun import(ctx: Context, uri: Uri): String {
        val name = FileIO.displayName(ctx, uri) ?: "Font.ttf"
        val bytes = FileIO.read(ctx, uri, 40L * 1024 * 1024)
        val ext = when {
            bytes.size > 4 && bytes[0] == 'O'.code.toByte() && bytes[1] == 'T'.code.toByte() && bytes[2] == 'T'.code.toByte() && bytes[3] == 'O'.code.toByte() -> "otf"
            bytes.size > 4 && ((bytes[0].toInt() == 0 && bytes[1].toInt() == 1 && bytes[2].toInt() == 0 && bytes[3].toInt() == 0) || String(bytes, 0, 4, Charsets.US_ASCII) == "true") -> "ttf"
            bytes.size > 4 && String(bytes, 0, 4, Charsets.US_ASCII) == "wOFF" -> throw IllegalArgumentException("That's a web font (.woff). Please use the .ttf or .otf version of the font.")
            bytes.size > 4 && String(bytes, 0, 4, Charsets.US_ASCII) == "ttcf" -> throw IllegalArgumentException("Font collections (.ttc) aren't supported – pick a single .ttf or .otf file.")
            else -> throw IllegalArgumentException("“$name” doesn't look like a font file. Pick a .ttf or .otf font.")
        }
        val clean = name.substringBeforeLast('.').replace(Regex("[^A-Za-z0-9 _-]"), "").trim().ifBlank { "Font" }.take(48)
        var f = File(dir(ctx), "$clean.$ext")
        var i = 2
        while (f.exists() && !f.readBytes().contentEquals(bytes)) { f = File(dir(ctx), "$clean $i.$ext"); i++ }
        f.writeBytes(bytes)
        val tf = runCatching { Typeface.Builder(f).build() }.getOrNull()
        if (tf == null) { f.delete(); throw IllegalArgumentException("Android couldn't read “$name”. The file may be damaged.") }
        cache.remove("file:${f.name}")
        return "file:${f.name}"
    }

    fun delete(ctx: Context, id: String) {
        if (!id.startsWith("file:")) return
        File(dir(ctx), id.removePrefix("file:")).delete()
        cache.remove(id)
    }
}
