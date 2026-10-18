package app.glbandme.core.templates

import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshBuilder
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.Noise
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Color
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.ShadingMode
import app.glbandme.math.Mat4
import app.glbandme.math.MathUtil
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

class Template(
    val id: String,
    val name: String,
    val category: String,
    val description: String,
    val animated: Boolean = false,
    val build: () -> Scene
)

/** Procedurally generated starter scenes. */
object Templates {

    val categories = listOf("All", "Sculpting", "Characters", "Props", "Nature", "Game Assets", "Scenes")

    val all: List<Template> by lazy {
        listOf(
            Template("sculpt_base", "Sculpt Base", "Sculpting", "Dense, evenly spaced sphere ready for clay brushes.") { sculptBase() },
            Template("head_base", "Head Base", "Sculpting", "Proportioned head blockout with neck to start a character bust.") { headBase() },
            Template("character_base", "Character Base", "Characters", "Low-poly humanoid blockout made of editable parts.") { characterBase() },
            Template("robot", "Robot Buddy", "Characters", "Cute robot with glowing eyes and a waving animation.", animated = true) { robot() },
            Template("snowman", "Snowman", "Characters", "Classic snowman with carrot nose, hat and scarf.") { snowman() },
            Template("tree", "Low-poly Tree", "Nature", "Faceted stylised tree with vertex-colored foliage.") { tree() },
            Template("rock", "Rock", "Nature", "Noise-displaced boulder with natural color variation.") { rock() },
            Template("mushroom", "Mushroom", "Nature", "Toadstool with spotted cap.") { mushroom() },
            Template("crystals", "Crystal Cluster", "Nature", "Glowing crystals growing from a rock base.") { crystals() },
            Template("island", "Tiny Island", "Scenes", "Terrain, water and a palm tree – a mini diorama.") { island() },
            Template("planet", "Planet & Rings", "Scenes", "Ringed planet with a moon in orbit.", animated = true) { planet() },
            Template("pedestal", "Product Stage", "Scenes", "Pedestal and curved backdrop for presenting a model.") { pedestal() },
            Template("house", "Little House", "Props", "Cottage with roof, chimney, door and lit windows.") { house() },
            Template("pawn", "Chess Pawn", "Props", "Turned chess piece built from a lathe profile.") { pawn() },
            Template("vase", "Vase", "Props", "Glazed ceramic vase with a curvy silhouette.") { vase() },
            Template("mug", "Coffee Mug", "Props", "Ceramic mug with handle, filled with coffee.") { mug() },
            Template("donut", "Donut", "Props", "Iced donut with sprinkles.") { donut() },
            Template("sword", "Sword", "Game Assets", "Fantasy sword with golden guard.") { sword() },
            Template("coin", "Spinning Coin", "Game Assets", "Gold coin pickup with spin animation.", animated = true) { coin() },
            Template("chest", "Treasure Chest", "Game Assets", "Wooden chest with metal bands and a lid that opens.", animated = true) { chest() },
        )
    }

    fun byId(id: String) = all.firstOrNull { it.id == id }

    // =========================================================================================
    // helpers
    // =========================================================================================
    private fun mat(name: String, hex: Int, metal: Float = 0f, rough: Float = 0.5f, block: Material.() -> Unit = {}): Material {
        val m = Material(name = name)
        m.setBaseColorSrgb(hex)
        m.metallic = metal; m.roughness = rough
        m.block()
        return m
    }

    private fun Scene.obj(name: String, mesh: Mesh, m: Material, t: Vec3 = Vec3(), euler: Vec3 = Vec3(), s: Vec3 = Vec3(1f, 1f, 1f), prim: PrimitiveSpec? = null): SceneObject {
        val o = SceneObject(uniqueName(name), mesh, m)
        o.position.set(t); o.rotation.set(Quat.fromEulerDeg(euler.x, euler.y, euler.z)); o.scale.set(s)
        o.primitive = prim
        add(o, select = false)
        return o
    }

    private fun prim(type: PrimType, vararg p: Pair<String, Float>): Pair<Mesh, PrimitiveSpec> {
        val spec = PrimitiveSpec(type, mutableMapOf(*p))
        return spec.build() to spec
    }

    private fun Scene.primObj(name: String, type: PrimType, m: Material, t: Vec3 = Vec3(), euler: Vec3 = Vec3(), s: Vec3 = Vec3(1f, 1f, 1f), p: Array<Pair<String, Float>> = emptyArray()): SceneObject {
        val (mesh, spec) = prim(type, *p)
        return obj(name, mesh, m, t, euler, s, spec)
    }

