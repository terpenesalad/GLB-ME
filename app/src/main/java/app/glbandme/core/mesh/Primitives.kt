package app.glbandme.core.mesh

import app.glbandme.math.MathUtil
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

enum class PrimType(val label: String) {
    SCULPT_SPHERE("Sculpt Sphere"),
    SPHERE("UV Sphere"),
    ICOSPHERE("Icosphere"),
    CUBE("Cube"),
    CYLINDER("Cylinder"),
    CONE("Cone"),
    TORUS("Torus"),
    PLANE("Plane"),
    CAPSULE("Capsule"),
    TUBE("Tube"),
    PYRAMID("Pyramid");
}

class ParamDef(val key: String, val label: String, val min: Float, val max: Float, val def: Float, val integer: Boolean = false)

/** Editable procedural description of a primitive; kept on the object until the user bakes it. */
class PrimitiveSpec(val type: PrimType, val params: MutableMap<String, Float> = mutableMapOf()) {
    init {
        for (d in Primitives.paramDefs(type)) if (!params.containsKey(d.key)) params[d.key] = d.def
    }
    operator fun get(k: String) = params[k] ?: Primitives.paramDefs(type).first { it.key == k }.def
    fun int(k: String) = get(k).roundToInt()
    fun copy() = PrimitiveSpec(type, params.toMutableMap())
    fun build(): Mesh = Primitives.build(this)
}

object Primitives {

    fun paramDefs(type: PrimType): List<ParamDef> = when (type) {
        PrimType.SCULPT_SPHERE -> listOf(ParamDef("radius", "Radius", 0.05f, 5f, 0.5f), ParamDef("res", "Resolution", 2f, 96f, 32f, true))
        PrimType.SPHERE -> listOf(
            ParamDef("radius", "Radius", 0.05f, 5f, 0.5f),
            ParamDef("segments", "Segments", 3f, 128f, 48f, true), ParamDef("rings", "Rings", 2f, 96f, 24f, true)
        )
        PrimType.ICOSPHERE -> listOf(ParamDef("radius", "Radius", 0.05f, 5f, 0.5f), ParamDef("detail", "Detail", 0f, 6f, 3f, true))
        PrimType.CUBE -> listOf(
            ParamDef("width", "Width", 0.02f, 10f, 1f), ParamDef("height", "Height", 0.02f, 10f, 1f),
            ParamDef("depth", "Depth", 0.02f, 10f, 1f), ParamDef("divisions", "Divisions", 1f, 64f, 8f, true)
        )
        PrimType.CYLINDER -> listOf(
            ParamDef("radius", "Radius", 0.02f, 5f, 0.5f), ParamDef("height", "Height", 0.02f, 10f, 1f),
            ParamDef("segments", "Segments", 3f, 128f, 40f, true), ParamDef("hsegs", "Height Segs", 1f, 64f, 8f, true)
        )
        PrimType.CONE -> listOf(
            ParamDef("radius", "Radius", 0.02f, 5f, 0.5f), ParamDef("top", "Top Radius", 0f, 5f, 0f),
            ParamDef("height", "Height", 0.02f, 10f, 1f), ParamDef("segments", "Segments", 3f, 128f, 40f, true),
            ParamDef("hsegs", "Height Segs", 1f, 64f, 8f, true)
        )
        PrimType.TORUS -> listOf(
            ParamDef("major", "Ring Radius", 0.05f, 5f, 0.4f), ParamDef("minor", "Tube Radius", 0.01f, 2f, 0.15f),
            ParamDef("segments", "Segments", 3f, 160f, 64f, true), ParamDef("sides", "Sides", 3f, 96f, 24f, true)
        )
        PrimType.PLANE -> listOf(
            ParamDef("width", "Width", 0.02f, 50f, 2f), ParamDef("depth", "Depth", 0.02f, 50f, 2f),
            ParamDef("divisions", "Divisions", 1f, 200f, 16f, true)
        )
        PrimType.CAPSULE -> listOf(
            ParamDef("radius", "Radius", 0.02f, 5f, 0.3f), ParamDef("height", "Body Height", 0f, 10f, 0.6f),
            ParamDef("segments", "Segments", 3f, 128f, 40f, true), ParamDef("rings", "Cap Rings", 2f, 48f, 12f, true)
        )
        PrimType.TUBE -> listOf(
            ParamDef("outer", "Outer Radius", 0.02f, 5f, 0.5f), ParamDef("inner", "Inner Radius", 0.01f, 5f, 0.35f),
            ParamDef("height", "Height", 0.02f, 10f, 1f), ParamDef("segments", "Segments", 3f, 128f, 48f, true)
        )
        PrimType.PYRAMID -> listOf(ParamDef("base", "Base", 0.02f, 10f, 1f), ParamDef("height", "Height", 0.02f, 10f, 1f))
    }

