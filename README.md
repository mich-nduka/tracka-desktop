# Tracka Desktop

Desktop port of [`tracka-app`](../tracka-app) — the single-user, offline-first class
and earnings tracker for a private tutor — built with
[Wails v3](https://v3.wails.io) (Go + React + SQLite).

Parity with mobile: same SQLite constraints (including the v2 group-timer
trigger), same money rules (rates in integer kobo, earnings in tenths of kobo),
same Africa/Lagos calendar with Monday-start weeks, same one-running-timer
invariant, same backup manifest format (`.zip` restores interchangeably in
spirit — same `tracka.db` + `manifest.json` entries).

## Running

```bash
# Dev (hot reload, Go bindings regenerated automatically)
wails3 dev

# Production binary -> ./bin/tracka-desktop
wails3 build
./bin/tracka-desktop
```

Requirements: Go 1.25+, Node/npm, GTK4 + WebKitGTK 6.0 (`wails3 doctor`).

## Data

SQLite lives at `$XDG_CONFIG_HOME/tracka-desktop/tracka.db`
(`~/.config/tracka-desktop/tracka.db`). Same schema versions as mobile
(`PRAGMA user_version`, currently 2); older mobile-DB copies restore through
Settings → Restore and migrate forward on open.

## Layout

```
main.go / models.go / db.go        app entry, domain models, migrations
tracka.go                          TrackaService — all 27 bound methods
format.go                          money + Lagos-date helpers (Go side)
report.go                          printable earnings-report HTML (Go side)
tracka_test.go                     backend tests (go test .)
frontend/src/
  lib/         types, dates, format, api (Wails binding wrapper)
  views/       Dashboard, Timer, Students, History, SessionForm, Report, Settings
  components/  dark-zinc UI kit (mirrors mobile constants/theme.ts)
```

## Mobile → desktop mapping

| Mobile (Expo) | Desktop (Wails) |
|---|---|
| expo-sqlite + drizzle | Go `database/sql` + pure-Go `modernc.org/sqlite` |
| expo-router tabs | Sidebar navigation (same 6 sections) |
| @notifee chronometer | Persistent DB timer + sidebar/banner indicator (timers survive restart; >8 h flagged stale, same as mobile) |
| expo-print + share sheet | Report prints via print dialog (save as PDF); backups/CSV download as files |
| expo-file-system restore | File picker → validated in Go (integrity + schema version) before the live DB is touched |
| ToastAndroid/dialogs | In-app toasts + modal confirms |

No network, no auth, no server — same as mobile.
