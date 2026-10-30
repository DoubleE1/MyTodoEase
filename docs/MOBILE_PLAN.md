# TodoEase mobile: research and plan

Status: plan only, no code yet. Written 2026-10-31 on branch `roadmap-tasks`.

The task note asks for three things. The app is designed properly before any code. iOS comes first and Android second. Testing happens on an emulator. This document covers all three. It separates **decisions** (recommended, waiting for your OK), **facts** (checked, with sources) and **open questions**.

---

## 1. Goal and success criteria

**Problem.** TodoEase lives on the desktop and the web. Tasks get remembered away from the desk, so capture has to happen on the phone in a few seconds.

**The first release succeeds when:**

1. You sign in with the same Google account as the desktop (cloud mode) and see the same tasks. No separate account and no export step.
2. Quick add with natural language ("dentist friday 3pm p1 #Health") takes under 5 seconds from the home screen.
3. Today, Upcoming, Inbox and Projects work offline and catch up when the phone is back online.
4. A change on the phone shows on the desktop within a few seconds, and the other way round.
5. It feels like an iOS app: large titles, sheets, swipe actions, haptics, Dynamic Type, VoiceOver and dark mode.

**Not in the first release:** the mini window, docking, pop-out notes, MCP, shortcut remapping, Google Calendar mirroring setup, reminders and notifications (that task is on hold), skins and the shop.

---

## 2. Facts about the current system

| Area | Today | What it means for mobile |
|---|---|---|
| Cloud data | Firestore, `users/{uid}/{projects,sections,labels,tasks,completions}/{id}`, through `frontend/src/api/firestoreClient.ts` | The phone talks to Firestore directly, like the web app. No server work is needed. |
| Sign-in | Google through Firebase Auth. Desktop gets a Google ID token (PKCE) and calls `signInWithCredential` (`api/cloudSession.ts`). | Same pattern on the phone: native Google sign-in gives an ID token, then `signInWithCredential`. |
| Rules | Firestore security rules are already deployed per user. | They are reused unchanged. |
| Plan | Firebase Spark (free). You rejected Blaze and Cloud Functions. | Everything must run on the device. No server push, so no remote notifications in v1. |
| Logic | Quick add (with chrono-node), recurrence, dates, achievements and i18n are TypeScript in `frontend/src/lib` and `frontend/src/i18n`. | Most of it is reusable if it moves into a shared package. |
| Local-only users | Desktop "This PC" mode keeps data in LiteDB. | The phone needs cloud mode. A "This PC" user sees a "Move your tasks to the cloud on the desktop first" screen. |

---

## 3. Recommended stack (decision needed)

**Recommended: React Native with Expo (TypeScript), sharing a `packages/core` with the web app.**

| Option | Native feel | Reuse of existing code | Builds iOS from Windows | Verdict |
|---|---|---|---|---|
| **Expo / React Native** | Good: native views, gestures, haptics | High: types, quick add, dates, recurrence, achievements, i18n, Firestore client | Yes, through EAS Build (cloud Mac) | **Recommended** |
| Capacitor (wrap the current web app) | Weak: a web page in a shell; drag, scroll and keyboard feel off on iOS | Highest | Needs a Mac or a cloud build | Fails the "well designed" bar |
| SwiftUI (native iOS) | Best | None: everything rewritten in Swift, then again for Android | No, needs a Mac and Xcode | Too costly for one developer on Windows |
| Flutter | Good | None (Dart) | Needs a Mac or a cloud build | No reuse, new language |

Why Expo fits:

- It is React, which you already prefer.
- About 40% of the app logic carries over through `packages/core`.
- It is one codebase for iOS now and Android later.

### Libraries (to confirm in the spike)