    fun build(spec: PrimitiveSpec): Mesh = when (spec.type) {
        PrimType.SCULPT_SPHERE -> quadSphere(spec["radius"], spec.int("res"))
        PrimType.SPHERE -> uvSphere(spec["radius"], spec.int("segments"), spec.int("rings"))
        PrimType.ICOSPHERE -> icoSphere(spec["radius"], spec.int("detail"))
        PrimType.CUBE -> box(spec["width"], spec["height"], spec["depth"], spec.int("divisions"))
        PrimType.CYLINDER -> cylinder(spec["radius"], spec["radius"], spec["height"], spec.int("segments"), spec.int("hsegs"))
        PrimType.CONE -> cylinder(spec["radius"], spec["top"], spec["height"], spec.int("segments"), spec.int("hsegs"))
        PrimType.TORUS -> torus(spec["major"], spec["minor"], spec.int("segments"), spec.int("sides"))
        PrimType.PLANE -> plane(spec["width"], spec["depth"], spec.int("divisions"))
        PrimType.CAPSULE -> capsule(spec["radius"], spec["height"], spec.int("segments"), spec.int("rings"))
        PrimType.TUBE -> tube(spec["outer"], spec["inner"].coerceAtMost(spec["outer"] * 0.98f), spec["height"], spec.int("segments"))
        PrimType.PYRAMID -> MeshOps.flatShaded(cylinder(spec["base"] * 0.7071f, 0f, spec["height"], 4, 1, rotate = 45f))
    }

    // -------------------------------------------------------------------------------------------
    private fun grid(
        b: MeshBuilder, n: Int,
        ox: Float, oy: Float, oz: Float,
        ux: Float, uy: Float, uz: Float,
        vx: Float, vy: Float, vz: Float,
        map: ((FloatArray) -> Unit)? = null
    ) {
        val base = b.vertexCount
        val p = FloatArray(3)
        for (j in 0..n) for (i in 0..n) {
            val fu = i.toFloat() / n; val fv = j.toFloat() / n
            p[0] = ox + ux * fu + vx * fv
            p[1] = oy + uy * fu + vy * fv
            p[2] = oz + uz * fu + vz * fv
            map?.invoke(p)
            b.vertex(p[0], p[1], p[2], fu, 1f - fv)
        }
        val row = n + 1
        for (j in 0 until n) for (i in 0 until n) {
            val a = base + j * row + i
            b.quad(a, a + 1, a + row + 1, a + row)
        }
    }

    private fun boxFaces(b: MeshBuilder, hx: Float, hy: Float, hz: Float, n: Int, map: ((FloatArray) -> Unit)?) {
        grid(b, n, hx, -hy, hz, 0f, 0f, -2 * hz, 0f, 2 * hy, 0f, map)     // +X
        grid(b, n, -hx, -hy, -hz, 0f, 0f, 2 * hz, 0f, 2 * hy, 0f, map)    // -X
        grid(b, n, -hx, hy, hz, 2 * hx, 0f, 0f, 0f, 0f, -2 * hz, map)     // +Y
        grid(b, n, -hx, -hy, -hz, 2 * hx, 0f, 0f, 0f, 0f, 2 * hz, map)    // -Y
        grid(b, n, -hx, -hy, hz, 2 * hx, 0f, 0f, 0f, 2 * hy, 0f, map)     // +Z
        grid(b, n, hx, -hy, -hz, -2 * hx, 0f, 0f, 0f, 2 * hy, 0f, map)    // -Z
    }

    fun box(w: Float, h: Float, d: Float, divisions: Int = 1): Mesh {
        val b = MeshBuilder().also { it.hasUv = true }
        boxFaces(b, w / 2, h / 2, d / 2, max(1, divisions), null)
        return b.build()
    }

    /** Spherified cube: evenly distributed quads, ideal for sculpting. */
    fun quadSphere(radius: Float, res: Int): Mesh {
        val b = MeshBuilder().also { it.hasUv = true }
        boxFaces(b, 1f, 1f, 1f, max(1, res)) { p ->
            val x = p[0]; val y = p[1]; val z = p[2]
            val x2 = x * x; val y2 = y * y; val z2 = z * z
            p[0] = x * sqrt(1f - y2 / 2f - z2 / 2f + y2 * z2 / 3f) * radius
            p[1] = y * sqrt(1f - z2 / 2f - x2 / 2f + z2 * x2 / 3f) * radius
            p[2] = z * sqrt(1f - x2 / 2f - y2 / 2f + x2 * y2 / 3f) * radius
        }
        return b.build()
    }