    private inline fun displace(m: Mesh, f: (x: Float, y: Float, z: Float, nx: Float, ny: Float, nz: Float) -> Float): Mesh {
        val p = m.positions; val n = m.normals
        val w = m.weld()
        val off = FloatArray(m.vertexCount)
        for (v in 0 until m.vertexCount) if (w.rep[v] == v) off[v] = f(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], n[v * 3], n[v * 3 + 1], n[v * 3 + 2])
        val nn = n.copyOf()
        for (v in 0 until m.vertexCount) {
            val r = w.rep[v]
            val d = off[r]
            p[v * 3] += nn[r * 3] * d; p[v * 3 + 1] += nn[r * 3 + 1] * d; p[v * 3 + 2] += nn[r * 3 + 2] * d
        }
        m.computeNormals()
        return m
    }

    private inline fun warp(m: Mesh, f: (FloatArray) -> Unit): Mesh {
        val p = m.positions
        val tmp = FloatArray(3)
        for (v in 0 until m.vertexCount) {
            tmp[0] = p[v * 3]; tmp[1] = p[v * 3 + 1]; tmp[2] = p[v * 3 + 2]
            f(tmp)
            p[v * 3] = tmp[0]; p[v * 3 + 1] = tmp[1]; p[v * 3 + 2] = tmp[2]
        }
        m.computeNormals()
        return m
    }

    private inline fun colorize(m: Mesh, f: (x: Float, y: Float, z: Float) -> Int): Mesh {
        val c = m.ensureColors()
        val p = m.positions
        for (v in 0 until m.vertexCount) {
            val lin = Color.hexToLinear(f(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]))
            c[v * 4] = lin[0]; c[v * 4 + 1] = lin[1]; c[v * 4 + 2] = lin[2]; c[v * 4 + 3] = 1f
        }
        m.markColorsDirty()
        return m
    }

    private fun lerpHex(a: Int, b: Int, t: Float): Int {
        val tt = t.coerceIn(0f, 1f)
        fun ch(s: Int) = (((a shr s) and 0xff) + ((((b shr s) and 0xff) - ((a shr s) and 0xff)) * tt)).toInt().coerceIn(0, 255)
        return (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    private fun tf(t: Vec3 = Vec3(), e: Vec3 = Vec3(), s: Vec3 = Vec3(1f, 1f, 1f)) = Mat4.fromTRS(t, Quat.fromEulerDeg(e.x, e.y, e.z), s)
    private fun v(x: Float, y: Float, z: Float) = Vec3(x, y, z)
    private fun prof(vararg xy: Float): List<FloatArray> = (0 until xy.size / 2).map { floatArrayOf(xy[it * 2], xy[it * 2 + 1]) }

    private fun spin(o: SceneObject, frames: Int, axis: Vec3 = Vec3(0f, 1f, 0f)) {
        for (i in 0..4) {
            val f = frames * i / 4
            o.keys[f] = Keyframe(o.position.copy(), (Quat.axisAngle(axis, i * MathUtil.PI / 2f) * o.rotation).normalize(), o.scale.copy())
        }
    }

    /** Wedge/triangular prism along Z, apex up. */
    private fun prism(w: Float, h: Float, d: Float): Mesh {
        val b = MeshBuilder().also { it.hasUv = true }
        val hw = w / 2; val hd = d / 2
        // front & back triangles
        var a = b.vertex(-hw, 0f, hd, 0f, 1f); var c = b.vertex(hw, 0f, hd, 1f, 1f); var t = b.vertex(0f, h, hd, 0.5f, 0f)
        b.tri(a, c, t)
        a = b.vertex(hw, 0f, -hd, 0f, 1f); c = b.vertex(-hw, 0f, -hd, 1f, 1f); t = b.vertex(0f, h, -hd, 0.5f, 0f)
        b.tri(a, c, t)
        // slopes
        var q0 = b.vertex(hw, 0f, hd, 0f, 1f); var q1 = b.vertex(hw, 0f, -hd, 1f, 1f); var q2 = b.vertex(0f, h, -hd, 1f, 0f); var q3 = b.vertex(0f, h, hd, 0f, 0f)
        b.quad(q0, q1, q2, q3)
        q0 = b.vertex(-hw, 0f, -hd, 0f, 1f); q1 = b.vertex(-hw, 0f, hd, 1f, 1f); q2 = b.vertex(0f, h, hd, 1f, 0f); q3 = b.vertex(0f, h, -hd, 0f, 0f)
        b.quad(q0, q1, q2, q3)
        // bottom
        q0 = b.vertex(-hw, 0f, -hd, 0f, 0f); q1 = b.vertex(hw, 0f, -hd, 1f, 0f); q2 = b.vertex(hw, 0f, hd, 1f, 1f); q3 = b.vertex(-hw, 0f, hd, 0f, 1f)
        b.quad(q0, q1, q2, q3)
        return b.build()
    }

    // =========================================================================================
    // templates
    // =========================================================================================
    private fun sculptBase() = Scene().apply {
        val o = primObj("Sculpt", PrimType.SCULPT_SPHERE, Material.preset(MaterialPreset.CLAY), v(0f, 0.5f, 0f), p = arrayOf("radius" to 0.5f, "res" to 48f))
        o.primitive = null
        render.shading = ShadingMode.MATCAP
        selected = o
    }

    private fun headBase() = Scene().apply {
        val m = Primitives.quadSphere(0.5f, 40)
        warp(m) { p ->
            val x = p[0]; val y = p[1]; val z = p[2]
            // egg shape: wider at the top, narrow jaw
            val jaw = MathUtil.smoothstep(0.05f, -0.45f, y)
            p[0] = x * (0.82f - 0.22f * jaw)
            p[2] = z * (0.95f - 0.12f * jaw) + (if (z > 0) 0.04f * jaw else 0f)
            p[1] = y * 1.12f
            // chin forward
            if (y < -0.25f && z > 0) p[2] += 0.05f * MathUtil.smoothstep(-0.25f, -0.5f, y)
            // back of skull
            if (z < 0 && y > -0.1f) p[2] *= 1.08f
        }
        fun g(x: Float, y: Float, z: Float, cx: Float, cy: Float, cz: Float, s: Float) =
            exp(-((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz)) / (2 * s * s))
        displace(m) { x, y, z, _, _, _ ->
            0.055f * g(x, y, z, 0f, -0.02f, 0.47f, 0.06f) +               // nose
                0.03f * g(x, y, z, 0f, -0.1f, 0.45f, 0.05f) -
                0.05f * g(x, y, z, 0.15f, 0.08f, 0.38f, 0.06f) -               // eye sockets
                0.05f * g(x, y, z, -0.15f, 0.08f, 0.38f, 0.06f) +
                0.025f * g(x, y, z, 0.15f, 0.17f, 0.42f, 0.07f) +              // brow
                0.025f * g(x, y, z, -0.15f, 0.17f, 0.42f, 0.07f) +
                0.03f * g(x, y, z, 0.38f, 0.0f, 0.0f, 0.06f) +                 // ears
                0.03f * g(x, y, z, -0.38f, 0.0f, 0.0f, 0.06f) +
                0.02f * g(x, y, z, 0.2f, -0.12f, 0.36f, 0.08f) +               // cheeks
                0.02f * g(x, y, z, -0.2f, -0.12f, 0.36f, 0.08f)
        }
        val skin = Material.preset(MaterialPreset.SKIN)
        val head = obj("Head", m, skin, v(0f, 1.15f, 0f))
        primObj("Neck", PrimType.CYLINDER, skin.copy(), v(0f, 0.65f, -0.03f), s = v(1f, 1f, 0.9f), p = arrayOf("radius" to 0.17f, "height" to 0.5f, "segments" to 32f, "hsegs" to 8f))
        render.shading = ShadingMode.MATCAP
        selected = head
    }

    private fun characterBase() = Scene().apply {
        val skin = Material.preset(MaterialPreset.CLAY)
        primObj("Head", PrimType.SCULPT_SPHERE, skin, v(0f, 1.62f, 0f), s = v(0.9f, 1.1f, 1f), p = arrayOf("radius" to 0.12f, "res" to 16f))
        primObj("Neck", PrimType.CYLINDER, skin.copy(), v(0f, 1.45f, 0f), p = arrayOf("radius" to 0.05f, "height" to 0.12f, "segments" to 16f, "hsegs" to 2f))
        primObj("Torso", PrimType.CAPSULE, skin.copy(), v(0f, 1.15f, 0f), s = v(1.25f, 1f, 0.75f), p = arrayOf("radius" to 0.16f, "height" to 0.3f, "segments" to 24f, "rings" to 8f))
        primObj("Hips", PrimType.CAPSULE, skin.copy(), v(0f, 0.88f, 0f), euler = v(0f, 0f, 90f), s = v(1f, 1f, 0.8f), p = arrayOf("radius" to 0.12f, "height" to 0.12f, "segments" to 24f, "rings" to 8f))
        for (side in listOf(-1f, 1f)) {
            val sn = if (side < 0) "R" else "L"
            primObj("UpperArm.$sn", PrimType.CAPSULE, skin.copy(), v(0.3f * side, 1.2f, 0f), euler = v(0f, 0f, side * 12f), p = arrayOf("radius" to 0.045f, "height" to 0.22f, "segments" to 16f, "rings" to 6f))
            primObj("Forearm.$sn", PrimType.CAPSULE, skin.copy(), v(0.36f * side, 0.92f, 0f), euler = v(0f, 0f, side * 6f), p = arrayOf("radius" to 0.04f, "height" to 0.22f, "segments" to 16f, "rings" to 6f))
            primObj("Hand.$sn", PrimType.SCULPT_SPHERE, skin.copy(), v(0.385f * side, 0.73f, 0f), s = v(0.6f, 1f, 0.35f), p = arrayOf("radius" to 0.07f, "res" to 6f))
            primObj("Thigh.$sn", PrimType.CAPSULE, skin.copy(), v(0.1f * side, 0.62f, 0f), p = arrayOf("radius" to 0.07f, "height" to 0.28f, "segments" to 16f, "rings" to 6f))
            primObj("Shin.$sn", PrimType.CAPSULE, skin.copy(), v(0.1f * side, 0.26f, 0f), p = arrayOf("radius" to 0.055f, "height" to 0.3f, "segments" to 16f, "rings" to 6f))
            primObj("Foot.$sn", PrimType.CUBE, skin.copy(), v(0.1f * side, 0.035f, 0.05f), p = arrayOf("width" to 0.1f, "height" to 0.07f, "depth" to 0.24f, "divisions" to 2f))
        }
        render.shading = ShadingMode.MATCAP
    }

    private fun robot() = Scene().apply {
        val body = mat("Body", 0xE8ECF2, 0.2f, 0.35f)
        val dark = mat("Dark", 0x2B3040, 0.6f, 0.4f)
        val accent = mat("Accent", 0xFF7A45, 0f, 0.3f)
        val glow = mat("Eyes", 0x00E5FF, 0f, 0.3f) { emissive[0] = 0f; emissive[1] = 0.85f; emissive[2] = 1f; emissiveStrength = 3f }
        val torso = primObj("Body", PrimType.CUBE, body, v(0f, 0.75f, 0f), p = arrayOf("width" to 0.7f, "height" to 0.6f, "depth" to 0.5f, "divisions" to 4f))
        primObj("Chest Light", PrimType.CYLINDER, accent, v(0f, 0.8f, 0.255f), euler = v(90f, 0f, 0f), p = arrayOf("radius" to 0.09f, "height" to 0.02f, "segments" to 32f, "hsegs" to 1f))
        val head = primObj("Head", PrimType.CUBE, body.copy(), v(0f, 1.3f, 0f), p = arrayOf("width" to 0.62f, "height" to 0.42f, "depth" to 0.48f, "divisions" to 4f))
        val visor = primObj("Visor", PrimType.CUBE, dark, v(0f, 1.3f, 0.21f), p = arrayOf("width" to 0.5f, "height" to 0.24f, "depth" to 0.08f, "divisions" to 1f))
        val eyeL = primObj("Eye.L", PrimType.SPHERE, glow, v(0.12f, 1.31f, 0.255f), s = v(1f, 1f, 0.4f), p = arrayOf("radius" to 0.055f, "segments" to 24f, "rings" to 12f))
        val eyeR = primObj("Eye.R", PrimType.SPHERE, glow.copy(), v(-0.12f, 1.31f, 0.255f), s = v(1f, 1f, 0.4f), p = arrayOf("radius" to 0.055f, "segments" to 24f, "rings" to 12f))
        val ant = primObj("Antenna", PrimType.CYLINDER, dark.copy(), v(0f, 1.6f, 0f), p = arrayOf("radius" to 0.015f, "height" to 0.2f, "segments" to 12f, "hsegs" to 1f))
        val tip = primObj("Antenna Tip", PrimType.SPHERE, accent.copy(), v(0f, 1.72f, 0f), p = arrayOf("radius" to 0.045f, "segments" to 20f, "rings" to 10f))
        val armL = primObj("Arm.L", PrimType.CAPSULE, dark.copy(), v(0.45f, 0.72f, 0f), euler = v(0f, 0f, 10f), p = arrayOf("radius" to 0.07f, "height" to 0.35f, "segments" to 20f, "rings" to 6f))
        primObj("Arm.R", PrimType.CAPSULE, dark.copy(), v(-0.45f, 0.72f, 0f), euler = v(0f, 0f, -10f), p = arrayOf("radius" to 0.07f, "height" to 0.35f, "segments" to 20f, "rings" to 6f))
        for (side in listOf(-1f, 1f)) {
            primObj("Wheel", PrimType.TORUS, mat("Tire", 0x1C1C1F, 0f, 0.9f), v(0.24f * side, 0.18f, 0f), euler = v(0f, 0f, 90f), p = arrayOf("major" to 0.12f, "minor" to 0.06f, "segments" to 32f, "sides" to 16f))
            primObj("Hub", PrimType.CYLINDER, accent.copy(), v(0.24f * side, 0.18f, 0f), euler = v(0f, 0f, 90f), p = arrayOf("radius" to 0.08f, "height" to 0.1f, "segments" to 24f, "hsegs" to 1f))
        }
        primObj("Axle", PrimType.CYLINDER, dark.copy(), v(0f, 0.18f, 0f), euler = v(0f, 0f, 90f), p = arrayOf("radius" to 0.04f, "height" to 0.42f, "segments" to 16f, "hsegs" to 1f))
        primObj("Waist", PrimType.CYLINDER, dark.copy(), v(0f, 0.38f, 0f), p = arrayOf("radius" to 0.12f, "height" to 0.25f, "segments" to 24f, "hsegs" to 1f))
        // animation: head bob + wave
        frameCount = 60
        val headParts = listOf(head, visor, eyeL, eyeR, ant, tip)
        for (o in headParts) {
            val base = o.position.copy()
            for ((f, dy, rz) in listOf(Triple(0, 0f, 0f), Triple(15, 0.03f, 6f), Triple(30, 0f, 0f), Triple(45, 0.03f, -6f), Triple(60, 0f, 0f))) {
                // rotate around the head centre
                val q = Quat.fromEulerDeg(0f, 0f, rz)
                val rel = base - head.position
                val p = head.position + q.rotate(rel) + v(0f, dy, 0f)
                o.keys[f] = Keyframe(p, (q * o.rotation).normalize(), o.scale.copy())
            }
        }
        val armBase = armL.rotation.copy()
        for ((f, a) in listOf(0 to 10f, 15 to 140f, 30 to 110f, 45 to 140f, 60 to 10f)) {
            val q = Quat.fromEulerDeg(0f, 0f, a)
            armL.keys[f] = Keyframe(v(0.45f + 0.12f * sin(a * MathUtil.DEG), 0.72f + 0.17f * (1 - cos(a * MathUtil.DEG)), 0f), q, armL.scale.copy())
        }
        armL.rotation.set(armBase)
        selected = torso
    }

    private fun snowman() = Scene().apply {
        val snow = mat("Snow", 0xF7FAFF, 0f, 0.75f)
        primObj("Bottom", PrimType.SCULPT_SPHERE, snow, v(0f, 0.4f, 0f), s = v(1f, 0.92f, 1f), p = arrayOf("radius" to 0.42f, "res" to 24f))
        primObj("Middle", PrimType.SCULPT_SPHERE, snow.copy(), v(0f, 0.98f, 0f), p = arrayOf("radius" to 0.3f, "res" to 24f))
        primObj("Head", PrimType.SCULPT_SPHERE, snow.copy(), v(0f, 1.43f, 0f), p = arrayOf("radius" to 0.21f, "res" to 24f))
        val coal = mat("Coal", 0x151515, 0f, 0.9f)
        for (x in listOf(-0.07f, 0.07f)) primObj("Eye", PrimType.SPHERE, coal.copy(), v(x, 1.48f, 0.19f), p = arrayOf("radius" to 0.025f, "segments" to 12f, "rings" to 6f))
        for (y in listOf(0.88f, 1.0f, 1.12f)) primObj("Button", PrimType.SPHERE, coal.copy(), v(0f, y, 0.29f - abs(y - 1f) * 0.12f), p = arrayOf("radius" to 0.03f, "segments" to 12f, "rings" to 6f))
        primObj("Carrot", PrimType.CONE, mat("Carrot", 0xFF7A1A, 0f, 0.6f), v(0f, 1.42f, 0.29f), euler = v(90f, 0f, 0f), p = arrayOf("radius" to 0.035f, "top" to 0f, "height" to 0.2f, "segments" to 16f, "hsegs" to 2f))
        val wood = mat("Stick", 0x5A3A22, 0f, 0.9f)
        for (side in listOf(-1f, 1f)) primObj("Arm", PrimType.CYLINDER, wood.copy(), v(0.45f * side, 1.08f, 0f), euler = v(0f, 0f, side * 60f), p = arrayOf("radius" to 0.015f, "height" to 0.5f, "segments" to 8f, "hsegs" to 1f))
        val hat = mat("Hat", 0x202024, 0f, 0.6f)
        primObj("Hat Brim", PrimType.CYLINDER, hat, v(0f, 1.6f, 0f), p = arrayOf("radius" to 0.22f, "height" to 0.03f, "segments" to 32f, "hsegs" to 1f))
        primObj("Hat Top", PrimType.CYLINDER, hat.copy(), v(0f, 1.73f, 0f), p = arrayOf("radius" to 0.14f, "height" to 0.24f, "segments" to 32f, "hsegs" to 1f))
        primObj("Hat Band", PrimType.CYLINDER, mat("Band", 0xC62828, 0f, 0.5f), v(0f, 1.64f, 0f), p = arrayOf("radius" to 0.145f, "height" to 0.04f, "segments" to 32f, "hsegs" to 1f))
        primObj("Scarf", PrimType.TORUS, mat("Scarf", 0xD32F2F, 0f, 0.8f), v(0f, 1.25f, 0f), s = v(1f, 0.8f, 1f), p = arrayOf("major" to 0.19f, "minor" to 0.05f, "segments" to 40f, "sides" to 12f))
        obj("Ground", Primitives.cylinder(1.2f, 1.2f, 0.04f, 48, 1), mat("Snow Ground", 0xE9F1FA, 0f, 0.9f), v(0f, -0.02f, 0f))
    }

    private fun tree() = Scene().apply {
        val noise = Noise(7)
        val trunk = MeshOps.flatShaded(Primitives.cylinder(0.11f, 0.07f, 1.0f, 7, 3))
        warp(trunk) { p -> p[0] += 0.04f * sin(p[1] * 3f); }
        obj("Trunk", trunk, mat("Bark", 0x6B4426, 0f, 0.95f), v(0f, 0.5f, 0f))
        val greens = intArrayOf(0x3E8E41, 0x4CAF50, 0x2E7D32)
        val blobs = listOf(Triple(v(0f, 1.25f, 0f), 0.45f, 0), Triple(v(0.25f, 1.05f, 0.1f), 0.32f, 1), Triple(v(-0.22f, 1.1f, -0.12f), 0.34f, 2), Triple(v(0.02f, 1.6f, 0.02f), 0.3f, 1))
        for ((i, b) in blobs.withIndex()) {
            val (pos, r, ci) = b
            val m = Primitives.icoSphere(r, 1)
            displace(m) { x, y, z, _, _, _ -> noise.fbm(x * 3f + i, y * 3f, z * 3f, 2) * r * 0.35f }
            val flat = MeshOps.flatShaded(m)
            colorize(flat) { _, y, _ -> lerpHex(greens[ci], 0x8BC34A, (y / r + 1f) * 0.35f) }
            obj("Leaves", flat, mat("Leaves", 0xFFFFFF, 0f, 0.8f), pos)
        }
        obj("Ground", MeshOps.flatShaded(Primitives.cylinder(0.8f, 0.85f, 0.08f, 9, 1)), mat("Grass", 0x7CB342, 0f, 0.9f), v(0f, -0.04f, 0f))
    }

    private fun rock() = Scene().apply {
        val noise = Noise(42)
        val m = Primitives.icoSphere(0.5f, 3)
        warp(m) { p -> p[1] *= 0.7f }
        displace(m) { x, y, z, _, _, _ -> noise.fbm(x * 2.2f, y * 2.2f, z * 2.2f, 4) * 0.22f }
        warp(m) { p -> if (p[1] < -0.12f) p[1] = -0.12f - (p[1] + 0.12f) * 0.15f }
        val flat = MeshOps.flatShaded(m)
        colorize(flat) { x, y, z -> lerpHex(0x6D6E72, 0xA7A39A, (noise.fbm(x * 5, y * 5, z * 5, 3) + 0.5f)) }
        obj("Rock", flat, mat("Stone", 0xFFFFFF, 0f, 0.92f), v(0f, 0.25f, 0f))
    }

    private fun mushroom() = Scene().apply {
        val stem = Primitives.lathe(listOf(prof(0f, 0f, 0.12f, 0f, 0.13f, 0.05f, 0.1f, 0.3f, 0.09f, 0.5f, 0.1f, 0.6f, 0f, 0.6f)), 32)
        obj("Stem", stem, mat("Stem", 0xF3E9D2, 0f, 0.7f))
        val capProfile = prof(0f, 0.52f, 0.36f, 0.5f, 0.42f, 0.56f, 0.4f, 0.68f, 0.3f, 0.82f, 0.15f, 0.9f, 0f, 0.92f)
        val cap = Primitives.lathe(listOf(capProfile), 48)
        val capObj = obj("Cap", cap, mat("Cap", 0xD32F2F, 0f, 0.35f))
        val white = mat("Spots", 0xFFF8E7, 0f, 0.6f)
        val rnd = Noise(3)
        for (i in 0 until 9) {
            val a = rnd.hash(i) * 2f * MathUtil.PI
            val rr = 0.06f + rnd.hash(i + 50) * 0.3f
            // find the cap surface height at this radius on the upper profile (from rim to top)
            val top = capProfile.drop(2)
            var y = 0.92f; var slope = 0f
            for (k in 0 until top.size - 1) {
                val (r0, y0) = top[k][0] to top[k][1]; val (r1, y1) = top[k + 1][0] to top[k + 1][1]
                if (rr <= r0 && rr >= r1) { val t = (r0 - rr) / (r0 - r1); y = y0 + (y1 - y0) * t; slope = kotlin.math.atan2(y1 - y0, r0 - r1); break }
            }
            val s = 0.035f + rnd.hash(i + 100) * 0.03f
            // tilt the spot to follow the cap surface
            obj("Spot", Primitives.uvSphere(1f, 16, 8), white.copy(), v(rr * cos(a), y - s * 0.1f, rr * sin(a)),
                euler = v(0f, -a / MathUtil.DEG, 0f), s = v(s, s * 0.35f, s)).also { o ->
                o.rotation.set((Quat.axisAngle(v(-sin(a), 0f, cos(a)), -slope * 0.8f) * o.rotation).normalize())
            }
        }
        selected = capObj
    }

    private fun crystals() = Scene().apply {
        val noise = Noise(11)
        val base = Primitives.icoSphere(0.45f, 2)
        warp(base) { p -> p[1] *= 0.35f }
        displace(base) { x, y, z, _, _, _ -> noise.fbm(x * 3, y * 3, z * 3, 3) * 0.1f }
        obj("Rock Base", MeshOps.flatShaded(base), mat("Rock", 0x4A4650, 0f, 0.9f), v(0f, 0.08f, 0f))
        val crystal = mat("Crystal", 0xB388FF, 0f, 0.05f) {
            emissive[0] = 0.45f; emissive[1] = 0.2f; emissive[2] = 1f; emissiveStrength = 1.2f
            alphaMode = AlphaMode.BLEND; baseColor[3] = 0.82f
        }
        val shards = listOf(Triple(0f, 0f, 0.9f), Triple(25f, 18f, 0.6f), Triple(-30f, 120f, 0.7f), Triple(35f, 220f, 0.5f), Triple(-20f, 300f, 0.45f))
        for ((i, s) in shards.withIndex()) {
            val (tilt, yaw, h) = s
            val m = MeshOps.flatShaded(Primitives.lathe(listOf(prof(0f, 0f, 0.09f, 0f, 0.09f, h * 0.75f, 0f, h)), 6))
            obj("Crystal", m, if (i == 0) crystal else crystal.copy(), v(0f, 0.12f, 0f), euler = v(tilt, yaw, 0f))
        }
    }

    private fun island() = Scene().apply {
        val noise = Noise(5)
        val terrain = Primitives.plane(2.6f, 2.6f, 48)
        warp(terrain) { p ->
            // square grid -> disc (radius 1.3) so no corners poke out of the water
            val u = p[0] / 1.3f; val w = p[2] / 1.3f
            p[0] = 1.3f * u * sqrt(max(0f, 1f - w * w / 2f)); p[2] = 1.3f * w * sqrt(max(0f, 1f - u * u / 2f))
            val d = sqrt(p[0] * p[0] + p[2] * p[2])
            val fall = MathUtil.smoothstep(1.35f, 0.3f, d)
            p[1] = (fall * 0.45f + noise.fbm(p[0] * 1.5f, 0f, p[2] * 1.5f, 4) * 0.25f * fall) - 0.16f
        }
        val flatT = MeshOps.flatShaded(terrain)
        colorize(flatT) { _, y, _ ->
            when {
                y < -0.02f -> 0xD8C79A
                y < 0.05f -> 0xEAD9A6
                y < 0.3f -> lerpHex(0x6DAA45, 0x4E8A33, y * 3)
                else -> lerpHex(0x7A7468, 0xEEEEEE, (y - 0.3f) * 4)
            }
        }
        obj("Terrain", flatT, mat("Terrain", 0xFFFFFF, 0f, 0.9f))
        obj("Water", Primitives.cylinder(1.9f, 1.9f, 0.02f, 64, 1), mat("Water", 0x2E9BD6, 0f, 0.05f) { alphaMode = AlphaMode.BLEND; baseColor[3] = 0.82f }, v(0f, -0.02f, 0f))
        // palm
        val trunkParts = ArrayList<Pair<Mesh, FloatArray?>>()
        for (i in 0 until 6) {
            trunkParts.add(Primitives.cylinder(0.05f - i * 0.004f, 0.045f - i * 0.004f, 0.14f, 8, 1) to tf(v(i * i * 0.006f, 0.07f + i * 0.13f, 0f), v(0f, 0f, -i * 3f)))
        }
        val palmBase = v(0.35f, 0.3f, 0.1f)
        obj("Palm Trunk", MeshOps.flatShaded(MeshBuilder.merge(trunkParts)), mat("Palm Bark", 0x8D6E4A, 0f, 0.9f), palmBase)
        val leaves = ArrayList<Pair<Mesh, FloatArray?>>()
        for (i in 0 until 7) {
            val leaf = Primitives.plane(0.12f, 0.5f, 4)
            warp(leaf) { p -> val t = (p[2] + 0.25f) / 0.5f; p[0] *= sin(t * MathUtil.PI) * 1.4f + 0.1f; p[1] -= (0.5f - t) * (0.5f - t) * 0.35f }
            leaves.add(leaf to tf(v(0.15f, 0.82f, 0f), v(15f, i * 360f / 7f, 0f)) )
        }
        val leafMesh = MeshBuilder.merge(leaves.map { (m, t) -> m to Mat4.mul(t!!, tf(v(0f, 0f, 0.25f))) })
        obj("Palm Leaves", MeshOps.flatShaded(leafMesh), mat("Palm Leaf", 0x43A047, 0f, 0.8f) { doubleSided = true }, palmBase)
        obj("Coconut", Primitives.icoSphere(0.04f, 1), mat("Coconut", 0x5D4037, 0f, 0.8f), palmBase + v(0.13f, 0.8f, 0.04f))
        for ((i, p) in listOf(v(-0.5f, 0.2f, 0.3f), v(-0.3f, 0.25f, -0.5f)).withIndex()) {
            val r = Primitives.icoSphere(0.12f + i * 0.04f, 1)
            displace(r) { x, y, z, _, _, _ -> noise.fbm(x * 8, y * 8, z * 8, 2) * 0.05f }
            obj("Rock", MeshOps.flatShaded(r), mat("Rock", 0x8A8580, 0f, 0.9f), p, s = v(1f, 0.7f, 1f))
        }
    }

    private fun planet() = Scene().apply {
        val noise = Noise(21)
        val m = Primitives.quadSphere(0.6f, 32)
        colorize(m) { x, y, z ->
            val bands = sin(y * 14f + noise.fbm(x * 3, y * 3, z * 3, 3) * 4f)
            lerpHex(0xE0A458, 0x9C5B2E, bands * 0.5f + 0.5f)
        }
        val planetObj = obj("Planet", m, mat("Planet", 0xFFFFFF, 0f, 0.7f), v(0f, 1f, 0f), euler = v(18f, 0f, 8f))
        val ring = Primitives.tube(1.1f, 0.78f, 0.01f, 96)
        colorize(ring) { x, _, z -> val r = sqrt(x * x + z * z); lerpHex(0xE8D3A7, 0x8C7B60, (sin(r * 60f) * 0.5f + 0.5f)) }
        val ringObj = obj("Rings", ring, mat("Rings", 0xFFFFFF, 0f, 0.6f) { alphaMode = AlphaMode.BLEND; baseColor[3] = 0.85f; doubleSided = true }, v(0f, 1f, 0f), euler = v(18f, 0f, 8f))
        val moon = obj("Moon", Primitives.icoSphere(0.12f, 3), mat("Moon", 0xBDBDBD, 0f, 0.9f), v(1.5f, 1.2f, 0f))
        frameCount = 120
        spin(planetObj, 120)
        for (i in 0..8) {
            val a = i / 8f * 2f * MathUtil.PI
            moon.keys[i * 15] = Keyframe(v(1.5f * cos(a), 1.2f + 0.2f * sin(a), -1.5f * sin(a)), Quat(), v(1f, 1f, 1f))
        }
        ringObj.keys.clear()
        render.bgTop = 0x141833; render.bgBottom = 0x05060C
        render.showGrid = false
        render.env = app.glbandme.core.scene.EnvPreset.NIGHT
    }

    private fun pedestal() = Scene().apply {
        val stand = Primitives.lathe(listOf(prof(0f, 0f, 0.62f, 0f, 0.62f, 0.06f, 0.55f, 0.08f, 0.55f, 0.36f, 0.6f, 0.38f, 0.6f, 0.42f, 0f, 0.42f)), 64)
        obj("Pedestal", stand, mat("Marble", 0xF2F0EC, 0f, 0.15f))
        // floor that sweeps up into a wall (infinity cove)
        val back = Primitives.plane(3.4f, 1f, 48)
        warp(back) { p ->
            val t = 0.5f - p[2]               // 0 at the front edge .. 1 at the back edge
            val r = 0.6f                       // cove radius
            val floorLen = 1.6f; val wallLen = 1.6f
            val s = t * (floorLen + r * MathUtil.PI / 2 + wallLen)
            when {
                s < floorLen -> { p[1] = 0f; p[2] = 1.2f - s }
                s < floorLen + r * MathUtil.PI / 2 -> { val a = (s - floorLen) / r; p[2] = 1.2f - floorLen - r * sin(a); p[1] = r - r * cos(a) }
                else -> { p[2] = 1.2f - floorLen - r; p[1] = r + (s - floorLen - r * MathUtil.PI / 2) }
            }
        }
        obj("Backdrop", back, mat("Backdrop", 0xD9DCE3, 0f, 0.8f))
        primObj("Showpiece", PrimType.TORUS, Material.preset(MaterialPreset.GOLD), v(0f, 0.78f, 0f), euler = v(60f, 20f, 0f), p = arrayOf("major" to 0.25f, "minor" to 0.09f, "segments" to 64f, "sides" to 24f))
        render.showGrid = false
    }

    private fun house() = Scene().apply {
        primObj("Walls", PrimType.CUBE, mat("Walls", 0xF4E3C1, 0f, 0.85f), v(0f, 0.4f, 0f), p = arrayOf("width" to 1.2f, "height" to 0.8f, "depth" to 0.9f, "divisions" to 2f))
        obj("Roof", prism(1.4f, 0.55f, 1.05f), mat("Roof", 0xB23A2E, 0f, 0.7f), v(0f, 0.8f, 0f), euler = v(0f, 90f, 0f), s = v(0.75f, 1f, 1.3f))
        primObj("Chimney", PrimType.CUBE, mat("Brick", 0x8D4A3A, 0f, 0.9f), v(0.32f, 1.15f, -0.15f), p = arrayOf("width" to 0.16f, "height" to 0.4f, "depth" to 0.16f, "divisions" to 1f))
        primObj("Door", PrimType.CUBE, mat("Door", 0x6D4C41, 0f, 0.6f), v(0f, 0.22f, 0.455f), p = arrayOf("width" to 0.24f, "height" to 0.44f, "depth" to 0.03f, "divisions" to 1f))
        primObj("Knob", PrimType.SPHERE, Material.preset(MaterialPreset.GOLD), v(0.08f, 0.22f, 0.475f), p = arrayOf("radius" to 0.015f, "segments" to 12f, "rings" to 6f))
        val window = mat("Window", 0xFFE7A3, 0f, 0.2f) { emissive[0] = 1f; emissive[1] = 0.75f; emissive[2] = 0.35f; emissiveStrength = 1.4f }
        for (x in listOf(-0.38f, 0.38f)) {
            primObj("Window", PrimType.CUBE, window.copy(), v(x, 0.48f, 0.455f), p = arrayOf("width" to 0.2f, "height" to 0.2f, "depth" to 0.02f, "divisions" to 1f))
            primObj("Frame", PrimType.CUBE, mat("Frame", 0xFFFFFF, 0f, 0.5f), v(x, 0.48f, 0.452f), p = arrayOf("width" to 0.25f, "height" to 0.25f, "depth" to 0.015f, "divisions" to 1f))
        }
        primObj("Window Side", PrimType.CUBE, window.copy(), v(0.605f, 0.48f, 0f), p = arrayOf("width" to 0.02f, "height" to 0.2f, "depth" to 0.22f, "divisions" to 1f))
        primObj("Step", PrimType.CUBE, mat("Stone", 0x9E9E9E, 0f, 0.9f), v(0f, 0.02f, 0.53f), p = arrayOf("width" to 0.36f, "height" to 0.04f, "depth" to 0.14f, "divisions" to 1f))
        obj("Lawn", Primitives.cylinder(1.3f, 1.3f, 0.05f, 48, 1), mat("Grass", 0x7CB342, 0f, 0.9f), v(0f, -0.025f, 0.1f))
    }

    private fun pawn() = Scene().apply {
        val p = prof(
            0f, 0f, 0.3f, 0f, 0.31f, 0.04f, 0.29f, 0.08f, 0.24f, 0.1f, 0.25f, 0.14f, 0.2f, 0.17f, 0.15f, 0.22f, 0.11f, 0.42f,
            0.17f, 0.45f, 0.17f, 0.48f, 0.11f, 0.5f, 0.1f, 0.52f
        ).toMutableList()
        // head sphere on top
        val cy = 0.66f; val r = 0.15f
        for (i in 0..12) {
            val a = -MathUtil.PI / 2 + 0.35f + (MathUtil.PI - 0.35f) * i / 12f
            p.add(floatArrayOf(r * cos(a).coerceAtLeast(0f), cy + r * sin(a)))
        }
        p[p.size - 1][0] = 0f
        obj("Pawn", Primitives.lathe(listOf(p), 64), Material.preset(MaterialPreset.CERAMIC).apply { setBaseColorSrgb(0x222226); roughness = 0.12f })
        obj("Board Tile", Primitives.box(0.8f, 0.05f, 0.8f, 1), mat("Tile", 0xE9DFC9, 0f, 0.3f), v(0f, -0.025f, 0f))
    }

    private fun vase() = Scene().apply {
        val outer = ArrayList<FloatArray>()
        outer.add(floatArrayOf(0f, 0f))
        for (i in 0..24) {
            val t = i / 24f
            val y = t * 1.2f
            val rr = 0.18f + 0.17f * sin(t * MathUtil.PI * 1.2f) - 0.06f * MathUtil.smoothstep(0.7f, 1f, t) + 0.04f * MathUtil.smoothstep(0.92f, 1f, t)
            outer.add(floatArrayOf(rr, y))
        }
        val inner = outer.drop(1).reversed().map { floatArrayOf(it[0] - 0.02f, it[1]) }.filter { it[1] > 0.03f }.toMutableList()
        inner.add(floatArrayOf(0f, 0.03f))
        val lip = listOf(outer.last(), inner.first())
        val m = Primitives.lathe(listOf(outer, lip, inner), 64)
        obj("Vase", m, mat("Glaze", 0x1E5AA8, 0f, 0.08f))
    }

    private fun mug() = Scene().apply {
        val outer = prof(0f, 0f, 0.27f, 0f, 0.28f, 0.02f, 0.3f, 0.6f)
        val lip = prof(0.3f, 0.6f, 0.27f, 0.6f)
        val inner = prof(0.27f, 0.6f, 0.25f, 0.05f, 0f, 0.05f)
        obj("Mug", Primitives.lathe(listOf(outer, lip, inner), 64), Material.preset(MaterialPreset.CERAMIC).apply { setBaseColorSrgb(0xF2EEE6) })
        obj("Handle", Primitives.torus(0.15f, 0.04f, 40, 16), mat("Handle", 0xF2EEE6, 0f, 0.08f), v(0.3f, 0.32f, 0f), euler = v(90f, 0f, 0f), s = v(1f, 1f, 1.25f))
        obj("Coffee", Primitives.cylinder(0.265f, 0.265f, 0.01f, 48, 1), mat("Coffee", 0x3E2215, 0f, 0.15f), v(0f, 0.52f, 0f))
        obj("Saucer", Primitives.lathe(listOf(prof(0f, 0f, 0.42f, 0.0f, 0.45f, 0.04f, 0.43f, 0.045f, 0.3f, 0.02f, 0f, 0.02f)), 64), mat("Saucer", 0xF2EEE6, 0f, 0.08f), v(0f, -0.02f, 0f))
    }

    private fun donut() = Scene().apply {
        val noise = Noise(9)
        val dough = Primitives.torus(0.32f, 0.16f, 64, 32)
        displace(dough) { x, y, z, _, _, _ -> noise.fbm(x * 6, y * 6, z * 6, 3) * 0.012f }
        colorize(dough) { _, y, _ -> lerpHex(0xC98A4B, 0xE7B57A, y / 0.16f * 0.5f + 0.5f) }
        obj("Dough", dough, mat("Dough", 0xFFFFFF, 0f, 0.7f), v(0f, 0.16f, 0f))
        val icing = Primitives.torus(0.32f, 0.168f, 64, 32)
        warp(icing) { p ->
            // keep the top half; drip the edge
            val a = kotlin.math.atan2(p[2], p[0])
            val edge = -0.02f + 0.035f * sin(a * 9f) + 0.02f * sin(a * 23f)
            if (p[1] < edge) p[1] = edge + (p[1] - edge) * 0.05f
        }
        obj("Icing", icing, mat("Icing", 0xF06292, 0f, 0.25f), v(0f, 0.165f, 0f))
        val colors = intArrayOf(0xFFEB3B, 0x42A5F5, 0x66BB6A, 0xFFFFFF, 0xAB47BC)
        val parts = ArrayList<Pair<Mesh, FloatArray?>>()
        for (i in 0 until 70) {
            val a = noise.hash(i) * 2f * MathUtil.PI
            val rr = 0.2f + noise.hash(i + 300) * 0.24f
            val tubeD = rr - 0.32f
            val y = sqrt(max(0f, 0.168f * 0.168f - tubeD * tubeD)) + 0.165f + 0.004f
            val c = Primitives.capsule(0.007f, 0.025f, 6, 2)
            colorize(c) { _, _, _ -> colors[i % colors.size] }
            parts.add(c to tf(v(rr * cos(a), y, rr * sin(a)), v(90f, noise.hash(i + 600) * 360f, 0f)))
        }
        obj("Sprinkles", MeshBuilder.merge(parts), mat("Sprinkles", 0xFFFFFF, 0f, 0.4f))
    }

    private fun sword() = Scene().apply {
        val blade = MeshBuilder().also { it.hasUv = true }
        // diamond cross-section blade with a tip
        val len = 1.1f; val w = 0.055f; val t = 0.012f
        val sec = arrayOf(floatArrayOf(w, 0f), floatArrayOf(0f, t), floatArrayOf(-w, 0f), floatArrayOf(0f, -t))
        val rings = 6
        for (r in 0..rings) {
            val y = len * r / rings
            val k = if (r == rings) 0f else 1f - (r.toFloat() / rings) * 0.15f
            for (s in 0..4) { val q = sec[s % 4]; blade.vertex(q[0] * k, y, q[1] * k, s / 4f, r.toFloat() / rings) }
        }
        for (r in 0 until rings) for (s in 0 until 4) { val a = r * 5 + s; blade.quad(a, a + 1, a + 6, a + 5) }
        val bm = MeshOps.removeDegenerate(blade.build())
        obj("Blade", MeshOps.flatShaded(bm), Material.preset(MaterialPreset.SILVER).apply { roughness = 0.12f }, v(0f, 0.3f, 0f))
        primObj("Guard", PrimType.CUBE, Material.preset(MaterialPreset.GOLD), v(0f, 0.29f, 0f), p = arrayOf("width" to 0.32f, "height" to 0.04f, "depth" to 0.06f, "divisions" to 2f))
        primObj("Grip", PrimType.CYLINDER, mat("Leather", 0x4E342E, 0f, 0.8f), v(0f, 0.17f, 0f), p = arrayOf("radius" to 0.022f, "height" to 0.22f, "segments" to 16f, "hsegs" to 6f))
        primObj("Pommel", PrimType.SPHERE, Material.preset(MaterialPreset.GOLD), v(0f, 0.04f, 0f), p = arrayOf("radius" to 0.035f, "segments" to 24f, "rings" to 12f))
        primObj("Gem", PrimType.ICOSPHERE, mat("Ruby", 0xE53935, 0f, 0.05f) { emissive[0] = 0.5f; emissiveStrength = 1f }, v(0f, 0.29f, 0.032f), s = v(1f, 1f, 0.5f), p = arrayOf("radius" to 0.022f, "detail" to 1f))
    }

    private fun coin() = Scene().apply {
        val gold = Material.preset(MaterialPreset.GOLD).apply { setBaseColorSrgb(0xE3A62F); roughness = 0.3f }
        val c = obj("Coin", Primitives.cylinder(0.35f, 0.35f, 0.06f, 64, 1), gold, v(0f, 0.6f, 0f), euler = v(90f, 0f, 0f))
        val rim = obj("Rim", Primitives.torus(0.35f, 0.025f, 64, 12), gold.copy(), v(0f, 0.6f, 0f), euler = v(90f, 0f, 0f))
        // star emblem
        val pts = FloatArray(20)
        for (i in 0 until 10) { val a = MathUtil.PI / 2 + i * MathUtil.PI / 5; val r = if (i % 2 == 0) 0.2f else 0.085f; pts[i * 2] = r * cos(a); pts[i * 2 + 1] = r * sin(a) }
        val tri = app.glbandme.core.mesh.Triangulator.triangulate(listOf(pts))
        val star = MeshOps.extrudeCap(tri.positions, tri.indices, tri.contours, 0.1f)
        val s = obj("Star", MeshOps.flatShaded(star), mat("Bright Gold", 0xFFF1B8, 1f, 0.08f), v(0f, 0.6f, 0f))
        frameCount = 60
        for (o in listOf(c, rim, s)) {
            val base = o.rotation.copy()
            for (i in 0..4) {
                val q = (Quat.axisAngle(v(0f, 1f, 0f), i * MathUtil.PI / 2f) * base).normalize()
                o.keys[i * 15] = Keyframe(v(0f, 0.6f + 0.05f * sin(i * MathUtil.PI / 2f), 0f), q, o.scale.copy())
            }
        }
        render.showGrid = true
    }

    private fun chest() = Scene().apply {
        val wood = MaterialPreset.WOOD.let { Material.preset(it) }
        val metal = mat("Iron", 0x3A3D42, 1f, 0.45f)
        primObj("Box", PrimType.CUBE, wood, v(0f, 0.22f, 0f), p = arrayOf("width" to 0.8f, "height" to 0.44f, "depth" to 0.5f, "divisions" to 2f))
        val lidMesh = Primitives.cylinder(0.25f, 0.25f, 0.8f, 24, 1)
        // the cylinder lies along X after the 90° Z rotation; local -X becomes world down:
        // flatten the lower half -> rounded lid
        warp(lidMesh) { p -> if (p[0] < 0f) p[0] = 0f }
        val lid = obj("Lid", lidMesh, wood.copy(), v(0f, 0.44f, 0f), euler = v(0f, 0f, 90f))
        val bands = ArrayList<SceneObject>()
        for (x in listOf(-0.28f, 0.28f)) {
            primObj("Band", PrimType.CUBE, metal.copy(), v(x, 0.22f, 0f), p = arrayOf("width" to 0.06f, "height" to 0.45f, "depth" to 0.51f, "divisions" to 1f))
            val band = Primitives.torus(0.255f, 0.02f, 32, 8)
            warp(band) { p -> if (p[0] < 0f) p[0] = 0f }
            bands.add(obj("Lid Band", band, metal.copy(), v(x, 0.44f, 0f), euler = v(0f, 0f, 90f)))
        }
        val lock = primObj("Lock", PrimType.CUBE, Material.preset(MaterialPreset.GOLD), v(0f, 0.4f, 0.26f), p = arrayOf("width" to 0.1f, "height" to 0.12f, "depth" to 0.03f, "divisions" to 1f))
        frameCount = 60
        // lid opens around the hinge at the back edge
        val hinge = v(0f, 0.44f, -0.25f)
        val moving = listOf(lid) + bands
        for (o in moving) {
            val base = o.position.copy(); val baseRot = o.rotation.copy()
            for ((f, ang) in listOf(0 to 0f, 20 to 0f, 35 to -70f, 50 to -70f, 60 to 0f)) {
                val q = Quat.fromEulerDeg(ang, 0f, 0f)
                val p = hinge + q.rotate(base - hinge)
                o.keys[f] = Keyframe(p, (q * baseRot).normalize(), o.scale.copy())
            }
        }
        selected = lock
    }
}
