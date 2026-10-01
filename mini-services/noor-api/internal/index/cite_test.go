package index_test

import (
	"fmt"
	"testing"

	"noor/internal/catalog"
)

func TestCitationsInModel(t *testing.T) {
	cat, err := catalog.Load("/home/z/my-project/mini-services/noor-api/data/sources")
	if err != nil {
		t.Fatal(err)
	}
	m, err := cat.Model("doc-bahar-2")
	if err != nil {
		t.Fatal(err)
	}
	out := fmt.Sprintf("blocks=%d cits=%d\n", len(m.Blocks), len(m.Citations))
	for _, b := range m.Blocks {
		out += fmt.Sprintf("%s %s cits=%d spans=%d links=%d text=%q\n", b.ID, b.Type, len(b.Citations), len(b.Spans), len(b.Links), runeCut(b.Text, 50))
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
