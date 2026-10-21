// Package jobs — صف پایدار در app.sqlite؛ claim اتمیک، lease، heartbeat (§۵۱).
// فقط API نویسندهٔ app.sqlite است؛ worker با endpoint داخلی claim می‌کند.
package jobs

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"noor/internal/store"
)

type Service struct{ db *store.DB }

func New(db *store.DB) *Service { return &Service{db: db} }

type Job struct {
	UID       string          `json:"uid"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	Status    string          `json:"status"`
	Progress  int             `json:"progress"`
	Note      string          `json:"progress_note"`
	Error     string          `json:"error,omitempty"`
	CreatedAt string          `json:"created_at"`
}

// Enqueue افزودن کار؛ جلوگیری از تکرار با کلید kind فعال (import/reindex یک فعال).
func (s *Service) Enqueue(kind string, payload json.RawMessage, createdBy string) (*Job, error) {
	uid := "job-" + randHex(8)
	if kind == "index_rebuild" {
		// بررسی «یک کار فعال» داخل تراکنش تا دو enqueue هم‌زمان هر دو از شرط
		// عبور نکنند (TOCTOU قبلی: دو rebuild موازی با فایل ساختن مشترک).
		tx, err := s.db.Begin()
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		var n int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM jobs WHERE kind='index_rebuild' AND status IN ('queued','running')`).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, errors.New("یک کار ساخت نمایه فعال وجود دارد؛ تا پایان آن صبر کنید")
		}
		if _, err := tx.Exec(`INSERT INTO jobs(uid, kind, payload, created_by) VALUES(?,?,?,?)`, uid, kind, string(payload), createdBy); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.Get(uid)
	}
	if _, err := s.db.Exec(`INSERT INTO jobs(uid, kind, payload, created_by) VALUES(?,?,?,?)`, uid, kind, string(payload), createdBy); err != nil {
		return nil, err
	}
	return s.Get(uid)
}

func (s *Service) Get(uid string) (*Job, error) {
	var j Job
	var payload, errStr, note sql.NullString
	err := s.db.QueryRow(`SELECT uid, kind, payload, status, progress, progress_note, error, created_at FROM jobs WHERE uid=?`, uid).
		Scan(&j.UID, &j.Kind, &payload, &j.Status, &j.Progress, &note, &errStr, &j.CreatedAt)
	if err != nil {
		return nil, errors.New("کار یافت نشد")
	}
	j.Payload = json.RawMessage(payload.String)
	j.Error = errStr.String
	j.Note = note.String
	return &j, nil
}

func (s *Service) List() ([]Job, error) {
	rows, err := s.db.Query(`SELECT uid, kind, payload, status, progress, progress_note, error, created_at FROM jobs ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var j Job
		var payload, errStr, note sql.NullString
		if err := rows.Scan(&j.UID, &j.Kind, &payload, &j.Status, &j.Progress, &note, &errStr, &j.CreatedAt); err != nil {
			continue
		}
		j.Payload = json.RawMessage(payload.String)
		j.Error = errStr.String
		j.Note = note.String
		out = append(out, j)
	}
	return out, nil
}

// Claim claim اتمیک از صف. پیش از آن کارهای running با lease منقضی (worker
// کرش‌کرده) دوباره صف می‌شوند تا برای همیشه «running» نمانند.
func (s *Service) Claim(worker string) (*Job, error) {
	_, _ = s.db.Exec(`UPDATE jobs SET status='queued', lease_until=NULL, retries=retries+1
		WHERE status='running' AND lease_until IS NOT NULL AND lease_until < datetime('now')`)
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var uid string
	err = tx.QueryRow(`SELECT uid FROM jobs WHERE status='queued' ORDER BY priority, created_at LIMIT 1`).Scan(&uid)
	if err != nil {
		return nil, sql.ErrNoRows
	}
	now := time.Now().UTC().Format(time.RFC3339)
	lease := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	// گارد status='queued' در UPDATE: دو worker هم‌زمان نمی‌توانند همان کار را ببرند
	res, err := tx.Exec(`UPDATE jobs SET status='running', claimed_at=?, heartbeat_at=?, lease_until=? WHERE uid=? AND status='queued'`, now, now, lease, uid)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Get(uid)
}

// StatusOf وضعیت فعلی کار؛ خالی اگر یافت نشود (مصرف: پاسخ progress داخلی).
func (s *Service) StatusOf(uid string) string {
	var st string
	if err := s.db.QueryRow(`SELECT status FROM jobs WHERE uid=?`, uid).Scan(&st); err != nil {
		return ""
	}
	return st
}

// Heartbeat تمدید lease.
func (s *Service) Heartbeat(uid string, progress int, note string) error {
	lease := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE jobs SET heartbeat_at=datetime('now'), lease_until=?, progress=?, progress_note=? WHERE uid=? AND status='running'`, lease, progress, note, uid)
	return err
}

// Complete پایان موفق — هرگز کارِ لغوشده را «done» نمی‌کند (ممیزی: لغو بی‌اثر).
func (s *Service) Complete(uid string, result json.RawMessage) error {
	_, err := s.db.Exec(`UPDATE jobs SET status='done', progress=100, finished_at=datetime('now'), result=? WHERE uid=? AND status IN ('queued','running')`, string(result), uid)
	return err
}

// Fail شکست قابل بررسی (هرگز نیم‌کاره منتشر نمی‌شود) — لغوشده هم لغوشده می‌ماند.
func (s *Service) Fail(uid, errText string) error {
	_, err := s.db.Exec(`UPDATE jobs SET status='failed', finished_at=datetime('now'), error=? WHERE uid=? AND status IN ('queued','running')`, errText, uid)
	return err
}

func (s *Service) Cancel(uid string) error {
	_, err := s.db.Exec(`UPDATE jobs SET status='cancelled', finished_at=datetime('now') WHERE uid=? AND status IN ('queued','running')`, uid)
	return err
}

func randHex(n int) string {
	const chars = "0123456789abcdef"
	b := make([]byte, n)
	_, _ = cryptoRead(b)
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}