- **Navigation:** Expo Router, using native stack and tabs.
- **Data:** `@react-native-firebase/app`, `auth` and `firestore`.
  - These are the native Firebase SDKs, so they have real offline persistence.
  - The Firebase JS SDK works in React Native too, but its auth persistence and offline cache need workarounds, and there are open issues ([firebase-js-sdk #8332](https://github.com/firebase/firebase-js-sdk/issues/8332), [#9316](https://github.com/firebase/firebase-js-sdk/issues/9316)).
  - Trade-off: the native SDKs do not run in Expo Go, so a development build is needed (see section 6).
- **Google sign-in:** `@react-native-google-signin/google-signin`. It returns the ID token for `signInWithCredential`.
- **Lists and gestures:** FlashList, `react-native-gesture-handler` and Reanimated (for swipe to complete or reschedule, and drag to reorder).
- **Haptics:** `expo-haptics`.
- **Dates:** date-fns and chrono-node, the same as the web app.

---

## 4. Design first (phase 0, before any code)

The note says "make sure the mobile is well designed before implementing". Nothing in phases 2 to 5 starts until you sign off these designs.

### 4.1 Information architecture

**Tab bar (5 items):** Today · Upcoming · Browse · Notes · Search

- **Browse:** Inbox, projects, labels, completed, Insights and achievements.
- **Quick add:** a floating "+" button on every tab opens a bottom sheet with the natural-language field. Chips under the field show what it understood: date, priority, project, label.
- **Task detail:** a sheet holding the title, description (Markdown), date, repeat, priority, project, labels and sub-tasks.

### 4.2 Gestures and patterns, following the Apple Human Interface Guidelines

| Action | Gesture | Fallback for VoiceOver / no gesture |
|---|---|---|
| Complete | Tap the circle; a haptic tick and the same completion animation (off under Reduce Motion) | Rotor action "Complete" |
| Reschedule | Swipe left opens Today / Tomorrow / Next week / Pick… | Rotor action "Reschedule" |
| Delete | Swipe left, full swipe, confirm | Rotor action "Delete" |
| Undo | A toast with Undo; shaking the device also undoes, as iOS expects | Undo button in the toast |
| Reorder | Long press, then drag | Move up / Move down actions |
| Board view | Horizontal paging columns; long press a card for "Move to…" | Same "Move to…" menu |

### 4.3 Accessibility and layout

- **Dynamic Type:** test up to the largest accessibility size. Rows wrap; they never truncate the task title.
- **Contrast:** at least 4.5:1 for text in both themes. Priority and due colours are never the only signal; each also gets an icon or text.
- **Touch targets:** at least 44×44 pt.
- **VoiceOver:**
  - Each task row reads as "title, due Friday 3 pm, priority 1, project Health".
  - Each row carries custom actions.
- **Languages:** reuse the four dictionaries (English, 简体中文, 日本語, 한국어) and `datePattern()`.
- **Layout:** respect safe areas and the keyboard. On iPad, show a split view with the list left and detail right; this is later, but the layout must not block it.

### 4.4 Design deliverables

1. **User flows:** first launch and sign-in, quick add, plan today, review overdue, capture a note and turn it into tasks.
2. **Low-fi wireframes:** every screen in the information architecture.
3. **Hi-fi mock-ups:** in Figma, light and dark, at the smallest (iPhone SE) and largest (Pro Max) sizes.
4. **Clickable prototype:** for you to try on your phone, with your sign-off before code.

**Estimate:** about 1 to 2 weeks part-time.

---

## 5. Code sharing plan

Move the pure logic from `frontend/src` into an npm workspace package, `packages/core`. Both the web app (Vite) and the phone app (Metro) consume it.

| Moves to core | Stays per app |
|---|---|
| `api/types.ts` and the Firestore data rules (validation, recurrence roll-forward, cascades) | React hooks and TanStack Query wiring |
| `lib/quickAdd.ts`, `lib/recurrence.ts` and the pure parts of `lib/dates.ts` | Components and styles |
| `lib/achievements.ts` (`evaluate` and the definitions) | Storage: localStorage on web, MMKV/AsyncStorage on the phone |
| `i18n/` dictionaries and `datePattern` | Platform sign-in |

The data layer needs one interface with two adapters, because the code calls the Firestore API differently:

- web: `firebase/firestore`
- phone: `@react-native-firebase/firestore`

The data rules stay in one place.

**Estimate:** 2 to 4 days, done as its own PR, with the web app tested afterwards and nothing changing for users.

---

## 6. Testing on Windows, iOS first

**Fact:** the iOS Simulator only runs on macOS ([Expo: devices compared](https://docs.expo.dev/preview/simulators/how-it-works/devices-compared/)). This machine is Windows, so "iOS first, on an emulator" needs one of these:

| Option | iOS Simulator? | Cost | Notes |
|---|---|---|---|
| **A. Development build on your iPhone** (built by EAS in the cloud, installed on the phone) | Real device | Apple Developer Program, 99 USD per year (needed anyway to publish) | Recommended starting point. Hot reload over Wi-Fi from Windows. |
| B. Expo Go on your iPhone | Real device | Free | UI work only. It cannot load the native Firebase or Google sign-in modules, so it runs on a mock data layer. Useful in the design and prototype phase. |
| C. EAS Simulator (Expo's cloud iOS Simulator) | Yes, in the cloud | Unknown; limited-access preview ([Expo blog, Sept 2026](https://expo.dev/blog/build-ios-apps-on-windows-with-cloud-simulators)) | Worth trying when it opens. It is the closest match to "test with emulator" from Windows. |
| D. A Mac (for example a used Mac mini) | Yes, local | One-off hardware | Best long-term setup if iOS becomes the main target. |
| Android Emulator (Android Studio on Windows) | No, but it is an emulator | Free | Used from day one for Android checks and automated tests. |

**Builds:**

- EAS Build compiles iOS on Expo's Macs.
- The free plan is listed as 30 builds a month, of which up to 15 can be iOS. Sources disagree on the exact split, so check [expo.dev/pricing](https://expo.dev/pricing) before relying on the number ([Expo changelog on free plan limits](https://expo.dev/changelog/2023-08-01-eas-free-plan-limits)).
- With hot reload, a new build is only needed when native modules change, so 15 iOS builds a month is enough.

**Paid items:**

- **Apple Developer Program, 99 USD per year.** It is the only way to put an app on the App Store or install development builds on an iPhone from Windows, so it cannot be avoided for iOS.
- **Google Play, a one-off 25 USD.**

Everything else in this plan is free.

**Automated tests:**

- Jest for `packages/core`. Quick add and recurrence already have esbuild-tested cases to port.
- Maestro for end-to-end flows (sign-in with a test account, quick add, complete, undo) on the Android Emulator. iOS runs join when a simulator (option C or D) is available.

---

## 7. Phases

| # | Phase | Output | Estimate |
|---|---|---|---|
| 0 | Design | Flows, wireframes, Figma, prototype, your sign-off | 1 to 2 weeks |
| 1 | Spike | Expo app; Google sign-in on your iPhone; reads Today from Firestore; offline test (flight mode, complete, reconnect) | 2 to 3 days |
| 2 | Shared core | `packages/core`; web app unchanged and tested | 2 to 4 days |
| 3 | MVP | Today, Upcoming, Inbox, Projects, task detail, quick add, complete, undo, search, languages | 2 to 3 weeks |
| 4 | Second wave | Notes and Turn into tasks, Insights (heatmap and World, read-only), achievements, board view | 1 to 2 weeks |
| 5 | Polish | Haptics, accessibility audit (VoiceOver, Dynamic Type), performance on an older iPhone, App Store screenshots | 1 week |
| 6 | Release iOS | TestFlight beta, then a paid App Store listing | about 1 week, including review |
| 7 | Android | Android pass (back button, Material touches), Play Store | 1 to 2 weeks |

Total to the App Store: about 7 to 11 weeks part-time.

---

## 8. Monetisation and distribution

These follow your standing rules:

1. **Never ads.**
2. **A paid mobile app with a one-time price.** Skins and cosmetic unlocks come later as one-time in-app purchases, matching the achievements points shop.
3. **Same cloud account as desktop and web.** Nothing about the account changes.
4. **The web app on a phone browser shows a dismissible banner,** "TodoEase for iPhone", linking to the App Store page once it exists. It stays usable; the banner is not a wall.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| No Mac, so slow iOS debugging | Option A from day one; try EAS Simulator when available; budget for option D if iOS debugging hurts |
| Offline edits conflict with desktop edits | Firestore last-write-wins per field. Keep writes per field where possible; the spike tests the desktop and phone editing one task offline. |
| Native Firebase modules and Expo upgrades | Pin the versions; upgrade Expo SDKs one at a time on a branch |
| App Store review for a paid app with sign-in | Provide a review test account; Sign in with Apple may be required when Google sign-in is offered (Apple guideline 4.8). Check this before phase 6. |
| Spark plan limits (reads/writes per day) | One user's traffic is far below the free quota. Listeners attach only to the open screens. |

---

## 10. Open questions for you

1. Approve the stack: Expo, React Native and a shared `packages/core`?
2. Is the Apple Developer Program (99 USD per year) acceptable? There is no free path to iOS distribution.
3. Is a Mac available to borrow? If not, plan on options A and C.
4. Price point for the paid app? This is not needed until phase 6.
5. Does Sign in with Apple need to sit beside Google? It is likely required by App Store guideline 4.8, and it adds an Apple-to-Firebase sign-in path.

## Sources

- [Expo pricing](https://expo.dev/pricing)
- [Expo changelog: EAS free plan limits](https://expo.dev/changelog/2023-08-01-eas-free-plan-limits)
- [Expo blog: build iOS apps on Windows with cloud simulators](https://expo.dev/blog/build-ios-apps-on-windows-with-cloud-simulators)
- [Expo docs: devices compared](https://docs.expo.dev/preview/simulators/how-it-works/devices-compared/)
- [Expo FYI: Firebase JS auth setup](https://github.com/expo/fyi/blob/main/firebase-js-auth-setup.md)
- [firebase-js-sdk issue #8332](https://github.com/firebase/firebase-js-sdk/issues/8332)
- [firebase-js-sdk issue #9316](https://github.com/firebase/firebase-js-sdk/issues/9316)
