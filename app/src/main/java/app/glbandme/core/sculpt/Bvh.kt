package app.glbandme.core.sculpt

import app.glbandme.core.mesh.Mesh
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.math.Mat4
import app.glbandme.math.Vec3
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Bounding volume hierarchy over a mesh's triangles (local space). Refittable after deformation. */
class Bvh private constructor(val mesh: Mesh) {
    private var nodeBounds = FloatArray(0)   // 6 per node
    private var nodeLeft = IntArray(0)       // child index or -1 for leaf
    private var nodeStart = IntArray(0)      // leaf: first tri in order
    private var nodeCount = IntArray(0)      // leaf: tri count
    private var order = IntArray(0)
    private var nodes = 0
    var topology = -1; private set
    private var lastRefit = 0L
    var geometry = -1; private set

    class Hit(var t: Float = Float.MAX_VALUE, var tri: Int = -1, var u: Float = 0f, var v: Float = 0f)

    private fun build() {
        val tc = mesh.triangleCount
        val p = mesh.positions
        val idx = mesh.indices
        val cent = FloatArray(tc * 3)
        for (t in 0 until tc) {
            val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val c = idx[t * 3 + 2] * 3
            for (k in 0 until 3) cent[t * 3 + k] = (p[a + k] + p[b + k] + p[c + k]) / 3f
        }
        order = IntArray(tc) { it }
        val maxNodes = max(1, tc * 2)
        nodeBounds = FloatArray(maxNodes * 6)
        nodeLeft = IntArray(maxNodes)
        nodeStart = IntArray(maxNodes)
        nodeCount = IntArray(maxNodes)
        nodes = 0
        // iterative build: (node, start, count)
        val stack = IntArray(256 * 3)
        var sp = 0
        nodes = 1
        stack[sp++] = 0; stack[sp++] = 0; stack[sp++] = tc
        while (sp > 0) {
            val count = stack[--sp]; val start = stack[--sp]; val node = stack[--sp]
            nodeStart[node] = start; nodeCount[node] = count; nodeLeft[node] = -1
            if (count <= LEAF || sp >= stack.size - 6) continue
            // split on largest centroid extent at the median
            var mnx = Float.MAX_VALUE; var mny = Float.MAX_VALUE; var mnz = Float.MAX_VALUE
            var mxx = -Float.MAX_VALUE; var mxy = -Float.MAX_VALUE; var mxz = -Float.MAX_VALUE
            for (i in start until start + count) {
                val t = order[i]
                mnx = min(mnx, cent[t * 3]); mxx = max(mxx, cent[t * 3])
                mny = min(mny, cent[t * 3 + 1]); mxy = max(mxy, cent[t * 3 + 1])
                mnz = min(mnz, cent[t * 3 + 2]); mxz = max(mxz, cent[t * 3 + 2])
            }
            val ex = mxx - mnx; val ey = mxy - mny; val ez = mxz - mnz
            val axis = if (ex >= ey && ex >= ez) 0 else if (ey >= ez) 1 else 2
            if (max(ex, max(ey, ez)) <= 0f) continue
            val mid = start + count / 2
            nthElement(cent, axis, start, start + count - 1, mid)
            val left = nodes; val right = nodes + 1
            nodes += 2
            nodeLeft[node] = left
            stack[sp++] = right; stack[sp++] = mid; stack[sp++] = start + count - mid
            stack[sp++] = left; stack[sp++] = start; stack[sp++] = mid - start
        }
        topology = mesh.topologyVersion
        refit()
    }

    /** Quickselect on triangle order by centroid axis. */
    private fun nthElement(cent: FloatArray, axis: Int, lo0: Int, hi0: Int, n: Int) {
        var lo = lo0; var hi = hi0
        while (lo < hi) {
            val pivot = cent[order[(lo + hi) ushr 1] * 3 + axis]
            var i = lo; var j = hi
            while (i <= j) {
                while (cent[order[i] * 3 + axis] < pivot) i++
                while (cent[order[j] * 3 + axis] > pivot) j--
                if (i <= j) { val tmp = order[i]; order[i] = order[j]; order[j] = tmp; i++; j-- }
            }
            if (n <= j) hi = j else if (n >= i) lo = i else return
        }
    }

