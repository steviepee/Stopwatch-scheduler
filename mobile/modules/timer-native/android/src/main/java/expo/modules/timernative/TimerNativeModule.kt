package expo.modules.timernative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TimerNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TimerNative")

    Function("hello") {
      "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { value: String ->
    }
  }
}
