// adminctl — ابزار عملیات: bootstrap ادمین، دعوت، backup، پاکسازی.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"noor/internal/auth"
	"noor/internal/config"
	"noor/internal/store"
)

func main() {
	cfg := config.FromEnv()
	cmd := flag.String("cmd", "", "bootstrap-admin | invite | backup")
	role := flag.String("role", "reader", "نقش دعوت")
	username := flag.String("username", "", "نام کاربری")
	by := flag.String("by", "", "ایجادکنندهٔ دعوت (uid ادمین؛ پیش‌فرض: اولین ادمین فعال)")
	out := flag.String("out", "./data/backups/app-backup.sqlite", "مسیر backup")
	flag.Parse()
	db, err := store.Open(cfg.DataDir + "/app.sqlite")
	if err != nil {
		fmt.Fprintln(os.Stderr, "خطا:", err)
		os.Exit(1)
	}
	am := auth.NewManager(db, cfg.SessionMaxAge, cfg.SessionIdle)
	switch *cmd {
	case "bootstrap-admin":
		code, err := am.BootstrapAdmin(*username)
		exitIf(err)
		fmt.Println("کد دعوت یک‌بارمصرف ادمین (۲۴ ساعت):", code)
	case "invite":
		createdBy := *by
		if createdBy == "" {
			// ایجادکننده باید کاربر واقعی باشد (قید FOREIGN KEY) — اولین ادمین فعال
			if err := db.QueryRow(`SELECT uid FROM users WHERE role='admin' AND disabled=0 AND uid != 'usr-system' ORDER BY created_at LIMIT 1`).Scan(&createdBy); err != nil {
				fmt.Fprintln(os.Stderr, "خطا: ادمین فعالی برای ایجاد دعوت یافت نشد (اول با bootstrap-admin حساب بسازید)")
				os.Exit(1)
			}
		}
		code, err := am.CreateInvitation(createdBy, *role, 24*time.Hour)
		exitIf(err)
		fmt.Println("کد دعوت", *role, ":", code)
	case "backup":
		_ = os.MkdirAll(dirOf(*out), 0o700)
		exitIf(db.Backup(*out))
		fmt.Println("پشتیبان سازگار ساخته شد:", *out)
	default:
		fmt.Println("استفاده: adminctl -cmd bootstrap-admin|invite|backup")
	}
}

func exitIf(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "خطا:", err)
		os.Exit(1)
	}
}

func dirOf(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[:i]
		}
	}
	return "."
}
