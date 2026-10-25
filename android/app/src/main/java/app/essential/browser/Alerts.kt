package app.essential.browser

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// Оповещения о беспилотной опасности — то же, что alerts.js в ПК-версии (тот же формат источника,
// тот же встроенный список субъектов). Область не отправляется никуда: скачиваем общий список и ищем свою.
// «Нет данных» никогда не показываем как «спокойно».
class Alerts(private val act: MainActivity, private val b: Browser) {
    companion object {
        const val DEFAULT_SOURCE = "" // как в alerts.js: пока источник не задан, оповещения выключены
        private const val POLL_MS = 60_000L
        private const val STALE_MS = 10 * 60_000L
        private const val LOST_MS = 10 * 60_000L
        private const val CHANNEL = "alerts"
    }

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var seq = 0
    private var status = "off" // off | checking | ok | danger | stale | error
    private var danger = false
    private var updated = 0L
    private var error: String? = null
    private var regionName = ""
    private var lastGoodAt = 0L
    private var startedAt = 0L
    private var lostNotified = false
    private val tick = Runnable { poll(); schedule() }

    private val subjects: JSONArray by lazy {
        val kinds = mapOf("kraja" to "край", "oblasti" to "область", "respubliki" to "республика",
            "goroda_federalnogo_znachenija" to "город федерального значения", "avtonomnaja_oblast" to "автономная область", "avtonomnye_okruga" to "автономный округ")
        val cats = JSONObject(act.assets.open("ui/subjects-rf.json").bufferedReader().readText()).getJSONObject("categories")
        val out = mutableListOf<JSONObject>()
        for (cat in cats.keys()) {
            val arr = cats.getJSONArray(cat)
            for (i in 0 until arr.length()) {
                val x = arr.get(i)
                val name = if (x is JSONObject) x.optString("name") else x.toString()
                out.add(jsonOf("id" to name, "name" to name, "kind" to (kinds[cat] ?: ""), "capital" to ((x as? JSONObject)?.optString("capital") ?: "")))
            }
        }
        JSONArray(out.sortedWith(compareBy(java.text.Collator.getInstance(java.util.Locale("ru"))) { it.optString("name") }))
    }

    private fun source() = b.settings.optString("alertsSource").ifEmpty { DEFAULT_SOURCE }

    fun validSource(url: String) = runCatching {
        val u = java.net.URI(url)
        u.scheme == "https" || (u.scheme == "http" && u.host in listOf("127.0.0.1", "localhost", "10.0.2.2"))
    }.getOrDefault(false)

    fun available() = validSource(source())
    private fun enabled() = b.settings.optString("alertsCountry") == "ru" && b.settings.optString("alertsRegion").isNotEmpty() && available()

    fun regions() = jsonOf("ok" to true, "regions" to subjects)

    fun state() = jsonOf(
        "available" to available(), "status" to status, "danger" to danger, "updated" to updated, "error" to error,
        "country" to b.settings.optString("alertsCountry"), "region" to b.settings.optString("alertsRegion"),
        "regionName" to b.settings.optString("alertsRegionName"), "sound" to b.settings.optBoolean("alertsSound", true),
        "source" to b.settings.optString("alertsSource"),
    )

    // настройки из интерфейса — как ipcMain.on('alerts:set') в main.js
    fun set(p: JSONObject) {
        val s = b.settings
        p.optString("country", "\u0000").takeIf { it in listOf("", "ru", "other") }?.let { s.put("alertsCountry", it) }
        if (p.has("region")) s.put("alertsRegion", p.optString("region").take(64))
        if (p.has("regionName")) s.put("alertsRegionName", p.optString("regionName").take(120))
        if (p.has("sound")) s.put("alertsSound", p.optBoolean("sound"))
        if (p.has("source")) p.optString("source").let { if (it.isEmpty() || validSource(it)) s.put("alertsSource", it.take(500)) }
        if (s.optString("alertsCountry") != "ru") { s.put("alertsRegion", ""); s.put("alertsRegionName", "") } // не в России — область не храним
        b.saveSettings()
        restart()
    }

    fun restart() {
        main.removeCallbacks(tick)
        danger = false; updated = 0; error = null; lastGoodAt = 0; lostNotified = false; startedAt = System.currentTimeMillis()
        status = if (enabled()) "checking" else "off"
        b.pushState()
        if (!enabled()) return
        poll()
        schedule()
    }

