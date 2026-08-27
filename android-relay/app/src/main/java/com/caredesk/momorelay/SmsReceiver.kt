package com.caredesk.momorelay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

/**
 * Fires on EVERY incoming SMS on the device. We deliberately filter here
 * rather than trusting a carrier-level shortcode, because MTN and Airtel
 * both send from a mix of alphanumeric sender IDs and plain numbers
 * depending on region/OS — matching on sender address substring is more
 * reliable than an exact-match allowlist.
 *
 * Only messages from a MoMo sender are queued for relay. Everything else
 * (personal texts, OTPs, spam) is read into memory by the OS regardless —
 * that's unavoidable with RECEIVE_SMS — but never leaves this device.
 */
class SmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsReceiver"
        // Loosely matched — real-world sender IDs seen: "MTNMobMoney" (as
        // shown in the SMS app), sometimes "MTNMOBILE" or a plain number
        // depending on network/OS. Widen this list if messages are missed;
        // check RelayLog in the app for anything that arrived but wasn't
        // recognised as MoMo (logged, not silently dropped).
        private val MOMO_SENDER_HINTS = listOf("mtn", "airtel", "momo")
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // A single SMS can arrive as multiple PDUs (concatenated long
        // message) — join them back into one body before we look at it.
        val sender = messages[0].originatingAddress ?: ""
        val fullBody = messages.joinToString(separator = "") { it.messageBody ?: "" }

        val senderLower = sender.lowercase()
        val bodyLower = fullBody.lowercase()
        val looksLikeMomo = MOMO_SENDER_HINTS.any { senderLower.contains(it) } ||
            bodyLower.contains("you have received ugx")

        Log.i(TAG, "SMS from '$sender' — looksLikeMomo=$looksLikeMomo")
        RelayLog.record(context, sender, fullBody, forwarded = looksLikeMomo)

        if (!looksLikeMomo) return

        val network = if (senderLower.contains("airtel")) "airtel" else "mtn"

        // Hand off to the foreground service rather than doing the network
        // call directly in the receiver — a BroadcastReceiver has a hard
        // ~10s execution limit and no guarantee the process survives long
        // enough for an HTTP call + retry to finish.
        val serviceIntent = Intent(context, RelayForegroundService::class.java).apply {
            action = RelayForegroundService.ACTION_RELAY_SMS
            putExtra(RelayForegroundService.EXTRA_SENDER, sender)
            putExtra(RelayForegroundService.EXTRA_BODY, fullBody)
            putExtra(RelayForegroundService.EXTRA_NETWORK, network)
        }
        RelayForegroundService.enqueueWork(context, serviceIntent)
    }
}
