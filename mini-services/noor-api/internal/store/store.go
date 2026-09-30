// Package store — app.sqlite: حساب/نشست/پژوهش/overlay/release/job/audit (§۳۹).
// فقط Go API نویسنده است. WAL + foreign_keys + busy_timeout روی هر اتصال.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB پوشش اتصال برنامه.
type DB struct {
	*sql.DB
}

// Open برنامه‌دیتابیس را باز و migrations را اجرا می‌کند.
func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(2)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5) // §۳۸ read pool
	db.SetMaxIdleConns(5)
	s := &DB{db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS users(
			uid TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, username_norm TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','reader')),
			totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS sessions(
			uid TEXT PRIMARY KEY, user_uid TEXT NOT NULL REFERENCES users(uid), token_digest TEXT NOT NULL UNIQUE,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT,
			pending_mfa INTEGER NOT NULL DEFAULT 0, revoked_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS invitations(
			code_digest TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','reader')),
			created_by TEXT NOT NULL REFERENCES users(uid), created_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL, used_at TEXT, used_by TEXT)`,
		`CREATE TABLE IF NOT EXISTS projects(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid),
			name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
			version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id, updated_at)`,
		`CREATE TABLE IF NOT EXISTS clips(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid), project_uid TEXT NOT NULL REFERENCES projects(uid),
			kind TEXT NOT NULL CHECK(kind IN ('original','as_read','note')),
			quote_original TEXT NOT NULL, quote_as_read TEXT, prefix_context TEXT, suffix_context TEXT,
			note TEXT, tags TEXT, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1,
			work_uid TEXT, document_uid TEXT, page_uid TEXT, page_label TEXT, section_uid TEXT,
			source_offsets_start INTEGER, source_offsets_end INTEGER, offset_unit TEXT DEFAULT 'codepoint',
			source_version_uid TEXT, release_uid TEXT, overlay_revision_uid TEXT, local_hadith_uid TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE INDEX IF NOT EXISTS idx_clips_owner ON clips(owner_user_id, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_clips_project ON clips(project_uid, deleted_at)`,
		`CREATE TABLE IF NOT EXISTS clip_revisions(
			id INTEGER PRIMARY KEY AUTOINCREMENT, clip_uid TEXT NOT NULL REFERENCES clips(uid),
			owner_user_id TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS notes(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid),
			document_uid TEXT NOT NULL, page_uid TEXT, section_uid TEXT, local_hadith_uid TEXT,
			body TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(owner_user_id, updated_at)`,
		`CREATE TABLE IF NOT EXISTS bookmarks(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid),
			document_uid TEXT NOT NULL, page_uid TEXT NOT NULL, label TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS saved_searches(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid),
			name TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS workspace_states(
			owner_user_id TEXT PRIMARY KEY REFERENCES users(uid),
			prefs TEXT NOT NULL DEFAULT '{}', positions TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS source_registry(
			uid TEXT PRIMARY KEY, source_series_id TEXT, source_document_id TEXT,
			file_path TEXT NOT NULL, size_bytes INTEGER, checksum TEXT, status TEXT NOT NULL DEFAULT 'pending',
			doc_uid TEXT, work_uid TEXT, language TEXT, label TEXT, kind TEXT,
			last_error TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS content_releases(
			uid TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_by TEXT, status TEXT NOT NULL DEFAULT 'building',
			manifest TEXT, notes TEXT)`,
		`CREATE TABLE IF NOT EXISTS overlay_revisions(
			uid TEXT PRIMARY KEY, document_uid TEXT NOT NULL, owner_user TEXT NOT NULL,
			change_type TEXT NOT NULL, target_json TEXT NOT NULL, base_hash TEXT NOT NULL,
			reason TEXT NOT NULL, old_value TEXT, new_value TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft', release_uid TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS mapping_revisions(
			uid TEXT PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS jobs(
			uid TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'queued',
			priority INTEGER NOT NULL DEFAULT 5, progress INTEGER NOT NULL DEFAULT 0, progress_note TEXT,
			claimed_at TEXT, heartbeat_at TEXT, lease_until TEXT, retries INTEGER NOT NULL DEFAULT 0,
			created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
			started_at TEXT, finished_at TEXT, result TEXT, error TEXT)`,
		`CREATE TABLE IF NOT EXISTS outbox(
			id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, payload TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS audit_events(
			id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
			object_type TEXT, object_uid TEXT, detail TEXT, ip TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS export_jobs(
			uid TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(uid),
			project_uid TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
			file_path TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT, error TEXT)`,
		`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
		// کاربر سیستمی برای bootstrap و jobهای سیستمی — غیرفعال، بدون ورود
		`INSERT OR IGNORE INTO users(uid, username, username_norm, display_name, password_hash, role, disabled)
			VALUES('usr-system', 'system', 'system', 'سیستم', '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'admin', 1)`,
	}
	for _, st := range stmts {
		if _, err := s.Exec(st); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	var v int
	_ = s.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&v)
	if v < 1 {
		if _, err := s.Exec(`INSERT INTO schema_migrations(version) VALUES(1)`); err != nil {
			return err
		}
	}
	return nil
}

// KV خواندن کلید.
func (s *DB) KV(k string) (string, bool) {
	var v string
	err := s.QueryRow(`SELECT v FROM kv WHERE k=?`, k).Scan(&v)
	return v, err == nil
}

// SetKV نوشتن کلید.
func (s *DB) SetKV(k, v string) error {
	_, err := s.Exec(`INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v)
	return err
}

// ActiveRelease نسخهٔ فعال محتوا.
func (s *DB) ActiveRelease() (string, error) {
	v, ok := s.KV("active_release")
	if !ok || v == "" {
		return "rel-genesis", nil
	}
	return v, nil
}

// Audit ثبت رویداد حساس (SEC-15).
func (s *DB) Audit(actor, action, objectType, objectUID, detail, ip string) {
	_, _ = s.Exec(`INSERT INTO audit_events(actor,action,object_type,object_uid,detail,ip) VALUES(?,?,?,?,?,?)`,
		actor, action, objectType, objectUID, detail, ip)
}

// Backup پشتیبان سازگار با VACUUM INTO (§۵۴).
func (s *DB) Backup(destPath string) error {
	_, err := s.Exec(`VACUUM INTO ?`, destPath)
	return err
}
