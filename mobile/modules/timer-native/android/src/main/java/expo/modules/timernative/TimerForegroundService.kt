package expo.modules.timernative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.util.Locale

class TimerForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var startedAtElapsedMs: Long = SystemClock.elapsedRealtime()

  private val tick = object : Runnable {
    override fun run() {
      notificationManager().notify(NOTIFICATION_ID, buildNotification())
      handler.postDelayed(this, REFRESH_INTERVAL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent != null && intent.hasExtra(EXTRA_STARTED_AT)) {
      startedAtElapsedMs = intent.getLongExtra(EXTRA_STARTED_AT, SystemClock.elapsedRealtime())
    }
    createChannel()
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      buildNotification(),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    )
    handler.removeCallbacks(tick)
    handler.postDelayed(tick, REFRESH_INTERVAL_MS)
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  private fun notificationManager(): NotificationManager =
    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = notificationManager()
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(CHANNEL_NAME)
      .setContentText(formatElapsed(SystemClock.elapsedRealtime() - startedAtElapsedMs))
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
  }

  private fun formatElapsed(elapsedMs: Long): String {
    val totalSeconds = (if (elapsedMs > 0) elapsedMs else 0L) / 1000L
    val hours = totalSeconds / 3600L
    val minutes = (totalSeconds % 3600L) / 60L
    val seconds = totalSeconds % 60L
    return if (hours > 0L) {
      String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    } else {
      String.format(Locale.US, "%d:%02d", minutes, seconds)
    }
  }

  companion object {
    const val EXTRA_STARTED_AT = "startedAtElapsedMs"
    private const val CHANNEL_ID = "stopwatch-timer"
    private const val CHANNEL_NAME = "Recording"
    private const val NOTIFICATION_ID = 1
    private const val REFRESH_INTERVAL_MS = 1000L
  }
}
