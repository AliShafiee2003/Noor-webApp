// Package auth — هویت، نشست، MFA، دعوت (§۵۰).
package auth

import (
        "crypto/hmac"
        "crypto/rand"
        "crypto/sha1"
	"crypto/sha256"
        "crypto/subtle"
        "database/sql"
        "encoding/base32"
        "encoding/base64"
        "encoding/binary"
        "encoding/hex"
        "errors"
        "fmt"
        "strings"
        "sync"
        "time"

        "golang.org/x/crypto/argon2"

        "noor/internal/store"
)

// ---- رمزها: Argon2id 64MiB, t=3, p=1 (§۵۰) ----

const (
        argonMemory  = 64 * 1024 // KiB
        argonTime    = 3
        argonThreads = 1
        argonKeyLen  = 32
        argonSaltLen = 16
)

var hashLimiter = make(chan struct{}, 2) // حداکثر دو عملیات hash هم‌زمان

// HashPassword رمز هش می‌کند (فرمت PHC).
func HashPassword(password string) (string, error) {
        hashLimiter <- struct{}{}
        defer func() { <-hashLimiter }()
        salt := make([]byte, argonSaltLen)
        if _, err := rand.Read(salt); err != nil {
                return "", err
        }
        key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
        return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
                argonMemory, argonTime, argonThreads,
                base64.RawStdEncoding.EncodeToString(salt),
                base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword بررسی + rehash در صورت تغییر پارامتر.
func VerifyPassword(password, encoded string) (ok bool, needRehash bool, err error) {
        if !strings.HasPrefix(encoded, "$argon2id$") {
                return false, false, errors.New("فرمت رمز نامعتبر است")
        }
        parts := strings.Split(encoded, "$")
        if len(parts) != 6 {
                return false, false, errors.New("فرمت رمز نامعتبر است")
        }
        var m uint32
        var t uint32
        var p uint8
        if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
                return false, false, err
        }
        salt, err := base64.RawStdEncoding.DecodeString(parts[4])
        if err != nil {
                return false, false, err
        }
        want, err := base64.RawStdEncoding.DecodeString(parts[5])
        if err != nil {
                return false, false, err
        }
        hashLimiter <- struct{}{}
        defer func() { <-hashLimiter }()
        got := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(want)))
        if subtle.ConstantTimeCompare(got, want) == 1 {
                return true, m != argonMemory || t != argonTime || p != argonThreads, nil
        }
        return false, false, nil
}

// ---- نشست‌ها: token تصادفی ≥256bit؛ فقط digest در DB ----

type SessionUser struct {
        UID         string `json:"uid"`
        Username    string `json:"username"`
        DisplayName string `json:"display_name"`
        Role        string `json:"role"`
        PendingMFA  bool   `json:"pending_mfa"`
}

type Manager struct {
        db        *store.DB
        maxAge    time.Duration
        idle      time.Duration
        limiter   *RateLimiter
}

func NewManager(db *store.DB, maxAge, idle time.Duration) *Manager {
        return &Manager{db: db, maxAge: maxAge, idle: idle, limiter: NewRateLimiter(5, time.Minute)}
}

// digest256 نگهداری هش نشست؛ token خام هرگز ذخیره نمی‌شود (§۵۰).
func digest256(token string) string {
        sum := sha256.Sum256([]byte(token))
        return hex.EncodeToString(sum[:])
}

