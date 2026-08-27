package com.caredesk.momorelay

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Last-50-events log, persisted to SharedPreferences as a JSON array so it
 * survives app restarts. This is the "did it actually see my payment SMS"
 * debugging view in MainActivity — separate from the backend's
 * momoSmsEvents table, which only knows about SMS that made it all the way
 * to the server. If a message never leaves the phone (network down, relay
 * crashed before the HTTP call), this is the only place that's visible.
 */
object RelayLog {
    private const val PREFS_NAME = "momo_relay_log"
    private const val KEY_ENTRIES = "entries"
    private const val MAX_ENTRIES = 50

    data class Entry(
        val timestamp: Long,
        val sender: String,
        val bodyPreview: String,
        val forwarded: Boolean,
        val httpStatus: Int?,
        val error: String?
    )

    fun record(context: Context, sender: String, body: String, forwarded: Boolean) {
        append(context, Entry(System.currentTimeMillis(), sender, body.take(160), forwarded, null, null))
    }

    fun recordResult(context: Context, sender: String, body: String, httpStatus: Int?, error: String?) {
        append(context, Entry(System.currentTimeMillis(), sender, body.take(160), true, httpStatus, error))
    }

    fun recent(context: Context): List<Entry> {
        val raw = prefs(context).getString(KEY_ENTRIES, "[]") ?: "[]"
        val arr = JSONArray(raw)
        val out = mutableListOf<Entry>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                Entry(
                    timestamp = o.getLong("ts"),
                    sender = o.getString("sender"),
                    bodyPreview = o.getString("body"),
                    forwarded = o.getBoolean("forwarded"),
                    httpStatus = if (o.has("status")) o.getInt("status") else null,
                    error = if (o.has("error")) o.getString("error") else null
                )
            )
        }
        return out.sortedByDescending { it.timestamp }
    }

    private fun append(context: Context, entry: Entry) {
        val raw = prefs(context).getString(KEY_ENTRIES, "[]") ?: "[]"
        val arr = JSONArray(raw)
        val o = JSONObject().apply {
            put("ts", entry.timestamp)
            put("sender", entry.sender)
            put("body", entry.bodyPreview)
            put("forwarded", entry.forwarded)
            entry.httpStatus?.let { put("status", it) }
            entry.error?.let { put("error", it) }
        }
        arr.put(o)
        // Trim from the front once over MAX_ENTRIES.
        val trimmed = JSONArray()
        val start = maxOf(0, arr.length() - MAX_ENTRIES)
        for (i in start until arr.length()) trimmed.put(arr.get(i))
        prefs(context).edit().putString(KEY_ENTRIES, trimmed.toString()).apply()
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