    /** Recompute node bounds after vertices moved (children always have larger indices). */
    fun refit() {
        val p = mesh.positions
        val idx = mesh.indices
        val b = nodeBounds
        for (node in nodes - 1 downTo 0) {
            val o = node * 6
            val l = nodeLeft[node]
            if (l < 0) {
                var mnx = Float.MAX_VALUE; var mny = Float.MAX_VALUE; var mnz = Float.MAX_VALUE
                var mxx = -Float.MAX_VALUE; var mxy = -Float.MAX_VALUE; var mxz = -Float.MAX_VALUE
                for (i in nodeStart[node] until nodeStart[node] + nodeCount[node]) {
                    val t = order[i]
                    for (k in 0 until 3) {
                        val v = idx[t * 3 + k] * 3
                        val x = p[v]; val y = p[v + 1]; val z = p[v + 2]
                        if (x < mnx) mnx = x; if (x > mxx) mxx = x
                        if (y < mny) mny = y; if (y > mxy) mxy = y
                        if (z < mnz) mnz = z; if (z > mxz) mxz = z
                    }
                }
                b[o] = mnx; b[o + 1] = mny; b[o + 2] = mnz; b[o + 3] = mxx; b[o + 4] = mxy; b[o + 5] = mxz
            } else {
                val a = l * 6; val c = (l + 1) * 6
                b[o] = min(b[a], b[c]); b[o + 1] = min(b[a + 1], b[c + 1]); b[o + 2] = min(b[a + 2], b[c + 2])
                b[o + 3] = max(b[a + 3], b[c + 3]); b[o + 4] = max(b[a + 4], b[c + 4]); b[o + 5] = max(b[a + 5], b[c + 5])
            }
        }
        geometry = mesh.geometryVersion
    }

    fun raycast(ox: Float, oy: Float, oz: Float, dx: Float, dy: Float, dz: Float, hit: Hit, backfaces: Boolean = true): Boolean {
        if (nodes == 0 || mesh.triangleCount == 0) return false
        val idx = mesh.indices
        val p = mesh.positions
        val idx2 = if (abs(dx) > 1e-12f) 1f / dx else Float.MAX_VALUE * Math.signum(dx + 1e-30f)
        val idy = if (abs(dy) > 1e-12f) 1f / dy else Float.MAX_VALUE * Math.signum(dy + 1e-30f)
        val idz = if (abs(dz) > 1e-12f) 1f / dz else Float.MAX_VALUE * Math.signum(dz + 1e-30f)
        val stack = IntArray(128)
        var sp = 0
        stack[sp++] = 0
        var found = false
        while (sp > 0) {
            val node = stack[--sp]
            val o = node * 6
            // slab test
            var t0 = (nodeBounds[o] - ox) * idx2; var t1 = (nodeBounds[o + 3] - ox) * idx2
            var tmin = min(t0, t1); var tmax = max(t0, t1)
            t0 = (nodeBounds[o + 1] - oy) * idy; t1 = (nodeBounds[o + 4] - oy) * idy
            tmin = max(tmin, min(t0, t1)); tmax = min(tmax, max(t0, t1))
            t0 = (nodeBounds[o + 2] - oz) * idz; t1 = (nodeBounds[o + 5] - oz) * idz
            tmin = max(tmin, min(t0, t1)); tmax = min(tmax, max(t0, t1))
            if (tmax < max(tmin, 0f) || tmin > hit.t) continue
            val l = nodeLeft[node]
            if (l >= 0) {
                if (sp + 2 <= stack.size) { stack[sp++] = l; stack[sp++] = l + 1 }
                continue
            }
            for (i in nodeStart[node] until nodeStart[node] + nodeCount[node]) {
                val t = order[i]
                val a = idx[t * 3] * 3; val b = idx[t * 3 + 1] * 3; val c = idx[t * 3 + 2] * 3
                val e1x = p[b] - p[a]; val e1y = p[b + 1] - p[a + 1]; val e1z = p[b + 2] - p[a + 2]
                val e2x = p[c] - p[a]; val e2y = p[c + 1] - p[a + 1]; val e2z = p[c + 2] - p[a + 2]
                val px = dy * e2z - dz * e2y; val py = dz * e2x - dx * e2z; val pz = dx * e2y - dy * e2x
                val det = e1x * px + e1y * py + e1z * pz
                if (backfaces) { if (abs(det) < 1e-14f) continue } else if (det < 1e-14f) continue
                val inv = 1f / det
                val sx = ox - p[a]; val sy = oy - p[a + 1]; val sz = oz - p[a + 2]
                val u = (sx * px + sy * py + sz * pz) * inv
                if (u < 0f || u > 1f) continue
                val qx = sy * e1z - sz * e1y; val qy = sz * e1x - sx * e1z; val qz = sx * e1y - sy * e1x
                val v = (dx * qx + dy * qy + dz * qz) * inv
                if (v < 0f || u + v > 1f) continue
                val tt = (e2x * qx + e2y * qy + e2z * qz) * inv
                if (tt > 1e-6f && tt < hit.t) { hit.t = tt; hit.tri = t; hit.u = u; hit.v = v; found = true }
            }
        }
        return found
    }

