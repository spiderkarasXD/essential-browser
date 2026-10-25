package app.essential.browser

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// Автообновление из GitHub Releases, как у ПК-версии: ищем самый новый релиз с .apk,
// качаем его в фоне, а кнопка «Обновить» открывает системную установку поверх
class Updater(private val ctx: Context, private val onChange: () -> Unit) {
    private val repo = "spiderkarasXD/essential-browser"
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val dm = ctx.getSystemService(DownloadManager::class.java)
    private var status = "idle" // idle | checking | downloading | ready | latest | error
    private var version: String? = null
    private var error: String? = null
    private var downloadId = -1L
    private var progress = 0

    fun state() = jsonOf("status" to status, "version" to version, "error" to error, "progress" to progress, "current" to BuildConfig.VERSION_NAME)

    private fun set(s: String, v: String? = version, e: String? = null) {
        status = s; version = v; error = e
        onChange()
    }

    // '0.6.10' > '0.6.9'
    private fun newer(a: String, b: String): Boolean {
        val pa = a.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        val pb = b.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val x = pa.getOrElse(i) { 0 }
            val y = pb.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    fun check() {
        if (status == "checking" || status == "downloading" || status == "ready") return
        set("checking")
        io.execute {
            try {
                val con = URL("https://api.github.com/repos/$repo/releases?per_page=15").openConnection() as HttpURLConnection
                con.setRequestProperty("Accept", "application/vnd.github+json")
                con.setRequestProperty("User-Agent", "Essential-Android/${BuildConfig.VERSION_NAME}")
                con.connectTimeout = 10000
                con.readTimeout = 15000
                if (con.responseCode != 200) throw Exception("GitHub ответил ${con.responseCode}")
                val releases = JSONArray(con.inputStream.bufferedReader().readText())
                // первый опубликованный релиз, в котором есть APK (у ПК-версии бывают релизы и без него)
                val rel = releases.objects().firstOrNull { r ->
                    !r.optBoolean("draft") && !r.optBoolean("prerelease") &&
                        r.optJSONArray("assets")?.objects()?.any { it.optString("name").endsWith(".apk") } == true
                }
                val tag = rel?.optString("tag_name")?.removePrefix("v")
                val asset = rel?.optJSONArray("assets")?.objects()?.first { it.optString("name").endsWith(".apk") }
                main.post {
                    if (tag == null || asset == null || !newer(tag, BuildConfig.VERSION_NAME)) set("latest", null)
                    else download(tag, asset.optString("browser_download_url"))
                }
            } catch (e: Exception) {
                main.post { set("error", e = e.message ?: e.toString()) }
            }
        }
    }

    private fun download(tag: String, url: String) {
        val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        File(dir, "essential-update.apk").delete()
        downloadId = dm.enqueue(
            DownloadManager.Request(Uri.parse(url))
                .setTitle("Essential $tag")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
                .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, "essential-update.apk")
        )
        progress = 0
        set("downloading", tag)
        main.postDelayed(object : Runnable {
            override fun run() {
                dm.query(DownloadManager.Query().setFilterById(downloadId))?.use { c ->
                    if (!c.moveToFirst()) return set("error", e = "загрузка обновления отменена")
                    val got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    progress = if (total > 0) (got * 100 / total).toInt() else 0
                    when (c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                        DownloadManager.STATUS_SUCCESSFUL -> return set("ready")
                        DownloadManager.STATUS_FAILED -> return set("error", e = "не удалось скачать обновление")
                    }
                }
                onChange()
                main.postDelayed(this, 1000)
            }
        }, 1000)
    }

    fun install() {
        if (status != "ready") return check()
        // Android спрашивает один раз: разрешить Essential устанавливать приложения
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(ctx, "Разрешите Essential устанавливать обновления и нажмите «Обновить» ещё раз", Toast.LENGTH_LONG).show()
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        val uri = dm.getUriForDownloadedFile(downloadId) ?: return set("error", e = "файл обновления не найден")
        ctx.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
