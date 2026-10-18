package app.glbandme.core.scene

import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshBuilder
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.Primitives
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import kotlin.math.cos

/** KHR_lights_punctual light types. Spot and sun lights shine along the object's local −Z. */
enum class LightType(val label: String, val gltf: String) { POINT("Point", "point"), SPOT("Spot", "spot"), SUN("Sun", "directional") }

class LightSpec(
    var type: LightType = LightType.POINT,
    /** linear rgb */
    val color: FloatArray = floatArrayOf(1f, 1f, 1f),
    /** candela for point / spot, lux-like multiplier for sun (glTF units) */
    var intensity: Float = 8f,
    /** 0 = infinite */
    var range: Float = 0f,
    /** radians */
    var innerCone: Float = 0.3f,
    var outerCone: Float = 0.6f,
) {
    fun copy() = LightSpec(type, color.copyOf(), intensity, range, innerCone, outerCone)

    fun copyFrom(o: LightSpec) { type = o.type; o.color.copyInto(color); intensity = o.intensity; range = o.range; innerCone = o.innerCone; outerCone = o.outerCone }

    /** glTF spot cone attenuation: scale & offset for clamp(cosAngle * scale + offset). */
    fun coneScaleOffset(): Pair<Float, Float> {
        val ci = cos(innerCone.coerceAtMost(outerCone - 0.001f)); val co = cos(outerCone)
        val scale = 1f / maxOf(0.001f, ci - co)
        return scale to -co * scale
    }

    fun toGltf(name: String): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("name" to name, "type" to type.gltf, "color" to color.toList(), "intensity" to intensity)
        if (range > 0f && type != LightType.SUN) m["range"] = range
        if (type == LightType.SPOT) m["spot"] = mapOf("innerConeAngle" to innerCone, "outerConeAngle" to outerCone)
        return m
    }

    companion object {
        fun defaults(type: LightType) = when (type) {
            LightType.POINT -> LightSpec(type, floatArrayOf(1f, 0.92f, 0.82f), 8f)
            LightType.SPOT -> LightSpec(type, floatArrayOf(1f, 1f, 1f), 20f, 0f, 0.25f, 0.5f)
            LightType.SUN -> LightSpec(type, floatArrayOf(1f, 0.96f, 0.9f), 2.5f)
        }

        fun fromGltf(m: Map<String, Any?>): LightSpec? {
            val type = LightType.values().firstOrNull { it.gltf == m["type"] } ?: return null
            val l = LightSpec(type)
            (m["color"] as? List<*>)?.mapNotNull { (it as? Number)?.toFloat() }?.takeIf { it.size == 3 }?.forEachIndexed { i, v -> l.color[i] = v }
            l.intensity = (m["intensity"] as? Number)?.toFloat() ?: 1f
            l.range = (m["range"] as? Number)?.toFloat() ?: 0f
            (m["spot"] as? Map<*, *>)?.let { s ->
                l.innerCone = (s["innerConeAngle"] as? Number)?.toFloat() ?: 0f
                l.outerCone = (s["outerConeAngle"] as? Number)?.toFloat() ?: (Math.PI / 4).toFloat()
            }
            return l
        }
    }
}

/** Small on-screen stand-ins so lights can be seen, picked and moved in the viewport. */
object LightProxy {
    fun mesh(type: LightType): Mesh {
        val bulb = Primitives.icoSphere(0.06f, 2)
        return when (type) {
            LightType.POINT -> bulb
            LightType.SPOT -> {
                // cone opening towards -Z: build along +Y then rotate
                val cone = Primitives.cylinder(0.09f, 0.0f, 0.16f, 16, 1)
                val rot = Mat4.fromTRS(Vec3(0f, 0f, -0.08f), Quat.fromEulerDeg(-90f, 0f, 0f), Vec3(1f, 1f, 1f))
                MeshOps.flatShaded(MeshBuilder.merge(listOf(bulb to null, cone to rot)))
            }
            LightType.SUN -> {
                val shaft = Primitives.cylinder(0.012f, 0.012f, 0.22f, 8, 1)
                val head = Primitives.cylinder(0.035f, 0f, 0.07f, 12, 1)
                val r1 = Mat4.fromTRS(Vec3(0f, 0f, -0.15f), Quat.fromEulerDeg(-90f, 0f, 0f), Vec3(1f, 1f, 1f))
                val r2 = Mat4.fromTRS(Vec3(0f, 0f, -0.29f), Quat.fromEulerDeg(-90f, 0f, 0f), Vec3(1f, 1f, 1f))
                MeshBuilder.merge(listOf(Primitives.icoSphere(0.07f, 2) to null, shaft to r1, head to r2))
            }
        }
    }

    fun material(l: LightSpec): Material = Material(name = "Light").apply {
        unlit = true
        val mx = maxOf(l.color[0], l.color[1], l.color[2], 1e-4f)
        baseColor[0] = l.color[0] / mx; baseColor[1] = l.color[1] / mx; baseColor[2] = l.color[2] / mx
    }

    fun create(type: LightType, name: String = "${type.label} light"): SceneObject {
        val spec = LightSpec.defaults(type)
        val o = SceneObject(name, mesh(type), material(spec))
        o.light = spec
        o.locked = true
        return o
    }
}
