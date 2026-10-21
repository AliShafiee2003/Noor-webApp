package auth

import (
	"path/filepath"
	"testing"
	"time"

	"noor/internal/store"
)

func mfaTestManager(t *testing.T) (*Manager, *store.DB) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, u := range []string{"usr-a", "usr-b"} {
		if _, err := db.Exec(`INSERT INTO users(uid, username, username_norm, display_name, password_hash, role)
			VALUES(?, ?, ?, 'x', 'x', 'admin')`, u, u, u); err != nil {
			t.Fatal(err)
		}
	}
	return NewManager(db, time.Hour, time.Hour), db
}

func TestMFALifecycle(t *testing.T) {
	m, db := mfaTestManager(t)
	secret, err := m.SetupMFA("usr-a")
	if err != nil {
		t.Fatal(err)
	}
	code, _ := TOTPCode(secret, time.Now())
	if err := m.EnableMFA("usr-a", code); err != nil {
		t.Fatalf("EnableMFA: %v", err)
	}
	// رازِ فعال بی‌کد بازنویسی نمی‌شود
	if _, err := m.SetupMFA("usr-a"); err != ErrMFAAlreadyEnabled {
		t.Fatalf("SetupMFA روی MFA فعال باید رد شود: %v", err)
	}
	// همان کد دوباره (replay) پذیرفته نمی‌شود
	if err := m.DisableMFA("usr-a", code); err == nil {
		t.Fatal("کد مصرف‌شده نباید دوباره پذیرفته شود")
	}
	// ادمین نمی‌تواند MFA خودش را بی‌کد بازنشانی کند؛ ادمین دیگر می‌تواند
	if err := m.ResetMFA("usr-a", "usr-a"); err == nil {
		t.Fatal("بازنشانی MFA خود باید رد شود")
	}
	if err := m.ResetMFA("usr-b", "usr-a"); err != nil {
		t.Fatalf("ResetMFA: %v", err)
	}
	var enabled int
	_ = db.QueryRow(`SELECT totp_enabled FROM users WHERE uid='usr-a'`).Scan(&enabled)
	if enabled != 0 {
		t.Fatal("پس از ResetMFA باید MFA خاموش باشد")
	}
}

func TestRateLimiterSaturationDoesNotReset(t *testing.T) {
	r := NewRateLimiter(2, time.Minute)
	r.Allow("victim")
	r.Allow("victim")
	if r.Allow("victim") {
		t.Fatal("سومین تلاش باید رد شود")
	}
	for i := 0; i < rateLimiterMaxKeys+10; i++ {
		r.Allow("k" + string(rune('a'+i%26)) + time.Duration(i).String())
	}
	if r.Allow("victim") {
		t.Fatal("سیل کلیدهای جعلی نباید شمارندهٔ حساب هدف را صفر کند")
	}
}
