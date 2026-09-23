package main

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// ---- Money / earnings (port of utils/earnings.ts + utils/format.ts) ----

func computeEarned(durationSeconds, rateKobo int64) int64 {
	return int64(math.Round(float64(durationSeconds*rateKobo*10) / 3600.0))
}

func groupThousands(digits string) string {
	n := len(digits)
	if n <= 3 {
		return digits
	}
	var b strings.Builder
	rem := n % 3
	if rem > 0 {
		b.WriteString(digits[:rem])
		if n > rem {
			b.WriteByte(',')
		}
	}
	for i := rem; i < n; i += 3 {
		b.WriteString(digits[i : i+3])
		if i+3 < n {
			b.WriteByte(',')
		}
	}
	return b.String()
}

// formatNaira renders integer kobo as ₦12,500 (2dp only when needed).
func formatNaira(kobo float64) string {
	sign := ""
	if kobo < 0 {
		sign = "-"
	}
	naira := math.Round(math.Abs(kobo)) / 100.0
	s := fmt.Sprintf("%.2f", naira)
	parts := strings.SplitN(s, ".", 2)
	grouped := groupThousands(parts[0])
	if parts[1] == "00" {
		return sign + "₦" + grouped
	}
	return sign + "₦" + grouped + "." + parts[1]
}

func previewEarnedKobo(tenths int64) string {
	return formatNaira(float64(tenths) / 10.0)
}

func formatDurationLong(seconds int64) string {
	if seconds < 0 {
		seconds = 0
	}
	totalMinutes := seconds / 60
	h := totalMinutes / 60
	m := totalMinutes % 60
	if h == 0 {
		return fmt.Sprintf("%dm", m)
	}
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh %dm", h, m)
}

var months = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

func formatLocalDate(date string) string {
	var y, m, d int
	_, _ = fmt.Sscanf(date, "%d-%d-%d", &y, &m, &d)
	if m < 1 || m > 12 {
		return date
	}
	return fmt.Sprintf("%d %s %d", d, months[m-1], y)
}

// ---- Lagos calendar (port of utils/dates.ts) ----
// Africa/Lagos is UTC+1 with no DST: fixed offset.

const lagosOffsetMs = int64(3600 * 1000)

func lagosDate(epochMs int64) string {
	t := time.UnixMilli(epochMs + lagosOffsetMs).UTC()
	return t.Format("2006-01-02")
}

func lagosMidday(date string) int64 {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", date+"T12:00:00.000Z")
	if err != nil {
		return 0
	}
	return t.UnixMilli() - lagosOffsetMs
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func isValidCalendarDate(s string) bool {
	if !dateRe.MatchString(s) {
		return false
	}
	var y, m, d int
	_, _ = fmt.Sscanf(s, "%d-%d-%d", &y, &m, &d)
	if y < 1 || m < 1 || m > 12 || d < 1 {
		return false
	}
	return d <= daysInMonth(y, m)
}

func daysInMonth(year, month int) int {
	return time.Date(year, time.Month(month+1), 0, 0, 0, 0, 0, time.UTC).Day()
}

func addDays(date string, days int) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, days).Format("2006-01-02")
}

func weekRange(date string) DateRange {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return DateRange{From: date, To: date}
	}
	dow := int(t.Weekday()) // Sun=0
	sinceMonday := (dow + 6) % 7
	from := addDays(date, -sinceMonday)
	return DateRange{From: from, To: addDays(from, 6)}
}

func monthRange(date string) DateRange {
	if len(date) < 7 {
		return DateRange{From: date, To: date}
	}
	prefix := date[:7]
	var y, m int
	_, _ = fmt.Sscanf(date, "%d-%d", &y, &m)
	return DateRange{From: prefix + "-01", To: fmt.Sprintf("%s-%02d", prefix, daysInMonth(y, m))}
}

func rangeForKind(kind, now string) DateRange {
	switch kind {
	case "today":
		return DateRange{From: now, To: now}
	case "month":
		return monthRange(now)
	default: // week
		return weekRange(now)
	}
}
