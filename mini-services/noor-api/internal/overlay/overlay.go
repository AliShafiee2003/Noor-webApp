// Package overlay — اصلاحات ادمین نسخه‌دار (§۴۹): منبع immutable است؛
// چرخهٔ draft←validated←ready←published←superseded؛ انتشار اتمیک با pointer + outbox + audit؛ rollback به نسل سالم.
package overlay

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"noor/internal/store"
)

type Service struct{ db *store.DB }

func New(db *store.DB) *Service { return &Service{db: db} }

// Revision یک اصلاح.
type Revision struct {
	UID         string          `json:"uid"`
	DocumentUID string          `json:"document_uid"`
	Owner       string          `json:"owner"`
	ChangeType  string          `json:"change_type"` // text_replace|metadata
	Target      json.RawMessage `json:"target"`
	BaseHash    string          `json:"base_hash"`
	Reason      string          `json:"reason"`
	OldValue    string          `json:"old_value"`
	NewValue    string          `json:"new_value"`
	Status      string          `json:"status"`
	ReleaseUID  string          `json:"release_uid,omitempty"`
	CreatedAt   string          `json:"created_at"`
}

var validStates = map[string]bool{"draft": true, "validated": true, "building": true, "ready": true, "published": true, "superseded": true, "failed": true}

// Create پیش‌نویس؛ hash مبنا الزامی (تعارض هم‌پوشانی).
func (s *Service) Create(documentUID, owner, changeType, reason, baseHash, oldValue, newValue string, target json.RawMessage) (*Revision, error) {
	if changeType != "text_replace" && changeType != "metadata" {
		return nil, errors.New("نوع تغییر نامعتبر است")
	}
	if baseHash == "" {
		return nil, errors.New("hash متن مبنا الزامی است")
	}
	if newValue == "" && changeType == "text_replace" {
		return nil, errors.New("متن جدید خالی است")
	}
	uid := uidOf("ovl")
	_, err := s.db.Exec(`INSERT INTO overlay_revisions(uid, document_uid, owner_user, change_type, target_json, base_hash, reason, old_value, new_value, status)
		VALUES(?,?,?,?,?,?,?,?,?, 'draft')`, uid, documentUID, owner, changeType, orNullJSON(target), baseHash, reason, oldValue, newValue)
	if err != nil {
		return nil, err
	}
	s.db.Audit(owner, "overlay_draft", "overlay", uid, "doc="+documentUID, "")
	return s.Get(uid)
}

func (s *Service) Get(uid string) (*Revision, error) {
	var r Revision
	var target, release sql.NullString
	err := s.db.QueryRow(`SELECT uid, document_uid, owner_user, change_type, target_json, base_hash, reason, old_value, new_value, status, release_uid, created_at
		FROM overlay_revisions WHERE uid=?`, uid).
		Scan(&r.UID, &r.DocumentUID, &r.Owner, &r.ChangeType, &target, &r.BaseHash, &r.Reason, &r.OldValue, &r.NewValue, &r.Status, &release, &r.CreatedAt)
	if err != nil {
		return nil, errors.New("اصلاح یافت نشد")
	}
	r.Target = orNullJSON(json.RawMessage(target.String))
	r.ReleaseUID = release.String
	return &r, nil
}

