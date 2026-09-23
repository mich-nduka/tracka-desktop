package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const LastSyncKey = "last_synced_to_neon_at"

type SyncAction string

const (
	ActionUpsertStudent SyncAction = "upsert_student"
	ActionDeleteStudent SyncAction = "delete_student"
	ActionUpsertSession SyncAction = "upsert_session"
	ActionDeleteSession SyncAction = "delete_session"
	ActionSetMeta       SyncAction = "set_meta"
)

type Execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

type SyncEngine struct {
	mu           sync.Mutex
	localDB      *sql.DB
	cloudDB      *sql.DB
	cloudURL     string
	isSyncing    bool
	currentState string // "synced" | "syncing" | "offline" | "error"
	lastError    string
	syncMutex    sync.Mutex // ensures only one sync runs at a time
}

func NewSyncEngine(localDB *sql.DB, cloudDB *sql.DB, cloudURL string) *SyncEngine {
	s := &SyncEngine{
		localDB:      localDB,
		cloudDB:      cloudDB,
		cloudURL:     cloudURL,
		currentState: "synced",
	}
	if cloudURL == "" && cloudDB == nil {
		s.currentState = "offline"
	}
	return s
}

func (s *SyncEngine) SetCloudDB(cloudDB *sql.DB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cloudDB = cloudDB
	if cloudDB != nil && s.currentState == "offline" {
		s.currentState = "synced"
		s.lastError = ""
	}
}

func (s *SyncEngine) SetCloudURL(url string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cloudURL = url
}

// Enqueue inserts a mutation into sync_queue and launches non-blocking background sync.
func (s *SyncEngine) Enqueue(ex Execer, action SyncAction, entityID string, payload any) error {
	id := uuid.New().String()
	var payloadStr *string
	if payload != nil {
		if str, ok := payload.(string); ok {
			payloadStr = &str
		} else {
			b, err := json.Marshal(payload)
			if err != nil {
				return fmt.Errorf("marshal sync payload: %w", err)
			}
			strVal := string(b)
			payloadStr = &strVal
		}
	}
	now := time.Now().UnixMilli()
	target := ex
	if target == nil {
		target = s.localDB
	}
	if target == nil {
		return errors.New("no database available to enqueue mutation")
	}

	_, err := target.Exec(
		`INSERT INTO sync_queue (id, action, entity_id, payload, created_at) VALUES ($1, $2, $3, $4, $5)`,
		id, string(action), entityID, payloadStr, now,
	)
	if err != nil {
		return fmt.Errorf("insert into sync_queue: %w", err)
	}

	// Trigger non-blocking background sync
	go func() {
		_, _ = s.SyncNow()
	}()
	return nil
}

