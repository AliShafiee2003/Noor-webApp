// Package store — app.sqlite: حساب/نشست/پژوهش/overlay/release/job/audit (§۳۹).
// فقط Go API نویسنده است. WAL + foreign_keys + busy_timeout روی هر اتصال.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

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
                        totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, last_totp_step INTEGER NOT NULL DEFAULT 0,
                        disabled INTEGER NOT NULL DEFAULT 0,
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
		// نشست جست‌وجو (§۴۷): فقط درخواست + release — نتایج هرگز ذخیره نمی‌شود؛
		// ادامهٔ صفحه‌بندی با re-execute قطعی همان پرس‌وجو انجام می‌شود (ب-۶).
		`CREATE TABLE IF NOT EXISTS search_sessions(
                        uid TEXT PRIMARY KEY, release_uid TEXT NOT NULL, request TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')), expire_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_search_sessions_exp ON search_sessions(expire_at)`,
		// ---- دادهٔ خصوصی کاربر (§۷-الف) — ج-۷: مالکیت داده از Prisma/Next BFF به Go منتقل شد ----
		// همهٔ تاریخ‌ها UTC RFC3339 با مقداردهی از Go در INSERT (فرمت یکنواخت، بدون datetime('now')).
		// هایلایت شخصی — لنگر پایدار: شناسهٔ بلوک + بازهٔ code point
		`CREATE TABLE IF NOT EXISTS highlights(
                        uid TEXT PRIMARY KEY, user_uid TEXT NOT NULL, document_uid TEXT NOT NULL,
                        page_uid TEXT NOT NULL, block_id TEXT NOT NULL,
                        start_cp INTEGER NOT NULL, end_cp INTEGER NOT NULL,
                        text TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'yellow', note TEXT, group_uid TEXT,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_highlights_owner ON highlights(user_uid, document_uid, created_at)`,
		// اشتراک صریح و لغوشدنی — مقصد snapshot تا لغو واقعاً دسترسی را قطع کند
		`CREATE TABLE IF NOT EXISTS share_links(
                        uid TEXT PRIMARY KEY, user_uid TEXT NOT NULL,
                        kind TEXT NOT NULL CHECK(kind IN ('note','highlight')),
                        item_id TEXT NOT NULL, document_uid TEXT NOT NULL,
                        page_uid TEXT, page_label TEXT, work_title TEXT,
                        payload TEXT NOT NULL, meta TEXT,
                        revoked INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_share_links_owner ON share_links(user_uid, revoked, created_at)`,
		// کار تولید PDF — رکورد فقط در Go؛ فایل خروجی سمت runner (Next) روی دیسک می‌ماند.
		// title = document_label (برچسب نمایشی جلد). work_title و finished_at برای
		// پاریتی کامل قرارداد JSON PdfJob اضافه شدند (انحراف مستند در گزارش ج-۷).
		`CREATE TABLE IF NOT EXISTS pdf_jobs(
                        uid TEXT PRIMARY KEY, user_uid TEXT NOT NULL, work_uid TEXT, document_uid TEXT NOT NULL,
                        title TEXT NOT NULL DEFAULT '', work_title TEXT,
                        page_from TEXT, page_to TEXT, include_notes INTEGER NOT NULL DEFAULT 0,
                        overlay_note TEXT, status TEXT NOT NULL DEFAULT 'queued',
                        progress INTEGER NOT NULL DEFAULT 0, status_note TEXT,
                        download_token TEXT, token_expires_at TEXT, file_size INTEGER,
                        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`,
		`CREATE INDEX IF NOT EXISTS idx_pdf_jobs_owner ON pdf_jobs(user_uid, created_at)`,
		// کاربر سیستمی برای bootstrap و jobهای سیستمی — غیرفعال، بدون ورود
		`INSERT OR IGNORE INTO users(uid, username, username_norm, display_name, password_hash, role, disabled)
                        VALUES('usr-system', 'system', 'system', 'سیستم', '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'admin', 1)`,
		// وضعیت انتشار و دسترس‌پذیری کتب (§۱۰) — کنترل توسط مدیر سامانه
		`CREATE TABLE IF NOT EXISTS work_publications(
                        work_uid TEXT PRIMARY KEY,
                        published INTEGER NOT NULL DEFAULT 1,
                        updated_by TEXT,
                        updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
	}
	/* DB-04: مهاجرت باید اتمیک و serialized باشد — api و worker هم‌زمان boot
	   می‌شوند و هر دو روی همان app.sqlite مهاجرت می‌کنند. BEGIN IMMEDIATE روی
	   یک اتصال اختصاصی (sql.Conn) قفل نوشتن را از ابتدا می‌گیرد؛ مهاجرت دوم
	   (سرویس دیگر) با busy_timeout صف می‌شود نه crash روی INSERT نسخه، و
	   نمای نیم‌ساخته هرگز دیده نمی‌شود. INSERT OR IGNORE هم دوباردرج نسخه
	   را بی‌اثر می‌کند. */
	ctx := context.Background()
	conn, err := s.Conn(ctx)
	if err != nil {
		return fmt.Errorf("migrate: conn: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("migrate: begin: %w", err)
	}
	// اگر مسیر خطا برگردد (یا COMMIT شده باشد) این عقب‌نشینی بی‌ضرر است.
	defer func() { _, _ = conn.ExecContext(ctx, `ROLLBACK`) }()
	for _, st := range stmts {
		if _, err := conn.ExecContext(ctx, st); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	// مهاجرت افزایشی ستون‌ها (idempotent): برای پایگاه‌های موجود که CREATE TABLE
	// دیگر رویشان اجرا نمی‌شود.
	if err := ensureColumn(conn, "users", "last_totp_step", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("migrate: ensureColumn: %w", err)
	}
	if err := ensureColumn(conn, "highlights", "group_uid", "TEXT"); err != nil {
		return fmt.Errorf("migrate: ensureColumn: %w", err)
	}
	var v int
	_ = conn.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&v)
	if v < 1 {
		if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO schema_migrations(version) VALUES(1)`); err != nil {
			return fmt.Errorf("migrate: version: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("migrate: commit: %w", err)
	}
	return nil
}

