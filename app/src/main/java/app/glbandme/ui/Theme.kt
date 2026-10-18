package app.glbandme.ui

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Resources
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.provider.Settings

/**
 * Design tokens for GLB&ME. Dark, calm, high-contrast palette in the spirit of iOS dark mode.
 * All sizes go through [dp]/[sp] so the "Interface size" setting and the system font scale
 * apply everywhere, including custom-drawn controls.
 */
object Theme {
    val density get() = Resources.getSystem().displayMetrics.density

    /** Global interface scale (Settings › Accessibility › Interface size). */
    var uiScale = 1f; private set
    /** System font scale, clamped so fixed layouts stay intact. */
    var fontScale = 1f; private set
    var reduceMotion = false; private set
    var leftHanded = false; private set
    var boldText = false; private set

    fun dp(v: Float) = v * density * uiScale
    fun dp(v: Int) = (v * density * uiScale + 0.5f).toInt()
    /** Text size in px for custom-drawn text (honours font scale). */
    fun sp(v: Float) = v * density * uiScale * fontScale

    // ---- palette ------------------------------------------------------------------------------
    // Contrast against SURFACE (#1C1C1F): TEXT 17:1, TEXT_DIM 7.6:1, TEXT_MUTED 4.8:1 (WCAG AA).
    val BG = 0xFF0A0A0D.toInt()
    val SURFACE = 0xFF1C1C1F.toInt()
    val SURFACE_2 = 0xFF2A2A2F.toInt()
    val SURFACE_3 = 0xFF3A3A41.toInt()
    val PANEL = 0xF51A1A1E.toInt()
    val GLASS = 0xE01C1C20.toInt()
    val STROKE = 0xFF34343B.toInt()
    val SEPARATOR = 0x33FFFFFF
    val TEXT = 0xFFF5F5F7.toInt()
    val TEXT_DIM = 0xFFAEAEB6.toInt()
    val TEXT_MUTED = 0xFF8C8C95.toInt()
    val DANGER = 0xFFFF6B6B.toInt()
    val SUCCESS = 0xFF34D399.toInt()
    val WARNING = 0xFFFFC53D.toInt()
    val CYAN = 0xFF22D3EE.toInt()
    val AXIS_X = 0xFFFF5A67.toInt()
    val AXIS_Y = 0xFF7CDB72.toInt()
    val AXIS_Z = 0xFF5B95FF.toInt()

    /** Accent choices – all keep white text above 4.5:1. */
    val accentChoices = intArrayOf(0xFF6E56F7.toInt(), 0xFF0071E3.toInt(), 0xFF0E7C86.toInt(), 0xFFD6246E.toInt(), 0xFFC2410C.toInt(), 0xFF15803D.toInt())
    val accentNames = arrayOf("Violet", "Blue", "Teal", "Pink", "Orange", "Green")
    var accent = accentChoices[0]

    val regular: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    val medium: Typeface get() = if (boldText) bold else mediumFace
    private val mediumFace: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val mono: Typeface = Typeface.MONOSPACE

    fun blend(a: Int, b: Int, t: Float): Int {
        fun ch(x: Int, y: Int) = (x + (y - x) * t).toInt().coerceIn(0, 255)
        return (0xFF shl 24) or (ch(Color.red(a), Color.red(b)) shl 16) or (ch(Color.green(a), Color.green(b)) shl 8) or ch(Color.blue(a), Color.blue(b))
    }

    fun withAlpha(c: Int, a: Float) = (c and 0x00ffffff) or ((a * 255).toInt().coerceIn(0, 255) shl 24)

    fun accentRgb(): FloatArray = floatArrayOf(Color.red(accent) / 255f, Color.green(accent) / 255f, Color.blue(accent) / 255f)

    /** Lighter accent for text/icons on dark surfaces. */
    fun accentLight(): Int {
        val hsv = FloatArray(3); Color.colorToHSV(accent, hsv)
        hsv[1] = (hsv[1] * 0.7f).coerceAtMost(1f); hsv[2] = 1f
        return Color.HSVToColor(hsv)
    }

    fun rounded(color: Int, radiusDp: Float, strokeColor: Int = 0, strokeDp: Float = 0f) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp)
        if (strokeDp > 0f) setStroke(dp(strokeDp).toInt().coerceAtLeast(1), strokeColor)
    }

    fun brandGradient(x0: Float, y0: Float, x1: Float, y1: Float): Shader {
        val hsv = FloatArray(3); Color.colorToHSV(accent, hsv)
        hsv[0] = (hsv[0] + 28f) % 360f; hsv[2] = (hsv[2] * 1.1f).coerceAtMost(1f)
        return LinearGradient(x0, y0, x1, y1, intArrayOf(accent, Color.HSVToColor(hsv)), null, Shader.TileMode.CLAMP)
    }

    /** Animation duration honouring "Reduce motion" (system or in-app). */
    fun anim(ms: Long): Long = if (reduceMotion) 0L else ms

    fun load(ctx: Context) {
        val p = Prefs.of(ctx)
        accent = p.accent.let { a -> if (a in accentChoices) a else accentChoices[0] }
        val oldKey = "$uiScale/$fontScale/$boldText/${p.accent}"
        uiScale = when (p.uiSize) { 1 -> 1.12f; 2 -> 1.25f; else -> 1f }
        fontScale = (if (p.textScale > 0f) p.textScale else ctx.resources.configuration.fontScale).coerceIn(0.85f, 1.5f)
        val systemNoAnim = runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
        reduceMotion = p.reduceMotion || systemNoAnim
        leftHanded = p.leftHanded
        boldText = p.boldText || (android.os.Build.VERSION.SDK_INT >= 31 && ctx.resources.configuration.fontWeightAdjustment > 0)
        if (oldKey != "$uiScale/$fontScale/$boldText/${p.accent}") version++
    }

    /** Bumped whenever sizes / fonts / accent change so screens can rebuild. */
    var version = 0; private set
}

