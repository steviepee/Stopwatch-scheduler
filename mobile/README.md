# Stopwatch Scheduler — mobile

Expo Router app for Android. It talks to the FastAPI backend in `../backend`.

## Expo Go cannot run this app

The stopwatch depends on a local native module, `modules/timer-native`, which exposes
`SystemClock.elapsedRealtime()` and an Android foreground service. Expo Go ships a fixed set of
native modules and cannot load this one, so the app must run inside a **development build**.

## First run on a phone

1. Build the dev client (needs `eas login` once):

   ```bash
   cd mobile
   eas build --profile development --platform android
   ```

2. Open the link EAS prints when the build finishes and install the APK on the phone. The QR
   code on the build page installs it directly.

3. Start the bundler on this machine:

   ```bash
   npx expo start --dev-client
   ```

4. Open the installed app on the phone. It is on the same Wi-Fi, so it finds the bundler; if it
   does not, scan the QR code from the terminal.

Rebuild with `eas build` only when native code changes — a JS-only change just needs
`npx expo start --dev-client`.

## Verifying the native timer

`src/timer/native.ts` wraps the module and falls back to `Date.now()` with no-op service calls
when the module is unavailable (Jest, Expo Go). `isNativeAvailable()` reports which path is
live — it must be `true` in the dev build. Android 13+ also needs notification permission, which
`requestNotificationPermission()` asks for.

## Backend URL and token

`EXPO_PUBLIC_API_URL` in `mobile/.env` is the default (see `.env.example`). Both the URL and the
bearer token can be overridden on the phone from the Settings screen; they are stored in
`expo-secure-store`.

## Checks

```bash
npx jest --ci
npx tsc --noEmit
npx expo export --platform android
```
