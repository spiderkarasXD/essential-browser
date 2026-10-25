package app.essential.browser

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.URLUtil
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

// Загрузки через системный DownloadManager: файлы попадают в «Загрузки», уведомление рисует Android,
// а прогресс для кружка на панели и списка мы опрашиваем сами
class Downloads(private val ctx: Context, private val onChange: () -> Unit) {
    private class D(val id: Long, val name: String, val url: String, var received: Long = 0, var total: Long = -1, var state: String = "progressing", var speed: Double = 0.0, var lastBytes: Long = 0, var lastAt: Long = 0)

    private val dm = ctx.getSystemService(DownloadManager::class.java)
    private val list = mutableListOf<D>()
    private val main = Handler(Looper.getMainLooper())
    private var polling = false
    private val store = Store(ctx)

    fun start(url: String, userAgent: String?, disposition: String?, mime: String?, length: Long, cookie: String?) {
        if (!url.startsWith("http")) {
            Toast.makeText(ctx, "Такую загрузку (blob/data) телефон сохранить не может", Toast.LENGTH_SHORT).show()
            return
        }
        val name = URLUtil.guessFileName(url, disposition, mime)
        try {
            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setMimeType(mime)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            cookie?.let { req.addRequestHeader("Cookie", it) }
            userAgent?.let { req.addRequestHeader("User-Agent", it) }
            val id = dm.enqueue(req)
            list.add(0, D(id, name, url, total = length))
            if (list.size > 30) list.subList(30, list.size).clear()
            save()
            Toast.makeText(ctx, "Скачивается: $name", Toast.LENGTH_SHORT).show()
            poll()
        } catch (e: Exception) {
            Toast.makeText(ctx, "Не удалось начать загрузку: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    fun restore() {
        store.arr("downloads.json")?.objects()?.forEach { list.add(D(it.optLong("id"), it.optString("name"), it.optString("url"))) }
        poll()
    }

    private fun save() = store.write("downloads.json", JSONArray(list.map { jsonOf("id" to it.id, "name" to it.name, "url" to it.url) }).toString())

    private fun poll() {
        refresh()
        if (polling || list.none { it.state == "progressing" || it.state == "paused" }) return
        polling = true
        main.postDelayed(object : Runnable {
            override fun run() {
                refresh()
                if (list.any { it.state == "progressing" || it.state == "paused" }) main.postDelayed(this, 500) else polling = false
            }
        }, 500)
    }

    private fun refresh() {
        if (list.isEmpty()) return
        val q = DownloadManager.Query().setFilterById(*list.map { it.id }.toLongArray())
        val seen = mutableSetOf<Long>()
        dm.query(q)?.use { c ->
            val idCol = c.getColumnIndex(DownloadManager.COLUMN_ID)
            val gotCol = c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val totCol = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val stCol = c.getColumnIndex(DownloadManager.COLUMN_STATUS)
            while (c.moveToNext()) {
                val d = list.firstOrNull { it.id == c.getLong(idCol) } ?: continue
                seen.add(d.id)
                d.received = c.getLong(gotCol)
                d.total = c.getLong(totCol)
                d.state = when (c.getInt(stCol)) {
                    DownloadManager.STATUS_SUCCESSFUL -> "completed"
                    DownloadManager.STATUS_FAILED -> "interrupted"
                    DownloadManager.STATUS_PAUSED -> "paused"
                    else -> "progressing"
                }
                val now = System.currentTimeMillis()
                if (d.lastAt > 0 && now > d.lastAt) {
                    val raw = (d.received - d.lastBytes) * 1000.0 / (now - d.lastAt)
                    d.speed = if (d.speed == 0.0) raw else d.speed * 0.85 + raw * 0.15 // сглаживаем, чтобы цифра не скакала
                }
                d.lastBytes = d.received
                d.lastAt = now
                if (d.state != "progressing") d.speed = 0.0
            }
        }
        // удалённые из системного списка — считаем отменёнными
        list.filter { it.id !in seen && it.state != "cancelled" }.forEach { it.state = "cancelled" }
        onChange()
    }

    fun summary(): JSONObject {
        val active = list.filter { it.state == "progressing" || it.state == "paused" }
        val total = active.sumOf { maxOf(it.total, 0) }
        val known = active.isNotEmpty() && active.all { it.total > 0 }
        return jsonOf(
            "count" to list.size,
            "active" to active.size,
            "progress" to if (known && total > 0) active.sumOf { it.received } * 100 / total else JSONObject.NULL,
            "lastDone" to (list.firstOrNull { it.state == "completed" }?.id ?: 0L),
        )
    }

    fun list(): JSONArray = JSONArray(list.map {
        jsonOf("id" to it.id, "name" to it.name, "url" to it.url, "received" to it.received, "total" to it.total, "state" to it.state, "speed" to it.speed.toLong())
    })

    fun action(id: Long, action: String) {
        val d = list.firstOrNull { it.id == id } ?: return
        when (action) {
            "cancel" -> { dm.remove(id); d.state = "cancelled" }
            "remove" -> { list.remove(d); save() }
            "retry" -> { list.remove(d); start(d.url, null, null, null, -1, null) }
            "open" -> try {
                val uri = dm.getUriForDownloadedFile(id) ?: return
                ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, dm.getMimeTypeForDownloadedFile(id)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                Toast.makeText(ctx, "Нет приложения, чтобы открыть этот файл", Toast.LENGTH_SHORT).show()
            }
            "show" -> runCatching { ctx.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
        onChange()
    }
}
