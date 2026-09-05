---
status: accepted
date: 2026-09-05
---

# React Native with Expo, not a progressive web app

The frontend is being rebuilt for phone use. The one requirement a web app cannot meet is a
stopwatch that keeps timing with the screen locked and shows its elapsed time in a
notification — the way the stock Android stopwatch does. That needs a foreground service,
which needs native code, so the rewrite is React Native with Expo (dev build, not Expo Go).

## Considered options

- **Stay a PWA.** Rejected only because of background timing. Everything else the rewrite
  needs — touch targets, responsive layout, a correct timer — a PWA could have done.
- **React Native + Expo.** Chosen. Android first; iOS stays buildable via stubs.

## Consequences

- The oft-cited "fatal timer drift" was **not** a reason. It was `useStopwatch.ts`
  accumulating `+10` per interval tick instead of subtracting timestamps, a bug fixable on any
  platform. Do not cite drift as justification for native.
- Google OAuth never runs on the phone. The token is a single global file on the backend and
  is authorized once from a laptop browser.
- The backend must be reachable off-box from day one of the rewrite, which is why the
  credential gate (ADR 0002) precedes it.
- The web app's Workbox offline caching is gone; offline is reduced to recording with a queued
  save, deliberately.