// ensureColumn اگر ستون در جدول نبود آن را اضافه می‌کند (SQLite، idempotent).
func ensureColumn(conn *sql.Conn, table, column, def string) error {
	rows, err := conn.QueryContext(context.Background(), fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return err
		}
		if strings.EqualFold(name, column) {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = conn.ExecContext(context.Background(), fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, def))
	return err
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
	if _, err := s.Exec(`INSERT INTO audit_events(actor,action,object_type,object_uid,detail,ip) VALUES(?,?,?,?,?,?)`,
		actor, action, objectType, objectUID, detail, ip); err != nil {
		// حسابرسی نباید بی‌صدا گم شود؛ ثبت در لاگ سرویس انجام می‌شود.
		log.Printf("noor-audit: write failed: action=%s actor=%s err=%v", action, actor, err)
	}
}

// ---- نشست جست‌وجو (پیاده‌سازی search.SessionStore روی app.sqlite) ----

// SaveSearchSession ذخیره/تمدید نشست با TTL؛ ردیف‌های منقضی به‌صورت تنبل پاک می‌شوند.
func (s *DB) SaveSearchSession(uid, releaseUID string, reqJSON []byte, ttl time.Duration) error {
	_, _ = s.Exec(`DELETE FROM search_sessions WHERE expire_at < datetime('now')`)
	_, err := s.Exec(`INSERT INTO search_sessions(uid, release_uid, request, expire_at)
                VALUES(?,?,?, datetime('now', ?))
                ON CONFLICT(uid) DO UPDATE SET release_uid=excluded.release_uid, request=excluded.request, expire_at=excluded.expire_at`,
		uid, releaseUID, string(reqJSON), fmt.Sprintf("+%d seconds", int(ttl.Seconds())))
	return err
}

// LoadSearchSession اگر نشست نبود یا منقضی بود → search.ErrSearchSessionGone معادل.
// برای پرهیز از وابستگی store→search، خطای استاندارد sql.ErrNoRows برمی‌گردد؛
// لایهٔ موتور هر خطای غیر صفر را Gone تفسیر می‌کند.
func (s *DB) LoadSearchSession(uid string) (string, []byte, error) {
	var release, req string
	err := s.QueryRow(`SELECT release_uid, request FROM search_sessions WHERE uid=? AND expire_at >= datetime('now')`, uid).Scan(&release, &req)
	if err != nil {
		return "", nil, err
	}
	return release, []byte(req), nil
}

// TouchSearchSession تمدید TTL نشست (ادامهٔ موفق صفحه‌بندی نشست را زنده نگه می‌دارد).
func (s *DB) TouchSearchSession(uid string, ttl time.Duration) error {
	_, err := s.Exec(`UPDATE search_sessions SET expire_at=datetime('now', ?) WHERE uid=?`,
		fmt.Sprintf("+%d seconds", int(ttl.Seconds())), uid)
	return err
}

// IsWorkPublished وضعیت انتشار یک اثر (پیش‌فرض: true).
func (s *DB) IsWorkPublished(workUID string) bool {
	var pub int
	err := s.QueryRow(`SELECT published FROM work_publications WHERE work_uid=?`, workUID).Scan(&pub)
	if err != nil {
		return true
	}
	return pub == 1
}

// SetWorkPublished تغییر وضعیت انتشار اثر توسط مدیر سامانه.
func (s *DB) SetWorkPublished(workUID string, published bool, updatedBy string) error {
	pubInt := 0
	if published {
		pubInt = 1
	}
	_, err := s.Exec(`INSERT INTO work_publications(work_uid, published, updated_by, updated_at)
                VALUES(?,?,?, datetime('now'))
                ON CONFLICT(work_uid) DO UPDATE SET published=excluded.published, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
		workUID, pubInt, updatedBy)
	return err
}

// UnpublishedWorkUIDs مجموعهٔ شناسه‌های آثار از دسترس خارج شده.
func (s *DB) UnpublishedWorkUIDs() (map[string]bool, error) {
	rows, err := s.Query(`SELECT work_uid FROM work_publications WHERE published=0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err == nil {
			out[uid] = true
		}
	}
	return out, nil
}

// Backup پشتیبان سازگار با VACUUM INTO (§۵۴).
func (s *DB) Backup(destPath string) error {
	_, err := s.Exec(`VACUUM INTO ?`, destPath)
	return err
}
