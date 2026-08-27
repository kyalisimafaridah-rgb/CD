package com.caredesk.momorelay

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Runs briefly in the foreground (required so Android doesn't kill the
 * process mid-HTTP-call under Doze) to POST one relayed SMS to the CareDesk
 * momo-sms webhook, then stops itself. One service start per SMS — simple,
 * and volume here is a handful of payments a day, not a stream that needs
 * a persistent connection or a real job queue.
 */
class RelayForegroundService : Service() {

    companion object {
        private const val TAG = "RelayForegroundService"
        const val ACTION_RELAY_SMS = "com.caredesk.momorelay.RELAY_SMS"
        const val EXTRA_SENDER = "sender"
        const val EXTRA_BODY = "body"
        const val EXTRA_NETWORK = "network"
        private const val NOTIFICATION_CHANNEL_ID = "momo_relay_channel"
        private const val NOTIFICATION_ID = 1
        private const val MAX_ATTEMPTS = 3
        private val executor = Executors.newSingleThreadExecutor()

        fun enqueueWork(context: Context, intent: Intent) {
            ContextCompat.startForegroundService(context, intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Forwarding payment SMS…"))

        val sender = intent?.getStringExtra(EXTRA_SENDER) ?: ""
        val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
        val network = intent?.getStringExtra(EXTRA_NETWORK) ?: "mtn"

        executor.execute {
            val result = postWithRetry(sender, body, network)
            RelayLog.recordResult(applicationContext, sender, body, result.httpStatus, result.error)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private data class PostResult(val httpStatus: Int?, val error: String?)

    private fun postWithRetry(sender: String, body: String, network: String): PostResult {
        val webhookUrl = RelaySettings.getWebhookUrl(applicationContext)
        val secret = RelaySettings.getSharedSecret(applicationContext)
        if (webhookUrl.isBlank() || secret.isBlank()) {
            return PostResult(null, "Relay not configured — open the app and set webhook URL + secret")
        }

        var lastError: String? = null
        for (attempt in 1..MAX_ATTEMPTS) {
            try {
                val status = postOnce(webhookUrl, secret, sender, body, network)
                if (status in 200..299) return PostResult(status, null)
                lastError = "HTTP $status"
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
                Log.w(TAG, "Attempt $attempt failed: $lastError")
            }
            if (attempt < MAX_ATTEMPTS) Thread.sleep(2000L * attempt) // backoff: 2s, 4s
        }
        return PostResult(null, lastError)
    }

    private fun postOnce(webhookUrl: String, secret: String, sender: String, body: String, network: String): Int {
        val payload = JSONObject().apply {
            put("sender", sender)
            put("body", body)
            put("network", network)
        }
        val url = URL(webhookUrl)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("X-Momo-Secret", secret)
        try {
            val out: OutputStream = conn.outputStream
            out.write(payload.toString().toByteArray(Charsets.UTF_8))
            out.flush()
            out.close()
            return conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    private fun buildNotification(text: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "MoMo SMS Relay",
                NotificationManager.IMPORTANCE_MIN
            ).apply { description = "Silently forwards payment SMS to CareDesk" }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("CareDesk MoMo Relay")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(false)
            .build()
    }
}