// Login ورود با رمز؛ خطای غیرافشاگر؛ محدودسازی تلاش.
func (m *Manager) Login(username, password, ip, ua string) (*SessionUser, string, error) {
        if !m.limiter.Allow("login:"+ip+":"+username) {
                return nil, "", errors.New("تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید")
        }
        norm := normalizeUsername(username)
        var uid, display, role, phash string
        var disabled, totpEnabled bool
        var totpSecret sql.NullString
        err := m.db.QueryRow(`SELECT uid, display_name, role, password_hash, disabled, totp_enabled, totp_secret FROM users WHERE username_norm=?`, norm).
                Scan(&uid, &display, &role, &phash, &disabled, &totpEnabled, &totpSecret)
        if err != nil {
                // پیام یکسان برای نبود حساب و رمز غلط (بدون enumeration)
                return nil, "", errors.New("نام کاربری یا رمز عبور درست نیست")
        }
        if disabled {
                return nil, "", errors.New("این حساب غیرفعال است؛ با مدیریت تماس بگیرید")
        }
        ok, needRehash, verr := VerifyPassword(password, phash)
        if verr != nil || !ok {
                return nil, "", errors.New("نام کاربری یا رمز عبور درست نیست")
        }
        if needRehash {
                if nh, herr := HashPassword(password); herr == nil {
                        _, _ = m.db.Exec(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE uid=?`, nh, uid)
                }
        }
        pending := role == "admin" && totpEnabled
        token := newToken()
        if err := m.createSession(uid, token, pending, ip, ua); err != nil {
                return nil, "", err
        }
        return &SessionUser{UID: uid, Username: username, DisplayName: display, Role: role, PendingMFA: pending}, token, nil
}

func (m *Manager) createSession(userUID, token string, pendingMFA bool, ip, ua string) error {
        now := time.Now()
        _, err := m.db.Exec(`INSERT INTO sessions(uid,user_uid,token_digest,expires_at,idle_expires_at,ip,user_agent,pending_mfa)
                VALUES(?,?,?,?,?,?,?,?)`,
                newUID("ses"), userUID, digest256(token),
                now.Add(m.maxAge).UTC().Format(time.RFC3339),
                now.Add(m.idle).UTC().Format(time.RFC3339),
                ip, ua, boolInt(pendingMFA))
        return err
}

// Validate نشست معتبر را به کاربر نگاشت می‌کند.
func (m *Manager) Validate(token string) (*SessionUser, error) {
        if token == "" {
                return nil, errors.New("unauthenticated")
        }
        var uid, username, display, role string
        var pending, disabled bool
        err := m.db.QueryRow(`SELECT u.uid, u.username, u.display_name, u.role, s.pending_mfa, u.disabled
                FROM sessions s JOIN users u ON u.uid=s.user_uid
                WHERE s.token_digest=? AND s.revoked_at IS NULL
                AND s.expires_at > datetime('now') AND s.idle_expires_at > datetime('now')`,
                digest256(token)).Scan(&uid, &username, &display, &role, &pending, &disabled)
        if err != nil {
                return nil, errors.New("unauthenticated")
        }
        if disabled {
                return nil, errors.New("unauthenticated")
        }
        // تمدید idle
        _, _ = m.db.Exec(`UPDATE sessions SET idle_expires_at=?, last_seen=datetime('now') WHERE token_digest=?`,
                time.Now().Add(m.idle).UTC().Format(time.RFC3339), digest256(token))
        return &SessionUser{UID: uid, Username: username, DisplayName: display, Role: role, PendingMFA: pending}, nil
}

// Revoke لغو نشست.
func (m *Manager) Revoke(sessionUID, byUser string) error {
        if byUser == "" {
                _, err := m.db.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE uid=?`, sessionUID)
                return err
        }
        _, err := m.db.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE uid=? AND user_uid=?`, sessionUID, byUser)
        return err
}

// RevokeToken لغو با token (خروج).
func (m *Manager) RevokeToken(token string) error {
        _, err := m.db.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE token_digest=?`, digest256(token))
        return err
}

// ListSessions فهرست نشست‌های فعال کاربر (شناسهٔ عمومی، بدون token).
func (m *Manager) ListSessions(userUID string) ([]map[string]any, error) {
        rows, err := m.db.Query(`SELECT uid, created_at, last_seen, ip, user_agent FROM sessions
                WHERE user_uid=? AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC`, userUID)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        var out []map[string]any
        for rows.Next() {
                var uid, created, last, ip, uag sql.NullString
                if err := rows.Scan(&uid, &created, &last, &ip, &uag); err != nil {
                        continue
                }
                out = append(out, map[string]any{"uid": uid.String, "created_at": created.String, "last_seen": last.String, "ip": ip.String, "user_agent": uag.String})
        }
        return out, nil
}



// ---- MFA (TOTP RFC 6238، پیاده‌سازی مستقل + تست) ----

