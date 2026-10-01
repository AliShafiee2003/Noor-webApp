package auth

// login_test.go — جایگزین TestLoginDebug قدیمی (GO-09): آزمون قبلی به
// app.sqlite شخصی و مسیر هاردکد /home/z/my-project وابسته بود و روی هشِ خالی
// panic می‌داد (ph[:50]). اینجا روی DB موقتِ همین آزمون، جریان واقعی ورود
// با گزارهٔ معنادار آزموده می‌شود؛ هیچ DB بیرونی لمس نمی‌شود.

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noor/internal/store"
)

func TestLoginFlow(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	hash, err := HashPassword("correct-horse-1234")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO users(uid, username, username_norm, display_name, password_hash, role)
		VALUES('usr-test', 'tester', 'tester', 'آزمونگر', ?, 'reader')`, hash); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	m := NewManager(db, 7*24*time.Hour, 24*time.Hour)

	// ورود درست: نشست معتبر با token با طول کافی (≥۲۵۶ بیت آنتروپی)
	u, tok, err := m.Login("Tester", "correct-horse-1234", "1.2.3.4", "go-test")
	if err != nil {
		t.Fatalf("Login با رمز درست نباید خطا بدهد: %v", err)
	}
	if tok == "" || len(tok) < 32 {
		t.Fatalf("token نشست باید ≥۳۲ نویسه باشد؛ got %d", len(tok))
	}
	if u == nil || u.Role != "reader" || u.Username != "Tester" || u.PendingMFA {
		t.Fatalf("کاربر نشست نادرست است: %+v", u)
	}
	if v, verr := m.Validate(tok); verr != nil || v.UID != u.UID {
		t.Fatalf("نشستِ تازه باید Validate شود: v=%+v err=%v", v, verr)
	}

	// ورود غلط: خطای غیرافشاگر (یکسان برای حساب غایب و رمز غلط)
	if _, _, err := m.Login("Tester", "wrong-password", "1.2.3.4", "go-test"); err == nil {
		t.Fatal("رمز غلط باید خطا بدهد")
	} else if strings.Contains(strings.ToLower(err.Error()), "رمز") && !strings.Contains(err.Error(), "نام کاربری یا رمز عبور درست نیست") {
		t.Fatalf("خطا نباید جزئیات افشا کند: %v", err)
	}

	// حساب غایب: همان پیام غیرافشاگر
	_, _, err = m.Login("no-such-user", "whatever-123", "1.2.3.4", "go-test")
	if err == nil || err.Error() != "نام کاربری یا رمز عبور درست نیست" {
		t.Fatalf("پیام نبودن حساب باید غیرافشاگر باشد: %v", err)
	}
}
