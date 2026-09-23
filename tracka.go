package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Coded domain errors: frontend branches on the code prefix before ":".
func derr(code, msg string) error {
	return fmt.Errorf("%s: %s", code, msg)
}

func isCode(err error, code string) bool {
	return err != nil && strings.HasPrefix(err.Error(), code+":")
}

type TrackaService struct {
	mu         sync.Mutex
	localDB    *sql.DB
	localPath  string
	cloudDB    *sql.DB
	cloudURL   string
	syncEngine *SyncEngine
}

func NewTrackaService() *TrackaService {
	path, err := defaultLocalDBPath()
	if err != nil {
		log.Fatalf("failed to get default local db path: %v", err)
	}
	db, err := openLocalDB(path)
	if err != nil {
		log.Fatalf("failed to open local db at %s: %v", path, err)
	}
	url := pgDatabaseURL()
	svc := &TrackaService{
		localDB:   db,
		localPath: path,
		cloudURL:  url,
	}
	svc.syncEngine = NewSyncEngine(db, nil, url)
	return svc
}

func NewTrackaServiceWithDB(localDB *sql.DB, localPath string, cloudURL string) *TrackaService {
	svc := &TrackaService{
		localDB:   localDB,
		localPath: localPath,
		cloudURL:  cloudURL,
	}
	svc.syncEngine = NewSyncEngine(localDB, nil, cloudURL)
	return svc
}

func (t *TrackaService) SetCloudDB(cloudDB *sql.DB) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.cloudDB = cloudDB
	if t.syncEngine != nil {
		t.syncEngine.SetCloudDB(cloudDB)
	}
}

func (t *TrackaService) SyncEngine() *SyncEngine {
	return t.syncEngine
}

func (t *TrackaService) SyncNow() (bool, error) {
	if t.syncEngine == nil {
		return false, nil
	}
	return t.syncEngine.SyncNow()
}

func (t *TrackaService) GetSyncStatus() (SyncStatus, error) {
	if t.syncEngine == nil {
		return SyncStatus{State: "offline"}, nil
	}
	return t.syncEngine.GetStatus(), nil
}

func (t *TrackaService) conn() (*sql.DB, error) {
	if t.localDB != nil {
		return t.localDB, nil
	}
	return nil, errors.New("local database not initialized")
}

// ---------- row scanning ----------

func scanStudent(row interface{ Scan(...any) error }) (Student, error) {
	var s Student
	var status string
	err := row.Scan(&s.ID, &s.Name, &s.HourlyRateKobo, &status, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return s, err
	}
	s.Status = status
	return s, nil
}

func scanSession(rows *sql.Rows) (Session, error) {
	var s Session
	var endedAt, dur, earned sql.NullInt64
	var notes, groupID sql.NullString
	err := rows.Scan(
		&s.ID, &s.StudentID, &s.Source, &s.Status,
		&s.StartedAt, &endedAt, &dur,
		&s.RateSnapshotKobo, &earned,
		&s.LocalDate, &notes, &groupID,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return s, err
	}
	if endedAt.Valid {
		v := endedAt.Int64
		s.EndedAt = &v
	}
	if dur.Valid {
		v := dur.Int64
		s.DurationSeconds = &v
	}
	if earned.Valid {
		v := earned.Int64
		s.EarnedKobo = &v
	}
	if notes.Valid {
		v := notes.String
		s.Notes = &v
	}
	if groupID.Valid {
		v := groupID.String
		s.GroupID = &v
	}
	return s, nil
}

func scanOneSession(row *sql.Row) (Session, error) {
	var s Session
	var endedAt, dur, earned sql.NullInt64
	var notes, groupID sql.NullString
	err := row.Scan(
		&s.ID, &s.StudentID, &s.Source, &s.Status,
		&s.StartedAt, &endedAt, &dur,
		&s.RateSnapshotKobo, &earned,
		&s.LocalDate, &notes, &groupID,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return s, err
	}
	if endedAt.Valid {
		v := endedAt.Int64
		s.EndedAt = &v
	}
	if dur.Valid {
		v := dur.Int64
		s.DurationSeconds = &v
	}
	if earned.Valid {
		v := earned.Int64
		s.EarnedKobo = &v
	}
	if notes.Valid {
		v := notes.String
		s.Notes = &v
	}
	if groupID.Valid {
		v := groupID.String
		s.GroupID = &v
	}
	return s, nil
}

// ---------- validation ----------

func validateName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if len(name) == 0 {
		return "", derr("INVALID_NAME", "Name cannot be empty.")
	}
	if len(name) > 100 {
		return "", derr("INVALID_NAME", "Name cannot exceed 100 characters.")
	}
	return name, nil
}

func validateRate(rate int64) error {
	if rate <= 0 {
		return derr("INVALID_RATE", "Hourly rate must be greater than zero.")
	}
	return nil
}

func validateDuration(d int64) error {
	if d < 60 {
		return derr("DURATION_TOO_SHORT", "Sessions must be at least 1 minute long.")
	}
	if d > 86400 {
		return derr("DURATION_TOO_LONG", "Sessions cannot exceed 24 hours.")
	}
	return nil
}

