package main

import (
	"fmt"
	"log"
	"noor/internal/auth"
	"noor/internal/store"
)

func main() {
	db, err := store.Open("./data/app.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	hash, err := auth.HashPassword("Admin@123456")
	if err != nil {
		log.Fatal(err)
	}
	_, _ = db.Exec(`INSERT OR IGNORE INTO users(uid, username, username_norm, display_name, password_hash, role, totp_enabled, disabled) VALUES('usr-system', 'system', 'system', 'سامانه', '', 'admin', 0, 1)`)
	_, err = db.Exec(`INSERT INTO users(uid, username, username_norm, display_name, password_hash, role, totp_enabled, disabled)
		VALUES('usr-admin-master', 'admin', 'admin', 'مدیر پژوهش', ?, 'admin', 0, 0)
		ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, disabled=0, totp_enabled=0`, hash)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("User admin created successfully with password: Admin@123456")
}
