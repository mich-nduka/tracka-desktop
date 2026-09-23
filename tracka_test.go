package main

import (
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Tests run with local SQLite database as primary store.
// If DATABASE_URL is provided, tests also verify Neon Postgres cloud synchronization.

var testURL string

func TestMain(m *testing.M) {
	base := os.Getenv("DATABASE_URL")
	if base == "" {
		// Also check config file
		dir, err := os.UserConfigDir()
		if err == nil {
			p := filepath.Join(dir, "tracka-desktop", "database_url")
			if b, err := os.ReadFile(p); err == nil {
				base = strings.TrimSpace(string(b))
			}
		}
	}
	if base != "" {
		var err error
		testURL, err = swapDatabase(base, "tracka_test")
		if err == nil {
			// Ensure the test db exists and is empty
			if db, err := pgOpenDB(testURL); err == nil {
				_, _ = db.Exec(`DROP TABLE IF EXISTS public.sessions, public.students, public.meta, public.schema_migrations CASCADE`)
				_ = db.Close()
			}
		}
	}
	os.Exit(m.Run())
}

// swapDatabase replaces the database name in a postgres URL.
func swapDatabase(conn, dbName string) (string, error) {
	u, err := url.Parse(conn)
	if err != nil {
		return "", err
	}
	u.Path = "/" + dbName
	return u.String(), nil
}

func newTestService(t *testing.T) *TrackaService {
	t.Helper()
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "test.db")
	localDB, err := openLocalDB(localPath)
	if err != nil {
		t.Fatalf("open local test db: %v", err)
	}
	t.Cleanup(func() { localDB.Close() })

	svc := NewTrackaServiceWithDB(localDB, localPath, testURL)

	if testURL != "" {
		cloudDB, err := pgOpenDB(testURL)
		if err == nil {
			svc.SetCloudDB(cloudDB)
			t.Cleanup(func() {
				_, _ = cloudDB.Exec(`DELETE FROM public.sessions`)
				_, _ = cloudDB.Exec(`DELETE FROM public.students`)
				_, _ = cloudDB.Exec(`DELETE FROM public.meta`)
				cloudDB.Close()
			})
		}
	}
	return svc
}

func TestStudentsCRUD(t *testing.T) {
	svc := newTestService(t)
	s, err := svc.CreateStudent("Ada", 500000)
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "Ada" || s.HourlyRateKobo != 500000 {
		t.Fatalf("unexpected student: %+v", s)
	}
	if _, err := svc.CreateStudent("  ", 100); err == nil {
		t.Fatal("expected INVALID_NAME")
	}
	if _, err := svc.CreateStudent("Bob", 0); err == nil {
		t.Fatal("expected INVALID_RATE")
	}
	upd, err := svc.UpdateStudent(s.ID, "Ada Lovelace", 600000)
	if err != nil {
		t.Fatal(err)
	}
	if upd.Name != "Ada Lovelace" || upd.HourlyRateKobo != 600000 {
		t.Fatalf("unexpected update: %+v", upd)
	}
	list, err := svc.ListStudents(false)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %d", err, len(list))
	}
	if err := svc.ArchiveStudent(s.ID); err != nil {
		t.Fatal(err)
	}
	list, _ = svc.ListStudents(false)
	if len(list) != 0 {
		t.Fatal("archived student should be hidden")
	}
	if err := svc.UnarchiveStudent(s.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteStudent(s.ID); err != nil {
		t.Fatal(err)
	}
}