    fun uvSphere(radius: Float, segments: Int, rings: Int): Mesh {
        val s = max(3, segments); val r = max(2, rings)
        val b = MeshBuilder().also { it.hasUv = true }
        for (i in 0..r) {
            val phi = i.toFloat() / r * PI.toFloat()
            for (j in 0..s) {
                val th = j.toFloat() / s * 2f * PI.toFloat()
                b.vertex(radius * sin(phi) * sin(th), radius * cos(phi), radius * sin(phi) * cos(th), j.toFloat() / s, i.toFloat() / r)
            }
        }
        val row = s + 1
        for (i in 0 until r) for (j in 0 until s) {
            val a = i * row + j
            val bb = (i + 1) * row + j
            val c = bb + 1
            val d = a + 1
            if (i != r - 1) b.tri(a, bb, c)   // bb, c collapse onto the south pole on the last ring
            if (i != 0) b.tri(a, c, d)        // a, d collapse onto the north pole on the first ring
        }
        // the extra pole duplicates (one per ring end) are unused -> drop them
        return MeshOps.removeUnused(MeshOps.removeDegenerate(b.build()))
    }

    fun icoSphere(radius: Float, detail: Int): Mesh {
        val t = (1f + sqrt(5f)) / 2f
        val verts = FloatArrayList(64)
        fun addV(x: Float, y: Float, z: Float): Int {
            val l = sqrt(x * x + y * y + z * z); verts.add(x / l, y / l, z / l); return verts.size / 3 - 1
        }
        addV(-1f, t, 0f); addV(1f, t, 0f); addV(-1f, -t, 0f); addV(1f, -t, 0f)
        addV(0f, -1f, t); addV(0f, 1f, t); addV(0f, -1f, -t); addV(0f, 1f, -t)
        addV(t, 0f, -1f); addV(t, 0f, 1f); addV(-t, 0f, -1f); addV(-t, 0f, 1f)
        var faces = intArrayOf(
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
        )
        repeat(MathUtil.clamp(detail, 0, 7)) {
            val cache = HashMap<Long, Int>()
            fun mid(a: Int, b: Int): Int {
                val key = if (a < b) a.toLong() shl 32 or b.toLong() else b.toLong() shl 32 or a.toLong()
                return cache.getOrPut(key) {
                    addV(
                        (verts[a * 3] + verts[b * 3]) / 2, (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2,
                        (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2
                    )
                }
            }
            val nf = IntArrayList(faces.size * 4)
            for (f in 0 until faces.size / 3) {
                val a = faces[f * 3]; val b = faces[f * 3 + 1]; val c = faces[f * 3 + 2]
                val ab = mid(a, b); val bc = mid(b, c); val ca = mid(c, a)
                nf.add(a); nf.add(ab); nf.add(ca)
                nf.add(b); nf.add(bc); nf.add(ab)
                nf.add(c); nf.add(ca); nf.add(bc)
                nf.add(ab); nf.add(bc); nf.add(ca)
            }
            faces = nf.toArray()
        }
        val p = verts.toArray()
        for (i in p.indices) p[i] *= radius
        return Mesh(p, faces)
    }

    fun cylinder(rBottom: Float, rTop: Float, height: Float, segments: Int, hsegs: Int, caps: Boolean = true, rotate: Float = 0f): Mesh {
        val s = max(3, segments); val hs = max(1, hsegs)
        val b = MeshBuilder().also { it.hasUv = true }
        val h2 = height / 2
        val rot = rotate * MathUtil.DEG
        for (k in 0..hs) {
            val f = k.toFloat() / hs
            val y = -h2 + f * height
            val r = rBottom + (rTop - rBottom) * f
            for (j in 0..s) {
                val th = j.toFloat() / s * 2f * PI.toFloat() + rot
                b.vertex(r * sin(th), y, r * cos(th), j.toFloat() / s, 1f - f)
            }
        }
        val row = s + 1
        for (k in 0 until hs) for (j in 0 until s) {
            val a = k * row + j
            b.quad(a, a + 1, a + row + 1, a + row)
        }
        if (caps) {
            if (rBottom > 0f) {
                val c = b.vertex(0f, -h2, 0f, 0.5f, 0.5f)
                val st = b.vertexCount
                for (j in 0..s) {
                    val th = j.toFloat() / s * 2f * PI.toFloat() + rot
                    b.vertex(rBottom * sin(th), -h2, rBottom * cos(th), 0.5f + 0.5f * sin(th), 0.5f + 0.5f * cos(th))
                }
                for (j in 0 until s) b.tri(c, st + j + 1, st + j)
            }
            if (rTop > 0f) {
                val c = b.vertex(0f, h2, 0f, 0.5f, 0.5f)
                val st = b.vertexCount
                for (j in 0..s) {
                    val th = j.toFloat() / s * 2f * PI.toFloat() + rot
                    b.vertex(rTop * sin(th), h2, rTop * cos(th), 0.5f + 0.5f * sin(th), 0.5f - 0.5f * cos(th))
                }
                for (j in 0 until s) b.tri(c, st + j, st + j + 1)
            }
        }
        return MeshOps.removeDegenerate(b.build())
    }

    fun torus(major: Float, minor: Float, segments: Int, sides: Int): Mesh {
        val s = max(3, segments); val n = max(3, sides)
        val b = MeshBuilder().also { it.hasUv = true }
        for (i in 0..n) {
            val phi = i.toFloat() / n * 2f * PI.toFloat()
            for (j in 0..s) {
                val th = j.toFloat() / s * 2f * PI.toFloat()
                val rr = major + minor * cos(phi)
                b.vertex(rr * sin(th), minor * sin(phi), rr * cos(th), j.toFloat() / s, i.toFloat() / n)
            }
        }
        val row = s + 1
        for (i in 0 until n) for (j in 0 until s) {
            val a = i * row + j
            b.quad(a, a + 1, a + row + 1, a + row)
        }
        return b.build()
    }

    fun plane(w: Float, d: Float, divisions: Int): Mesh {
        val b = MeshBuilder().also { it.hasUv = true }
        grid(b, max(1, divisions), -w / 2, 0f, d / 2, w, 0f, 0f, 0f, 0f, -d, null)
        return b.build()
    }

    fun capsule(radius: Float, bodyHeight: Float, segments: Int, capRings: Int): Mesh {
        val prof = ArrayList<FloatArray>()
        val h2 = bodyHeight / 2
        val cr = max(2, capRings)
        for (i in 0..cr) { // bottom hemisphere from pole up to equator
            val a = -PI.toFloat() / 2 + i.toFloat() / cr * PI.toFloat() / 2
            prof.add(floatArrayOf(radius * cos(a), -h2 + radius * sin(a)))
        }
        val bodySegs = max(1, (bodyHeight / (radius * 0.25f)).roundToInt().coerceAtMost(32))
        for (i in 1 until bodySegs) prof.add(floatArrayOf(radius, -h2 + bodyHeight * i / bodySegs))
        for (i in 0..cr) {
            val a = i.toFloat() / cr * PI.toFloat() / 2
            prof.add(floatArrayOf(radius * cos(a), h2 + radius * sin(a)))
        }
        prof.first()[0] = 0f; prof.last()[0] = 0f
        return lathe(listOf(prof), segments)
    }

    fun tube(outer: Float, inner: Float, height: Float, segments: Int): Mesh {
        val h2 = height / 2
        val strips = listOf(
            listOf(floatArrayOf(outer, -h2), floatArrayOf(outer, 0f), floatArrayOf(outer, h2)),
            listOf(floatArrayOf(outer, h2), floatArrayOf(inner, h2)),
            listOf(floatArrayOf(inner, h2), floatArrayOf(inner, 0f), floatArrayOf(inner, -h2)),
            listOf(floatArrayOf(inner, -h2), floatArrayOf(outer, -h2))
        )
        return lathe(strips, segments)
    }

    /**
     * Revolve 2D profile strips (radius, y) around the Y axis. Each strip is a polyline that should run
     * so that the outside of the surface is on its right when walking from start to end with +y up
     * (i.e. bottom->top for an outer wall). Separate strips give hard edges between them.
     */
    fun lathe(strips: List<List<FloatArray>>, segments: Int, uvScaleV: Float = 1f): Mesh {
        val s = max(3, segments)
        val b = MeshBuilder().also { it.hasUv = true }
        for (prof in strips) {
            if (prof.size < 2) continue
            val lens = FloatArray(prof.size)
            for (k in 1 until prof.size) {
                val dx = prof[k][0] - prof[k - 1][0]; val dy = prof[k][1] - prof[k - 1][1]
                lens[k] = lens[k - 1] + sqrt(dx * dx + dy * dy)
            }
            val total = max(1e-6f, lens.last())
            val base = b.vertexCount
            for (k in prof.indices) {
                val r = prof[k][0]; val y = prof[k][1]
                for (j in 0..s) {
                    val th = j.toFloat() / s * 2f * PI.toFloat()
                    b.vertex(r * sin(th), y, r * cos(th), j.toFloat() / s, (1f - lens[k] / total) * uvScaleV)
                }
            }
            val row = s + 1
            for (k in 0 until prof.size - 1) for (j in 0 until s) {
                val a = base + k * row + j
                b.quad(a, a + 1, a + row + 1, a + row)
            }
        }
        return MeshOps.removeDegenerate(b.build())
    }
}
