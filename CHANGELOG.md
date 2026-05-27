# Changelog

All notable changes to Bread Lab are recorded here.

---

## [Unreleased]

_Changes staged but not yet deployed._

---

## 2026-05-12 — Web SEO

### Fixed
- **Meta description** — added via `app/+html.tsx` (Expo Router's web HTML template); Lighthouse "missing description" warning resolved.
- **Page indexing** — added explicit `<meta name="robots" content="index, follow" />` to remove the block-from-indexing flag.
- **OG tags** — `og:title` and `og:description` added for better link previews.
- **PWA manifest** — `app.json` web section now includes `name`, `shortName`, `description`, `themeColor` (#5C3527 walnut), and `backgroundColor` (#F5F0E6 linen).

---

## 2026-05-12 — Cross-Device Sync (foreground refresh)

### Added
- **AppState listener** on History and Recipe tabs — calls `loadHistory()` / `loadAll()` whenever the app returns to the foreground, so data stays current when switching between devices.
- **Pull-to-refresh** on all scrollable surfaces across History and Recipe tabs (including all Recipe runner views).
- **"Synced X ago" label** in the Calendar header showing when the last successful API sync completed.

### Changed
- API fetch sections in `loadHistory()` and `loadAll()` converted from fire-and-forget `.then()` chains to properly `await`ed `try/catch` blocks so the pull-to-refresh spinner accurately reflects completion.

---

## 2026-05-12 — Device Data Migration on Sign-in

### Added
- **`lib/migrate.ts`** — `migrateLocalDataToAccount()` reads all feed sessions, bake history, and recipes from AsyncStorage and upserts them to the API immediately after sign-in. Returns a `MigrationResult` summary `{ feed, bakes, recipes }` with ok/failed counts.
- Migration is awaited before `onAuthChange()` fires, so the post-login history refresh sees the migrated records instead of racing against them. Individual record failures are caught and counted without aborting the rest.

---

## 2026-05-12 — User Authentication & Cross-Device Sync

### Added
- **Sign-up / Sign-in** — email + password accounts via new `POST /auth/signup` and `POST /auth/signin` endpoints. Passwords are hashed with scrypt; tokens are HMAC-SHA256 with a 90-day TTL.
- **Sign-out endpoint** — `POST /auth/signout` validates the token server-side (ready for future revocation).
- **Auth modal** — "Account" button on the Calendar tab opens a sheet with Sign In / Create Account tabs and a Sign Out option for signed-in users.
- **Device migration** — `POST /auth/link-device` batch-updates all anonymous device records (recipes, feed sessions, bake sessions) to the authenticated `userId` on first sign-in. Retried up to 3 times with backoff; user is notified if all attempts fail.
- **Cross-device restore** — once signed in, the history and recipe tabs fetch data scoped to the account (no `deviceId` needed), so data is available on any device after sign-in.
- **Global 401 handling** — expired or invalid tokens clear local auth and navigate to the Calendar tab (where the sign-in sheet can be opened) regardless of which tab triggered the request.

### Changed
- `recipes`, `feed_sessions`, `bake_sessions` tables gained a nullable `user_id` column (Drizzle schema + SQL migration applied).
- All API list/upsert/delete routes now scope by `userId` when a valid bearer token is present; unauthenticated requests fall back to `deviceId` but only for records where `userId IS NULL` (linked records are invisible without auth).
- A present-but-invalid `Authorization` header returns **401** immediately — no silent fallback to device mode.
- Authenticated list calls no longer send `deviceId` in the query string.
- Sign-out clears `HISTORY_KEY`, `BAKE_HISTORY_KEY`, and `RECIPES_KEY` from AsyncStorage so switching accounts starts from a clean slate.
- When authenticated, the server response is treated as the source of truth even when empty (prevents stale prior-account data from persisting in the local cache).

### Security
- Ownership checks added to all update/delete/upsert paths — cross-account record mutation returns 409 or 404.
- `isNull(userId)` guard on every unauthenticated deviceId path prevents device credentials from accessing linked account data.
