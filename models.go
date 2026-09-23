package main

// Domain models. JSON tags mirror the mobile app's camelCase types so the
// React frontend can share the same logic (see frontend/src/lib).

type Student struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	HourlyRateKobo int64  `json:"hourlyRateKobo"`
	Status         string `json:"status"` // active | archived
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type Session struct {
	ID               string  `json:"id"`
	StudentID        string  `json:"studentId"`
	Source           string  `json:"source"` // timer | manual
	Status           string  `json:"status"` // running | completed
	StartedAt        int64   `json:"startedAt"`
	EndedAt          *int64  `json:"endedAt"`
	DurationSeconds  *int64  `json:"durationSeconds"`
	RateSnapshotKobo int64   `json:"rateSnapshotKobo"`
	EarnedKobo       *int64  `json:"earnedKobo"` // tenths of kobo; nil while running
	LocalDate        string  `json:"localDate"`  // YYYY-MM-DD Africa/Lagos
	Notes            *string `json:"notes"`
	GroupID          *string `json:"groupId"`
	CreatedAt        int64   `json:"createdAt"`
	UpdatedAt        int64   `json:"updatedAt"`
}

type StudentEarnings struct {
	StudentID    string `json:"studentId"`
	Name         string `json:"name"`
	EarnedKobo   int64  `json:"earnedKobo"` // tenths
	Seconds      int64  `json:"seconds"`
	SessionCount int64  `json:"sessionCount"`
}

type DayTotal struct {
	LocalDate  string `json:"localDate"`
	EarnedKobo int64  `json:"earnedKobo"` // tenths
}

type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Dashboard struct {
	Range       DateRange         `json:"range"`
	TotalTenths int64             `json:"totalTenths"`
	ByStudent   []StudentEarnings `json:"byStudent"`
	DailySeries []DayTotal        `json:"dailySeries"`
}

type SessionFilter struct {
	StudentID string `json:"studentId"`
	From      string `json:"from"`
	To        string `json:"to"`
	Search    string `json:"search"`
}

type StopOptions struct {
	LocalDateOverride       string `json:"localDateOverride"`       // "" = keep running row's date
	DurationOverrideSeconds int64  `json:"durationOverrideSeconds"` // honoured when HasDurationOverride
	HasDurationOverride     bool   `json:"hasDurationOverride"`
	Notes                   string `json:"notes"`
	HasNotes                bool   `json:"hasNotes"` // when true, Notes (even "") replaces; "" clears
}

type ManualGroupInput struct {
	StudentIDs      []string `json:"studentIds"`
	DurationSeconds int64    `json:"durationSeconds"`
	LocalDate       string   `json:"localDate"`
	StartedAt       int64    `json:"startedAt"` // honoured when HasStartedAt
	HasStartedAt    bool     `json:"hasStartedAt"`
	RateKobo        int64    `json:"rateKobo"` // honoured when HasRate && len(StudentIDs)==1
	HasRate         bool     `json:"hasRate"`
	Notes           string   `json:"notes"`
}

type SessionPatch struct {
	StudentID        string `json:"studentId"`
	HasStudentID     bool   `json:"hasStudentId"`
	Source           string `json:"source"`
	HasSource        bool   `json:"hasSource"`
	LocalDate        string `json:"localDate"`
	HasLocalDate     bool   `json:"hasLocalDate"`
	StartedAt        int64  `json:"startedAt"`
	HasStartedAt     bool   `json:"hasStartedAt"`
	RateSnapshotKobo int64  `json:"rateSnapshotKobo"`
	HasRate          bool   `json:"hasRate"`
	DurationSeconds  int64  `json:"durationSeconds"`
	HasDuration      bool   `json:"hasDuration"`
	Notes            string `json:"notes"`
	HasNotes         bool   `json:"hasNotes"` // true => set ("" clears to NULL)
}

type LifetimeStats struct {
	EarnedKobo   int64 `json:"earnedKobo"`
	Seconds      int64 `json:"seconds"`
	SessionCount int64 `json:"sessionCount"`
}

type BackupStatus struct {
	LastExportAt *int64 `json:"lastExportAt"`
	Overdue      bool   `json:"overdue"`
}

type BackupFile struct {
	Filename string `json:"filename"`
	Base64   string `json:"base64"`
	Mime     string `json:"mime"`
}

type CsvFile struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

// Report types (mirror utils/report.ts on mobile).
type ReportRange struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

type ReportSessionRow struct {
	LocalDate       string `json:"localDate"`
	DurationSeconds int64  `json:"durationSeconds"`
	RateKobo        int64  `json:"rateKobo"`
	EarnedTenths    int64  `json:"earnedTenths"`
	Notes           string `json:"notes"`
	HasNotes        bool   `json:"hasNotes"`
	Source          string `json:"source"`
}

type ReportStudent struct {
	Name            string             `json:"name"`
	Archived        bool               `json:"archived"`
	CurrentRateKobo int64              `json:"currentRateKobo"`
	SessionCount    int64              `json:"sessionCount"`
	TotalSeconds    int64              `json:"totalSeconds"`
	EarnedTenths    int64              `json:"earnedTenths"`
	Sessions        []ReportSessionRow `json:"sessions"`
}

type ReportTotals struct {
	SessionCount int64 `json:"sessionCount"`
	TotalSeconds int64 `json:"totalSeconds"`
	EarnedTenths int64 `json:"earnedTenths"`
}

type ReportData struct {
	Range       ReportRange    `json:"range"`
	GeneratedAt string         `json:"generatedAt"`
	Students    []ReportStudent `json:"students"`
	Grand       ReportTotals   `json:"grand"`
}

type SyncStatus struct {
	State        string `json:"state"` // synced | syncing | offline | error
	PendingCount int    `json:"pendingCount"`
	LastSyncAt   *int64 `json:"lastSyncAt"`
	Error        string `json:"error,omitempty"`
}

type SyncQueueItem struct {
	ID        string  `json:"id"`
	Action    string  `json:"action"`
	EntityID  string  `json:"entityId"`
	Payload   *string `json:"payload"`
	CreatedAt int64   `json:"createdAt"`
}
