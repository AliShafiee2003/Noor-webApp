package xmlparse

// trace_test.go — GO-10: کوئری‌ها خطاخبار می‌شوند تا rows nil هرگز panic
// ندهد؛ مسیر داده نسبت به پکیج است و در نبود منبع، اسکیپ صادقانه.

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"noor/internal/noordb"
)

func TestTraceBaharItem4(t *testing.T) {
	dbPath := filepath.Join("..", "..", "data", "sources", "01407_011.db")
	if _, err := os.Stat(dbPath); err != nil {
		t.Skip("منبع نمونه (data/sources/01407_011.db) در این کلون موجود نیست؛ آزمون موضعی اسکیپ شد")
	}
	db, err := noordb.Open(dbPath)
	if err != nil {
		t.Fatalf("noordb.Open: %v", err)
	}
	defer db.Close()

	var dict []string
	rows, err := db.Query(`SELECT Txt FROM Letters ORDER BY Id`)
	if err != nil {
		t.Fatalf("خواندن Letters: %v", err) // rows nil نباید بی‌گارد استفاده شود
	}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			rows.Close()
			t.Fatalf("Scan Letters: %v", err)
		}
		dict = append(dict, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatalf("پیمایش Letters: %v", err)
	}
	rows.Close()
	if len(dict) == 0 {
		t.Skip("دیکشنری منبع خالی است؛ دادهٔ نمونهٔ این کلون معتبر نیست")
	}

	var raw string
	rows2, err := db.Query(`SELECT XmlText FROM DocItem WHERE Id=4`)
	if err != nil {
		t.Fatalf("خواندن DocItem 4: %v", err)
	}
	for rows2.Next() {
		var enc string
		if err := rows2.Scan(&enc); err != nil {
			rows2.Close()
			t.Fatalf("Scan DocItem: %v", err)
		}
		dec, derr := noordb.Decode(enc, dict)
		if derr != nil {
			rows2.Close()
			t.Fatalf("Decode: %v", derr)
		}
		raw = dec
	}
	if err := rows2.Err(); err != nil {
		rows2.Close()
		t.Fatalf("پیمایش DocItem: %v", err)
	}
	rows2.Close()
	if raw == "" {
		t.Skip("آیتم ۴ در این نسخه از منبع موجود نیست")
	}

	t.Log("RAW:", string([]rune(raw)[:min(300, len(raw))]))
	m, err := ParseItems("t", []ItemInput{{ID: 4, XML: raw}})
	if err != nil {
		t.Fatalf("ParseItems: %v", err)
	}
	if len(m.Blocks) == 0 {
		t.Fatal("parse آیتم ۴ هیچ بلوکی تولید نکرد")
	}
	out := fmt.Sprintf("blocks=%d\n", len(m.Blocks))
	for _, b := range m.Blocks {
		out += fmt.Sprintf("%s %s cits=%d text=%q\n", b.ID, b.Type, len(b.Citations), runeCut(b.Text, 40))
	}
	t.Log(out)
}

func runeCut(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