func TestGroupTimer(t *testing.T) {
	svc := newTestService(t)
	a, _ := svc.CreateStudent("A", 360000)
	b, _ := svc.CreateStudent("B", 720000)

	group, err := svc.StartTimer([]string{a.ID, b.ID}, "maths")
	if err != nil {
		t.Fatal(err)
	}
	if len(group) != 2 || group[0].GroupID == nil || *group[0].GroupID != *group[1].GroupID {
		t.Fatalf("expected shared group: %+v", group)
	}
	// Second timer must be rejected while one runs (trigger).
	if _, err := svc.StartTimer([]string{a.ID}, ""); !isCode(err, "TIMER_ALREADY_RUNNING") {
		t.Fatalf("expected TIMER_ALREADY_RUNNING, got %v", err)
	}
	// Too short must fail and keep running.
	if _, err := svc.StopTimer(group[0].StartedAt+30*1000, StopOptions{}); !isCode(err, "DURATION_TOO_SHORT") {
		t.Fatalf("expected DURATION_TOO_SHORT, got %v", err)
	}
	still, _ := svc.GetRunningGroup()
	if len(still) != 2 {
		t.Fatal("group should still be running after short-stop rejection")
	}
	// Stop after 1 hour.
	stopped, err := svc.StopTimer(group[0].StartedAt+3600*1000, StopOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range stopped {
		if s.Status != "completed" || s.DurationSeconds == nil || *s.DurationSeconds != 3600 {
			t.Fatalf("bad stop: %+v", s)
		}
	}
	for _, s := range stopped {
		var want int64
		if s.StudentID == a.ID {
			want = 360000 * 10
		} else {
			want = 720000 * 10
		}
		if s.EarnedKobo == nil || *s.EarnedKobo != want {
			t.Fatalf("earned mismatch: got %v want %v", s.EarnedKobo, want)
		}
	}
	empty, _ := svc.GetRunningGroup()
	if len(empty) != 0 {
		t.Fatal("should be idle after stop")
	}
}

func TestManualAndDashboard(t *testing.T) {
	svc := newTestService(t)
	a, _ := svc.CreateStudent("A", 360000)
	today := lagosDate(time.Now().UnixMilli())
	rows, err := svc.LogManualGroup(ManualGroupInput{
		StudentIDs: []string{a.ID}, DurationSeconds: 3600, LocalDate: today,
		Notes: "algebra",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].EarnedKobo == nil {
		t.Fatalf("bad manual row: %+v", rows)
	}
	d, err := svc.GetDashboard("today")
	if err != nil {
		t.Fatal(err)
	}
	if d.TotalTenths != 360000*10 {
		t.Fatalf("dashboard total: got %d", d.TotalTenths)
	}
	if len(d.ByStudent) != 1 || d.ByStudent[0].SessionCount != 1 {
		t.Fatalf("byStudent: %+v", d.ByStudent)
	}
	life, err := svc.GetLifetime(a.ID)
	if err != nil || life.SessionCount != 1 {
		t.Fatalf("lifetime: %+v %v", life, err)
	}
	// Edit recomputes earnings.
	upd, err := svc.UpdateSession(rows[0].ID, SessionPatch{DurationSeconds: 7200, HasDuration: true})
	if err != nil {
		t.Fatal(err)
	}
	if upd.EarnedKobo == nil || *upd.EarnedKobo != 360000*20 {
		t.Fatalf("recomputed earned: %+v", upd.EarnedKobo)
	}
	// Timer session locks student field (use a fresh timer row).
	g, _ := svc.StartTimer([]string{a.ID}, "")
	stopped, _ := svc.StopTimer(g[0].StartedAt+3600*1000, StopOptions{})
	c, _ := svc.CreateStudent("C", 100)
	if _, err := svc.UpdateSession(stopped[0].ID, SessionPatch{StudentID: c.ID, HasStudentID: true}); !isCode(err, "TIMER_FIELD_LOCKED") {
		t.Fatalf("expected TIMER_FIELD_LOCKED, got %v", err)
	}
}

func TestBackupRestoreAndReport(t *testing.T) {
	svc := newTestService(t)
	a, _ := svc.CreateStudent("A", 360000)
	today := lagosDate(time.Now().UnixMilli())
	_, _ = svc.LogManualGroup(ManualGroupInput{StudentIDs: []string{a.ID}, DurationSeconds: 3600, LocalDate: today})
	bf, err := svc.ExportBackup()
	if err != nil || bf.Base64 == "" {
		t.Fatalf("export: %v", err)
	}
	if err := svc.MarkExported(); err != nil {
		t.Fatal(err)
	}
	st, _ := svc.GetBackupStatus()
	if st.LastExportAt == nil || st.Overdue {
		t.Fatalf("status after export: %+v", st)
	}
	csv, err := svc.ExportCSV()
	if err != nil || csv.Content == "" {
		t.Fatalf("csv: %v", err)
	}
	if !strings.Contains(csv.Content, ",3600,36") {
		t.Fatalf("csv missing rows: %q", csv.Content)
	}
	data, err := svc.CollectReport([]string{a.ID}, today, today, "Today")
	if err != nil || data.Grand.SessionCount != 1 {
		t.Fatalf("report: %+v %v", data, err)
	}
	html, err := svc.GetReportHTML([]string{a.ID}, today, today, "Today")
	if err != nil || len(html) < 500 {
		t.Fatalf("html: %v %d", err, len(html))
	}
	// Restore into a fresh (empty) service from the exported bytes.
	svc2 := newTestService(t)
	msg, err := svc2.RestoreBackup(bf.Base64, bf.Filename)
	if err != nil || msg == "" {
		t.Fatalf("restore: %v %v", msg, err)
	}
	list, err := svc2.ListStudents(true)
	if err != nil || len(list) != 1 {
		t.Fatalf("restored students: %+v %v", list, err)
	}
	// Corrupt file must be rejected without touching the live DB.
	if _, err := svc2.RestoreBackup("bm90LWEK", "junk.bin"); err == nil {
		t.Fatal("expected restore rejection for junk")
	}
	list2, _ := svc2.ListStudents(true)
	if len(list2) != 1 {
		t.Fatal("live DB touched by failed restore")
	}
}

func TestRowScanningBigInt(t *testing.T) {
	// Guard against int64 <-> int32 scanning regressions.
	svc := newTestService(t)
	s, err := svc.CreateStudent("Scan", 12345678901)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.GetStudent(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.HourlyRateKobo != 12345678901 || got.CreatedAt <= 0 {
		t.Fatalf("bigint scan: %+v", got)
	}
}

func TestCloudSyncPushAndPull(t *testing.T) {
	if testURL == "" {
		t.Skip("Skipping cloud sync test: DATABASE_URL not configured")
	}

	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "client_a.db")
	localDB, err := openLocalDB(localPath)
	if err != nil {
		t.Fatal(err)
	}
	defer localDB.Close()

	cloudDB, err := pgOpenDB(testURL)
	if err != nil {
		t.Fatalf("open cloud db: %v", err)
	}
	defer cloudDB.Close()

	// Clear test tables in cloud
	_, _ = cloudDB.Exec(`DELETE FROM public.sessions`)
	_, _ = cloudDB.Exec(`DELETE FROM public.students`)
	_, _ = cloudDB.Exec(`DELETE FROM public.meta`)

	// 1. Create client A service
	svcA := NewTrackaServiceWithDB(localDB, localPath, testURL)
	svcA.SetCloudDB(cloudDB)

	// Create student locally in client A
	s, err := svcA.CreateStudent("Sync Student", 450000)
	if err != nil {
		t.Fatal(err)
	}

	// Verify mutation was enqueued in sync_queue
	pending, err := svcA.syncEngine.GetPendingCount()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Pending count after create: %d", pending)

	// Push pending mutations to cloud
	pushed, err := svcA.syncEngine.PushPending()
	if err != nil {
		t.Fatalf("PushPending: %v", err)
	}
	t.Logf("Pushed items: %d", pushed)

	// Verify row in cloud DB
	var cloudName string
	var cloudRate int64
	err = cloudDB.QueryRow(`SELECT name, hourly_rate_kobo FROM public.students WHERE id = $1`, s.ID).Scan(&cloudName, &cloudRate)
	if err != nil {
		t.Fatalf("cloud student not found: %v", err)
	}
	if cloudName != "Sync Student" || cloudRate != 450000 {
		t.Fatalf("unexpected cloud values: name=%s rate=%d", cloudName, cloudRate)
	}

	// 2. Simulate Client B (e.g. mobile app or another desktop) pulling the new student
	clientBPath := filepath.Join(tempDir, "client_b.db")
	clientBDB, err := openLocalDB(clientBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer clientBDB.Close()

	svcB := NewTrackaServiceWithDB(clientBDB, clientBPath, testURL)
	svcB.SetCloudDB(cloudDB)

	pulledStudents, _, err := svcB.syncEngine.PullChanges(nil)
	if err != nil {
		t.Fatalf("PullChanges on client B: %v", err)
	}
	if pulledStudents != 1 {
		t.Fatalf("expected 1 student pulled on client B, got %d", pulledStudents)
	}

	bStudent, err := svcB.GetStudent(s.ID)
	if err != nil {
		t.Fatalf("client B get student: %v", err)
	}
	if bStudent.Name != "Sync Student" || bStudent.HourlyRateKobo != 450000 {
		t.Fatalf("unexpected client B student: %+v", bStudent)
	}

	// 3. Client B logs a session and pushes it
	today := lagosDate(time.Now().UnixMilli())
	sessB, err := svcB.LogManualGroup(ManualGroupInput{
		StudentIDs:      []string{s.ID},
		DurationSeconds: 3600,
		LocalDate:       today,
		Notes:           "Synced session",
	})
	if err != nil {
		t.Fatalf("client B log session: %v", err)
	}
	if len(sessB) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessB))
	}

	_, err = svcB.syncEngine.PushPending()
	if err != nil {
		t.Fatalf("client B push: %v", err)
	}

	// Verify session in cloud
	var sessionID string
	err = cloudDB.QueryRow(`SELECT id FROM public.sessions WHERE id = $1`, sessB[0].ID).Scan(&sessionID)
	if err != nil {
		t.Fatalf("cloud session not found: %v", err)
	}

	// 4. Client A pulls changes and receives Client B's session
	zeroTime := int64(0)
	_, pulledSessions, err := svcA.syncEngine.PullChanges(&zeroTime)
	if err != nil {
		t.Fatalf("client A pull: %v", err)
	}
	if pulledSessions != 1 {
		t.Fatalf("expected 1 session pulled on client A, got %d", pulledSessions)
	}

	aSess, err := svcA.GetSession(sessB[0].ID)
	if err != nil {
		t.Fatalf("client A get session: %v", err)
	}
	if aSess.StudentID != s.ID || aSess.DurationSeconds == nil || *aSess.DurationSeconds != 3600 {
		t.Fatalf("unexpected client A session: %+v", aSess)
	}
}

func TestSyncStatusReporting(t *testing.T) {
	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "status_test.db")
	localDB, err := openLocalDB(localPath)
	if err != nil {
		t.Fatal(err)
	}
	defer localDB.Close()

	// Offline service (no cloud DB)
	svc := NewTrackaServiceWithDB(localDB, localPath, "")
	st, err := svc.GetSyncStatus()
	if err != nil {
		t.Fatal(err)
	}
	if st.State != "offline" {
		t.Fatalf("expected offline state, got %s", st.State)
	}

	// Create student -> pending count = 1
	_, err = svc.CreateStudent("Offline Ada", 300000)
	if err != nil {
		t.Fatal(err)
	}

	st, _ = svc.GetSyncStatus()
	if st.PendingCount != 1 {
		t.Fatalf("expected pendingCount=1, got %d", st.PendingCount)
	}
}

var _ = sql.ErrNoRows