func normalizeNotes(raw string, has bool) (*string, error) {
	if !has {
		return nil, nil // sentinel: caller keeps existing
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	if len(trimmed) > 500 {
		return nil, derr("NOTES_TOO_LONG", "Notes cannot exceed 500 characters.")
	}
	return &trimmed, nil
}

func normalizeNotesValue(raw string) (*string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	if len(trimmed) > 500 {
		return nil, derr("NOTES_TOO_LONG", "Notes cannot exceed 500 characters.")
	}
	return &trimmed, nil
}

// ---------- meta ----------

func (t *TrackaService) getMeta(key string) string {
	db, err := t.conn()
	if err != nil {
		return ""
	}
	var v string
	if err := db.QueryRow(`SELECT value FROM meta WHERE key = $1`, key).Scan(&v); err != nil {
		return ""
	}
	return v
}

func (t *TrackaService) setMeta(key, value string) error {
	db, err := t.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO meta (key, value) VALUES ($1, $2)
		ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`, key, value)
	if err != nil {
		return err
	}
	if key != LastSyncKey && t.syncEngine != nil {
		_ = t.syncEngine.Enqueue(db, ActionSetMeta, key, map[string]string{"key": key, "value": value})
	}
	return nil
}

// ---------- students ----------

func (t *TrackaService) ListStudents(includeArchived bool) ([]Student, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	var rows *sql.Rows
	if includeArchived {
		rows, err = db.Query(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students ORDER BY name ASC`)
	} else {
		rows, err = db.Query(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE status = 'active' ORDER BY name ASC`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Student{}
	for rows.Next() {
		s, err := scanStudent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *TrackaService) GetStudent(id string) (Student, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Student{}, err
	}
	s, err := scanStudent(db.QueryRow(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return Student{}, derr("STUDENT_NOT_FOUND", "Student not found.")
	}
	return s, err
}

func (t *TrackaService) CreateStudent(name string, hourlyRateKobo int64) (Student, error) {
	clean, err := validateName(name)
	if err != nil {
		return Student{}, err
	}
	if err := validateRate(hourlyRateKobo); err != nil {
		return Student{}, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Student{}, err
	}
	now := time.Now().UnixMilli()
	s := Student{ID: uuid.NewString(), Name: clean, HourlyRateKobo: hourlyRateKobo, Status: "active", CreatedAt: now, UpdatedAt: now}

	tx, err := db.Begin()
	if err != nil {
		return Student{}, err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`INSERT INTO students (id, name, hourly_rate_kobo, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		s.ID, s.Name, s.HourlyRateKobo, s.Status, s.CreatedAt, s.UpdatedAt)
	if err != nil {
		return Student{}, err
	}

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionUpsertStudent, s.ID, s); err != nil {
			return Student{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Student{}, err
	}
	return s, nil
}

func (t *TrackaService) UpdateStudent(id, name string, hourlyRateKobo int64) (Student, error) {
	clean, err := validateName(name)
	if err != nil {
		return Student{}, err
	}
	if err := validateRate(hourlyRateKobo); err != nil {
		return Student{}, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Student{}, err
	}

	tx, err := db.Begin()
	if err != nil {
		return Student{}, err
	}
	defer tx.Rollback()

	existing, err := scanStudent(tx.QueryRow(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return Student{}, derr("STUDENT_NOT_FOUND", "Student not found.")
	}
	if err != nil {
		return Student{}, err
	}

	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`UPDATE students SET name = $1, hourly_rate_kobo = $2, updated_at = $3 WHERE id = $4`,
		clean, hourlyRateKobo, now, id); err != nil {
		return Student{}, err
	}
	existing.Name = clean
	existing.HourlyRateKobo = hourlyRateKobo
	existing.UpdatedAt = now

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionUpsertStudent, existing.ID, existing); err != nil {
			return Student{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Student{}, err
	}
	return existing, nil
}

func (t *TrackaService) ArchiveStudent(id string) error {
	return t.setStudentStatus(id, "archived")
}

func (t *TrackaService) UnarchiveStudent(id string) error {
	return t.setStudentStatus(id, "active")
}

func (t *TrackaService) setStudentStatus(id, status string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	existing, err := scanStudent(tx.QueryRow(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return derr("STUDENT_NOT_FOUND", "Student not found.")
	}
	if err != nil {
		return err
	}

	now := time.Now().UnixMilli()
	if _, err := tx.Exec(`UPDATE students SET status = $1, updated_at = $2 WHERE id = $3`, status, now, id); err != nil {
		return err
	}
	existing.Status = status
	existing.UpdatedAt = now

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionUpsertStudent, id, existing); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (t *TrackaService) DeleteStudent(id string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM sessions WHERE student_id = $1`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM students WHERE id = $1`, id); err != nil {
		return err
	}

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionDeleteStudent, id, nil); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ---------- sessions ----------

func (t *TrackaService) runningRows(db *sql.DB) ([]Session, error) {
	rows, err := db.Query(`SELECT id, student_id, source, status, started_at, ended_at, duration_seconds,
		rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM sessions WHERE status = 'running' ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *TrackaService) runningRowsTx(tx *sql.Tx) ([]Session, error) {
	rows, err := tx.Query(`SELECT id, student_id, source, status, started_at, ended_at, duration_seconds,
		rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM sessions WHERE status = 'running' ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *TrackaService) GetRunningGroup() ([]Session, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	out, err := t.runningRows(db)
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []Session{}
	}
	return out, nil
}

func (t *TrackaService) requireActiveStudent(db *sql.DB, id string) (Student, error) {
	s, err := scanStudent(db.QueryRow(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return Student{}, derr("STUDENT_NOT_FOUND", "Student not found.")
	}
	if err != nil {
		return Student{}, err
	}
	if s.Status != "active" {
		return Student{}, derr("STUDENT_ARCHIVED", "This student is archived. Unarchive them first.")
	}
	return s, nil
}

func (t *TrackaService) StartTimer(studentIDs []string, notes string) ([]Session, error) {
	seen := map[string]bool{}
	unique := []string{}
	for _, id := range studentIDs {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return nil, derr("STUDENT_NOT_FOUND", "Choose at least one student.")
	}
	cleanNotes, err := normalizeNotesValue(notes)
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	roster := make([]Student, 0, len(unique))
	for _, id := range unique {
		s, err := t.requireActiveStudent(db, id)
		if err != nil {
			return nil, err
		}
		roster = append(roster, s)
	}
	now := time.Now().UnixMilli()
	groupID := uuid.NewString()
	rows := make([]Session, 0, len(roster))
	for _, st := range roster {
		rows = append(rows, Session{
			ID: uuid.NewString(), StudentID: st.ID, Source: "timer", Status: "running",
			StartedAt: now, EndedAt: nil, DurationSeconds: nil,
			RateSnapshotKobo: st.HourlyRateKobo, EarnedKobo: nil,
			LocalDate: lagosDate(now), Notes: cleanNotes, GroupID: &groupID,
			CreatedAt: now, UpdatedAt: now,
		})
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, r := range rows {
		if _, err := tx.Exec(`INSERT INTO sessions (id, student_id, source, status, started_at, ended_at,
			duration_seconds, rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, NULL, $7, $8, $9, $10, $11)`,
			r.ID, r.StudentID, r.Source, r.Status, r.StartedAt,
			r.RateSnapshotKobo, r.LocalDate, nullableString(r.Notes), nullableString(r.GroupID),
			r.CreatedAt, r.UpdatedAt); err != nil {
			msg := strings.ToLower(err.Error())
			if strings.Contains(msg, "already running") || strings.Contains(msg, "unique") {
				return nil, derr("TIMER_ALREADY_RUNNING", "A timer is already running.")
			}
			return nil, err
		}
		if t.syncEngine != nil {
			if err := t.syncEngine.Enqueue(tx, ActionUpsertSession, r.ID, r); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rows, nil
}

func (t *TrackaService) StopTimer(endedAtMillis int64, opts StopOptions) ([]Session, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	group, err := t.runningRows(db)
	if err != nil {
		return nil, err
	}
	if len(group) == 0 {
		return nil, derr("SESSION_NOT_RUNNING", "No timer is running.")
	}
	var duration int64
	if opts.HasDurationOverride {
		duration = opts.DurationOverrideSeconds
	} else {
		duration = int64((endedAtMillis - group[0].StartedAt + 500) / 1000)
		if endedAtMillis < group[0].StartedAt {
			duration = 0
		}
	}
	if err := validateDuration(duration); err != nil {
		return nil, err
	}
	localDate := group[0].LocalDate
	if strings.TrimSpace(opts.LocalDateOverride) != "" {
		localDate = strings.TrimSpace(opts.LocalDateOverride)
	}
	if !isValidCalendarDate(localDate) {
		return nil, derr("INVALID_DATE", "Not a valid date: "+localDate)
	}
	updatedAt := time.Now().UnixMilli()
	results := make([]Session, 0, len(group))
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, s := range group {
		earned := computeEarned(duration, s.RateSnapshotKobo)
		ended := endedAtMillis
		if ended < s.StartedAt {
			ended = s.StartedAt
		}
		var notes *string
		if opts.HasNotes {
			n, err := normalizeNotesValue(opts.Notes)
			if err != nil {
				return nil, err
			}
			notes = n
		} else {
			notes = s.Notes
		}
		if _, err := tx.Exec(`UPDATE sessions SET status = 'completed', ended_at = $1,
			duration_seconds = $2, earned_kobo = $3, local_date = $4, notes = $5, updated_at = $6 WHERE id = $7`,
			ended, duration, earned, localDate, nullableString(notes), updatedAt, s.ID); err != nil {
			return nil, err
		}
		d, e := duration, earned
		s.Status = "completed"
		s.EndedAt = &ended
		s.DurationSeconds = &d
		s.EarnedKobo = &e
		s.LocalDate = localDate
		s.Notes = notes
		s.UpdatedAt = updatedAt

		if t.syncEngine != nil {
			if err := t.syncEngine.Enqueue(tx, ActionUpsertSession, s.ID, s); err != nil {
				return nil, err
			}
		}

		results = append(results, s)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return results, nil
}

func (t *TrackaService) DiscardRunningGroup() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	running, err := t.runningRowsTx(tx)
	if err != nil {
		return err
	}
	for _, r := range running {
		if t.syncEngine != nil {
			if err := t.syncEngine.Enqueue(tx, ActionDeleteSession, r.ID, nil); err != nil {
				return err
			}
		}
	}

	if _, err := tx.Exec(`DELETE FROM sessions WHERE status = 'running'`); err != nil {
		return err
	}
	return tx.Commit()
}

func (t *TrackaService) LogManualGroup(input ManualGroupInput) ([]Session, error) {
	seen := map[string]bool{}
	unique := []string{}
	for _, id := range input.StudentIDs {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return nil, derr("STUDENT_NOT_FOUND", "Choose at least one student.")
	}
	if err := validateDuration(input.DurationSeconds); err != nil {
		return nil, err
	}
	if !isValidCalendarDate(input.LocalDate) {
		return nil, derr("INVALID_DATE", "Not a valid date: "+input.LocalDate)
	}
	var override *int64
	if len(unique) == 1 && input.HasRate {
		if input.RateKobo <= 0 {
			return nil, derr("INVALID_RATE", "Rate must be greater than zero.")
		}
		override = &input.RateKobo
	}
	cleanNotes, err := normalizeNotesValue(input.Notes)
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	roster := make([]Student, 0, len(unique))
	for _, id := range unique {
		s, err := t.requireActiveStudent(db, id)
		if err != nil {
			return nil, err
		}
		roster = append(roster, s)
	}
	now := time.Now().UnixMilli()
	startedAt := lagosMidday(input.LocalDate)
	if input.HasStartedAt && input.StartedAt > 0 {
		startedAt = input.StartedAt
	}
	endedAt := startedAt + input.DurationSeconds*1000
	var groupID *string
	if len(unique) > 1 {
		g := uuid.NewString()
		groupID = &g
	}
	rows := make([]Session, 0, len(roster))
	for _, st := range roster {
		rate := st.HourlyRateKobo
		if override != nil {
			rate = *override
		}
		rows = append(rows, Session{
			ID: uuid.NewString(), StudentID: st.ID, Source: "manual", Status: "completed",
			StartedAt: startedAt, EndedAt: &endedAt, DurationSeconds: &input.DurationSeconds,
			RateSnapshotKobo: rate, EarnedKobo: func() *int64 { e := computeEarned(input.DurationSeconds, rate); return &e }(),
			LocalDate: input.LocalDate, Notes: cleanNotes, GroupID: groupID,
			CreatedAt: now, UpdatedAt: now,
		})
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, r := range rows {
		if _, err := tx.Exec(`INSERT INTO sessions (id, student_id, source, status, started_at, ended_at,
			duration_seconds, rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			r.ID, r.StudentID, r.Source, r.Status, r.StartedAt, nullableInt(r.EndedAt),
			nullableInt(r.DurationSeconds), r.RateSnapshotKobo, nullableInt(r.EarnedKobo),
			r.LocalDate, nullableString(r.Notes), nullableString(r.GroupID), r.CreatedAt, r.UpdatedAt); err != nil {
			return nil, err
		}
		if t.syncEngine != nil {
			if err := t.syncEngine.Enqueue(tx, ActionUpsertSession, r.ID, r); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return rows, nil
}

func (t *TrackaService) GetSession(id string) (Session, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Session{}, err
	}
	s, err := scanOneSession(db.QueryRow(`SELECT id, student_id, source, status, started_at, ended_at,
		duration_seconds, rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM sessions WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return Session{}, derr("SESSION_NOT_FOUND", "Session not found.")
	}
	return s, err
}

func (t *TrackaService) UpdateSession(id string, patch SessionPatch) (Session, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Session{}, err
	}
	s, err := scanOneSession(db.QueryRow(`SELECT id, student_id, source, status, started_at, ended_at,
		duration_seconds, rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM sessions WHERE id = $1`, id))
	if err == sql.ErrNoRows {
		return Session{}, derr("SESSION_NOT_FOUND", "Session not found.")
	}
	if err != nil {
		return Session{}, err
	}
	if s.Status != "completed" {
		return Session{}, derr("SESSION_RUNNING", "Stop the timer before editing this session.")
	}
	if s.Source == "timer" && patch.HasStudentID && patch.StudentID != s.StudentID {
		return Session{}, derr("TIMER_FIELD_LOCKED", "The student on a timer session cannot be changed.")
	}
	studentID := s.StudentID
	if patch.HasStudentID && patch.StudentID != s.StudentID {
		if _, err := t.requireActiveStudent(db, patch.StudentID); err != nil {
			return Session{}, err
		}
		studentID = patch.StudentID
	}
	source := s.Source
	if patch.HasSource {
		if patch.Source != "timer" && patch.Source != "manual" {
			return Session{}, derr("INVALID_DATE", "Invalid source.")
		}
		source = patch.Source
	}
	localDate := s.LocalDate
	if patch.HasLocalDate {
		if !isValidCalendarDate(patch.LocalDate) {
			return Session{}, derr("INVALID_DATE", "Not a valid date: "+patch.LocalDate)
		}
		localDate = patch.LocalDate
	}
	var notes **string // nil = keep
	notesVal, err := normalizeNotes(patch.Notes, patch.HasNotes)
	if err != nil {
		return Session{}, err
	}
	if patch.HasNotes {
		notes = &notesVal
	}
	startedAt := s.StartedAt
	if patch.HasStartedAt {
		startedAt = patch.StartedAt
	}
	var curDur int64
	if s.DurationSeconds != nil {
		curDur = *s.DurationSeconds
	}
	duration := curDur
	rate := s.RateSnapshotKobo
	if patch.HasDuration {
		duration = patch.DurationSeconds
	}
	if patch.HasRate {
		rate = patch.RateSnapshotKobo
	}
	earnedChanged := false
	if patch.HasDuration || patch.HasRate {
		if err := validateDuration(duration); err != nil {
			return Session{}, err
		}
		if rate <= 0 {
			return Session{}, derr("INVALID_RATE", "Rate must be greater than zero.")
		}
		earnedChanged = true
	}
	updatedAt := time.Now().UnixMilli()
	set := []string{"updated_at = $1"}
	args := []any{updatedAt}
	idx := 2
	if patch.HasStudentID && studentID != s.StudentID {
		set = append(set, fmt.Sprintf("student_id = $%d", idx))
		args = append(args, studentID)
		idx++
	}
	if patch.HasSource {
		set = append(set, fmt.Sprintf("source = $%d", idx))
		args = append(args, source)
		idx++
	}
	if patch.HasLocalDate {
		set = append(set, fmt.Sprintf("local_date = $%d", idx))
		args = append(args, localDate)
		idx++
	}
	if patch.HasStartedAt {
		set = append(set, fmt.Sprintf("started_at = $%d", idx))
		args = append(args, startedAt)
		idx++
	}
	if patch.HasNotes {
		set = append(set, fmt.Sprintf("notes = $%d", idx))
		args = append(args, nullableString(*notes))
		idx++
	}
	if earnedChanged {
		earned := computeEarned(duration, rate)
		set = append(set,
			fmt.Sprintf("duration_seconds = $%d", idx), fmt.Sprintf("rate_snapshot_kobo = $%d", idx+1), fmt.Sprintf("earned_kobo = $%d", idx+2))
		args = append(args, duration, rate, earned)
		idx += 3
	}
	if patch.HasStartedAt || patch.HasDuration {
		ended := startedAt + duration*1000
		set = append(set, fmt.Sprintf("ended_at = $%d", idx))
		args = append(args, ended)
		idx++
	}
	args = append(args, id)

	tx, err := db.Begin()
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE sessions SET `+strings.Join(set, ", ")+fmt.Sprintf(` WHERE id = $%d`, idx), args...); err != nil {
		return Session{}, err
	}

	updated, err := scanOneSession(tx.QueryRow(`SELECT id, student_id, source, status, started_at, ended_at,
		duration_seconds, rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
		FROM sessions WHERE id = $1`, id))
	if err != nil {
		return Session{}, err
	}

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionUpsertSession, updated.ID, updated); err != nil {
			return Session{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Session{}, err
	}
	return updated, nil
}

func (t *TrackaService) DeleteSession(id string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM sessions WHERE id = $1`, id); err != nil {
		return err
	}

	if t.syncEngine != nil {
		if err := t.syncEngine.Enqueue(tx, ActionDeleteSession, id, nil); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (t *TrackaService) ListSessionsByStudent(studentID string, limit, offset int) ([]Session, error) {
	return t.ListSessions(SessionFilter{StudentID: studentID}, limit, offset)
}

func (t *TrackaService) ListSessions(filter SessionFilter, limit, offset int) ([]Session, error) {
	if limit <= 0 || limit > 10000 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return nil, err
	}
	conds := []string{}
	args := []any{}
	idx := 1
	if filter.StudentID != "" {
		conds = append(conds, fmt.Sprintf("student_id = $%d", idx))
		args = append(args, filter.StudentID)
		idx++
	}
	if filter.From != "" {
		conds = append(conds, fmt.Sprintf("local_date >= $%d", idx))
		args = append(args, filter.From)
		idx++
	}
	if filter.To != "" {
		conds = append(conds, fmt.Sprintf("local_date <= $%d", idx))
		args = append(args, filter.To)
		idx++
	}
	if filter.Search != "" {
		conds = append(conds, fmt.Sprintf("notes LIKE $%d", idx))
		args = append(args, "%"+filter.Search+"%")
		idx++
	}
	q := `SELECT id, student_id, source, status, started_at, ended_at, duration_seconds,
		rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at FROM sessions`
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += fmt.Sprintf(` ORDER BY local_date DESC, started_at DESC LIMIT $%d OFFSET $%d`, idx, idx+1)
	args = append(args, limit, offset)
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---------- dashboard / earnings ----------

func (t *TrackaService) GetDashboard(kind string) (Dashboard, error) {
	if kind != "today" && kind != "week" && kind != "month" {
		kind = "week"
	}
	now := lagosDate(time.Now().UnixMilli())
	r := rangeForKind(kind, now)
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return Dashboard{}, err
	}
	var total sql.NullInt64
	_ = db.QueryRow(`SELECT COALESCE(SUM(earned_kobo), 0) FROM sessions
		WHERE status = 'completed' AND local_date BETWEEN $1 AND $2`, r.From, r.To).Scan(&total)
	erows, err := db.Query(`SELECT s.id, s.name,
			COALESCE(SUM(x.earned_kobo), 0),
			COALESCE(SUM(x.duration_seconds), 0),
			COUNT(x.id)
		FROM students s
		JOIN sessions x ON x.student_id = s.id
			AND x.status = 'completed' AND x.local_date BETWEEN $1 AND $2
		GROUP BY s.id ORDER BY 3 DESC`, r.From, r.To)
	if err != nil {
		return Dashboard{}, err
	}
	byStudent := []StudentEarnings{}
	for erows.Next() {
		var e StudentEarnings
		if err := erows.Scan(&e.StudentID, &e.Name, &e.EarnedKobo, &e.Seconds, &e.SessionCount); err != nil {
			erows.Close()
			return Dashboard{}, err
		}
		byStudent = append(byStudent, e)
	}
	erows.Close()
	drows, err := db.Query(`SELECT local_date, COALESCE(SUM(earned_kobo), 0)
		FROM sessions WHERE status = 'completed' AND local_date BETWEEN $1 AND $2
		GROUP BY local_date ORDER BY local_date`, r.From, r.To)
	if err != nil {
		return Dashboard{}, err
	}
	series := []DayTotal{}
	for drows.Next() {
		var d DayTotal
		if err := drows.Scan(&d.LocalDate, &d.EarnedKobo); err != nil {
			drows.Close()
			return Dashboard{}, err
		}
		series = append(series, d)
	}
	drows.Close()
	return Dashboard{
		Range:       r,
		TotalTenths: total.Int64,
		ByStudent:   byStudent,
		DailySeries: series,
	}, nil
}

func (t *TrackaService) GetLifetime(studentID string) (LifetimeStats, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return LifetimeStats{}, err
	}
	var out LifetimeStats
	err = db.QueryRow(`SELECT COALESCE(SUM(earned_kobo), 0), COALESCE(SUM(duration_seconds), 0), COUNT(id)
		FROM sessions WHERE status = 'completed' AND student_id = $1`, studentID).
		Scan(&out.EarnedKobo, &out.Seconds, &out.SessionCount)
	return out, err
}

// ---------- reports ----------

func (t *TrackaService) CollectReport(studentIDs []string, from, to, label string) (ReportData, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return ReportData{}, err
	}
	students := []ReportStudent{}
	for _, id := range studentIDs {
		st, err := scanStudent(db.QueryRow(`SELECT id, name, hourly_rate_kobo, status, created_at, updated_at FROM students WHERE id = $1`, id))
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return ReportData{}, err
		}
		rows, err := db.Query(`SELECT id, student_id, source, status, started_at, ended_at, duration_seconds,
			rate_snapshot_kobo, earned_kobo, local_date, notes, group_id, created_at, updated_at
			FROM sessions WHERE student_id = $1 ORDER BY local_date ASC, started_at ASC LIMIT 10000`, id)
		if err != nil {
			return ReportData{}, err
		}
		sessRows := []ReportSessionRow{}
		for rows.Next() {
			s, err := scanSession(rows)
			if err != nil {
				rows.Close()
				return ReportData{}, err
			}
			if s.Status != "completed" {
				continue
			}
			if from != "" && s.LocalDate < from {
				continue
			}
			if to != "" && s.LocalDate > to {
				continue
			}
			var dur, earned int64
			if s.DurationSeconds != nil {
				dur = *s.DurationSeconds
			}
			if s.EarnedKobo != nil {
				earned = *s.EarnedKobo
			}
			row := ReportSessionRow{
				LocalDate: s.LocalDate, DurationSeconds: dur,
				RateKobo: s.RateSnapshotKobo, EarnedTenths: earned, Source: s.Source,
			}
			if s.Notes != nil {
				row.Notes = *s.Notes
				row.HasNotes = true
			}
			sessRows = append(sessRows, row)
		}
		rows.Close()
		sort.Slice(sessRows, func(i, j int) bool { return sessRows[i].LocalDate < sessRows[j].LocalDate })
		rs := ReportStudent{
			Name: st.Name, Archived: st.Status == "archived",
			CurrentRateKobo: st.HourlyRateKobo, Sessions: sessRows,
		}
		for _, r := range sessRows {
			rs.SessionCount++
			rs.TotalSeconds += r.DurationSeconds
			rs.EarnedTenths += r.EarnedTenths
		}
		if rs.Sessions == nil {
			rs.Sessions = []ReportSessionRow{}
		}
		students = append(students, rs)
	}
	if students == nil {
		students = []ReportStudent{}
	}
	data := ReportData{
		Range:       ReportRange{From: from, To: to, Label: label},
		GeneratedAt: time.Now().Format("2 Jan 2006, 15:04"),
		Students:    students,
	}
	for _, s := range students {
		data.Grand.SessionCount += s.SessionCount
		data.Grand.TotalSeconds += s.TotalSeconds
		data.Grand.EarnedTenths += s.EarnedTenths
	}
	return data, nil
}

func (t *TrackaService) GetReportHTML(studentIDs []string, from, to, label string) (string, error) {
	data, err := t.CollectReport(studentIDs, from, to, label)
	if err != nil {
		return "", err
	}
	return BuildReportHTML(data), nil
}

// ---------- CSV / backup ----------

func csvEscape(v string) string {
	if strings.ContainsAny(v, "\",\n") {
		return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
	}
	return v
}

func (t *TrackaService) ExportCSV() (CsvFile, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return CsvFile{}, err
	}
	rows, err := db.Query(`SELECT x.local_date, s.name, x.source, x.status,
			x.duration_seconds, x.rate_snapshot_kobo / 100.0, x.earned_kobo / 1000.0,
			x.notes, x.started_at, x.ended_at, x.id
		FROM sessions x JOIN students s ON s.id = x.student_id
		ORDER BY x.local_date DESC, x.started_at DESC`)
	if err != nil {
		return CsvFile{}, err
	}
	defer rows.Close()
	var b strings.Builder
	b.WriteString("date,student,source,status,duration_seconds,rate_naira_per_hour,earned_naira,notes,started_at_utc,ended_at_utc,id\n")
	for rows.Next() {
		var localDate, student, source, status, id string
		var dur, started sql.NullInt64
		var rate, earned sql.NullFloat64
		var notes sql.NullString
		var ended sql.NullInt64
		if err := rows.Scan(&localDate, &student, &source, &status, &dur, &rate, &earned, &notes, &started, &ended, &id); err != nil {
			return CsvFile{}, err
		}
		num := func(n sql.NullInt64) string {
			if !n.Valid {
				return ""
			}
			return fmt.Sprintf("%d", n.Int64)
		}
		fnum := func(n sql.NullFloat64) string {
			if !n.Valid {
				return ""
			}
			return fmt.Sprintf("%v", n.Float64)
		}
		startedISO := ""
		if started.Valid {
			startedISO = time.UnixMilli(started.Int64).UTC().Format(time.RFC3339)
		}
		endedISO := ""
		if ended.Valid {
			endedISO = time.UnixMilli(ended.Int64).UTC().Format(time.RFC3339)
		}
		noteStr := ""
		if notes.Valid {
			noteStr = notes.String
		}
		fields := []string{localDate, student, source, status, num(dur), fnum(rate), fnum(earned), noteStr, startedISO, endedISO, id}
		for i, f := range fields {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(csvEscape(f))
		}
		b.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		return CsvFile{}, err
	}
	stamp := lagosDate(time.Now().UnixMilli())
	return CsvFile{Filename: fmt.Sprintf("tracka-sessions-%s.csv", stamp), Content: b.String()}, nil
}

type manifest struct {
	App             string `json:"app"`
	ManifestVersion int    `json:"manifestVersion"`
	SchemaVersion   int    `json:"schemaVersion"`
	ExportedAt      string `json:"exportedAt"`
	RowCounts       struct {
		Students int `json:"students"`
		Sessions int `json:"sessions"`
	} `json:"rowCounts"`
}

// ExportBackup bundles the local SQLite database (.db) + manifest into a compressed .zip.
func (t *TrackaService) ExportBackup() (BackupFile, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return BackupFile{}, err
	}

	// Checkpoint WAL first
	_, _ = db.Exec("PRAGMA wal_checkpoint(FULL)")

	// Get row counts for manifest
	var m manifest
	m.App = "tracka"
	m.ManifestVersion = 1
	m.SchemaVersion = localSchemaVersion
	m.ExportedAt = time.Now().UTC().Format(time.RFC3339)
	_ = db.QueryRow(`SELECT COUNT(*) FROM students`).Scan(&m.RowCounts.Students)
	_ = db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&m.RowCounts.Sessions)
	manBytes, _ := json.MarshalIndent(m, "", "  ")

	var dbBytes []byte
	if t.localPath != "" && t.localPath != ":memory:" {
		b, err := os.ReadFile(t.localPath)
		if err != nil {
			return BackupFile{}, fmt.Errorf("reading db file for backup: %w", err)
		}
		dbBytes = b
	}

	// Create zip archive
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	if len(dbBytes) > 0 {
		dw, err := zw.Create("tracka.db")
		if err != nil {
			return BackupFile{}, err
		}
		if _, err := dw.Write(dbBytes); err != nil {
			return BackupFile{}, err
		}
	}

	mw, err := zw.Create("manifest.json")
	if err != nil {
		return BackupFile{}, err
	}
	if _, err := mw.Write(manBytes); err != nil {
		return BackupFile{}, err
	}
	if err := zw.Close(); err != nil {
		return BackupFile{}, err
	}

	stamp := lagosDate(time.Now().UnixMilli())
	return BackupFile{
		Filename: fmt.Sprintf("tracka-backup-%s.zip", stamp),
		Base64:   base64.StdEncoding.EncodeToString(buf.Bytes()),
		Mime:     "application/zip",
	}, nil
}

