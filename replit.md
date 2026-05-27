# Bread Lab

[![Deploy API server](https://github.com/waterviewbakehouse/bread-lab/actions/workflows/deploy-api.yml/badge.svg)](https://github.com/waterviewbakehouse/bread-lab/actions/workflows/deploy-api.yml)

A React Native (Expo) mobile app for tracking sourdough starter feed sessions and bread baking. Includes a ratio calculator, AP/WW flour slider, pH/volume readings, feed photo, active timer, peak logger, a recipe phase tracker, and a calendar history screen.

## Run & Operate

- `pnpm --filter @workspace/sourdough run dev` — run the Expo dev server
- `pnpm --filter @workspace/api-server run dev` — run the API server (dormant; kept for reference)
- `pnpm run typecheck` — full typecheck across all packages
- Scan the QR code from the Replit URL bar menu to test on device via Expo Go

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54, Expo Router 6, React Native
- State: useState + AsyncStorage (instant local reads) + Supabase (background sync)
- Styling: StyleSheet with semantic color tokens from `constants/colors.ts`
- Fonts: Inter (400/500/600/700) via @expo-google-fonts/inter

## Where things live

- `artifacts/sourdough/` — the Expo mobile app
- `artifacts/sourdough/app/(tabs)/index.tsx` — Feed Session screen + Peak modal
- `artifacts/sourdough/app/(tabs)/recipe.tsx` — Recipe phase tracker screen
- `artifacts/sourdough/app/(tabs)/history.tsx` — Calendar history screen
- `artifacts/sourdough/app/(tabs)/graph.tsx` — pH chart screen
- `artifacts/sourdough/app/(tabs)/_layout.tsx` — Three-tab layout (Feed | Recipe | Calendar)
- `artifacts/sourdough/constants/colors.ts` — farmhouse-minimalist color palette
- `artifacts/sourdough/app/_layout.tsx` — root layout (no tabs header, single Stack → (tabs))
- `artifacts/sourdough/components/PHChart.tsx` — SVG pH-over-time line chart (current session + temp overlay; isolate mode shows all-time avg)
- `artifacts/sourdough/lib/api.ts` — Supabase-backed data layer (all CRUD + analytics)
- `artifacts/sourdough/lib/analytics.ts` — shared pH chart computation helpers
- `artifacts/sourdough/lib/supabase.ts` — Supabase client (reads EXPO_PUBLIC_SUPABASE_* vars)
- `artifacts/sourdough/supabase/schema.sql` — DDL for all five Supabase tables
- `artifacts/api-server/` — Express API server (dormant; superseded by Supabase)

## Architecture decisions

- **Database**: Supabase PostgreSQL. Tables: `users`, `feed_sessions`, `bake_sessions`, `recipes`, `starter_analytics`.
- **Sync strategy**: AsyncStorage-first (instant local reads), then background-sync to Supabase (fire-and-forget). History tab refreshes from Supabase on mount. Fully offline-capable.
- **Device identity**: Random 32-char `bread_lab_device_id_v1` stored in AsyncStorage on first launch. Supabase queries scope by `device_id` OR `user_id` (whichever is available).
- **User identity**: Optional name + starter name stored in `users` table. The row ID becomes the "token" stored locally. Any device that identifies with the same name+starter gets the same token and can see all that user's data across devices.
- **Cross-device recovery**: History tab → account icon → "Name your data" / "Find my data". `api.auth.identify` upserts to `users`, `api.auth.linkDevice` stamps all existing sessions with the user_id, and all list queries use OR (device_id OR user_id).
- **No RLS**: App uses the anon key with device/user-ID-filtered queries. No Supabase Auth session.
- **pH analytics**: Pre-computed vitality (last 5 qualifying sessions) and all-time curves stored in `starter_analytics`. Updated after every new feed session save.
- **API base URL**: `EXPO_PUBLIC_DOMAIN` env var → `https://$DOMAIN/api`; falls back to `/api` for web.
- Three-tab app: Feed | Recipe | Calendar
- Tab layout uses NativeTabs (SF symbols, liquid glass on iOS 26+) + classic Tabs fallback (Feather icons)
- Peak Logger uses a React Native `Modal` (not expo-router sheet) for simplicity
- Recipe reading modal uses `Modal` with `pageSheet` presentation
- Ratio parsing supports arbitrary `S:F:W` format (e.g. 1:2:2, 2:5:5)
- Volume increase % and time to peak are auto-calculated at peak save time

## Build & Release

- Android package: `com.waterviewbakehouse.breadlab`
- Current versionCode: **6** (bump in `app.json` before each Play Store release)
- Play Store submitted: versionCode 5 as "1.0.9" — in progress
  - Acidification Index: y-axis hard-floored at 0; ceiling = 3× median (outlier-resistant)
  - Acidification Index: outlier points clip at top with pill badge showing exact value (e.g. `6.65 pH/hr`)
  - About tab: full Acidification Index interpretation guide (4 diagnostic patterns, standard + sweet variants)
- Play Store submitted: versionCode 4 as "1.0.8" — pending
- Play Store submitted: versionCode 3 as "1.0.2" — approved
- EAS projectId: `f9341997-8d63-4ef8-a2ed-e7ae9c5a8f47`
- Production build: `cd artifacts/sourdough && eas build --platform android --profile production`
- Supabase env vars are in `eas.json` under each build profile's `env` block

## Product

### Feed Tab
- **Feed Amounts**: Enter starter, flour and water weights directly (g) → ratio shown as a calculated badge (e.g. 1:2:2)
- **Flour Slider**: AP/WW blend percentage with per-type gram breakdown
- **Initial Readings**: Log pH and volume before fermentation
- **Feed Photo Gallery**: Camera or photo library picker for a "just fed" snapshot
- **Active Timer**: Once saved, shows live "Time Since Feed" counter
- **pH Readings**: Log multiple pH + temperature readings during fermentation; each timestamped with time-since-feed
- **pH Chart**: SVG line chart showing current session (terracotta) with temperature overlay (right y-axis, °F/°C), fermentation bands, and dumbbell markers; isolate mode shows all-time avg reference
- **Peak Logger**: Modal to log peak pH, volume, and a peak photo; auto-calculates rise % and time to peak
- **History Save**: Tapping "New Session" saves the completed session to history

### Recipe Tab
- **Phase tracking**: 10 predefined phases — Wet Mix, Dry Mix, Preferment, Final Mix, Bulk Ferment, Rest, Preshape, Shape, Proof, Bake
- **Phase states**: Pending → Active (with live timer) → Complete (with duration)
- **Log Reading**: Per-phase temp (°F/°C toggle) + pH + optional note
- **Progress bar**: Shows X/10 phases completed
- **New Bake**: Reset all phases to start fresh

### Calendar Tab
- **Monthly calendar**: Custom grid with dots on feed days (up to 3 dots per day)
- **Month navigation**: Browse backwards through months
- **Streak counter**: Consecutive fed days
- **Stats strip**: This month / streak / all-time totals
- **Day detail cards**: Tap a feed day to see full session summary with peak data
- **Delete entries**: Trash icon on each refresh and bake card; confirms then removes locally + from Supabase

## Storage Keys

- `sourdough_feed_session_v1` — current active feed session
- `sourdough_feed_history_v1` — array of completed sessions (newest first, capped at 500)
- `bread_lab_bake_v1` — current active bake/recipe session
- `bread_lab_auth_token_v1` — stored user ID (the Supabase users.id, used as cross-device token)
- `bread_lab_auth_user_v1` — stored user object { id, firstName, starterName }

## User preferences

- User declined hydration % suggestion ("if we get into recipes, sure, but not now")

## Planned improvements

### Bake Notes / Journal Roadmap
- **Voice transcription**: Integrate device microphone input so the user can dictate notes hands-free during a bake. Transcription runs on-device (iOS Speech framework / Android SpeechRecognizer) and inserts the result as text at the current cursor position in the Bake Notes journal.

### pH & Temperature Logging Roadmap
- **Continuous sensor integration**: Accept a streaming pH + temp feed from an Arduino, Raspberry Pi, or other IoT device over WebSocket or REST polling.
- **Dough development phase readings**: Extend the recipe Runner so each phase can have its own reading log (pH + temp), with its own mini chart.
- **Readings export**: Allow exporting all readings for a session as CSV (share sheet).
- **pH probe auto-detection**: If a Bluetooth or USB pH probe is paired, offer one-tap capture.

## Gotchas

- expo-image-picker and @react-native-async-storage/async-storage are pre-installed in the scaffold
- Web screenshot shows card structure but text may not render — test on device via Expo Go for accurate preview
- `webTop` (67px) applied for web-only status bar inset
- Tab bar pad: 84px on web, 49px on native — applied to ScrollView paddingBottom
- DO NOT use `useBottomTabBarHeight()` with NativeTabs — it throws an error

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `expo` skill for React Native guidelines
- See the `mobile-ui/references/tabs.md` skill for NativeTabs setup reference
