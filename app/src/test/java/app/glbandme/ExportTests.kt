package app.glbandme

import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.ExportOrigin
import app.glbandme.core.io.ExportPipeline
import app.glbandme.core.io.ExportPreset
import app.glbandme.core.io.ExportScope
import app.glbandme.core.io.ExportSettings
import app.glbandme.core.io.ExportUnit
import app.glbandme.core.io.MeshFormats
import app.glbandme.core.io.SceneIO
import app.glbandme.core.io.UpAxis
import app.glbandme.core.io.UsdzWriter
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

class ExportTests {
    private val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10, 1, 2, 3)

    private fun scene(): Scene {
        val s = Scene()
        val box = SceneObject("Box", MeshOps.projectUvs(Primitives.box(1f, 2f, 1f, 2), MeshOps.UvProjection.BOX), Material(name = "Painted").apply {
            baseColorTexture = Texture("paint", png, "image/png"); uvScale[0] = 2f; uvScale[1] = 2f
        })
        box.position.set(3f, 1.5f, -2f)
        s.add(box)
        val ball = SceneObject("Ball 1", Primitives.uvSphere(0.5f, 32, 16), Material(name = "Gold").apply { metallic = 1f; roughness = 0.2f })
        ball.position.set(-1f, 0.5f, 0f)
        ball.keys[0] = Keyframe(Vec3(-1f, 0.5f, 0f), Quat(), Vec3(1f, 1f, 1f))
        ball.keys[10] = Keyframe(Vec3(-1f, 2f, 0f), Quat(), Vec3(1f, 1f, 1f))
        s.add(ball)
        return s
    }

    private fun unzip(b: ByteArray): Map<String, ByteArray> {
        val out = LinkedHashMap<String, ByteArray>()
        ZipInputStream(ByteArrayInputStream(b)).use { z -> while (true) { val e = z.nextEntry ?: break; out[e.name] = z.readBytes() } }
        return out
    }

    @Test fun usdzIsAlignedValidZipWithPreviewSurface() {
        val s = scene()
        val res = ExportPipeline.export(s, ExportSettings(format = ExportFormat.USDZ))
        val bytes = res.main
        // every local file's data starts on a 64-byte boundary
        var off = 0
        var count = 0
        while (off + 30 < bytes.size && bytes[off] == 0x50.toByte() && bytes[off + 1] == 0x4b.toByte() && bytes[off + 2] == 3.toByte() && bytes[off + 3] == 4.toByte()) {
            fun u16(i: Int) = (bytes[i].toInt() and 0xff) or ((bytes[i + 1].toInt() and 0xff) shl 8)
            fun u32(i: Int) = u16(i) or (u16(i + 2) shl 16)
            val nameLen = u16(off + 26); val extra = u16(off + 28); val size = u32(off + 18)
            val data = off + 30 + nameLen + extra
            assertEquals(0, data % 64)
            assertEquals(0, u16(off + 8)) // stored
            off = data + size
            count++
        }
        assertEquals(2, count)
        val files = unzip(bytes)
        assertEquals("model.usda", files.keys.first())
        val usda = String(files["model.usda"]!!)
        assertTrue(usda.startsWith("#usda 1.0"))
        assertTrue(usda.contains("UsdPreviewSurface"))
        assertTrue(usda.contains("@textures/tex0.png@"))
        assertTrue(usda.contains("def Xform \"Ball_1\""))
        assertTrue(usda.contains("timeSamples")) // animated ball
        assertTrue(usda.contains("float inputs:metallic = 1"))
        assertTrue(files.containsKey("textures/tex0.png"))
        // point count of the box mesh
        val box = s.objects[0].mesh
        val firstPoints = usda.substringAfter("point3f[] points = [").substringBefore("]")
        assertEquals(box.vertexCount, firstPoints.split("), (").size)
    }

    @Test fun usdzStFlipsVAndBakesTiling() {
        val s = Scene()
        val m = app.glbandme.core.mesh.Mesh(floatArrayOf(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f), intArrayOf(0, 1, 2), null, null, floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f))
        m.computeNormals()
        s.add(SceneObject("Tri", m, Material().apply { baseColorTexture = Texture("t", png, "image/png"); uvScale[0] = 3f; uvScale[1] = 3f }))
        val usda = String(unzip(UsdzWriter.write(s, s.objects))["model.usda"]!!)
        val st = usda.substringAfter("primvars:st = [").substringBefore("]")
        // t = 1 - v' : equivalent to the image tiles under repeat wrapping
        assertEquals("(0, 1), (3, 1), (0, -2)", st)
    }

    @Test fun groundOriginAndUnitsApplyToGlb() {
        val s = scene()
        val set = ExportSettings(format = ExportFormat.GLB, origin = ExportOrigin.GROUND, unit = ExportUnit.CM, animations = false)
        val res = ExportPipeline.export(s, set)
        val back = SceneIO.import("x.glb", res.main)
        var lo = Vec3(1e9f, 1e9f, 1e9f); var hi = Vec3(-1e9f, -1e9f, -1e9f)
        for (o in back.objects) { val (a, b) = o.worldBounds(); lo = lo.minLocal(a); hi = hi.maxLocal(b) }
        assertEquals(0f, lo.y, 1e-2f)
        assertEquals(0f, (lo.x + hi.x) / 2, 1e-2f)
        // original scene is 5.5 m wide (x: -1.5 .. 3.5 + 0.5); in centimetres
        val orig = ExportPipeline.bounds(s.objects)!!
        assertEquals((orig.second.x - orig.first.x) * 100f, hi.x - lo.x, 0.5f)
    }

    @Test fun stlForPrintingIsMillimetresZUp() {
        val s = Scene()
        s.add(SceneObject("Tall", Primitives.box(0.01f, 0.05f, 0.02f, 1), Material()))
        val set = ExportSettings(); ExportPreset.PRINT.apply(set)
        val res = ExportPipeline.export(s, set)
        // raw STL: z extent must be the box height in mm and min z = 0
        val bb = java.nio.ByteBuffer.wrap(res.main).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val n = bb.getInt(80)
        var minZ = 1e9f; var maxZ = -1e9f; var maxY = -1e9f; var minY = 1e9f
        for (t in 0 until n) for (k in 0 until 3) {
            val o = 84 + t * 50 + 12 + k * 12
            val y = bb.getFloat(o + 4); val z = bb.getFloat(o + 8)
            minZ = minOf(minZ, z); maxZ = maxOf(maxZ, z); minY = minOf(minY, y); maxY = maxOf(maxY, y)
        }
        assertEquals(0f, minZ, 1e-3f)
        assertEquals(50f, maxZ, 1e-2f)
        assertEquals(20f, maxY - minY, 1e-2f)
        // and the default STL export path still round-trips
        val back = MeshFormats.readStl(MeshFormats.writeStl(s.objects))
        assertEquals(0.05f, back.objects[0].mesh.bounds().let { (a, b) -> b.y - a.y }, 1e-4f)
    }

    @Test fun triangleBudgetSimplifiesCopiesOnly() {
        val s = Scene()
        s.add(SceneObject("Dense", Primitives.uvSphere(1f, 128, 64), Material()))
        val before = s.objects[0].mesh.triangleCount
        val set = ExportSettings(format = ExportFormat.GLB, maxTriangles = 2000)
        val res = ExportPipeline.export(s, set)
        assertTrue(res.triangles <= 2200)
        assertEquals(before, s.objects[0].mesh.triangleCount)
        val back = SceneIO.import("x.glb", res.main)
        assertTrue(back.objects[0].mesh.triangleCount <= 2200)
    }

    @Test fun objWithMaterialsIsZipBundle() {
        val s = scene()
        val res = ExportPipeline.export(s, ExportSettings(format = ExportFormat.OBJ))
        val (zip, name) = res.bundle("model", "obj")
        assertEquals("model.zip", name)
        val files = unzip(zip)
        assertTrue(files.keys.containsAll(listOf("model.obj", "materials.mtl", "tex0.png")))
        val obj = String(files["model.obj"]!!)
        assertTrue(obj.contains("mtllib materials.mtl"))
        assertTrue(obj.contains("usemtl Painted_0"))
        val mtl = String(files["materials.mtl"]!!)
        assertTrue(mtl.contains("map_Kd tex0.png"))
        assertTrue(mtl.contains("Pm 1.000"))
        // tiling baked: some vt goes beyond 1
        assertTrue(obj.lines().filter { it.startsWith("vt ") }.any { l -> l.split(' ').drop(1).any { it.toFloat() !in -0.01f..1.01f } })
    }

    @Test fun scopeAndValidation() {
        val s = scene()
        s.objects[1].visible = false
        assertEquals(1, ExportPipeline.select(s, ExportSettings(scope = ExportScope.VISIBLE)).size)
        assertEquals(2, ExportPipeline.select(s, ExportSettings(scope = ExportScope.ALL)).size)
        s.selected = null
        assertTrue(ExportPipeline.validate(s, ExportSettings(scope = ExportScope.SELECTED)).first().contains("selected"))
        s.objects[1].visible = true
        val w = ExportPipeline.validate(s, ExportSettings(format = ExportFormat.STL))
        assertTrue(w.any { it.contains("animation") })
        assertTrue(w.any { it.contains("merges") })
    }

    @Test fun zUpRootRotatesYIntoZ() {
        val s = Scene()
        s.add(SceneObject("Up", Primitives.box(1f, 4f, 1f, 1), Material()))
        val root = ExportPipeline.rootMatrix(s.objects, ExportSettings(up = UpAxis.Z))!!
        val p = FloatArray(3)
        app.glbandme.math.Mat4.transformPoint(root, 0f, 2f, 0f, p)
        assertEquals(0f, p[1], 1e-5f)
        assertEquals(2f, p[2], 1e-5f)
    }

    @Test fun lightsRoundTripAsKhrLightsPunctual() {
        val s = scene()
        val spot = app.glbandme.core.scene.LightProxy.create(app.glbandme.core.scene.LightType.SPOT, "Key")
        spot.light!!.intensity = 42f; spot.light!!.range = 7f; spot.light!!.outerCone = 0.7f; spot.light!!.innerCone = 0.2f
        spot.position.set(1f, 3f, 2f)
        spot.rotation.set(Quat.fromEulerDeg(-45f, 20f, 0f))
        s.add(spot)
        val sun = app.glbandme.core.scene.LightProxy.create(app.glbandme.core.scene.LightType.SUN, "Sun")
        s.add(sun)
        val glb = ExportPipeline.export(s, ExportSettings(format = ExportFormat.GLB)).main
        val json = String(glb, 20, java.nio.ByteBuffer.wrap(glb).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(12))
        assertTrue(json.contains("KHR_lights_punctual"))
        assertTrue(json.contains("\"directional\""))
        val back = SceneIO.import("x.glb", glb).objects
        val k = back.first { it.name == "Key" }
        assertEquals(app.glbandme.core.scene.LightType.SPOT, k.light!!.type)
        assertEquals(42f, k.light!!.intensity, 1e-4f)
        assertEquals(7f, k.light!!.range, 1e-4f)
        assertEquals(0.7f, k.light!!.outerCone, 1e-4f)
        assertEquals(3f, k.position.y, 1e-4f)
        assertTrue(back.any { it.light?.type == app.glbandme.core.scene.LightType.SUN })
        // the meshes are still there and lights have no mesh in the file
        assertEquals(2, back.count { it.light == null })
        // project files keep lights too
        val proj = SceneIO.loadProject(SceneIO.saveProject(s))
        assertEquals(2, proj.objects.count { it.light != null })
        // mesh formats never contain light stand-ins
        val stl = ExportPipeline.export(s, ExportSettings(format = ExportFormat.STL)).main
        val tris = java.nio.ByteBuffer.wrap(stl).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(80)
        assertEquals(s.objects.filter { it.light == null }.sumOf { it.mesh.triangleCount }, tris)
    }

    @Test fun spotConeAttenuationMatchesSpec() {
        val l = app.glbandme.core.scene.LightSpec(app.glbandme.core.scene.LightType.SPOT, innerCone = 0.2f, outerCone = 0.5f)
        val (scale, offset) = l.coneScaleOffset()
        fun att(angle: Float) = (kotlin.math.cos(angle) * scale + offset).coerceIn(0f, 1f)
        assertEquals(1f, att(0.1f), 1e-4f)
        assertEquals(0f, att(0.6f), 1e-4f)
        assertTrue(att(0.35f) in 0.01f..0.99f)
    }
}