/** App settings (SharedPreferences). */
class Prefs private constructor(private val sp: SharedPreferences) {
    private fun b(k: String, d: Boolean) = sp.getBoolean(k, d)
    private fun setB(k: String, v: Boolean) = sp.edit().putBoolean(k, v).apply()

    var accent: Int get() = sp.getInt("accent2", Theme.accentChoices[0]); set(v) = sp.edit().putInt("accent2", v).apply()
    var showStats: Boolean get() = b("showStats", true); set(v) = setB("showStats", v)
    var showFps: Boolean get() = b("showFps", false); set(v) = setB("showFps", v)
    var invertOrbit: Boolean get() = b("invertOrbit", false); set(v) = setB("invertOrbit", v)
    var orbitSpeed: Float get() = sp.getFloat("orbitSpeed", 1f); set(v) = sp.edit().putFloat("orbitSpeed", v).apply()
    var msaa: Boolean get() = b("msaa", true); set(v) = setB("msaa", v)
    var stylusPressure: Boolean get() = b("pressure", true); set(v) = setB("pressure", v)
    var tapUndo: Boolean get() = b("tapUndo", true); set(v) = setB("tapUndo", v)
    var autosave: Boolean get() = b("autosave", true); set(v) = setB("autosave", v)
    var undoSteps: Int get() = sp.getInt("undoSteps", 60); set(v) = sp.edit().putInt("undoSteps", v).apply()
    var defaultExport: String get() = sp.getString("defaultExport", "GLB") ?: "GLB"; set(v) = sp.edit().putString("defaultExport", v).apply()
    var haptics: Boolean get() = b("haptics", true); set(v) = setB("haptics", v)
    var stylusOnly: Boolean get() = b("stylusOnly", false); set(v) = setB("stylusOnly", v)
    var exportPreset: Int get() = sp.getInt("exportPreset", 0); set(v) = sp.edit().putInt("exportPreset", v).apply()
    var sortMode: Int get() = sp.getInt("sortMode", 0); set(v) = sp.edit().putInt("sortMode", v).apply()
    var seenTips: Boolean get() = b("seenTips", false); set(v) = setB("seenTips", v)
    var seenWelcome: Boolean get() = b("seenWelcome", false); set(v) = setB("seenWelcome", v)
    var recentColors: String get() = sp.getString("recentColors", "") ?: ""; set(v) = sp.edit().putString("recentColors", v).apply()
    // accessibility
    var largeUi: Boolean get() = b("largeUi", false); set(v) = setB("largeUi", v)
    /** 0 standard, 1 large, 2 extra large */
    var uiSize: Int get() = sp.getInt("uiSize", if (largeUi) 1 else 0); set(v) = sp.edit().putInt("uiSize", v).apply()
    /** 0 = follow the system font size */
    var textScale: Float get() = sp.getFloat("textScale", 0f); set(v) = sp.edit().putFloat("textScale", v).apply()
    var lastVersionSeen: String get() = sp.getString("lastVersionSeen", "") ?: ""; set(v) = sp.edit().putString("lastVersionSeen", v).apply()
    var reduceMotion: Boolean get() = b("reduceMotion", false); set(v) = setB("reduceMotion", v)
    var leftHanded: Boolean get() = b("leftHanded", false); set(v) = setB("leftHanded", v)
    var boldText: Boolean get() = b("boldText", false); set(v) = setB("boldText", v)
    var showHints: Boolean get() = b("showHints", true); set(v) = setB("showHints", v)
    var showLabels: Boolean get() = b("showLabels", true); set(v) = setB("showLabels", v)
    /** Display unit for dimensions: 0 m, 1 cm, 2 mm, 3 in */
    var units: Int get() = sp.getInt("units", 0); set(v) = sp.edit().putInt("units", v).apply()

    fun hintSeen(key: String) = b("hint_$key", false)
    fun markHint(key: String) = setB("hint_$key", true)
    fun resetHints() { val e = sp.edit(); for (k in sp.all.keys) if (k.startsWith("hint_")) e.remove(k); e.apply() }

    companion object {
        @Volatile private var inst: Prefs? = null
        fun of(ctx: Context): Prefs = inst ?: synchronized(this) {
            inst ?: Prefs(ctx.applicationContext.getSharedPreferences("glbandme", Context.MODE_PRIVATE)).also { inst = it }
        }
    }
}

/** Length units for display & export. */
enum class Units(val label: String, val suffix: String, val perMeter: Float) {
    M("Meters", "m", 1f), CM("Centimeters", "cm", 100f), MM("Millimeters", "mm", 1000f), IN("Inches", "in", 39.3701f);

    fun format(meters: Float): String {
        val v = meters * perMeter
        return when {
            kotlin.math.abs(v) >= 100 -> String.format("%.0f %s", v, suffix)
            kotlin.math.abs(v) >= 10 -> String.format("%.1f %s", v, suffix)
            else -> String.format("%.2f %s", v, suffix)
        }
    }

    companion object { fun of(i: Int) = values().getOrElse(i) { M } }
}
