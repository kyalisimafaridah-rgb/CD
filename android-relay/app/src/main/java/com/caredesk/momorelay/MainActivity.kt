package com.caredesk.momorelay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.*

/**
 * Setup + status screen. Deliberately minimal: this app has exactly one
 * job (relay MoMo SMS to the CareDesk backend), so the UI is one screen —
 * enter webhook URL + secret, grant permissions, confirm it's running, see
 * recent activity. No navigation, no settings buried in menus.
 */
class MainActivity : ComponentActivity() {

    private val requestSmsPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Toast.makeText(this, "SMS permission is required — the relay can't work without it", Toast.LENGTH_LONG).show()
            }
        }
    private val requestNotifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent { RelayScreen() }
    }

    @Composable
    private fun RelayScreen() {
        val context = this
        var webhookUrl by remember { mutableStateOf(RelaySettings.getWebhookUrl(context)) }
        var secret by remember { mutableStateOf(RelaySettings.getSharedSecret(context)) }
        var smsGranted by remember {
            mutableStateOf(checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED)
        }
        var logEntries by remember { mutableStateOf(RelayLog.recent(context)) }

        MaterialTheme {
            Surface(modifier = Modifier.fillMaxSize()) {
                Column(modifier = Modifier.padding(16.dp).fillMaxSize()) {
                    Text("CareDesk MoMo Relay", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Forwards MTN/Airtel MoMo payment SMS to CareDesk so subscription payments auto-approve. Runs silently in the background.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = webhookUrl,
                        onValueChange = { webhookUrl = it },
                        label = { Text("Webhook URL") },
                        placeholder = { Text("https://your-caredesk-app.onrender.com/api/webhooks/momo-sms") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = secret,
                        onValueChange = { secret = it },
                        label = { Text("Shared secret (MOMO_SMS_WEBHOOK_SECRET)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            RelaySettings.setWebhookUrl(context, webhookUrl)
                            RelaySettings.setSharedSecret(context, secret)
                            Toast.makeText(context, "Saved", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Save") }

                    Spacer(Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(16.dp))

                    StatusRow(
                        label = "SMS permission",
                        ok = smsGranted,
                        actionLabel = "Grant",
                        onAction = { requestSmsPermission.launch(Manifest.permission.RECEIVE_SMS) }
                    )
                    Spacer(Modifier.height(8.dp))
                    val batteryExempt = isBatteryOptimizationExempt()
                    StatusRow(
                        label = "Battery optimization exemption",
                        ok = batteryExempt,
                        actionLabel = "Fix",
                        onAction = { requestBatteryExemption() }
                    )
                    Spacer(Modifier.height(8.dp))
                    StatusRow(label = "Webhook configured", ok = RelaySettings.isConfigured(context), actionLabel = null, onAction = {})

                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text("Recent activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        TextButton(onClick = {
                            smsGranted = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                            logEntries = RelayLog.recent(context)
                        }) { Text("Refresh") }
                    }
                    Spacer(Modifier.height(8.dp))

                    if (logEntries.isEmpty()) {
                        Text("Nothing received yet. Send yourself a test MoMo transaction to confirm setup.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        LazyColumn(modifier = Modifier.weight(1f)) {
                            items(logEntries) { entry -> LogRow(entry) }
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun StatusRow(label: String, ok: Boolean, actionLabel: String?, onAction: () -> Unit) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text((if (ok) "✅ " else "⚠️ ") + label)
            if (!ok && actionLabel != null) {
                TextButton(onClick = onAction) { Text(actionLabel) }
            }
        }
    }

    @Composable
    private fun LogRow(entry: RelayLog.Entry) {
        val fmt = remember { SimpleDateFormat("MMM d HH:mm:ss", Locale.getDefault()) }
        Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(modifier = Modifier.padding(8.dp)) {
                Text(
                    "${fmt.format(Date(entry.timestamp))} — ${entry.sender}",
                    style = MaterialTheme.typography.labelSmall
                )
                Text(entry.bodyPreview, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                val status = when {
                    !entry.forwarded -> "Not a MoMo message — ignored"
                    entry.httpStatus in 200..299 -> "✅ Forwarded (HTTP ${entry.httpStatus})"
                    entry.error != null -> "❌ Failed: ${entry.error}"
                    else -> "Pending…"
                }
                Text(status, style = MaterialTheme.typography.labelSmall)
            }
        }
    }

    private fun isBatteryOptimizationExempt(): Boolean {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestBatteryExemption() {
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
