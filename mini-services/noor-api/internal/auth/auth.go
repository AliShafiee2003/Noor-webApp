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

// dummyPasswordHash حسابِ ساختگی برای هم‌ارزی زمانیِ مسیر «کاربر ناموجود» با
// مسیر «رمز غلط» — کارِ Argon2 در هر دو مسیر انجام می‌شود (تایمینگ اوراکل بسته).
const dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

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
	db          *store.DB
	maxAge      time.Duration
	idle        time.Duration
	limiter     *RateLimiter // کلید (ip,username)
	userLimiter *RateLimiter // کلید username — جلوگیری از brute-force توزیع‌شده روی یک حساب
	mfaLimiter  *RateLimiter // تلاش‌های کد TOTP (challenge و step-up)
}

func NewManager(db *store.DB, maxAge, idle time.Duration) *Manager {
	return &Manager{
		db: db, maxAge: maxAge, idle: idle,
		limiter:     NewRateLimiter(5, time.Minute),
		userLimiter: NewRateLimiter(30, time.Minute),
		mfaLimiter:  NewRateLimiter(5, time.Minute),
	}
}

// SetLoginLimiter تنظیم محدودساز تلاش ورود (پیش‌فرض SEC-09: ۵ تلاش در دقیقه).
// راهگاه NOOR_LOGIN_RATE_MAX فقط برای محیط توسعه/E2E بیشتر می‌شود؛ در تولید پیش‌فرض می‌ماند.
func (m *Manager) SetLoginLimiter(max int, window time.Duration) {
	if max > 0 {
		m.limiter = NewRateLimiter(max, window)
	}
}

// ErrRateLimited خطای محدودسازی نرخ ورود — handler آن را به 429 ترجمه می‌کند
// (تفکیک صادقانه از «اعتبارنامهٔ نامعتبر» که 401 است).
var ErrRateLimited = errors.New("تلاش‌های بیش از حد؛ لطفاً کمی بعد دوباره تلاش کنید")

