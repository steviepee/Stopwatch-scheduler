import ExpoModulesCore

public class TimerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimerNative")

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
    }
  }
}