func (s *Service) List(status string) ([]Revision, error) {
	q := `SELECT uid, document_uid, owner_user, change_type, target_json, base_hash, reason, old_value, new_value, status, release_uid, created_at FROM overlay_revisions`
	var rows *sql.Rows
	var err error
	if status != "" {
		rows, err = s.db.Query(q+` WHERE status=? ORDER BY created_at DESC LIMIT 100`, status)
	} else {
		rows, err = s.db.Query(q + ` ORDER BY created_at DESC LIMIT 100`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Revision
	for rows.Next() {
		var r Revision
		var target, release sql.NullString
		if err := rows.Scan(&r.UID, &r.DocumentUID, &r.Owner, &r.ChangeType, &target, &r.BaseHash, &r.Reason, &r.OldValue, &r.NewValue, &r.Status, &release, &r.CreatedAt); err != nil {
			continue
		}
		r.Target = orNullJSON(json.RawMessage(target.String))
		r.ReleaseUID = release.String
		out = append(out, r)
	}
	return out, nil
}

// Validate اعتبارسنجی پیش از ساخت: hash مبنا، offsets، نوع.
func (s *Service) Validate(uid string, currentTextHash string) (*Revision, error) {
	r, err := s.Get(uid)
	if err != nil {
		return nil, err
	}
	if r.Status != "draft" {
		return nil, errors.New("فقط پیش‌نویس قابل اعتبارسنجی است")
	}
	if r.BaseHash != currentTextHash {
		return nil, errors.New("متن مبنا از زمان پیش‌نویس تغییر کرده است؛ پیش‌نویس جدید بسازید")
	}
	_, err = s.db.Exec(`UPDATE overlay_revisions SET status='validated', updated_at=datetime('now') WHERE uid=?`, uid)
	if err != nil {
		return nil, err
	}
	return s.Get(uid)
}

func (s *Service) SetStatus(uid, status, releaseUID string) error {
	if !validStates[status] {
		return errors.New("وضعیت نامعتبر است")
	}
	_, err := s.db.Exec(`UPDATE overlay_revisions SET status=?, release_uid=?, updated_at=datetime('now') WHERE uid=?`, status, releaseUID, uid)
	return err
}

// PublishRelease چرخهٔ انتشار نسل (§۴۹): نسل جدید immutable → pointer اتمیک + outbox + audit.
func (s *Service) PublishRelease(actor, notes string, manifest json.RawMessage) (releaseUID string, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	releaseUID = uidOf("rel")
	if _, err := tx.Exec(`INSERT INTO content_releases(uid, created_by, status, manifest, notes) VALUES(?,?,?,?,?)`,
		releaseUID, actor, "published", string(manifest), notes); err != nil {
		return "", err
	}
	if _, err := tx.Exec(`INSERT INTO kv(k,v) VALUES('active_release',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, releaseUID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(`INSERT INTO outbox(topic, payload) VALUES('release_published', ?)`, releaseUID); err != nil {
		return "", err
	}
	// overlayهای در وضعیت ready → published و اتصال به نسل
	if _, err := tx.Exec(`UPDATE overlay_revisions SET status='published', release_uid=? WHERE status IN ('ready','validated')`, releaseUID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	s.db.Audit(actor, "release_publish", "release", releaseUID, notes, "")
	return releaseUID, nil
}

// Rollback بازگشت pointer به نسل سالم حفظ‌شده (فیش‌های کاربران تغییر نمی‌کنند).
func (s *Service) Rollback(actor, toReleaseUID string) error {
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM content_releases WHERE uid=? AND status='published'`, toReleaseUID).Scan(&cnt); err != nil || cnt == 0 {
		return errors.New("نسل مقصد معتبر و منتشرشده نیست")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO kv(k,v) VALUES('active_release',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, toReleaseUID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO outbox(topic, payload) VALUES('release_rolled_back', ?)`, toReleaseUID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.db.Audit(actor, "release_rollback", "release", toReleaseUID, "", "")
	return nil
}

// Releases فهرست نسل‌ها.
func (s *Service) Releases() ([]map[string]any, error) {
	rows, err := s.db.Query(`SELECT uid, created_by, status, notes, created_at FROM content_releases ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var uid, by, status, notes, at sql.NullString
		if err := rows.Scan(&uid, &by, &status, &notes, &at); err != nil {
			continue
		}
		out = append(out, map[string]any{"uid": uid.String, "created_by": by.String, "status": status.String, "notes": notes.String, "created_at": at.String})
	}
	return out, nil
}

// orNullJSON RawMessage خالی → «null» (JSON معتبر) تا Marshal پاسخ هرگز خالی نشود.
func orNullJSON(raw json.RawMessage) json.RawMessage {
        if len(raw) == 0 || string(raw) == "" {
                return json.RawMessage("null")
        }
        return raw
}

// TextHashFor hash متن بلوک هدف (برای validate) — از محتوا محاسبه می‌شود.
func TextHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return "sha256:" + hex.EncodeToString(sum[:12])
}

func uidOf(prefix string) string {
	b := make([]byte, 6)
	_, _ = randRead(b)
	return prefix + "-" + hex.EncodeToString(b)
}

var _ = time.Now
