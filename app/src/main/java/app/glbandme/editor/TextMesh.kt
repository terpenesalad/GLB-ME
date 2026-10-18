package app.glbandme.editor

import android.content.Context
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import app.glbandme.core.mesh.Extruder
import app.glbandme.core.mesh.FloatArrayList
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.scene.TextSpec
import app.glbandme.ui.FontStore
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

/** Builds solid, optionally bevelled 3D text from any font via Android's glyph outlines. */
object TextMesh {
    private const val EM = 100f

    fun build(ctx: Context, spec: TextSpec): Mesh? {
        val tf = FontStore.typeface(ctx, spec.font, spec.bold, spec.italic)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = tf; textSize = EM
            letterSpacing = spec.letterSpacing
            // synthesize italics for fonts without an italic face
            if (spec.italic && !tf.isItalic) textSkewX = -0.21f
        }
        val lines = spec.text.split('\n')
        val fm = paint.fontMetrics
        val lineH = (fm.descent - fm.ascent + fm.leading) * spec.lineSpacing
        val widths = lines.map { paint.measureText(it) }
        val maxW = widths.maxOrNull() ?: 0f
        val path = Path()
        for ((i, line) in lines.withIndex()) {
            if (line.isBlank()) continue
            val x = when (spec.align) { 0 -> 0f; 2 -> maxW - widths[i]; else -> (maxW - widths[i]) / 2f }
            val lp = Path()
            paint.getTextPath(line, 0, line.length, x, i * lineH, lp)
            path.addPath(lp)
        }
        val contours = flatten(path, spec.quality.coerceIn(0.1f, 3f))
        if (contours.isEmpty()) return null
        val depth = (spec.depth * EM).coerceAtLeast(0.5f)
        val m = Extruder.extrude(contours, depth, spec.bevel * EM, spec.bevelSegments.coerceIn(1, 8)) ?: return null
        // font units -> metres (cap height ≈ 0.7 m at the default size)
        val k = 1f / EM
        val p = m.positions
        for (i in p.indices) p[i] *= k
        m.markGeometryDirty()
        m.computeNormals()
        MeshOps.centerToOrigin(m)
        return m
    }

    /**
     * Each contour of the path as a polyline (y flipped to y-up). Uses Path.approximate per
     * contour so straight edges stay exact and only curves get subdivided.
     */
    fun flatten(path: Path, tolerance: Float): List<FloatArray> {
        val out = ArrayList<FloatArray>()
        val pm = PathMeasure(path, false)
        do {
            val len = pm.length
            if (len < 0.5f) continue
            val seg = Path()
            pm.getSegment(0f, len, seg, true)
            val approx = seg.approximate(tolerance)
            val pts = FloatArrayList(approx.size / 3 * 2)
            var i = 0
            while (i + 2 < approx.size) {
                val x = approx[i + 1]; val y = -approx[i + 2]
                val n = pts.size
                if (n >= 2 && abs(pts[n - 2] - x) < 1e-3f && abs(pts[n - 1] - y) < 1e-3f) { i += 3; continue }
                pts.add(x, y)
                i += 3
            }
            var arr = pts.toArray()
            // drop the closing duplicate
            if (arr.size >= 4 && abs(arr[0] - arr[arr.size - 2]) < 1e-3f && abs(arr[1] - arr[arr.size - 1]) < 1e-3f) arr = arr.copyOf(arr.size - 2)
            arr = dropCollinear(arr)
            if (arr.size >= 6 && abs(area(arr)) > 0.05f) out.add(arr)
        } while (pm.nextContour())
        return out
    }

    private fun area(c: FloatArray): Float {
        var a = 0f
        val n = c.size / 2
        for (i in 0 until n) { val j = (i + 1) % n; a += c[i * 2] * c[j * 2 + 1] - c[j * 2] * c[i * 2 + 1] }
        return a / 2f
    }

    private fun dropCollinear(c: FloatArray): FloatArray {
        val n = c.size / 2
        if (n < 4) return c
        val keep = FloatArrayList(c.size)
        for (i in 0 until n) {
            val p = (i - 1 + n) % n; val q = (i + 1) % n
            val ax = c[i * 2] - c[p * 2]; val ay = c[i * 2 + 1] - c[p * 2 + 1]
            val bx = c[q * 2] - c[i * 2]; val by = c[q * 2 + 1] - c[i * 2 + 1]
            val cross = ax * by - ay * bx
            val la = sqrt(ax * ax + ay * ay); val lb = sqrt(bx * bx + by * by)
            if (abs(cross) <= 1e-4f * max(la * lb, 1e-6f) && ax * bx + ay * by > 0f) continue
            keep.add(c[i * 2], c[i * 2 + 1])
        }
        return if (keep.size >= 6) keep.toArray() else c
    }
}
