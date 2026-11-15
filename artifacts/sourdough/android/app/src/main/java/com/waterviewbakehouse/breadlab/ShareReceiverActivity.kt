package com.waterviewbakehouse.breadlab

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.annotation.Keep
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

@Keep
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val shareData = ShareReceiverDataExtractor.extract(intent, callingPackage)

    Log.i(HARNESS_TAG, "=== BEGIN ShareReceiverData ===")
    Log.i(HARNESS_TAG, shareData.toDiagnosticJson())
    Log.i(HARNESS_TAG, "=== END ShareReceiverData ===")

    val rawText = if (shareData.action == Intent.ACTION_SEND) {
      shareData.extraText
    } else null

    val rawSubject = if (shareData.action == Intent.ACTION_SEND) {
      shareData.extraSubject
    } else null

    var stagedId: String? = null

    if (!rawText.isNullOrBlank()) {
      try {
        stagedId = stageSharePayload(rawText.trim(), rawSubject?.trim())
        val message = if (rawText.trim().startsWith("http://", ignoreCase = true) ||
          rawText.trim().startsWith("https://", ignoreCase = true)) {
          "Recipe link saved. Open Bread Lab when online to process it."
        } else {
          "Shared recipe saved for processing in Bread Lab."
        }
        Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
      } catch (e: Exception) {
        Log.e(HARNESS_TAG, "Could not durably stage shared recipe", e)
        Toast.makeText(applicationContext, "Could not save the shared recipe. Please try sharing again.", Toast.LENGTH_LONG).show()
      }
    }

    logNativeDiagnostic(
      action = shareData.action,
      hasExtraText = !rawText.isNullOrBlank(),
      extraTextLength = rawText?.length ?: 0,
      hasSubject = !rawSubject.isNullOrBlank(),
      subjectLength = rawSubject?.length ?: 0,
      stagedId = stagedId
    )

    finish()
  }

  private fun stageSharePayload(rawText: String, rawSubject: String?): String =
    synchronized(StagedShareBridgeModule.STAGING_LOCK) {
      val prefs = applicationContext.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
      val jsonArray = JSONArray(prefs.getString(KEY_STAGED_SHARES, "[]") ?: "[]")
      val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
      val id = UUID.randomUUID().toString()
      val newEntry = JSONObject().apply {
        put("id", id)
        put("rawContent", rawText)
        if (!rawSubject.isNullOrBlank()) put("subject", rawSubject)
        put("sharedAt", dateFormat.format(Date()))
      }
      jsonArray.put(newEntry)
      if (!prefs.edit().putString(KEY_STAGED_SHARES, jsonArray.toString()).commit()) {
        throw IllegalStateException("Shared recipe staging was not persisted")
      }
      id
    }

  private fun logNativeDiagnostic(
    action: String?,
    hasExtraText: Boolean,
    extraTextLength: Int,
    hasSubject: Boolean,
    subjectLength: Int,
    stagedId: String?
  ) {
    val prefs = applicationContext.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    val existingDiag = prefs.getString(KEY_NATIVE_DIAG_LOGS, "[]") ?: "[]"
    val jsonArray = try {
      JSONArray(existingDiag)
    } catch (_: Exception) {
      JSONArray()
    }

    val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }

    val entry = JSONObject().apply {
      put("timestamp", dateFormat.format(Date()))
      put("stage", "native_intent_receipt")
      put("action", action ?: "null")
      put("hasExtraText", hasExtraText)
      put("extraTextLength", extraTextLength)
      put("hasSubject", hasSubject)
      put("subjectLength", subjectLength)
      if (stagedId != null) put("stagedId", stagedId)
    }

    jsonArray.put(entry)
    while (jsonArray.length() > 50) {
      jsonArray.remove(0)
    }
    prefs.edit().putString(KEY_NATIVE_DIAG_LOGS, jsonArray.toString()).apply()
  }

  companion object {
    private const val HARNESS_TAG = "ShareReceiverDataHarness"
    private const val PREFS_NAME = "bread_lab_native_staging"
    private const val KEY_STAGED_SHARES = "staged_shares_v1"
    private const val KEY_NATIVE_DIAG_LOGS = "native_diag_logs_v1"
  }
}
