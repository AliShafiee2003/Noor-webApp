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
	if kind == "index_rebuild" {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE kind='index_rebuild' AND status IN ('queued','running')`).Scan(&n); err == nil && n > 0 {
			return nil, errors.New("یک کار ساخت نمایه فعال وجود دارد؛ تا پایان آن صبر کنید")
		}
	}
	uid := "job-" + randHex(8)
	_, err := s.db.Exec(`INSERT INTO jobs(uid, kind, payload, created_by) VALUES(?,?,?,?)`, uid, kind, string(payload), createdBy)
	if err != nil {
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

// Claim claim اتمیک از صف.
func (s *Service) Claim(worker string) (*Job, error) {
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
	if _, err := tx.Exec(`UPDATE jobs SET status='running', claimed_at=?, heartbeat_at=?, lease_until=? WHERE uid=?`, now, now, lease, uid); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.Get(uid)
}

// Heartbeat تمدید lease.
func (s *Service) Heartbeat(uid string, progress int, note string) error {
	lease := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`UPDATE jobs SET heartbeat_at=datetime('now'), lease_until=?, progress=?, progress_note=? WHERE uid=? AND status='running'`, lease, progress, note, uid)
	return err
}

// Complete پایان موفق.
func (s *Service) Complete(uid string, result json.RawMessage) error {
	_, err := s.db.Exec(`UPDATE jobs SET status='done', progress=100, finished_at=datetime('now'), result=? WHERE uid=?`, string(result), uid)
	return err
}

// Fail شکست قابل بررسی (هرگز نیم‌کاره منتشر نمی‌شود).
func (s *Service) Fail(uid, errText string) error {
	_, err := s.db.Exec(`UPDATE jobs SET status='failed', finished_at=datetime('now'), error=? WHERE uid=?`, errText, uid)
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
