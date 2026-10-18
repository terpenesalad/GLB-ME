package app.glbandme.core.scene

/** Editable parameters of a 3D text object (the mesh is rebuilt from these). */
class TextSpec(
    var text: String = "Text",
    /** "sys:<family>" for system fonts or "file:<name>" for imported fonts */
    var font: String = "sys:sans-serif",
    var bold: Boolean = true,
    var italic: Boolean = false,
    var depth: Float = 0.2f,
    var bevel: Float = 0.02f,
    var bevelSegments: Int = 3,
    /** em units, like CSS letter-spacing */
    var letterSpacing: Float = 0f,
    var lineSpacing: Float = 1f,
    /** 0 left, 1 centre, 2 right */
    var align: Int = 1,
    /** curve flattening tolerance in font units (lower = smoother, more triangles) */
    var quality: Float = 0.6f,
) {
    fun copy() = TextSpec(text, font, bold, italic, depth, bevel, bevelSegments, letterSpacing, lineSpacing, align, quality)

    fun toMap(): Map<String, Any?> = linkedMapOf(
        "text" to text, "font" to font, "bold" to bold, "italic" to italic, "depth" to depth, "bevel" to bevel,
        "bevelSegments" to bevelSegments, "letterSpacing" to letterSpacing, "lineSpacing" to lineSpacing, "align" to align, "quality" to quality
    )

    override fun equals(other: Any?): Boolean = other is TextSpec && other.toMap() == toMap()
    override fun hashCode(): Int = toMap().hashCode()

    companion object {
        fun fromMap(m: Map<String, Any?>): TextSpec {
            fun f(k: String, d: Float) = (m[k] as? Number)?.toFloat() ?: d
            fun b(k: String, d: Boolean) = m[k] as? Boolean ?: d
            return TextSpec(
                text = m["text"] as? String ?: "Text", font = m["font"] as? String ?: "sys:sans-serif",
                bold = b("bold", true), italic = b("italic", false), depth = f("depth", 0.2f), bevel = f("bevel", 0.02f),
                bevelSegments = f("bevelSegments", 3f).toInt(), letterSpacing = f("letterSpacing", 0f), lineSpacing = f("lineSpacing", 1f),
                align = f("align", 1f).toInt(), quality = f("quality", 0.6f)
            )
        }
    }
}
