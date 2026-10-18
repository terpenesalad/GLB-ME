package app.glbandme

import app.glbandme.core.io.ExportFormat
import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.GltfReader
import app.glbandme.core.io.GltfWriter
import app.glbandme.core.io.Json
import app.glbandme.core.io.MeshFormats
import app.glbandme.core.io.SceneIO
import app.glbandme.core.mesh.Decimator
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.PrimType
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.mesh.Triangulator
import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.MaterialPreset
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class CoreTests {

    private fun assertValid(m: Mesh) {
        for (i in m.indices) assertTrue("index $i out of range", i in 0 until m.vertexCount)
        for (f in m.positions) assertTrue(f.isFinite())
        for (f in m.normals) assertTrue(f.isFinite())
        m.colors?.let { assertEquals(m.vertexCount * 4, it.size) }
        m.uvs?.let { assertEquals(m.vertexCount * 2, it.size) }
    }

    /** Normals of convex, origin-centred shapes must point away from the centre. */
    private fun assertOutward(m: Mesh) {
        for (v in 0 until m.vertexCount) {
            val d = m.positions[v * 3] * m.normals[v * 3] + m.positions[v * 3 + 1] * m.normals[v * 3 + 1] + m.positions[v * 3 + 2] * m.normals[v * 3 + 2]
            assertTrue("vertex $v normal points inward", d > -1e-4f)
        }
        // face winding agrees with vertex normals
        for (t in 0 until m.triangleCount) {
            val a = m.indices[t * 3]; val b = m.indices[t * 3 + 1]; val c = m.indices[t * 3 + 2]
            val p = m.positions
            val e1 = Vec3(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2])
            val e2 = Vec3(p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2])
            val n = e1.cross(e2)
            val center = Vec3((p[a * 3] + p[b * 3] + p[c * 3]) / 3, (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3, (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3)
            assertTrue("triangle $t wound inward", n.dot(center) >= -1e-6f)
        }
    }

    @Test fun primitivesAreValidAndOutward() {
        for (t in PrimType.values()) {
            val m = PrimitiveSpec(t).build()
            assertValid(m)
            assertTrue("$t has triangles", m.triangleCount > 0)
            if (t != PrimType.PLANE && t != PrimType.TUBE && t != PrimType.TORUS) assertOutward(m)
        }
    }

    @Test fun cubeKeepsHardEdgesButSphereSeamsAreSmooth() {
        val cube = Primitives.box(1f, 1f, 1f, 1)
        for (v in 0 until cube.vertexCount) {
            val n = Vec3.of(cube.normals, v * 3)
            assertEquals(1f, maxOf(abs(n.x), abs(n.y), abs(n.z)), 1e-4f)
        }
        val s = Primitives.uvSphere(1f, 32, 16)
        for (v in 0 until s.vertexCount) {
            val n = Vec3.of(s.normals, v * 3)
            val p = Vec3.of(s.positions, v * 3).normalize()
            assertTrue("seam vertex $v not smooth", n.dot(p) > 0.97f)
        }
    }

    @Test fun mathRoundTrips() {
        val q = Quat.fromEulerDeg(30f, -45f, 60f)
        val e = q.toEulerDeg()
        val q2 = Quat.fromEulerDeg(e.x, e.y, e.z)
        assertEquals(1f, abs(q.x * q2.x + q.y * q2.y + q.z * q2.z + q.w * q2.w), 1e-4f)
        val m = Mat4.fromTRS(Vec3(1f, 2f, 3f), q, Vec3(2f, 0.5f, 1.5f))
        val t = Vec3(); val r = Quat(); val s = Vec3()
        Mat4.decompose(m, t, r, s)
        assertEquals(1f, t.x, 1e-5f); assertEquals(0.5f, s.y, 1e-5f); assertEquals(1.5f, s.z, 1e-5f)
        val inv = Mat4.inverted(m)
        val id = Mat4.mul(m, inv)
        for (i in 0 until 16) assertEquals(if (i % 5 == 0) 1f else 0f, id[i], 1e-4f)
    }

    @Test fun jsonRoundTrip() {
        val src = mapOf("a" to 1, "b" to listOf(1.5f, -2, "x\"y\n"), "c" to mapOf("d" to true, "e" to null))
        val back = Json.parse(Json.write(src))
        @Suppress("UNCHECKED_CAST") val m = back as Map<String, Any?>
        assertEquals(1.0, m["a"])
        assertEquals("x\"y\n", (m["b"] as List<*>)[2])
        assertEquals(true, (m["c"] as Map<*, *>)["d"])
    }

    private fun sampleScene(): Scene {
        val scene = Scene()
        val a = SceneObject("Ball", Primitives.quadSphere(0.5f, 8), Material.preset(MaterialPreset.GOLD))
        a.primitive = PrimitiveSpec(PrimType.SCULPT_SPHERE)
        MeshOps.fillColor(a.mesh, 1f, 0f, 0f)
        a.mesh.ensureMask()[3] = 0.75f
        a.position.set(1f, 2f, 3f)
        a.keys[0] = Keyframe(Vec3(0f, 0f, 0f), Quat(), Vec3(1f, 1f, 1f))
        a.keys[30] = Keyframe(Vec3(0f, 1f, 0f), Quat.fromEulerDeg(0f, 90f, 0f), Vec3(2f, 2f, 2f))
        scene.add(a)
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 1, 2, 3, 4, 5)
        val mat = Material(name = "Glass", alphaMode = AlphaMode.BLEND, doubleSided = true, unlit = true)
        mat.baseColorTexture = Texture("tex", png, "image/png")
        mat.emissive[0] = 1f; mat.emissiveStrength = 3f
        val b = SceneObject("Box", Primitives.box(1f, 2f, 1f, 2), mat)
        b.visible = false
        scene.add(b)
        return scene
    }

    @Test fun glbRoundTripKeepsEverything() {
        val scene = sampleScene()
        val bytes = GltfWriter.write(scene, GltfExportOptions(includeHidden = true))
        assertEquals(0x46546C67, java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(0))
        assertEquals(0, bytes.size % 4)
        val res = GltfReader().read(bytes)
        assertEquals(2, res.objects.size)
        val ball = res.objects[0]
        assertEquals("Ball", ball.name)
        assertEquals(scene.objects[0].mesh.vertexCount, ball.mesh.vertexCount)
        assertEquals(scene.objects[0].mesh.triangleCount, ball.mesh.triangleCount)
        assertEquals(1f, ball.mesh.colors!![0], 1e-3f)
        assertEquals(0f, ball.mesh.colors!![1], 1e-3f)
        assertEquals(1f, ball.material.metallic, 1e-6f)
        assertEquals(2, ball.keys.size)
        assertEquals(2f, ball.keys[30]!!.scale.x, 1e-5f)
        val box = res.objects[1]
        assertEquals(AlphaMode.BLEND, box.material.alphaMode)
        assertTrue(box.material.unlit)
        assertTrue(box.material.doubleSided)
        assertEquals(3f, box.material.emissiveStrength, 1e-6f)
        assertNotNull(box.material.baseColorTexture)
        assertArrayEquals(scene.objects[1].material.baseColorTexture!!.bytes, box.material.baseColorTexture!!.bytes)
    }

    @Test fun gltfEmbeddedRoundTrip() {
        val scene = sampleScene()
        val bytes = SceneIO.export(scene, ExportFormat.GLTF, GltfExportOptions(includeHidden = true))
        assertTrue(String(bytes).contains("data:application/octet-stream;base64,"))
        val res = SceneIO.import("model.gltf", bytes)
        assertEquals(2, res.objects.size)
    }

    @Test fun projectRoundTripKeepsEditorState() {
        val scene = sampleScene()
        scene.camera.yaw = 77f
        scene.render.wireframe = true
        scene.fps = 24
        val back = SceneIO.loadProject(SceneIO.saveProject(scene))
        assertEquals(77f, back.camera.yaw, 1e-5f)
        assertTrue(back.render.wireframe)
        assertEquals(24, back.fps)
        assertEquals(PrimType.SCULPT_SPHERE, back.objects[0].primitive?.type)
        assertEquals(0.75f, back.objects[0].mesh.mask!![3], 1e-6f)
        assertTrue(!back.objects[1].visible)
        assertEquals(0f, back.objects[0].position.x, 1e-6f) // animated: first keyframe wins
    }

    @Test fun objStlPlyRoundTrips() {
        val scene = Scene()
        scene.add(SceneObject("Cube", Primitives.box(1f, 1f, 1f, 2)))
        val tris = scene.objects[0].mesh.triangleCount
        val obj = SceneIO.import("a.obj", SceneIO.export(scene, ExportFormat.OBJ))
        assertEquals(tris, obj.objects.sumOf { it.mesh.triangleCount })
        val stl = SceneIO.import("a.stl", SceneIO.export(scene, ExportFormat.STL))
        assertEquals(tris, stl.objects[0].mesh.triangleCount)
        val (mn, mx) = stl.objects[0].mesh.bounds()
        assertEquals(1f, mx.y - mn.y, 1e-4f)
        val ply = SceneIO.import("a.ply", SceneIO.export(scene, ExportFormat.PLY))
        assertEquals(tris, ply.objects[0].mesh.triangleCount)
        // ascii STL
        val ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n"
        assertEquals(1, MeshFormats.readStl(ascii.toByteArray()).objects[0].mesh.triangleCount)
    }

    @Test fun subdivisionAndDecimation() {
        val cube = Primitives.box(1f, 1f, 1f, 2)
        val simple = MeshOps.subdivide(cube, smooth = false)
        assertEquals(cube.triangleCount * 4, simple.triangleCount)
        assertValid(simple)
        val smooth = MeshOps.subdivide(cube, smooth = true)
        assertValid(smooth)
        val (mn, mx) = smooth.bounds()
        assertTrue(mx.x <= 0.5f + 1e-4f && mn.x >= -0.5f - 1e-4f)
        val sphere = Primitives.quadSphere(1f, 24)
        val target = sphere.triangleCount / 4
        val dec = Decimator.decimate(sphere, target)
        assertValid(dec)
        assertTrue("decimated to ${dec.triangleCount} (target $target)", dec.triangleCount <= target + 8)
        assertTrue(dec.triangleCount > target / 2)
        // stays round
        for (v in 0 until dec.vertexCount) assertEquals(1f, Vec3.of(dec.positions, v * 3).length(), 0.08f)
    }

    @Test fun weldAndFlatShade() {
        val flat = MeshOps.flatShaded(Primitives.icoSphere(1f, 1))
        assertEquals(flat.triangleCount * 3, flat.vertexCount)
        val smooth = MeshOps.smoothShaded(flat)
        assertEquals(42, smooth.vertexCount)
    }

    @Test fun symmetrize() {
        val m = Primitives.quadSphere(1f, 8)
        for (v in 0 until m.vertexCount) if (m.positions[v * 3] > 0.1f) m.positions[v * 3 + 1] += 0.2f
        m.computeNormals()
        val n = MeshOps.symmetrizeInPlace(m, 0, true)
        assertTrue(n > 0)
        // for every vertex on -X there is a mirrored partner
        for (v in 0 until m.vertexCount) {
            if (m.positions[v * 3] < -0.1f) assertTrue(m.positions[v * 3 + 1] > -1f)
        }
    }

    @Test fun triangulateWithHole() {
        val outer = floatArrayOf(0f, 0f, 4f, 0f, 4f, 4f, 0f, 4f)
        val hole = floatArrayOf(1f, 1f, 3f, 1f, 3f, 3f, 1f, 3f)
        val r = Triangulator.triangulate(listOf(outer, hole))
        var area = 0f
        for (t in 0 until r.indices.size / 3) {
            val a = r.indices[t * 3]; val b = r.indices[t * 3 + 1]; val c = r.indices[t * 3 + 2]
            val p = r.positions
            area += ((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2])) / 2f
        }
        assertEquals(12f, area, 1e-3f)
    }

    @Test fun uvProjections() {
        for (mode in MeshOps.UvProjection.values()) {
            val m = MeshOps.projectUvs(Primitives.uvSphere(1f, 16, 8), mode)
            assertValid(m)
            assertNotNull(m.uvs)
        }
    }

    @Test fun animationEvaluates() {
        val o = SceneObject("o", Primitives.box(1f, 1f, 1f))
        o.keys[0] = Keyframe(Vec3(0f, 0f, 0f), Quat(), Vec3(1f, 1f, 1f))
        o.keys[10] = Keyframe(Vec3(10f, 0f, 0f), Quat(), Vec3(1f, 1f, 1f))
        o.evaluate(5f)
        assertEquals(5f, o.position.x, 1e-5f)
        o.evaluate(20f)
        assertEquals(10f, o.position.x, 1e-5f)
    }
}