func (t *TrackaService) MarkExported() error {
	return t.setMeta("last_export_at", fmt.Sprintf("%d", time.Now().UnixMilli()))
}

func (t *TrackaService) GetBackupStatus() (BackupStatus, error) {
	raw := t.getMeta("last_export_at")
	var out BackupStatus
	if raw == "" {
		out.Overdue = true
		return out, nil
	}
	var last int64
	_, _ = fmt.Sscanf(raw, "%d", &last)
	out.LastExportAt = &last
	out.Overdue = time.Now().UnixMilli()-last > 7*24*3600*1000
	return out, nil
}

// RestoreBackup restores a .zip backup (containing tracka.db or tracka.sql) + manifest.json.
func (t *TrackaService) RestoreBackup(base64Data string, filename string) (string, error) {
	if comma := strings.LastIndex(base64Data, ","); comma != -1 && strings.Contains(base64Data[:comma], "base64") {
		base64Data = base64Data[comma+1:]
	}
	base64Data = strings.TrimSpace(base64Data)
	base64Data = strings.ReplaceAll(base64Data, "\n", "")
	base64Data = strings.ReplaceAll(base64Data, "\r", "")
	base64Data = strings.ReplaceAll(base64Data, " ", "")
	raw, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		if raw2, err2 := base64.RawStdEncoding.DecodeString(base64Data); err2 == nil {
			raw = raw2
			err = nil
		} else {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Could not read that file (base64 decode failed: %v).", err))
		}
	}
	return t.restoreFromBytes(raw)
}

