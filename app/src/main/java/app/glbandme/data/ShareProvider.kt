package app.glbandme.data

import android.app.Activity
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/**
 * Minimal read-only provider exposing files from cache/share/ for the system share sheet
 * (the app intentionally has no AndroidX dependency, so no FileProvider).
 */
class ShareProvider : ContentProvider() {
    override fun onCreate() = true

    private fun fileFor(uri: Uri): File? {
        val ctx = context ?: return null
        val name = uri.lastPathSegment ?: return null
        val dir = File(ctx.cacheDir, "share")
        val f = File(dir, name)
        return if (f.canonicalPath.startsWith(dir.canonicalPath) && f.exists()) f else null
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
        val f = fileFor(uri) ?: throw java.io.FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
        val f = fileFor(uri) ?: return null
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val c = MatrixCursor(cols)
        c.addRow(cols.map { if (it == OpenableColumns.DISPLAY_NAME) f.name else if (it == OpenableColumns.SIZE) f.length() else null }.toTypedArray())
        return c
    }

    override fun getType(uri: Uri): String = mimeFor(uri.lastPathSegment ?: "")
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    companion object {
        fun authority(ctx: Context) = ctx.packageName + ".share"

        fun mimeFor(name: String): String = when (name.substringAfterLast('.').lowercase()) {
            "glb" -> "model/gltf-binary"
            "gltf" -> "model/gltf+json"
            "obj" -> "model/obj"
            "stl" -> "model/stl"
            "ply" -> "application/octet-stream"
            "usdz" -> "model/vnd.usdz+zip"
            "zip" -> "application/zip"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            else -> "application/octet-stream"
        }

        /** Writes bytes to the share cache and opens the Android share sheet. */
        fun share(act: Activity, fileName: String, bytes: ByteArray, title: String = "Share", @Suppress("UNUSED_PARAMETER") mime: String? = null) {
            val dir = File(act.cacheDir, "share").apply { mkdirs() }
            dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3_600_000) it.delete() }
            val safe = fileName.replace(Regex("[^A-Za-z0-9._ &()-]"), "_")
            val f = File(dir, safe)
            f.writeBytes(bytes)
            val uri = Uri.parse("content://${authority(act)}/${Uri.encode(safe)}")
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeFor(safe)
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TITLE, safe)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            act.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }
}

object FileIO {
    fun displayName(ctx: Context, uri: Uri): String? {
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) return c.getString(0)
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')
    }

    fun read(ctx: Context, uri: Uri, maxBytes: Long = 512L * 1024 * 1024): ByteArray {
        ctx.contentResolver.openInputStream(uri).use { ins ->
            requireNotNull(ins) { "Couldn't open file" }
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(1 shl 16)
            var total = 0L
            while (true) {
                val n = ins.read(buf)
                if (n < 0) break
                total += n
                if (total > maxBytes) throw IllegalStateException("File is too large (over ${maxBytes / (1024 * 1024)} MB)")
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }

    fun write(ctx: Context, uri: Uri, bytes: ByteArray) {
        ctx.contentResolver.openOutputStream(uri, "wt").use { out ->
            requireNotNull(out) { "Couldn't open destination" }
            out.write(bytes)
        }
    }
}
