package expo.modules.timernative

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TimerNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TimerNative")

    Function("elapsedRealtime") {
      SystemClock.elapsedRealtime().toDouble()
    }

    Function("startForegroundService") { startedAtElapsedMs: Double ->
      val intent = Intent(context, TimerForegroundService::class.java)
      intent.putExtra(TimerForegroundService.EXTRA_STARTED_AT, startedAtElapsedMs.toLong())
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stopForegroundService") {
      context.stopService(Intent(context, TimerForegroundService::class.java))
    }

    AsyncFunction("requestNotificationPermissionAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(true)
      } else {
        val permissions = appContext.permissions ?: throw Exceptions.PermissionsModuleNotFound()
        permissions.askForPermissions(
          { result ->
            val response = result[Manifest.permission.POST_NOTIFICATIONS]
            promise.resolve(response?.status == PermissionsStatus.GRANTED)
          },
          Manifest.permission.POST_NOTIFICATIONS
        )
      }
    }
  }
}