func generateTOTPSecret() (string, error) {
        b := make([]byte, 20)
        if _, err := rand.Read(b); err != nil {
                return "", err
        }
        return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// TOTPCode کد ۶ رقمی فعلی برای secret (برای تست).
func TOTPCode(secret string, t time.Time) (string, error) {
        key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
        if err != nil {
                return "", err
        }
        counter := uint64(t.Unix() / 30)
        var buf [8]byte
        binary.BigEndian.PutUint64(buf[:], counter)
        mac := hmac.New(sha1.New, key)
        mac.Write(buf[:])
        sum := mac.Sum(nil)
        off := sum[len(sum)-1] & 0x0f
        code := (binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff) % 1000000
        return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTP بررسی کد با پنجرهٔ ±۱.
func VerifyTOTP(secret, code string) bool {
        now := time.Now()
        for _, d := range []time.Duration{0, -30 * time.Second, 30 * time.Second} {
                want, err := TOTPCode(secret, now.Add(d))
                if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
                        return true
                }
        }
        return false
}

// SetupMFA فعال‌سازی MFA برای ادمین.
func (m *Manager) SetupMFA(userUID string) (secret string, err error) {
        secret, err = generateTOTPSecret()
        if err != nil {
                return "", err
        }
        _, err = m.db.Exec(`UPDATE users SET totp_secret=? WHERE uid=?`, secret, userUID)
        return secret, err
}

func (m *Manager) EnableMFA(userUID, code string) error {
        var secret string
        var role string
        if err := m.db.QueryRow(`SELECT totp_secret, role FROM users WHERE uid=?`, userUID).Scan(&secret, &role); err != nil {
                return err
        }
        if secret == "" {
                return errors.New("ابتدا MFA را تنظیم کنید")
        }
        if !VerifyTOTP(secret, code) {
                return errors.New("کد تأیید نامعتبر است")
        }
        _, err := m.db.Exec(`UPDATE users SET totp_enabled=1 WHERE uid=?`, userUID)
        return err
}

// MFAChallenge تکمیل نشست نیمهٔ ادمین.
func (m *Manager) MFAChallenge(token, code string) (*SessionUser, error) {
        u, err := m.Validate(token)
        if err != nil || !u.PendingMFA {
                return nil, errors.New("نشست در انتظار MFA نیست")
        }
        var secret string
        if err := m.db.QueryRow(`SELECT totp_secret FROM users WHERE uid=?`, u.UID).Scan(&secret); err != nil {
                return nil, err
        }
        if !VerifyTOTP(secret, code) {
                return nil, errors.New("کد تأیید نامعتبر است")
        }
        _, _ = m.db.Exec(`UPDATE sessions SET pending_mfa=0 WHERE token_digest=?`, digest256(token))
        u.PendingMFA = false
        return u, nil
}

// StepUpMFA برای عملیات حساس؛ هدر X-Noor-MFA.
func (m *Manager) StepUpMFA(token, code string) error {
        u, err := m.Validate(token)
        if err != nil {
                return errors.New("unauthenticated")
        }
        if u.Role != "admin" {
                return errors.New("forbidden")
        }
        var secret string
        if err := m.db.QueryRow(`SELECT totp_secret FROM users WHERE uid=?`, u.UID).Scan(&secret); err != nil {
                return err
        }
        if !VerifyTOTP(secret, code) {
                return errors.New("کد تأیید دوم نامعتبر است")
        }
        return nil
}

// ---- دعوت‌ها: کد یک‌بارمصرف، کوتاه‌عمر، hash‌شده ----

func (m *Manager) CreateInvitation(createdBy, role string, ttl time.Duration) (code string, err error) {
        if role != "admin" && role != "reader" {
                return "", errors.New("نقش نامعتبر است")
        }
        code = newToken()[:20]
        _, err = m.db.Exec(`INSERT INTO invitations(code_digest, role, created_by, expires_at) VALUES(?,?,?,?)`,
                digest256(code), role, createdBy, time.Now().Add(ttl).UTC().Format(time.RFC3339))
        return code, err
}

func (m *Manager) AcceptInvitation(code, username, displayName, password string) (*SessionUser, error) {
        if len(password) < 8 {
                return nil, errors.New("رمز عبور باید حداقل ۸ نویسه باشد")
        }
        var role, createdBy string
        err := m.db.QueryRow(`SELECT role, created_by FROM invitations WHERE code_digest=? AND used_at IS NULL AND expires_at > datetime('now')`,
                digest256(code)).Scan(&role, &createdBy)
        if err != nil {
                return nil, errors.New("کد دعوت نامعتبر یا منقضی است")
        }
        norm := normalizeUsername(username)
        var cnt int
        _ = m.db.QueryRow(`SELECT COUNT(*) FROM users WHERE username_norm=?`, norm).Scan(&cnt)
        if cnt > 0 {
                return nil, errors.New("این نام کاربری قبلاً گرفته شده است")
        }
        hash, err := HashPassword(password)
        if err != nil {
                return nil, err
        }
        tx, err := m.db.Begin()
        if err != nil {
                return nil, err
        }
        defer tx.Rollback()
        uid := newUID("usr")
        if _, err := tx.Exec(`INSERT INTO users(uid, username, username_norm, display_name, password_hash, role) VALUES(?,?,?,?,?,?)`,
                uid, username, norm, displayName, hash, role); err != nil {
                return nil, err
        }
        if _, err := tx.Exec(`UPDATE invitations SET used_at=datetime('now'), used_by=? WHERE code_digest=?`, uid, digest256(code)); err != nil {
                return nil, err
        }
        if err := tx.Commit(); err != nil {
                return nil, err
        }
        m.db.Audit(uid, "accept_invitation", "user", uid, "role="+role, "")
        return &SessionUser{UID: uid, Username: username, DisplayName: displayName, Role: role}, nil
}

// BootstrapAdmin اولین ادمین با دعوت یک‌بارمصرف ساخته می‌شود.
func (m *Manager) BootstrapAdmin(username string) (code string, err error) {
        var cnt int
        if err := m.db.QueryRow(`SELECT COUNT(*) FROM users WHERE uid != 'usr-system'`).Scan(&cnt); err != nil {
                return "", err
        }
        if cnt > 0 {
                return "", errors.New("حسابی وجود دارد؛ bootstrap فقط برای نصب خالی است")
        }
        code = newToken()[:20]
        _, err = m.db.Exec(`INSERT INTO invitations(code_digest, role, created_by, expires_at)
                VALUES(?,?,?,datetime('now','+24 hours'))`, digest256(code), "admin", uidSystem)
        return code, err
}

const uidSystem = "usr-system"

// ChangeRole تغییر نقش (step-up؛ محافظت آخرین ادمین).
func (m *Manager) ChangeRole(actor, targetUID, role string) error {
        if role != "admin" && role != "reader" {
                return errors.New("نقش نامعتبر است")
        }
        var curRole string
        var disabled bool
        if err := m.db.QueryRow(`SELECT role, disabled FROM users WHERE uid=?`, targetUID).Scan(&curRole, &disabled); err != nil {
                return errors.New("not_found")
        }
        if curRole == "admin" && role == "reader" {
                var admins int
                _ = m.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&admins)
                if admins <= 1 {
                        return errors.New("آخرین ادمین فعال را نمی‌توان تغییر نقش داد")
                }
        }
        _, err := m.db.Exec(`UPDATE users SET role=?, updated_at=datetime('now') WHERE uid=?`, role, targetUID)
        if err == nil {
                // لغو نشست‌های کاربر پس از تغییر نقش (session rotation)
                _, _ = m.db.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=?`, targetUID)
                m.db.Audit(actor, "change_role", "user", targetUID, "to="+role, "")
        }
        return err
}

func (m *Manager) SetDisabled(actor, targetUID string, disabled bool) error {
        var curRole string
        if err := m.db.QueryRow(`SELECT role FROM users WHERE uid=?`, targetUID).Scan(&curRole); err != nil {
                return errors.New("not_found")
        }
        if !disabled {
                if _, err := m.db.Exec(`UPDATE users SET disabled=0 WHERE uid=?`, targetUID); err != nil {
                        return err
                }
                return nil
        }
        if curRole == "admin" {
                var admins int
                _ = m.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&admins)
                if admins <= 1 {
                        return errors.New("آخرین ادمین فعال را نمی‌توان غیرفعال کرد")
                }
        }
        _, err := m.db.Exec(`UPDATE users SET disabled=1 WHERE uid=?`, targetUID)
        if err == nil {
                _, _ = m.db.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=?`, targetUID)
                m.db.Audit(actor, "disable_user", "user", targetUID, "", "")
        }
        return err
}