    private fun schedule() {
        main.removeCallbacks(tick)
        if (enabled()) main.postDelayed(tick, (POLL_MS * (0.9 + Math.random() * 0.2)).toLong())
    }

    private fun norm(s: String) = s.lowercase().replace('ё', 'е').replace("республика", " ").replace(Regex("[()—–\\-.,«»\"]"), " ").replace(Regex("\\s+"), " ").trim()

    private fun poll() {
        val mine = ++seq
        val src = source()
        val region = b.settings.optString("alertsRegion")
        io.execute {
            val result = runCatching {
                val con = URL(src).openConnection() as HttpURLConnection
                con.connectTimeout = 10000
                con.readTimeout = 10000
                con.setRequestProperty("Accept", "application/json")
                con.setRequestProperty("User-Agent", "Essential-Android/${BuildConfig.VERSION_NAME}")
                con.useCaches = false
                if (con.responseCode != 200) throw Exception("источник ответил ${con.responseCode}")
                val text = con.inputStream.bufferedReader().readText()
                if (text.length > 2_000_000) throw Exception("слишком большой ответ")
                val json = JSONObject(text)
                var upd = json.optLong("updated")
                if (upd <= 0) throw Exception("в ответе нет времени обновления")
                if (upd > 1_000_000_000_000L) upd /= 1000
                val regions = json.optJSONArray("regions") ?: throw Exception("неверный формат ответа")
                val r = regions.objects().firstOrNull { it.optString("id") == region || norm(it.optString("name")) == norm(region) }
                Triple(upd, r, null as String?)
            }
            main.post {
                if (mine != seq) return@post
                val now = System.currentTimeMillis()
                result.onFailure {
                    // при ошибке опасность не снимаем: нет связи — не повод считать, что опасность прошла
                    status = if (danger) "danger" else "error"
                    error = it.message ?: it.toString()
                    lostCheck(now)
                }.onSuccess { (upd, r, _) ->
                    when {
                        r == null -> { status = "error"; error = "выбранной области нет в списке источника" }
                        now - upd * 1000 > STALE_MS -> { status = if (danger) "danger" else "stale"; updated = upd; error = null; lostCheck(now) }
                        else -> {
                            lastGoodAt = now; lostNotified = false; updated = upd; error = null
                            regionName = r.optString("name")
                            val d = r.optBoolean("drone")
                            if (d && !danger) { danger = true; status = "danger"; onDanger() }
                            else if (!d && danger) { danger = false; status = "ok"; alarm("clear") }
                            else status = if (d) "danger" else "ok"
                        }
                    }
                }
                b.pushState()
            }
        }
    }

    // один раз за перебой: «мониторинг не работает, не полагайтесь на него»
    private fun lostCheck(now: Long) {
        val since = if (lastGoodAt > 0) lastGoodAt else startedAt
        if (lostNotified || now - since < LOST_MS) return
        lostNotified = true
        alarm("lost")
    }

    private fun alarm(kind: String) = act.emit("alert", jsonOf("kind" to kind, "region" to b.settings.optString("alertsRegionName"), "sound" to b.settings.optBoolean("alertsSound", true)))

    private fun onDanger() {
        alarm("danger")
        val region = b.settings.optString("alertsRegionName").ifEmpty { "Ваша область" }
        // системное уведомление и вибрация — если браузер свёрнут
        val nm = act.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Тревога", NotificationManager.IMPORTANCE_HIGH).apply { description = "Беспилотная опасность в выбранной области" })
        }
        val open = PendingIntent.getActivity(act, 0, Intent(act, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        @Suppress("DEPRECATION")
        val n = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(act, CHANNEL) else Notification.Builder(act))
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("Опасность в вашей области")
            .setContentText("$region: угроза БПЛА. Отойдите от окон, пройдите в помещение без окон или в укрытие.")
            .setStyle(Notification.BigTextStyle().bigText("$region: угроза БПЛА. Отойдите от окон, пройдите в помещение без окон или в укрытие. Следите за сообщениями МЧС."))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(1, n) }
        runCatching {
            val vib = act.getSystemService(Vibrator::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vib.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 300, 600, 300, 900), -1))
        }
    }
}
