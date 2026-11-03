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

    Events("onTimerAction")

    OnCreate {
      TimerForegroundService.onAction = { sendEvent("onTimerAction") }
    }

    OnDestroy {
      TimerForegroundService.onAction = null
    }

    Function("elapsedRealtime") {
      SystemClock.elapsedRealtime().toDouble()
    }

    Function("startForegroundService") { startedAtElapsedMs: Double, options: Map<String, Any?>? ->
      val startedAt = startedAtElapsedMs.toLong()
      val paused = options?.get("paused") == true
      val pomodoro = options?.get("pomodoro") as? Map<*, *>
      val intent = Intent(context, TimerForegroundService::class.java)
      intent.putExtra(TimerForegroundService.EXTRA_STARTED_AT, startedAt)
      intent.putExtra(TimerForegroundService.EXTRA_PAUSED, paused)
      if (pomodoro != null) {
        intent.putExtra(TimerForegroundService.EXTRA_PHASE, pomodoro["phase"] as? String ?: "work")
        intent.putExtra(
          TimerForegroundService.EXTRA_TARGET,
          (pomodoro["targetMs"] as? Number)?.toLong() ?: 0L
        )
      }
      if (paused) {
        val pausedElapsed = (pomodoro?.get("phaseAccumulatedMs") as? Number)?.toLong()
          ?: (SystemClock.elapsedRealtime() - startedAt)
        intent.putExtra(TimerForegroundService.EXTRA_PAUSED_ELAPSED, pausedElapsed)
      }
      ContextCompat.startForegroundService(context, intent)
    }

    Function("stopForegroundService") {
      context.stopService(Intent(context, TimerForegroundService::class.java))
    }

    Function("drainActions") {
      TimerForegroundService.drainActions(context)
    }

    Function("notifyPhaseDue") { phase: String ->
      TimerForegroundService.postReminder(context, phase)
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