// ---- کمکی‌ها ----

func newToken() string {
        b := make([]byte, 32)
        _, _ = rand.Read(b)
        return base64.RawURLEncoding.EncodeToString(b)
}

func newUID(prefix string) string {
        b := make([]byte, 9)
        _, _ = rand.Read(b)
        return prefix + "-" + hex.EncodeToString(b)
}

func normalizeUsername(s string) string {
        return strings.ToLower(strings.TrimSpace(s))
}

func boolInt(b bool) int {
        if b {
                return 1
        }
        return 0
}

// ---- Rate limiter ساده درون‌حافظه‌ای (SEC-09) ----

type RateLimiter struct {
        mu      sync.Mutex
        buckets map[string]*bucket
        max     int
        window  time.Duration
}

type bucket struct {
        count int
        reset time.Time
}

func NewRateLimiter(max int, window time.Duration) *RateLimiter {
        return &RateLimiter{buckets: map[string]*bucket{}, max: max, window: window}
}

func (r *RateLimiter) Allow(key string) bool {
        r.mu.Lock()
        defer r.mu.Unlock()
        b, ok := r.buckets[key]
        now := time.Now()
        if !ok || now.After(b.reset) {
                r.buckets[key] = &bucket{count: 1, reset: now.Add(r.window)}
                if len(r.buckets) > 10000 {
                        r.buckets = map[string]*bucket{}
                }
                return true
        }
        b.count++
        return b.count <= r.max
}

// CreateSessionFor ساخت نشست برای جریان قبول دعوت (پس از ثبت حساب).
func (m *Manager) CreateSessionFor(userUID string) (string, error) {
	token := newToken()
	if err := m.createSession(userUID, token, false, "", ""); err != nil {
		return "", err
	}
	return token, nil
}
