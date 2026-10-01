// pwreset — بازنشانی رمز کاربر توسط اپراتور (مسیر «کمک ادمین با ثبت audit» طبق §۵۰ PRD).
// استفاده:
//
//	./bin/pwreset -username admin                # رمز تصادفی می‌سازد و چاپ می‌کند
//	PWRESET_PASS='...' ./bin/pwreset -username u # رمز دلخواه (حداقل ۸ نویسه) از محیط
//
// همهٔ نشست‌های فعال همان کاربر باطل می‌شود (revoked_at) و رویداد در audit ثبت می‌گردد.
package main

import (
	"crypto/rand"
	"flag"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	"noor/internal/auth"
	"noor/internal/config"
	"noor/internal/store"
)

// الفبای بدون نویسه‌های گمراه‌کننده (بدون 0/O/1/l/I)
const pwAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"

func genPassword() (string, error) {
	groups := make([]string, 3)
	for g := range groups {
		b := make([]byte, 5)
		for i := range b {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(pwAlphabet))))
			if err != nil {
				return "", err
			}
			b[i] = pwAlphabet[n.Int64()]
		}
		groups[g] = string(b)
	}
	return strings.Join(groups, "-"), nil
}

func main() {
	cfg := config.FromEnv()
	username := flag.String("username", "", "نام کاربری هدف")
	flag.Parse()
	if *username == "" {
		fmt.Fprintln(os.Stderr, "استفاده: pwreset -username <نام کاربری>")
		os.Exit(1)
	}
	db, err := store.Open(cfg.DataDir + "/app.sqlite")
	if err != nil {
		fmt.Fprintln(os.Stderr, "خطا:", err)
		os.Exit(1)
	}

	norm := strings.ToLower(strings.TrimSpace(*username))
	var uid, role string
	err = db.QueryRow(`SELECT uid, role FROM users WHERE username_norm=? AND uid != 'usr-system'`, norm).
		Scan(&uid, &role)
	if err != nil {
		fmt.Fprintln(os.Stderr, "کاربر یافت نشد:", *username)
		os.Exit(1)
	}

	pass := os.Getenv("PWRESET_PASS")
	if pass == "" {
		pass, err = genPassword()
		exitIf(err)
	}
	if len(pass) < 8 {
		fmt.Fprintln(os.Stderr, "رمز عبور باید حداقل ۸ نویسه باشد")
		os.Exit(1)
	}
	hash, err := auth.HashPassword(pass)
	exitIf(err)

	// به‌روزرسانی رمز + باطل‌کردن همهٔ نشست‌های فعال کاربر، در یک تراکنش
	tx, err := db.Begin()
	exitIf(err)
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE uid=?`, hash, uid); err != nil {
		exitIf(err)
	}
	if _, err := tx.Exec(`UPDATE sessions SET revoked_at=datetime('now') WHERE user_uid=? AND revoked_at IS NULL`, uid); err != nil {
		exitIf(err)
	}
	exitIf(tx.Commit())

	db.Audit("operator", "admin_password_reset", "user", uid, "role="+role, "")
	fmt.Println("کاربر:", *username, "| نقش:", role)
	fmt.Println("رمز تازه:", pass)
	fmt.Println("همهٔ نشست‌های قبلی این کاربر باطل شد. (زمان:", time.Now().Format(time.RFC3339), ")")
}

func exitIf(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "خطا:", err)
		os.Exit(1)
	}
}
