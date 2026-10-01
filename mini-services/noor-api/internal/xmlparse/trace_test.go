package xmlparse

import (
	_ "modernc.org/sqlite"
	"fmt"
	"testing"

	"noor/internal/noordb"
)

func TestTraceBaharItem4(t *testing.T) {
	db, err := noordb.Open("/home/z/my-project/mini-services/noor-api/data/sources/01407_011.db")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var dict []string
	rows, _ := db.Query(`SELECT Txt FROM Letters ORDER BY Id`)
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		dict = append(dict, s)
	}
	rows.Close()
	var raw string
	rows2, _ := db.Query(`SELECT XmlText FROM DocItem WHERE Id=4`)
	for rows2.Next() {
		var enc string
		_ = rows2.Scan(&enc)
		dec, derr := noordb.Decode(enc, dict)
		if derr != nil {
			t.Fatal(derr)
		}
		raw = dec
	}
	rows2.Close()
	if raw == "" {
		t.Fatal("item 4 not found")
	}
	t.Log("RAW:", string([]rune(raw)[:min(300, len(raw))]))
	m, err := ParseItems("t", []ItemInput{{ID: 4, XML: raw}})
	if err != nil {
		t.Fatal(err)
	}
	out := fmt.Sprintf("blocks=%d\n", len(m.Blocks))
	for _, b := range m.Blocks {
		out += fmt.Sprintf("%s %s cits=%d text=%q\n", b.ID, b.Type, len(b.Citations), runeCut(b.Text, 40))
	}
	t.Log(out)
}


func runeCut(s string, n int) string { r := []rune(s); if len(r) > n { return string(r[:n]) }; return s }