// PushPending drains pending mutations from local sync_queue to Neon Postgres.
func (s *SyncEngine) PushPending() (int, error) {
	s.mu.Lock()
	cloudDB := s.cloudDB
	s.mu.Unlock()

	if cloudDB == nil {
		return 0, errors.New("cloud database not connected")
	}

	rows, err := s.localDB.Query(`SELECT id, action, entity_id, payload, created_at FROM sync_queue ORDER BY created_at ASC`)
	if err != nil {
		return 0, fmt.Errorf("reading sync_queue: %w", err)
	}
	defer rows.Close()

	type queueRow struct {
		id        string
		action    string
		entityID  string
		payload   sql.NullString
		createdAt int64
	}
	var items []queueRow
	for rows.Next() {
		var item queueRow
		if err := rows.Scan(&item.id, &item.action, &item.entityID, &item.payload, &item.createdAt); err != nil {
			return 0, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	pushed := 0
	for _, item := range items {
		payloadStr := ""
		if item.payload.Valid {
			payloadStr = item.payload.String
		}

		switch SyncAction(item.action) {
		case ActionUpsertStudent:
			var st Student
			if err := json.Unmarshal([]byte(payloadStr), &st); err != nil {
				return pushed, fmt.Errorf("unmarshal student payload: %w", err)
			}
			_, err := cloudDB.Exec(`
				INSERT INTO public.students (id, name, hourly_rate_kobo, status, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (id) DO UPDATE SET
					name = EXCLUDED.name,
					hourly_rate_kobo = EXCLUDED.hourly_rate_kobo,
					status = EXCLUDED.status,
					updated_at = EXCLUDED.updated_at
				WHERE EXCLUDED.updated_at >= public.students.updated_at`,
				st.ID, st.Name, st.HourlyRateKobo, st.Status, st.CreatedAt, st.UpdatedAt,
			)
			if err != nil {
				return pushed, fmt.Errorf("pushing student %s: %w", st.ID, err)
			}

		case ActionDeleteStudent:
			tx, err := cloudDB.Begin()
			if err != nil {
				return pushed, err
			}
			if _, err := tx.Exec(`DELETE FROM public.sessions WHERE student_id = $1`, item.entityID); err != nil {
				tx.Rollback()
				return pushed, err
			}
			if _, err := tx.Exec(`DELETE FROM public.students WHERE id = $1`, item.entityID); err != nil {
				tx.Rollback()
				return pushed, err
			}
			if err := tx.Commit(); err != nil {
				return pushed, err
			}

		case ActionUpsertSession:
			var ses Session
			if err := json.Unmarshal([]byte(payloadStr), &ses); err != nil {
				return pushed, fmt.Errorf("unmarshal session payload: %w", err)
			}
			_, err := cloudDB.Exec(`
				INSERT INTO public.sessions (
					id, student_id, source, status, started_at, ended_at, duration_seconds,
					rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
				) VALUES (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
				)
				ON CONFLICT (id) DO UPDATE SET
					student_id = EXCLUDED.student_id,
					source = EXCLUDED.source,
					status = EXCLUDED.status,
					started_at = EXCLUDED.started_at,
					ended_at = EXCLUDED.ended_at,
					duration_seconds = EXCLUDED.duration_seconds,
					rate_snapshot_kobo = EXCLUDED.rate_snapshot_kobo,
					earned_kobo = EXCLUDED.earned_kobo,
					local_date = EXCLUDED.local_date,
					notes = EXCLUDED.notes,
					group_id = EXCLUDED.group_id,
					updated_at = EXCLUDED.updated_at
				WHERE EXCLUDED.updated_at >= public.sessions.updated_at`,
				ses.ID, ses.StudentID, ses.Source, ses.Status,
				ses.StartedAt, ses.EndedAt, ses.DurationSeconds,
				ses.RateSnapshotKobo, ses.EarnedKobo,
				ses.LocalDate, ses.Notes, ses.GroupID,
				ses.CreatedAt, ses.UpdatedAt,
			)
			if err != nil {
				return pushed, fmt.Errorf("pushing session %s: %w", ses.ID, err)
			}

		case ActionDeleteSession:
			if _, err := cloudDB.Exec(`DELETE FROM public.sessions WHERE id = $1`, item.entityID); err != nil {
				return pushed, fmt.Errorf("deleting session %s: %w", item.entityID, err)
			}

		case ActionSetMeta:
			var metaPayload struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal([]byte(payloadStr), &metaPayload); err != nil {
				return pushed, fmt.Errorf("unmarshal meta payload: %w", err)
			}
			_, err := cloudDB.Exec(`
				INSERT INTO public.meta (key, value) VALUES ($1, $2)
				ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
				metaPayload.Key, metaPayload.Value,
			)
			if err != nil {
				return pushed, fmt.Errorf("pushing meta %s: %w", metaPayload.Key, err)
			}
		}

		// Delete pushed item from local sync_queue
		if _, err := s.localDB.Exec(`DELETE FROM sync_queue WHERE id = $1`, item.id); err != nil {
			if strings.Contains(err.Error(), "database is closed") {
				return pushed, nil
			}
			return pushed, fmt.Errorf("deleting queue item %s: %w", item.id, err)
		}
		pushed++
	}
	return pushed, nil
}

// PullChanges pulls remote student and session changes from Neon and reconciles with local SQLite.
func (s *SyncEngine) PullChanges(sinceOverride *int64) (studentsPulled int, sessionsPulled int, err error) {
	s.mu.Lock()
	cloudDB := s.cloudDB
	s.mu.Unlock()

	if cloudDB == nil {
		return 0, 0, errors.New("cloud database not connected")
	}

	var lastSync int64
	if sinceOverride != nil {
		lastSync = *sinceOverride
	} else {
		ls, _ := s.GetLastSyncAt()
		if ls != nil {
			lastSync = *ls
		}
	}

	// 1. Fetch remote students updated since lastSync
	rows, err := cloudDB.Query(`
		SELECT id, name, hourly_rate_kobo, status, created_at, updated_at
		FROM public.students
		WHERE updated_at > $1
		ORDER BY updated_at ASC`,
		lastSync,
	)
	if err != nil {
		return 0, 0, fmt.Errorf("query remote students: %w", err)
	}

	var remoteStudents []Student
	for rows.Next() {
		var st Student
		var status string
		if err := rows.Scan(&st.ID, &st.Name, &st.HourlyRateKobo, &status, &st.CreatedAt, &st.UpdatedAt); err != nil {
			rows.Close()
			return 0, 0, err
		}
		st.Status = status
		remoteStudents = append(remoteStudents, st)
	}
	rows.Close()

	if len(remoteStudents) > 0 {
		tx, err := s.localDB.Begin()
		if err != nil {
			return 0, 0, err
		}
		for _, st := range remoteStudents {
			var pendingID string
			err := tx.QueryRow(`SELECT id FROM sync_queue WHERE entity_id = $1`, st.ID).Scan(&pendingID)
			if err == nil {
				// Pending mutation exists locally; local changes have precedence
				continue
			}
			_, err = tx.Exec(`
				INSERT INTO students (id, name, hourly_rate_kobo, status, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name,
					hourly_rate_kobo = excluded.hourly_rate_kobo,
					status = excluded.status,
					updated_at = excluded.updated_at
				WHERE excluded.updated_at >= students.updated_at`,
				st.ID, st.Name, st.HourlyRateKobo, st.Status, st.CreatedAt, st.UpdatedAt,
			)
			if err != nil {
				tx.Rollback()
				return studentsPulled, 0, fmt.Errorf("upsert local student %s: %w", st.ID, err)
			}
			studentsPulled++
		}
		if err := tx.Commit(); err != nil {
			return 0, 0, err
		}
	}

	// 2. Fetch remote sessions updated since lastSync
	srows, err := cloudDB.Query(`
		SELECT id, student_id, source, status, started_at, ended_at, duration_seconds,
		       rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM public.sessions
		WHERE updated_at > $1
		ORDER BY updated_at ASC`,
		lastSync,
	)
	if err != nil {
		return studentsPulled, 0, fmt.Errorf("query remote sessions: %w", err)
	}

	var remoteSessions []Session
	for srows.Next() {
		ses, err := scanSession(srows)
		if err != nil {
			srows.Close()
			return studentsPulled, 0, err
		}
		remoteSessions = append(remoteSessions, ses)
	}
	srows.Close()

	if len(remoteSessions) > 0 {
		tx, err := s.localDB.Begin()
		if err != nil {
			return studentsPulled, 0, err
		}
		for _, ses := range remoteSessions {
			var pendingID string
			err := tx.QueryRow(`SELECT id FROM sync_queue WHERE entity_id = $1`, ses.ID).Scan(&pendingID)
			if err == nil {
				continue
			}
			_, err = tx.Exec(`
				INSERT INTO sessions (
					id, student_id, source, status, started_at, ended_at, duration_seconds,
					rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
				ON CONFLICT(id) DO UPDATE SET
					student_id = excluded.student_id,
					source = excluded.source,
					status = excluded.status,
					started_at = excluded.started_at,
					ended_at = excluded.ended_at,
					duration_seconds = excluded.duration_seconds,
					rate_snapshot_kobo = excluded.rate_snapshot_kobo,
					earned_kobo = excluded.earned_kobo,
					local_date = excluded.local_date,
					notes = excluded.notes,
					group_id = excluded.group_id,
					updated_at = excluded.updated_at
				WHERE excluded.updated_at >= sessions.updated_at`,
				ses.ID, ses.StudentID, ses.Source, ses.Status,
				ses.StartedAt, ses.EndedAt, ses.DurationSeconds,
				ses.RateSnapshotKobo, ses.EarnedKobo,
				ses.LocalDate, ses.Notes, ses.GroupID,
				ses.CreatedAt, ses.UpdatedAt,
			)
			if err != nil {
				tx.Rollback()
				return studentsPulled, sessionsPulled, fmt.Errorf("upsert local session %s: %w", ses.ID, err)
			}
			sessionsPulled++
		}
		if err := tx.Commit(); err != nil {
			return studentsPulled, 0, err
		}
	}

	// 3. Update sync timestamp in local meta
	now := time.Now().UnixMilli()
	_, _ = s.localDB.Exec(`
		INSERT INTO meta (key, value) VALUES ($1, $2)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		LastSyncKey, fmt.Sprintf("%d", now),
	)

	return studentsPulled, sessionsPulled, nil
}

// SyncNow executes full bidirectional sync (push pending queue, then pull changes).
// Coalesces concurrent calls into the active sync operation.
func (s *SyncEngine) SyncNow() (bool, error) {
	if !s.syncMutex.TryLock() {
		return false, nil
	}
	defer s.syncMutex.Unlock()

	s.mu.Lock()
	if s.cloudURL == "" && s.cloudDB == nil {
		s.currentState = "offline"
		s.mu.Unlock()
		return false, nil
	}
	s.isSyncing = true
	s.currentState = "syncing"
	s.lastError = ""
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.isSyncing = false
		s.mu.Unlock()
	}()

	// Ensure cloud connection
	s.mu.Lock()
	cloudDB := s.cloudDB
	url := s.cloudURL
	s.mu.Unlock()

	if cloudDB == nil && url != "" {
		db, err := pgOpenDB(url)
		if err != nil {
			s.mu.Lock()
			s.currentState = "offline"
			s.lastError = err.Error()
			s.mu.Unlock()
			log.Printf("[sync] connect to cloud failed: %v", err)
			return false, nil
		}
		s.mu.Lock()
		s.cloudDB = db
		cloudDB = db
		s.mu.Unlock()
	}

	if cloudDB == nil {
		s.mu.Lock()
		s.currentState = "offline"
		s.mu.Unlock()
		return false, nil
	}

	// Ping cloud DB with 4s timeout
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	err := cloudDB.PingContext(ctx)
	cancel()
	if err != nil {
		s.mu.Lock()
		s.currentState = "offline"
		s.lastError = err.Error()
		s.mu.Unlock()
		log.Printf("[sync] ping cloud failed: %v", err)
		return false, nil
	}

	// 1. Push pending
	if _, err := s.PushPending(); err != nil {
		if strings.Contains(err.Error(), "database is closed") {
			return false, nil
		}
		s.mu.Lock()
		s.currentState = "error"
		s.lastError = err.Error()
		s.mu.Unlock()
		log.Printf("[sync] push pending failed: %v", err)
		return false, err
	}

	// 2. Pull changes
	if _, _, err := s.PullChanges(nil); err != nil {
		if strings.Contains(err.Error(), "database is closed") {
			return false, nil
		}
		s.mu.Lock()
		s.currentState = "error"
		s.lastError = err.Error()
		s.mu.Unlock()
		log.Printf("[sync] pull changes failed: %v", err)
		return false, err
	}

	s.mu.Lock()
	s.currentState = "synced"
	s.lastError = ""
	s.mu.Unlock()
	return true, nil
}

func (s *SyncEngine) GetStatus() SyncStatus {
	s.mu.Lock()
	state := s.currentState
	errStr := s.lastError
	isSync := s.isSyncing
	cloudConfigured := (s.cloudURL != "" || s.cloudDB != nil)
	s.mu.Unlock()

	pending, _ := s.GetPendingCount()
	lastSync, _ := s.GetLastSyncAt()

	if !cloudConfigured {
		state = "offline"
	} else if isSync {
		state = "syncing"
	} else if errStr != "" {
		state = "error"
	} else if pending > 0 && state == "synced" {
		state = "offline"
	}

	return SyncStatus{
		State:        state,
		PendingCount: pending,
		LastSyncAt:   lastSync,
		Error:        errStr,
	}
}

func (s *SyncEngine) GetPendingCount() (int, error) {
	if s.localDB == nil {
		return 0, nil
	}
	var count int
	err := s.localDB.QueryRow(`SELECT COUNT(*) FROM sync_queue`).Scan(&count)
	return count, err
}

func (s *SyncEngine) GetLastSyncAt() (*int64, error) {
	if s.localDB == nil {
		return nil, nil
	}
	var val string
	err := s.localDB.QueryRow(`SELECT value FROM meta WHERE key = $1`, LastSyncKey).Scan(&val)
	if err != nil {
		return nil, nil
	}
	var t int64
	if _, err := fmt.Sscanf(val, "%d", &t); err != nil {
		return nil, nil
	}
	return &t, nil
}
