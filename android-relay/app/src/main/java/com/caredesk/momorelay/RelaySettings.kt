package com.caredesk.momorelay

import android.content.Context

/**
 * Thin wrapper over SharedPreferences. Deliberately NOT EncryptedSharedPreferences
 * for v1 — the value stored here (the webhook shared secret) is only as
 * sensitive as "someone could POST fake MoMo SMS to your billing webhook,"
 * not payment credentials themselves. If that risk profile changes, swap
 * this for androidx.security's EncryptedSharedPreferences without touching
 * any caller.
 */
object RelaySettings {
    private const val PREFS_NAME = "momo_relay_settings"
    private const val KEY_WEBHOOK_URL = "webhook_url"
    private const val KEY_SHARED_SECRET = "shared_secret"

    fun getWebhookUrl(context: Context): String =
        prefs(context).getString(KEY_WEBHOOK_URL, "") ?: ""

    fun setWebhookUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_WEBHOOK_URL, url.trim()).apply()
    }

    fun getSharedSecret(context: Context): String =
        prefs(context).getString(KEY_SHARED_SECRET, "") ?: ""

    fun setSharedSecret(context: Context, secret: String) {
        prefs(context).edit().putString(KEY_SHARED_SECRET, secret.trim()).apply()
    }

    fun isConfigured(context: Context): Boolean =
        getWebhookUrl(context).isNotBlank() && getSharedSecret(context).isNotBlank()

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