    companion object {
        private const val LEAF = 6
        private val cache = WeakHashMap<Mesh, Bvh>()

        /**
         * Cached BVH for [mesh]. [maxStaleMs] > 0 allows slightly stale bounds (skips refits for
         * that long) which keeps picking cheap on huge meshes during a sculpt stroke.
         */
        @Synchronized
        fun of(mesh: Mesh, maxStaleMs: Long = 0): Bvh {
            var b = cache[mesh]
            if (b == null || b.topology != mesh.topologyVersion) {
                b = Bvh(mesh); b.build(); cache[mesh] = b; b.lastRefit = System.nanoTime()
            } else if (b.geometry != mesh.geometryVersion) {
                val now = System.nanoTime()
                if (maxStaleMs <= 0 || now - b.lastRefit > maxStaleMs * 1_000_000L) { b.refit(); b.lastRefit = now }
            }
            return b
        }
    }
}

/** Ray picking across a scene. */
object Picking {
    class SceneHit(
        val obj: SceneObject, val worldPos: Vec3, val worldNormal: Vec3,
        val localPos: Vec3, val localNormal: Vec3, val distance: Float, val tri: Int
    )

    fun pick(scene: Scene, origin: Vec3, dir: Vec3, only: SceneObject? = null, maxStaleMs: Long = 0): SceneHit? {
        var best: SceneHit? = null
        val inv = FloatArray(16)
        for (o in scene.objects) {
            if (!o.visible || (only != null && o !== only)) continue
            if (o.mesh.triangleCount == 0) continue
            val m = o.localMatrix()
            Mat4.invert(m, inv)
            val lo = Mat4.transformPoint(inv, origin)
            val ld = Mat4.transformDir(inv, dir)
            val hit = Bvh.Hit()
            if (!Bvh.of(o.mesh, maxStaleMs).raycast(lo.x, lo.y, lo.z, ld.x, ld.y, ld.z, hit)) continue
            val lp = Vec3(lo.x + ld.x * hit.t, lo.y + ld.y * hit.t, lo.z + ld.z * hit.t)
            val wp = Mat4.transformPoint(m, lp)
            val dist = wp.distance(origin)
            if (best != null && dist >= best.distance) continue
            val mesh = o.mesh
            val a = mesh.indices[hit.tri * 3]; val b = mesh.indices[hit.tri * 3 + 1]; val c = mesh.indices[hit.tri * 3 + 2]
            val w0 = 1f - hit.u - hit.v
            val n = mesh.normals
            val ln = Vec3(
                n[a * 3] * w0 + n[b * 3] * hit.u + n[c * 3] * hit.v,
                n[a * 3 + 1] * w0 + n[b * 3 + 1] * hit.u + n[c * 3 + 1] * hit.v,
                n[a * 3 + 2] * w0 + n[b * 3 + 2] * hit.u + n[c * 3 + 2] * hit.v
            ).normalize()
            val nm = Mat4.normalMatrix(m)
            val wn = Vec3(
                nm[0] * ln.x + nm[3] * ln.y + nm[6] * ln.z,
                nm[1] * ln.x + nm[4] * ln.y + nm[7] * ln.z,
                nm[2] * ln.x + nm[5] * ln.y + nm[8] * ln.z
            ).normalize()
            best = SceneHit(o, wp, wn, lp, ln, dist, hit.tri)
        }
        return best
    }
}
