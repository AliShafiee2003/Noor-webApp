package auth

import (
	"fmt"
	"testing"
	"time"

	"noor/internal/store"
)

func TestLoginDebug(t *testing.T) {
	db, err := store.Open("/home/z/my-project/mini-services/noor-api/data/app.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(db, 7*24*time.Hour, 24*time.Hour)
	var ph string
	_ = db.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&ph)
	ok, _, verr := VerifyPassword("NoorAdmin1404!", ph)
	fmt.Println("verify stored:", ok, verr)
	fmt.Println("hash head:", ph[:50])
	u, tok, err := m.Login("admin", "NoorAdmin1404!", "1.2.3.4", "test")
	fmt.Println("login err:", err)
	if err == nil {
		fmt.Println("OK user:", u.Username, u.Role, "token len:", len(tok))
	}
}
