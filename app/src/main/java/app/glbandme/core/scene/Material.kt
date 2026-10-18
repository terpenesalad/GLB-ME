package app.glbandme.core.scene

import kotlin.math.pow

/** Encoded image (PNG/JPEG/WebP) kept as original bytes so export is lossless. */
class Texture(var name: String, val bytes: ByteArray, val mimeType: String) {
    val uid: Long = nextUid++
    companion object { private var nextUid = 1L }
}

enum class AlphaMode { OPAQUE, MASK, BLEND }

/** glTF 2.0 metallic-roughness material. Colors are linear. */
class Material(
    var name: String = "Material",
    val baseColor: FloatArray = floatArrayOf(0.8f, 0.8f, 0.8f, 1f),
    var metallic: Float = 0f,
    var roughness: Float = 0.5f,
    val emissive: FloatArray = floatArrayOf(0f, 0f, 0f),
    var emissiveStrength: Float = 1f,
    var alphaMode: AlphaMode = AlphaMode.OPAQUE,
    var alphaCutoff: Float = 0.5f,
    var doubleSided: Boolean = false,
    var unlit: Boolean = false,
    var baseColorTexture: Texture? = null,
    var metallicRoughnessTexture: Texture? = null,
    var normalTexture: Texture? = null,
    var normalScale: Float = 1f,
    var occlusionTexture: Texture? = null,
    var occlusionStrength: Float = 1f,
    var emissiveTexture: Texture? = null,
) {
    fun copy(): Material = Material(
        name, baseColor.copyOf(), metallic, roughness, emissive.copyOf(), emissiveStrength, alphaMode, alphaCutoff,
        doubleSided, unlit, baseColorTexture, metallicRoughnessTexture, normalTexture, normalScale,
        occlusionTexture, occlusionStrength, emissiveTexture
    )

    fun copyFrom(o: Material) {
        name = o.name
        o.baseColor.copyInto(baseColor); metallic = o.metallic; roughness = o.roughness
        o.emissive.copyInto(emissive); emissiveStrength = o.emissiveStrength
        alphaMode = o.alphaMode; alphaCutoff = o.alphaCutoff; doubleSided = o.doubleSided; unlit = o.unlit
        baseColorTexture = o.baseColorTexture; metallicRoughnessTexture = o.metallicRoughnessTexture
        normalTexture = o.normalTexture; normalScale = o.normalScale
        occlusionTexture = o.occlusionTexture; occlusionStrength = o.occlusionStrength; emissiveTexture = o.emissiveTexture
    }

    fun textures(): List<Texture> = listOfNotNull(baseColorTexture, metallicRoughnessTexture, normalTexture, occlusionTexture, emissiveTexture)

    fun setBaseColorSrgb(rgb: Int) {
        baseColor[0] = Color.srgbToLinear(((rgb shr 16) and 0xff) / 255f)
        baseColor[1] = Color.srgbToLinear(((rgb shr 8) and 0xff) / 255f)
        baseColor[2] = Color.srgbToLinear((rgb and 0xff) / 255f)
    }

    fun baseColorSrgb(): Int = Color.linearToArgb(baseColor[0], baseColor[1], baseColor[2])

    companion object {
        fun preset(p: MaterialPreset): Material = Material(name = p.label).also { p.apply(it) }
    }
}

object Color {
    fun srgbToLinear(c: Float): Float = if (c <= 0.04045f) c / 12.92f else ((c + 0.055f) / 1.055f).toDouble().pow(2.4).toFloat()
    fun linearToSrgb(c: Float): Float {
        val v = c.coerceIn(0f, 1f)
        return if (v <= 0.0031308f) v * 12.92f else (1.055 * v.toDouble().pow(1.0 / 2.4) - 0.055).toFloat()
    }
    fun linearToArgb(r: Float, g: Float, b: Float): Int {
        val ri = (linearToSrgb(r) * 255f + 0.5f).toInt(); val gi = (linearToSrgb(g) * 255f + 0.5f).toInt(); val bi = (linearToSrgb(b) * 255f + 0.5f).toInt()
        return (0xff shl 24) or (ri shl 16) or (gi shl 8) or bi
    }
    /** sRGB hex (0xRRGGBB) to linear rgb. */
    fun hexToLinear(rgb: Int): FloatArray = floatArrayOf(
        srgbToLinear(((rgb shr 16) and 0xff) / 255f), srgbToLinear(((rgb shr 8) and 0xff) / 255f), srgbToLinear((rgb and 0xff) / 255f)
    )
}

enum class MaterialPreset(val label: String, val color: Int, val metallic: Float, val roughness: Float, val extra: (Material) -> Unit = {}) {
    CLAY("Clay", 0xC8A890, 0f, 0.85f),
    PLASTIC("Plastic", 0xE8E8EC, 0f, 0.35f),
    GLOSSY_PAINT("Glossy Paint", 0xD32F2F, 0f, 0.12f),
    RUBBER("Rubber", 0x2A2A2E, 0f, 0.95f),
    GOLD("Gold", 0xFFD27A, 1f, 0.22f),
    SILVER("Silver", 0xF2F2F2, 1f, 0.15f),
    CHROME("Chrome", 0xFFFFFF, 1f, 0.03f),
    COPPER("Copper", 0xF2A07B, 1f, 0.28f),
    BRUSHED_STEEL("Brushed Steel", 0xC9CDD2, 1f, 0.45f),
    CERAMIC("Ceramic", 0xF5F1E8, 0f, 0.08f),
    JADE("Jade", 0x4FA37A, 0f, 0.18f),
    WOOD("Wood", 0x8B5A2B, 0f, 0.7f),
    SKIN("Skin", 0xE0AC8D, 0f, 0.55f),
    GLASS("Glass", 0xBFE3FF, 0f, 0.02f, { it.alphaMode = AlphaMode.BLEND; it.baseColor[3] = 0.3f; it.doubleSided = true }),
    NEON("Neon", 0x00E5FF, 0f, 0.4f, { it.emissive[0] = 0f; it.emissive[1] = 0.8f; it.emissive[2] = 1f; it.emissiveStrength = 2f }),
    LAVA("Lava", 0x30120A, 0f, 0.8f, { it.emissive[0] = 1f; it.emissive[1] = 0.25f; it.emissive[2] = 0.02f; it.emissiveStrength = 1.5f }),
    TOON("Toon (Unlit)", 0xFFB74D, 0f, 1f, { it.unlit = true });

    fun apply(m: Material) {
        m.setBaseColorSrgb(color)
        m.baseColor[3] = 1f
        m.metallic = metallic; m.roughness = roughness
        m.emissive.fill(0f); m.emissiveStrength = 1f
        m.alphaMode = AlphaMode.OPAQUE; m.doubleSided = false; m.unlit = false
        extra(m)
    }
}
