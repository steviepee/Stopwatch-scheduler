import ExpoModulesCore

public class TimerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimerNative")

    Function("elapsedRealtime") { () -> Double in
      Date().timeIntervalSince1970 * 1000
    }

    Function("startForegroundService") { (startedAtElapsedMs: Double) in
    }

    Function("stopForegroundService") {
    }

    AsyncFunction("requestNotificationPermissionAsync") { () -> Bool in
      false
    }
  }
}