func (t *TrackaService) RestoreBackupDialog() (string, error) {
	app := application.Get()
	if app == nil {
		return "", derr("RESTORE_INVALID", "Dialog unavailable — app not ready.")
	}
	result, err := app.Dialog.OpenFile().
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("Tracka backup", "*.zip;*.db;*.sql").
		AddFilter("All files", "*.*").
		PromptForSingleSelection()
	if err != nil {
		return "", derr("RESTORE_INVALID", err.Error())
	}
	if result == "" {
		return "", derr("CANCELLED", "No file selected.")
	}
	raw, err := os.ReadFile(result)
	if err != nil {
		return "", derr("RESTORE_INVALID", fmt.Sprintf("Could not read %s: %v", filepath.Base(result), err))
	}
	return t.restoreFromBytes(raw)
}

func (t *TrackaService) restoreFromBytes(raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", derr("RESTORE_INVALID", "Backup archive is empty.")
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	var dbFileBytes []byte
	var sqlFileBytes []byte

	// Check if zip
	if len(raw) >= 4 && raw[0] == 'P' && raw[1] == 'K' {
		zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Could not read backup zip: %v", err))
		}
		hasValid := false
		for _, f := range zr.File {
			if f.Name == "tracka.db" {
				rc, err := f.Open()
				if err == nil {
					dbFileBytes, _ = io.ReadAll(rc)
					rc.Close()
					hasValid = true
				}
			} else if f.Name == "tracka.sql" {
				rc, err := f.Open()
				if err == nil {
					sqlFileBytes, _ = io.ReadAll(rc)
					rc.Close()
					hasValid = true
				}
			}
		}
		if !hasValid {
			return "", derr("RESTORE_INVALID", "This zip is not a Tracka backup (missing tracka.db or tracka.sql).")
		}
	} else if len(raw) >= 16 && string(raw[:15]) == "SQLite format 3" {
		dbFileBytes = raw
	} else if len(raw) > 0 && (strings.Contains(string(raw), "INSERT INTO") || strings.Contains(string(raw), "students") || strings.Contains(string(raw), "sessions")) {
		sqlFileBytes = raw
	} else {
		return "", derr("RESTORE_INVALID", "This file is not a valid Tracka backup archive.")
	}

	if len(dbFileBytes) == 0 && len(sqlFileBytes) == 0 {
		return "", derr("RESTORE_INVALID", "This file is not a valid Tracka backup archive.")
	}

	// If SQLite database bytes provided, verify them in a temporary file first
	if len(dbFileBytes) > 0 {
		tempDir, err := os.MkdirTemp("", "tracka-restore-*")
		if err != nil {
			return "", fmt.Errorf("create temp dir: %w", err)
		}
		defer os.RemoveAll(tempDir)

		tempDBPath := filepath.Join(tempDir, "restore.db")
		if err := os.WriteFile(tempDBPath, dbFileBytes, 0600); err != nil {
			return "", fmt.Errorf("writing restore temp file: %w", err)
		}

		// Verify integrity of restored db
		chkDB, err := sql.Open("sqlite", tempDBPath)
		if err != nil {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Corrupt SQLite database in backup: %v", err))
		}
		var checkRes string
		_ = chkDB.QueryRow(`PRAGMA quick_check`).Scan(&checkRes)
		chkDB.Close()
		if checkRes != "ok" {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Backup database integrity check failed: %s", checkRes))
		}

		// Close current local DB connection and replace file
		if t.localDB != nil {
			t.localDB.Close()
		}

		if t.localPath != "" && t.localPath != ":memory:" {
			if err := os.WriteFile(t.localPath, dbFileBytes, 0600); err != nil {
				return "", fmt.Errorf("overwriting local database: %w", err)
			}
			newDB, err := openLocalDB(t.localPath)
			if err != nil {
				return "", fmt.Errorf("reopening restored database: %w", err)
			}
			t.localDB = newDB
			if t.syncEngine != nil {
				t.syncEngine.localDB = newDB
			}
		}

		// Re-enqueue all restored data for cloud synchronization
		go t.enqueueAllForSync()

		return "Backup restored successfully.", nil
	}

	if len(sqlFileBytes) > 0 {
		db, err := t.conn()
		if err != nil {
			return "", err
		}
		tx, err := db.Begin()
		if err != nil {
			return "", err
		}
		defer tx.Rollback()

		if _, err := tx.Exec(string(sqlFileBytes)); err != nil {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Failed to execute SQL: %v", err))
		}
		if err := tx.Commit(); err != nil {
			return "", derr("RESTORE_INVALID", fmt.Sprintf("Failed to commit restore: %v", err))
		}
		go t.enqueueAllForSync()
		return "Backup restored successfully.", nil
	}

	return "Backup restored.", nil
}