// digest256 نگهداری هش نشست؛ token خام هرگز ذخیره نمی‌شود (§۵۰).
func digest256(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Login ورود با رمز؛ خطای غیرافشاگر؛ محدودسازی تلاش.
func (m *Manager) Login(username, password, ip, ua string) (*SessionUser, string, error) {
	if len(password) > 1024 {
		return nil, "", errors.New("رمز عبور بیش از حد بلند است")
	}
	if u := strings.TrimSpace(username); u == "" || len(u) > 128 {
		return nil, "", errors.New("نام کاربری نامعتبر است")
	}
	if !m.limiter.Allow("login:" + ip + ":" + username) {
		return nil, "", ErrRateLimited
	}
	norm := normalizeUsername(username)
	if !m.userLimiter.Allow("user:" + norm) {
		return nil, "", ErrRateLimited
	}
	var uid, display, role, phash string
	var disabled, totpEnabled bool
	var totpSecret sql.NullString
	err := m.db.QueryRow(`SELECT uid, display_name, role, password_hash, disabled, totp_enabled, totp_secret FROM users WHERE username_norm=?`, norm).
		Scan(&uid, &display, &role, &phash, &disabled, &totpEnabled, &totpSecret)
	if err != nil {
		// پیام یکسان برای نبود حساب و رمز غلط (بدون enumeration) — کارِ هش روی
		// حسابِ ساختگی انجام می‌شود تا زمانِ پاسخ هم قابل تفکیک نباشد.
		_, _, _ = VerifyPassword(password, dummyPasswordHash)
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

// SessionUIDOf شناسهٔ نشستِ فعالِ متناظر با token (برای علامت‌گذاری «نشست فعلی»).
func (m *Manager) SessionUIDOf(token string) string {
	if token == "" {
		return ""
	}
	var uid string
	if err := m.db.QueryRow(`SELECT uid FROM sessions WHERE token_digest=? AND revoked_at IS NULL`, digest256(token)).Scan(&uid); err != nil {
		return ""
	}
	return uid
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

// TOTPCodeAt کد ۶ رقمی برای counter مشخص (RFC 6238) — پایهٔ VerifyTOTP و ضد-replay.
func TOTPCodeAt(secret string, counter int64) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	code := (binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff) % 1000000
	return fmt.Sprintf("%06d", code), nil
}

// VerifyTOTP بررسی کد با پنجرهٔ ±۱ (بدون حالت — برای تست و EnableMFA).
func VerifyTOTP(secret, code string) bool {
	now := time.Now()
	for _, d := range []time.Duration{0, -30 * time.Second, 30 * time.Second} {
		want, err := TOTPCodeAt(secret, now.Add(d).Unix()/30)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// verifyTOTPSteps پنجره‌های مجاز را می‌سنجد و شمارهٔ گام (۳۰ثانیه‌ای) سازگار را برمی‌گرداند.
func verifyTOTPSteps(secret, code string) (int64, bool) {
	now := time.Now()
	for _, d := range []time.Duration{0, -30 * time.Second, 30 * time.Second} {
		counter := now.Add(d).Unix() / 30
		want, err := TOTPCodeAt(secret, counter)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return counter, true
		}
	}
	return 0, false
}

// verifyTOTPFresh بررسی کد با جلوگیری از replay: هر گام ۳۰ثانیه‌ای فقط یک‌بار
// مصرف می‌شود (last_totp_step روی users با به‌روزرسانی خوش‌بینانه برای هم‌زمانی).
func (m *Manager) verifyTOTPFresh(userUID, secret, code string) bool {
	step, ok := verifyTOTPSteps(secret, code)
	if !ok {
		return false
	}
	var last int64
	_ = m.db.QueryRow(`SELECT last_totp_step FROM users WHERE uid=?`, userUID).Scan(&last)
	if step <= last {
		return false // همان کد قبلاً مصرف شده است
	}
	res, err := m.db.Exec(`UPDATE users SET last_totp_step=? WHERE uid=? AND last_totp_step=?`, step, userUID, last)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// SetupMFA فعال‌سازی MFA برای ادمین.
func (m *Manager) SetupMFA(userUID string) (secret string, err error) {
	// بازنویسی رازِ MFA فعال بدون کد فعلی = تصاحب/قفل حساب با یک نشست دزدیده‌شده؛
	// چرخش دستگاه فقط از مسیر DisableMFA (با کد معتبر) یا ResetMFA ادمین دیگر.
	var enabled int
	if err := m.db.QueryRow(`SELECT totp_enabled FROM users WHERE uid=?`, userUID).Scan(&enabled); err != nil {
		return "", err
	}
	if enabled == 1 {
		return "", ErrMFAAlreadyEnabled
	}
	secret, err = generateTOTPSecret()
	if err != nil {
		return "", err
	}
	_, err = m.db.Exec(`UPDATE users SET totp_secret=?, last_totp_step=0 WHERE uid=? AND totp_enabled=0`, secret, userUID)
	return secret, err
}

// ErrMFAAlreadyEnabled راز MFA فعال را نمی‌توان بی‌کد بازنویسی کرد.
var ErrMFAAlreadyEnabled = errors.New("ورود دومرحله‌ای از پیش فعال است؛ برای تعویض دستگاه ابتدا آن را با کد فعلی غیرفعال کنید")

func (m *Manager) EnableMFA(userUID, code string) error {
	if !m.mfaLimiter.Allow("mfa:" + userUID) {
		return errors.New("تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید")
	}
	var secret string
	var role string
	if err := m.db.QueryRow(`SELECT totp_secret, role FROM users WHERE uid=?`, userUID).Scan(&secret, &role); err != nil {
		return err
	}
	if secret == "" {
		return errors.New("ابتدا MFA را تنظیم کنید")
	}
	if !m.verifyTOTPFresh(userUID, secret, code) {
		return errors.New("کد تأیید نامعتبر است")
	}
	_, err := m.db.Exec(`UPDATE users SET totp_enabled=1 WHERE uid=?`, userUID)
	if err == nil {
		m.db.Audit(userUID, "mfa_enable", "user", userUID, "", "")
	}
	return err
}

// DisableMFA غیرفعال‌سازی MFA توسط خود کاربر با کد معتبر و تازه (چرخش دستگاه).
func (m *Manager) DisableMFA(userUID, code string) error {
	if !m.mfaLimiter.Allow("mfa:" + userUID) {
		return errors.New("تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید")
	}
	var secret string
	var enabled int
	if err := m.db.QueryRow(`SELECT totp_secret, totp_enabled FROM users WHERE uid=?`, userUID).Scan(&secret, &enabled); err != nil {
		return err
	}
	if enabled == 0 {
		return errors.New("ورود دومرحله‌ای فعال نیست")
	}
	if !m.verifyTOTPFresh(userUID, secret, code) {
		return errors.New("کد تأیید نامعتبر است")
	}
	if _, err := m.db.Exec(`UPDATE users SET totp_enabled=0, totp_secret='', last_totp_step=0 WHERE uid=?`, userUID); err != nil {
		return err
	}
	m.db.Audit(userUID, "mfa_disable", "user", userUID, "", "")
	return nil
}

// ResetMFA بازیابی حساب ادمینی که دستگاهش را گم کرده — فقط ادمین دیگر (با step-up در
// لایهٔ HTTP)؛ همهٔ نشست‌های هدف باطل می‌شوند تا ورود دوباره و تنظیم تازه لازم شود.
func (m *Manager) ResetMFA(actor, targetUID string) error {
	if actor == targetUID {
		return errors.New("بازنشانی MFA حساب خود ممکن نیست؛ از غیرفعال‌سازی با کد استفاده کنید")
	}
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE users SET totp_enabled=0, totp_secret='', last_totp_step=0, updated_at=datetime('now') WHERE uid=?`, targetUID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errors.New("not_found")
	}
	if _, err := tx.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=? AND revoked_at IS NULL`, targetUID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.db.Audit(actor, "mfa_reset", "user", targetUID, "", "")
	return nil
}

// MFAChallenge تکمیل نشست نیمهٔ ادمین.
func (m *Manager) MFAChallenge(token, code string) (*SessionUser, error) {
	u, err := m.Validate(token)
	if err != nil || !u.PendingMFA {
		return nil, errors.New("نشست در انتظار MFA نیست")
	}
	if !m.mfaLimiter.Allow("mfa:" + u.UID) {
		return nil, errors.New("تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید")
	}
	var secret string
	if err := m.db.QueryRow(`SELECT totp_secret FROM users WHERE uid=?`, u.UID).Scan(&secret); err != nil {
		return nil, err
	}
	if !m.verifyTOTPFresh(u.UID, secret, code) {
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
	if !m.mfaLimiter.Allow("mfa:" + u.UID) {
		return errors.New("تلاش‌های بیش از حد؛ کمی بعد دوباره تلاش کنید")
	}
	var secret string
	if err := m.db.QueryRow(`SELECT totp_secret FROM users WHERE uid=?`, u.UID).Scan(&secret); err != nil {
		return err
	}
	if !m.verifyTOTPFresh(u.UID, secret, code) {
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

// ChangeRole تغییر نقش (step-up؛ محافظت آخرین ادمین). شمارش ادمین‌ها و UPDATE
// در یک تراکنش است تا دو درخواست هم‌زمان نتوانند هر دو از شرط بگذرند (TOCTOU بسته).
func (m *Manager) ChangeRole(actor, targetUID, role string) error {
	if role != "admin" && role != "reader" {
		return errors.New("نقش نامعتبر است")
	}
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var curRole string
	if err := tx.QueryRow(`SELECT role FROM users WHERE uid=?`, targetUID).Scan(&curRole); err != nil {
		return errors.New("not_found")
	}
	if curRole == "admin" && role == "reader" {
		var admins int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 {
			return errors.New("آخرین ادمین فعال را نمی‌توان تغییر نقش داد")
		}
	}
	if _, err := tx.Exec(`UPDATE users SET role=?, updated_at=datetime('now') WHERE uid=?`, role, targetUID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=?`, targetUID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.db.Audit(actor, "change_role", "user", targetUID, "to="+role, "")
	return nil
}

// SetDisabled غیرفعال/فعال‌سازی حساب — شمارش ادمین‌ها و UPDATE در یک تراکنش.
func (m *Manager) SetDisabled(actor, targetUID string, disabled bool) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var curRole string
	if err := tx.QueryRow(`SELECT role FROM users WHERE uid=?`, targetUID).Scan(&curRole); err != nil {
		return errors.New("not_found")
	}
	if _, err := tx.Exec(`UPDATE users SET disabled=? WHERE uid=?`, boolInt(disabled), targetUID); err != nil {
		return err
	}
	if disabled && curRole == "admin" {
		var admins int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 {
			return errors.New("آخرین ادمین فعال را نمی‌توان غیرفعال کرد")
		}
	}
	if disabled {
		if _, err := tx.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=?`, targetUID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	m.db.Audit(actor, "disable_user", "user", targetUID, "", "")
	return nil
}

// ChangePassword تغییر رمز عبور توسط کاربر دارای نشست فعال.
func (m *Manager) ChangePassword(userUID, currentPassword, newPassword string) error {
	if len(newPassword) < 8 {
		return errors.New("رمز عبور جدید باید حداقل ۸ نویسه باشد")
	}
	if len(newPassword) > 1024 {
		return errors.New("رمز عبور جدید بیش از حد بلند است")
	}
	var phash string
	var disabled bool
	err := m.db.QueryRow(`SELECT password_hash, disabled FROM users WHERE uid=?`, userUID).Scan(&phash, &disabled)
	if err != nil {
		return errors.New("کاربر یافت نشد")
	}
	if disabled {
		return errors.New("این حساب غیرفعال است")
	}
	ok, _, verr := VerifyPassword(currentPassword, phash)
	if verr != nil || !ok {
		return errors.New("رمز عبور فعلی درست نیست")
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	_, err = m.db.Exec(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE uid=?`, newHash, userUID)
	if err == nil {
		m.db.Audit(userUID, "change_password", "user", userUID, "", "")
	}
	return err
}

// ---- کمکی‌ها ----

func newToken() string {
	b := make([]byte, 32)
	mustRand(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func newUID(prefix string) string {
	b := make([]byte, 9)
	mustRand(b)
	return prefix + "-" + hex.EncodeToString(b)
}

// mustRand شکست crypto/rand یعنی توکن قابل‌پیش‌بینی (همه‌صفر)؛ ادامه دادن ناامن است.
func mustRand(b []byte) {
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
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
		if len(r.buckets) >= rateLimiterMaxKeys {
			// فقط سطل‌های منقضی حذف می‌شوند؛ پاک‌کردن کل نقشه (رفتار قبلی) به مهاجم اجازه
			// می‌داد با ۱۰هزار کلید جعلی، شمارندهٔ حساب هدف را صفر کند.
			for k, v := range r.buckets {
				if now.After(v.reset) {
					delete(r.buckets, k)
				}
			}
			if len(r.buckets) >= rateLimiterMaxKeys {
				return false // اشباع: محافظه‌کارانه رد (fail-closed)
			}
		}
		r.buckets[key] = &bucket{count: 1, reset: now.Add(r.window)}
		return true
	}
	b.count++
	return b.count <= r.max
}

const rateLimiterMaxKeys = 50000

// CreateSessionFor ساخت نشست برای جریان قبول دعوت (پس از ثبت حساب).
func (m *Manager) CreateSessionFor(userUID string) (string, error) {
	token := newToken()
	if err := m.createSession(userUID, token, false, "", ""); err != nil {
		return "", err
	}
	return token, nil
}
