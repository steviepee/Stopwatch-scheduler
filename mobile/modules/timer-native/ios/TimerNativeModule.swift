import ExpoModulesCore

public class TimerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimerNative")

    Events("onTimerAction")

    Function("elapsedRealtime") { () -> Double in
      Date().timeIntervalSince1970 * 1000
    }

    Function("startForegroundService") { (startedAtElapsedMs: Double, options: [String: Any]?) in
    }

    Function("stopForegroundService") {
    }

    Function("drainActions") { () -> [[String: Any]] in
      []
    }

    Function("notifyPhaseDue") { (phase: String) in
    }

    AsyncFunction("requestNotificationPermissionAsync") { () -> Bool in
      false
    }
  }
}