// enqueueAllForSync enqueues all local students and sessions so they push to Neon
func (t *TrackaService) enqueueAllForSync() {
	if t.syncEngine == nil {
		return
	}
	db, err := t.conn()
	if err != nil {
		return
	}

	students, err := t.ListStudents(true)
	if err == nil {
		for _, s := range students {
			_ = t.syncEngine.Enqueue(db, ActionUpsertStudent, s.ID, s)
		}
	}

	sessions, err := t.ListSessions(SessionFilter{}, 10000, 0)
	if err == nil {
		for _, ses := range sessions {
			_ = t.syncEngine.Enqueue(db, ActionUpsertSession, ses.ID, ses)
		}
	}
}

// ---------- startup / health ----------

type StartupCheck struct {
	Ok              bool   `json:"ok"`
	IntegrityDetail string `json:"integrityDetail"`
	RunningCount    int    `json:"runningCount"`
	RunningSince    int64  `json:"runningSince"`
	IsStale         bool   `json:"isStale"`
	BackupOverdue   bool   `json:"backupOverdue"`
	SchemaVersion   int    `json:"schemaVersion"`
	DatabasePath    string `json:"databasePath"`
}

func (t *TrackaService) StartupCheck() (StartupCheck, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	db, err := t.conn()
	if err != nil {
		return StartupCheck{}, err
	}
	var out StartupCheck
	out.SchemaVersion = localSchemaVersion
	out.DatabasePath = t.localPath

	// Verify local SQLite integrity
	var checkResult string
	if err := db.QueryRow(`PRAGMA quick_check`).Scan(&checkResult); err != nil {
		out.Ok = false
		out.IntegrityDetail = fmt.Sprintf("database check failed: %v", err)
		return out, nil
	}
	if checkResult != "ok" {
		out.Ok = false
		out.IntegrityDetail = fmt.Sprintf("database integrity error: %s", checkResult)
		return out, nil
	}
	out.Ok = true
	out.IntegrityDetail = "ok"

	group, err := t.runningRows(db)
	if err == nil {
		out.RunningCount = len(group)
		if len(group) > 0 {
			out.RunningSince = group[0].StartedAt
			out.IsStale = time.Now().UnixMilli()-group[0].StartedAt > 8*3600*1000
		}
	}
	raw := ""
	_ = db.QueryRow(`SELECT value FROM meta WHERE key = 'last_export_at'`).Scan(&raw)
	if raw == "" {
		out.BackupOverdue = true
	} else {
		var last int64
		_, _ = fmt.Sscanf(raw, "%d", &last)
		out.BackupOverdue = time.Now().UnixMilli()-last > 7*24*3600*1000
	}
	return out, nil
}

// ---------- helpers ----------

func nullableString(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func nullableInt(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

var _ = isCode
