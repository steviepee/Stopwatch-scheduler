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
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class TimerForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var startedAtElapsedMs: Long = SystemClock.elapsedRealtime()
  private var paused: Boolean = false
  private var pausedElapsedMs: Long = 0L
  private var phase: String? = null
  private var targetMs: Long = 0L
  private val knownTargets = mutableMapOf<String, Long>()

  private val tick = object : Runnable {
    override fun run() {
      remindIfDue()
      notificationManager().notify(NOTIFICATION_ID, buildNotification())
      handler.postDelayed(this, REFRESH_INTERVAL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action != null && action in TAP_ACTIONS) {
      if ((flags and START_FLAG_REDELIVERY) == 0) {
        applyTap(action)
      }
    } else if (intent != null && intent.hasExtra(EXTRA_STARTED_AT)) {
      readState(intent)
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
    reminderPosted = false
    super.onDestroy()
  }

  private fun readState(intent: Intent) {
    val previousPhase = phase
    startedAtElapsedMs = intent.getLongExtra(EXTRA_STARTED_AT, SystemClock.elapsedRealtime())
    paused = intent.getBooleanExtra(EXTRA_PAUSED, false)
    pausedElapsedMs = intent.getLongExtra(EXTRA_PAUSED_ELAPSED, 0L)
    phase = intent.getStringExtra(EXTRA_PHASE)
    targetMs = intent.getLongExtra(EXTRA_TARGET, 0L)
    val current = phase ?: return
    if (targetMs > 0L) {
      knownTargets[current] = targetMs
    }
    val elapsed = elapsedMs()
    if (previousPhase == null) {
      reminderPosted = targetMs > 0L && elapsed >= targetMs
    } else if (current != previousPhase || elapsed < targetMs) {
      reminderPosted = false
    }
    if (current != previousPhase) {
      notificationManager().cancel(REMINDER_NOTIFICATION_ID)
    }
  }

  private fun applyTap(action: String) {
    val now = SystemClock.elapsedRealtime()
    when (action) {
      ACTION_PAUSE -> {
        if (paused) return
        pausedElapsedMs = now - startedAtElapsedMs
        paused = true
      }
      ACTION_RESUME -> {
        if (!paused) return
        startedAtElapsedMs = now - pausedElapsedMs
        paused = false
      }
      ACTION_SWITCH -> {
        val current = phase ?: return
        val next = if (current == PHASE_WORK) PHASE_BREAK else PHASE_WORK
        phase = next
        targetMs = knownTargets[next] ?: 0L
        startedAtElapsedMs = now
        paused = false
        reminderPosted = false
        notificationManager().cancel(REMINDER_NOTIFICATION_ID)
      }
    }
    recordAction(this, action.removePrefix(ACTION_PREFIX), now)
    ContextCompat.startForegroundService(this, stateIntent())
    onAction?.invoke()
  }

  private fun stateIntent(): Intent {
    val intent = Intent(this, TimerForegroundService::class.java)
    intent.putExtra(EXTRA_STARTED_AT, startedAtElapsedMs)
    intent.putExtra(EXTRA_PAUSED, paused)
    intent.putExtra(EXTRA_PAUSED_ELAPSED, pausedElapsedMs)
    phase?.let {
      intent.putExtra(EXTRA_PHASE, it)
      intent.putExtra(EXTRA_TARGET, targetMs)
    }
    return intent
  }

  private fun elapsedMs(): Long =
    if (paused) pausedElapsedMs else SystemClock.elapsedRealtime() - startedAtElapsedMs

  private fun remindIfDue() {
    val current = phase ?: return
    if (paused || targetMs <= 0L || elapsedMs() < targetMs) {
      return
    }
    postReminder(this, current)
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

  private fun tapIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, TimerForegroundService::class.java).setAction(action)
    return PendingIntent.getService(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun contentText(): String {
    val elapsed = elapsedMs()
    val current = phase
    val text = if (current == null) {
      formatElapsed(elapsed)
    } else if (targetMs <= 0L) {
      "${phaseLabel(current)} · ${formatElapsed(elapsed)}"
    } else if (elapsed <= targetMs) {
      "${phaseLabel(current)} · ${formatElapsed(targetMs - elapsed)} left"
    } else {
      "${phaseLabel(current)} · +${formatElapsed(elapsed - targetMs)} over"
    }
    return if (paused) "Paused · $text" else text
  }

  private fun buildNotification(): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(CHANNEL_NAME)
      .setContentText(contentText())
      .setContentIntent(launchIntent(this))
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
    if (paused) {
      builder.addAction(0, "Resume", tapIntent(ACTION_RESUME, 1))
    } else {
      builder.addAction(0, "Pause", tapIntent(ACTION_PAUSE, 2))
    }
    phase?.let {
      val label = if (it == PHASE_WORK) "Start break" else "Start work"
      builder.addAction(0, label, tapIntent(ACTION_SWITCH, 3))
    }
    return builder.build()
  }

  companion object {
    const val EXTRA_STARTED_AT = "startedAtElapsedMs"
    const val EXTRA_PAUSED = "paused"
    const val EXTRA_PAUSED_ELAPSED = "pausedElapsedMs"
    const val EXTRA_PHASE = "phase"
    const val EXTRA_TARGET = "targetMs"
    private const val CHANNEL_ID = "stopwatch-timer"
    private const val CHANNEL_NAME = "Recording"
    private const val REMINDER_CHANNEL_ID = "pomodoro-reminder"
    private const val REMINDER_CHANNEL_NAME = "Pomodoro reminders"
    private const val NOTIFICATION_ID = 1
    private const val REMINDER_NOTIFICATION_ID = 2
    private const val REFRESH_INTERVAL_MS = 1000L
    private const val ACTION_PREFIX = "expo.modules.timernative."
    private const val ACTION_PAUSE = ACTION_PREFIX + "pause"
    private const val ACTION_RESUME = ACTION_PREFIX + "resume"
    private const val ACTION_SWITCH = ACTION_PREFIX + "switch"
    private val TAP_ACTIONS = setOf(ACTION_PAUSE, ACTION_RESUME, ACTION_SWITCH)
    private const val PHASE_WORK = "work"
    private const val PHASE_BREAK = "break"
    private const val PREFS_NAME = "timer-native-actions"
    private const val PREFS_KEY = "actions"
    private val lock = Any()

    @Volatile
    var onAction: (() -> Unit)? = null

    @Volatile
    private var reminderPosted: Boolean = false

    fun drainActions(context: Context): List<Map<String, Any>> {
      synchronized(lock) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = JSONArray(prefs.getString(PREFS_KEY, "[]"))
        prefs.edit().remove(PREFS_KEY).apply()
        return (0 until stored.length()).map {
          val item = stored.getJSONObject(it)
          mapOf(
            "action" to item.getString("action"),
            "atElapsedMs" to item.getLong("atElapsedMs").toDouble()
          )
        }
      }
    }

    fun postReminder(context: Context, phase: String) {
      if (reminderPosted) {
        return
      }
      reminderPosted = true
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        manager.getNotificationChannel(REMINDER_CHANNEL_ID) == null
      ) {
        val channel = NotificationChannel(
          REMINDER_CHANNEL_ID,
          REMINDER_CHANNEL_NAME,
          NotificationManager.IMPORTANCE_DEFAULT
        )
        channel.enableVibration(true)
        manager.createNotificationChannel(channel)
      }
      val text = if (phase == PHASE_WORK) "Work interval reached its length" else "Break is over"
      val notification = NotificationCompat.Builder(context, REMINDER_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_media_play)
        .setContentTitle("Pomodoro")
        .setContentText(text)
        .setContentIntent(launchIntent(context))
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setDefaults(NotificationCompat.DEFAULT_ALL)
        .setAutoCancel(true)
        .build()
      manager.notify(REMINDER_NOTIFICATION_ID, notification)
    }

    private fun recordAction(context: Context, action: String, atElapsedMs: Long) {
      synchronized(lock) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = JSONArray(prefs.getString(PREFS_KEY, "[]"))
        stored.put(JSONObject().put("action", action).put("atElapsedMs", atElapsedMs))
        prefs.edit().putString(PREFS_KEY, stored.toString()).apply()
      }
    }

    private fun launchIntent(context: Context): PendingIntent {
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      return PendingIntent.getActivity(
        context,
        0,
        launchIntent ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun phaseLabel(phase: String): String = when (phase) {
      PHASE_WORK -> "Work"
      PHASE_BREAK -> "Break"
      else -> "Long break"
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
  }
}
