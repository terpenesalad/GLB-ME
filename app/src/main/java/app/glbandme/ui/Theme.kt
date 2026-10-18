package app.glbandme.ui

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Resources
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable

/** Design tokens for the GLB&ME dark UI. */
object Theme {
    val density get() = Resources.getSystem().displayMetrics.density
    fun dp(v: Float) = v * density
    fun dp(v: Int) = (v * density + 0.5f).toInt()

    const val BG = 0xFF0E0F14.toInt()
    const val SURFACE = 0xFF171922.toInt()
    const val SURFACE_2 = 0xFF1F2230.toInt()
    const val SURFACE_3 = 0xFF292D3E.toInt()
    const val PANEL = 0xF2161821.toInt()
    const val STROKE = 0xFF2C3042.toInt()
    const val TEXT = 0xFFECEEF6.toInt()
    const val TEXT_DIM = 0xFF9CA3B8.toInt()
    const val TEXT_MUTED = 0xFF6B7189.toInt()
    const val DANGER = 0xFFFF5470.toInt()
    const val SUCCESS = 0xFF34D399.toInt()
    const val WARNING = 0xFFFBBF24.toInt()
    const val CYAN = 0xFF22D3EE.toInt()
    const val AXIS_X = 0xFFFF4D5E.toInt()
    const val AXIS_Y = 0xFF6BD968.toInt()
    const val AXIS_Z = 0xFF4D8DFF.toInt()

    val accentChoices = intArrayOf(0xFF7C5CFF.toInt(), 0xFF22D3EE.toInt(), 0xFFFF6B6B.toInt(), 0xFF34D399.toInt(), 0xFFFFB020.toInt(), 0xFFFF4FA3.toInt())
    var accent = 0xFF7C5CFF.toInt()

    val regular: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    val medium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val mono: Typeface = Typeface.MONOSPACE

    fun withAlpha(c: Int, a: Float) = (c and 0x00ffffff) or ((a * 255).toInt().coerceIn(0, 255) shl 24)

    fun accentRgb(): FloatArray = floatArrayOf(Color.red(accent) / 255f, Color.green(accent) / 255f, Color.blue(accent) / 255f)

    fun rounded(color: Int, radiusDp: Float, strokeColor: Int = 0, strokeDp: Float = 0f) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp)
        if (strokeDp > 0f) setStroke(dp(strokeDp).toInt().coerceAtLeast(1), strokeColor)
    }

    fun brandGradient(x0: Float, y0: Float, x1: Float, y1: Float): Shader =
        LinearGradient(x0, y0, x1, y1, intArrayOf(accent, CYAN), null, Shader.TileMode.CLAMP)

    fun load(ctx: Context) {
        accent = Prefs.of(ctx).accent
    }
}

/** App settings (SharedPreferences). */
class Prefs private constructor(private val sp: SharedPreferences) {
    var accent: Int get() = sp.getInt("accent", Theme.accentChoices[0]); set(v) = sp.edit().putInt("accent", v).apply()
    var showStats: Boolean get() = sp.getBoolean("showStats", true); set(v) = sp.edit().putBoolean("showStats", v).apply()
    var showFps: Boolean get() = sp.getBoolean("showFps", false); set(v) = sp.edit().putBoolean("showFps", v).apply()
    var invertOrbit: Boolean get() = sp.getBoolean("invertOrbit", false); set(v) = sp.edit().putBoolean("invertOrbit", v).apply()
    var orbitSpeed: Float get() = sp.getFloat("orbitSpeed", 1f); set(v) = sp.edit().putFloat("orbitSpeed", v).apply()
    var msaa: Boolean get() = sp.getBoolean("msaa", true); set(v) = sp.edit().putBoolean("msaa", v).apply()
    var stylusPressure: Boolean get() = sp.getBoolean("pressure", true); set(v) = sp.edit().putBoolean("pressure", v).apply()
    var tapUndo: Boolean get() = sp.getBoolean("tapUndo", true); set(v) = sp.edit().putBoolean("tapUndo", v).apply()
    var autosave: Boolean get() = sp.getBoolean("autosave", true); set(v) = sp.edit().putBoolean("autosave", v).apply()
    var undoSteps: Int get() = sp.getInt("undoSteps", 60); set(v) = sp.edit().putInt("undoSteps", v).apply()
    var defaultExport: String get() = sp.getString("defaultExport", "GLB") ?: "GLB"; set(v) = sp.edit().putString("defaultExport", v).apply()
    var haptics: Boolean get() = sp.getBoolean("haptics", true); set(v) = sp.edit().putBoolean("haptics", v).apply()
    var stylusOnly: Boolean get() = sp.getBoolean("stylusOnly", false); set(v) = sp.edit().putBoolean("stylusOnly", v).apply()
    var sortMode: Int get() = sp.getInt("sortMode", 0); set(v) = sp.edit().putInt("sortMode", v).apply()
    var seenTips: Boolean get() = sp.getBoolean("seenTips", false); set(v) = sp.edit().putBoolean("seenTips", v).apply()
    var recentColors: String get() = sp.getString("recentColors", "") ?: ""; set(v) = sp.edit().putString("recentColors", v).apply()

    companion object {
        @Volatile private var inst: Prefs? = null
        fun of(ctx: Context): Prefs = inst ?: synchronized(this) {
            inst ?: Prefs(ctx.applicationContext.getSharedPreferences("glbandme", Context.MODE_PRIVATE)).also { inst = it }
        }
    }
}
