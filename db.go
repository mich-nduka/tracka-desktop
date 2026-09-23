package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

// ---------- Local SQLite Schema & Migrations ----------

var localMigrations = []struct {
	version    int
	statements []string
}{
	{
		version: 1,
		statements: []string{
			`CREATE TABLE IF NOT EXISTS students (
				id                TEXT PRIMARY KEY,
				name              TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
				hourly_rate_kobo  INTEGER NOT NULL CHECK (hourly_rate_kobo > 0),
				status            TEXT NOT NULL DEFAULT 'active'
				                  CHECK (status IN ('active','archived')),
				created_at        INTEGER NOT NULL,
				updated_at        INTEGER NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS sessions (
				id                  TEXT PRIMARY KEY,
				student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
				source              TEXT NOT NULL CHECK (source IN ('timer','manual')),
				status              TEXT NOT NULL CHECK (status IN ('running','completed')),
				started_at          INTEGER NOT NULL,
				ended_at            INTEGER,
				duration_seconds    INTEGER CHECK (duration_seconds IS NULL
				                        OR (duration_seconds >= 60 AND duration_seconds <= 86400)),
				rate_snapshot_kobo  INTEGER NOT NULL CHECK (rate_snapshot_kobo > 0),
				earned_kobo         INTEGER CHECK (earned_kobo IS NULL OR earned_kobo >= 0),
				local_date          TEXT NOT NULL CHECK (
				                        local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
				                        AND date(local_date) IS NOT NULL
				                        AND local_date = date(local_date)),
				notes               TEXT CHECK (notes IS NULL OR length(notes) <= 500),
				created_at          INTEGER NOT NULL,
				updated_at          INTEGER NOT NULL,

				CHECK (status <> 'completed' OR (
					ended_at IS NOT NULL AND duration_seconds IS NOT NULL
					AND earned_kobo IS NOT NULL AND ended_at >= started_at
				)),
				CHECK (status <> 'running' OR (
					ended_at IS NULL AND duration_seconds IS NULL AND earned_kobo IS NULL
				))
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS one_running_session
				ON sessions(status) WHERE status = 'running'`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_student      ON sessions(student_id)`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_local_date   ON sessions(local_date)`,
			`CREATE INDEX IF NOT EXISTS idx_sessions_student_date ON sessions(student_id, local_date)`,
			`CREATE TABLE IF NOT EXISTS meta (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
		},
	},
	{
		version: 2,
		statements: []string{
			`ALTER TABLE sessions ADD COLUMN group_id TEXT`,
			`DROP INDEX IF EXISTS one_running_session`,
			`CREATE UNIQUE INDEX IF NOT EXISTS one_running_per_student
				ON sessions(student_id) WHERE status = 'running'`,
			`DROP TRIGGER IF EXISTS one_running_group`,
			`CREATE TRIGGER IF NOT EXISTS one_running_group
				BEFORE INSERT ON sessions
				FOR EACH ROW WHEN NEW.status = 'running' AND EXISTS (
					SELECT 1 FROM sessions
					WHERE status = 'running'
						AND (group_id IS NULL OR NEW.group_id IS NULL OR group_id <> NEW.group_id)
				)
				BEGIN
					SELECT RAISE(ABORT, 'a timer is already running');
				END`,
		},
	},
	{
		version: 3,
		statements: []string{
			`CREATE TABLE IF NOT EXISTS sync_queue (
				id         TEXT PRIMARY KEY,
				action     TEXT NOT NULL,
				entity_id  TEXT NOT NULL,
				payload    TEXT,
				created_at INTEGER NOT NULL
			)`,
			`CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at)`,
		},
	},
}

const localSchemaVersion = 3

func defaultLocalDBPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	appDir := filepath.Join(dir, "tracka-desktop")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(appDir, "tracka.db"), nil
}

func openLocalDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("setting sqlite pragmas: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := runLocalMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func runLocalMigrations(db *sql.DB) error {
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`); err != nil {
		return fmt.Errorf("creating local schema_migrations: %w", err)
	}

	var current int
	_ = db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_migrations`).Scan(&current)

	// If schema_migrations is unpopulated, infer existing version to handle pre-existing databases
	if current == 0 {
		var hasStudents int
		_ = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='students'`).Scan(&hasStudents)
		if hasStudents > 0 {
			current = 1
			var hasGroupID int
			_ = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='group_id'`).Scan(&hasGroupID)
			if hasGroupID > 0 {
				current = 2
			}
			var hasSyncQueue int
			_ = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_queue'`).Scan(&hasSyncQueue)
			if hasSyncQueue > 0 {
				current = 3
			}
			_, _ = db.Exec(`INSERT OR REPLACE INTO schema_migrations (version) VALUES (?)`, current)
		}
	}

	for _, m := range localMigrations {
		if m.version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		for _, stmt := range m.statements {
			if strings.Contains(stmt, "ADD COLUMN group_id") {
				var hasGroupID int
				_ = tx.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='group_id'`).Scan(&hasGroupID)
				if hasGroupID > 0 {
					continue
				}
			}
			if _, err := tx.Exec(stmt); err != nil {
				tx.Rollback()
				return fmt.Errorf("local migration to schema version %d failed: %w", m.version, err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, m.version); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		current = m.version
	}
	return nil
}

// ---------- Remote Neon Cloud Schema & Migrations ----------

// Schema authority: identical constraints to tracka-app/src/db/migrations.ts,
// translated to PostgreSQL DDL.
var pgMigrations = []struct {
	version    int
	statements []string
}{
	{
		version: 1,
		statements: []string{
			`CREATE TABLE public.students (
				id                TEXT PRIMARY KEY,
				name              TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
				hourly_rate_kobo  BIGINT NOT NULL CHECK (hourly_rate_kobo > 0),
				status            TEXT NOT NULL DEFAULT 'active'
				                  CHECK (status IN ('active','archived')),
				created_at        BIGINT NOT NULL,
				updated_at        BIGINT NOT NULL
			)`,
			`CREATE TABLE public.sessions (
				id                  TEXT PRIMARY KEY,
				student_id          TEXT NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
				source              TEXT NOT NULL CHECK (source IN ('timer','manual')),
				status              TEXT NOT NULL CHECK (status IN ('running','completed')),
				started_at          BIGINT NOT NULL,
				ended_at            BIGINT,
				duration_seconds    BIGINT CHECK (duration_seconds IS NULL
				                    OR (duration_seconds >= 60 AND duration_seconds <= 86400)),
				rate_snapshot_kobo  BIGINT NOT NULL CHECK (rate_snapshot_kobo > 0),
				earned_kobo         BIGINT CHECK (earned_kobo IS NULL OR earned_kobo >= 0),
				local_date          TEXT NOT NULL CHECK (
				                    local_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
				                    AND length(local_date) = 10),
				notes               TEXT CHECK (notes IS NULL OR length(notes) <= 500),
				created_at          BIGINT NOT NULL,
				updated_at          BIGINT NOT NULL,

				CONSTRAINT completed_fields CHECK (status <> 'completed' OR (
					ended_at IS NOT NULL AND duration_seconds IS NOT NULL
					AND earned_kobo IS NOT NULL AND ended_at >= started_at
				)),
				CONSTRAINT running_fields CHECK (status <> 'running' OR (
					ended_at IS NULL AND duration_seconds IS NULL AND earned_kobo IS NULL
				))
			)`,
			`CREATE UNIQUE INDEX one_running_per_student
				ON public.sessions(student_id) WHERE status = 'running'`,
			`CREATE INDEX idx_sessions_student      ON public.sessions(student_id)`,
			`CREATE INDEX idx_sessions_local_date   ON public.sessions(local_date)`,
			`CREATE INDEX idx_sessions_student_date ON public.sessions(student_id, local_date)`,
			`CREATE TABLE public.meta (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)`,
		},
	},
	{
		version: 2,
		statements: []string{
			`ALTER TABLE public.sessions ADD COLUMN group_id TEXT`,
			`DROP INDEX public.one_running_per_student`,
			`CREATE UNIQUE INDEX one_running_per_student
				ON public.sessions(student_id) WHERE status = 'running'`,
			`CREATE OR REPLACE FUNCTION public.check_one_running_session() RETURNS TRIGGER AS $$
			BEGIN
				IF NEW.status = 'running' AND EXISTS (
					SELECT 1 FROM public.sessions
					WHERE status = 'running'
						AND (group_id IS NULL OR NEW.group_id IS NULL OR group_id <> NEW.group_id)
				) THEN
					RAISE EXCEPTION 'a timer is already running';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql`,
			`CREATE TRIGGER one_running_session_trigger
				BEFORE INSERT ON public.sessions
				FOR EACH ROW
				EXECUTE FUNCTION public.check_one_running_session()`,
		},
	},
	{
		// v3: fix the v2 trigger function for databases that already applied v2 —
		// (a) schema-qualify sessions so restores via psql work even after
		// pg_dump resets search_path to '', and (b) drop the erroneous
		// per-student condition so the global one-running-timer invariant
		// matches the mobile/SQLite original.
		version: 3,
		statements: []string{
			`CREATE OR REPLACE FUNCTION public.check_one_running_session() RETURNS TRIGGER AS $$
			BEGIN
				IF NEW.status = 'running' AND EXISTS (
					SELECT 1 FROM public.sessions
					WHERE status = 'running'
						AND (group_id IS NULL OR NEW.group_id IS NULL OR group_id <> NEW.group_id)
				) THEN
					RAISE EXCEPTION 'a timer is already running';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql`,
		},
	},
}

const pgSchemaVersion = 3

func pgOpenDB(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	if err := pgRunMigrations(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func pgRunMigrations(db *sql.DB) error {
	// Create migration tracking table
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("creating schema_migrations: %w", err)
	}

	var current int
	_ = db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM public.schema_migrations`).Scan(&current)

	for _, m := range pgMigrations {
		if m.version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		// The Neon pooler can leak a session's search_path between clients, so
		// pin it for this transaction regardless of what any previous session
		// left behind. SET LOCAL only lasts until COMMIT/ROLLBACK.
		if _, err := tx.Exec(`SET LOCAL search_path TO public`); err != nil {
			tx.Rollback()
			return err
		}
		for _, stmt := range m.statements {
			if _, err := tx.Exec(stmt); err != nil {
				tx.Rollback()
				return fmt.Errorf("migration to schema version %d failed: %w", m.version, err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO public.schema_migrations (version) VALUES ($1)`, m.version); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		current = m.version
	}
	return nil
}

func pgDatabaseURL() string {
	if url := os.Getenv("DATABASE_URL"); url != "" {
		return url
	}
	return ""
}
