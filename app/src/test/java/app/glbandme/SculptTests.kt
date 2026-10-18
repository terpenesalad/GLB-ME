package app.glbandme

import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.sculpt.BrushSettings
import app.glbandme.core.sculpt.BrushType
import app.glbandme.core.sculpt.Picking
import app.glbandme.core.sculpt.SculptEngine
import app.glbandme.math.Vec3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class SculptTests {

    @Test fun pickingHitsFrontOfSphere() {
        val scene = Scene()
        val o = scene.add(SceneObject("s", Primitives.quadSphere(0.5f, 16)))
        o.position.set(0f, 1f, 0f)
        val hit = Picking.pick(scene, Vec3(0f, 1f, 5f), Vec3(0f, 0f, -1f))
        assertNotNull(hit)
        assertEquals(0.5f, hit!!.worldPos.z, 0.01f)
        assertTrue(hit.worldNormal.z > 0.95f)
        assertEquals(null, Picking.pick(scene, Vec3(3f, 1f, 5f), Vec3(0f, 0f, -1f)))
    }

    @Test fun everyBrushChangesMeshAndUndoRestores() {
        for (type in BrushType.values()) {
            val o = SceneObject("s", Primitives.uvSphere(0.5f, 48, 24))
            val m = o.mesh
            val before = m.positions.copyOf()
            val colBefore = m.colors?.copyOf()
            val engine = SculptEngine()
            val s = BrushSettings().apply { intensity = 0.8f; symmetry[0] = true }
            engine.begin(o, type, s, 0.2f)
            val c = Vec3(0.1f, 0.1f, 0.48f)
            if (type == BrushType.MOVE) {
                engine.grabStart(c, 0.2f)
                engine.dab(c, 0.2f, 1f, Vec3(0f, 0f, 0.1f))
            } else {
                for (i in 0 until 6) engine.dab(Vec3(c.x + i * 0.01f, c.y, c.z), 0.2f, 1f, Vec3(0.01f, 0f, 0f))
            }
            val undo = engine.end()
            assertNotNull("$type produced no undo", undo)
            when (type) {
                BrushType.PAINT -> assertTrue(m.colors!!.any { it < 0.99f })
                BrushType.MASK -> assertTrue(m.mask!!.any { it > 0f })
                else -> {
                    var diff = 0f
                    for (i in before.indices) diff += abs(before[i] - m.positions[i])
                    assertTrue("$type didn't move vertices", diff > 1e-4f)
                    // symmetry: mirrored region on -X moved too
                    var mirrored = false
                    for (v in 0 until m.vertexCount) if (m.positions[v * 3] < -0.05f && abs(before[v * 3 + 2] - m.positions[v * 3 + 2]) + abs(before[v * 3] - m.positions[v * 3]) + abs(before[v * 3 + 1] - m.positions[v * 3 + 1]) > 1e-6f) mirrored = true
                    assertTrue("$type symmetry", mirrored)
                    // seams stay closed: duplicates share positions
                    val w = m.weld()
                    for (v in 0 until m.vertexCount) {
                        val r = w.rep[v]
                        for (k in 0 until 3) assertEquals(m.positions[r * 3 + k], m.positions[v * 3 + k], 0f)
                    }
                }
            }
            for (f in m.normals) assertTrue(f.isFinite())
            undo!!.undo()
            for (i in before.indices) assertEquals("$type undo", before[i], m.positions[i], 1e-6f)
            undo.redo()
            undo.undo()
            if (colBefore != null) for (i in colBefore.indices) assertEquals(colBefore[i], m.colors!![i], 1e-6f)
        }
    }
}

class SeamTests {
    @Test fun wrapSeamsAndPolesAreWelded() {
        val cases = mapOf(
            "uvSphere" to (app.glbandme.core.mesh.Primitives.uvSphere(1f, 16, 8) to 16 * 7 + 2),
            "cylinder" to (app.glbandme.core.mesh.Primitives.cylinder(1f, 1f, 1f, 16, 2, caps = false) to 16 * 3),
            "torus" to (app.glbandme.core.mesh.Primitives.torus(1f, 0.3f, 16, 8) to 16 * 8),
            "quadSphere" to (app.glbandme.core.mesh.Primitives.quadSphere(1f, 4) to 6 * 9 + 12 * 3 + 8)
        )
        for ((name, pair) in cases) {
            val (m, unique) = pair
            val w = m.weld()
            val reps = (0 until m.vertexCount).count { w.rep[it] == it }
            org.junit.Assert.assertEquals(name, unique, reps)
        }
    }
}
