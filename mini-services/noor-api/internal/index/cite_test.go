package index_test

// cite_test.go — GO-09: مسیر کاتالوگ نسبت به پکیج است (بدون /home/z/my-project)
// و در نبود دادهٔ منابع در کلون، صادقانه اسکیپ می‌کند نه fail.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noor/internal/catalog"
)

func TestCitationsInModel(t *testing.T) {
	sources := filepath.Join("..", "..", "data", "sources")
	if _, err := os.Stat(filepath.Join(sources, "catalog.json")); err != nil {
		t.Skip("دادهٔ منابع (data/sources/catalog.json) در این کلون موجود نیست؛ آزمون موضعی اسکیپ شد")
	}
	cat, err := catalog.Load(sources)
	if err != nil {
		t.Fatalf("catalog.Load: %v", err)
	}
	m, err := cat.Model("doc-bahar-2")
	if err != nil {
		t.Skipf("سند doc-bahar-2 در دادهٔ این کلون موجود نیست: %v", err)
	}
	if len(m.Blocks) == 0 {
		t.Fatal("مدل سند بدون بلوک است")
	}
	// گزارهٔ معنادار: هر استناد باید سورهٔ شناسایی‌شده داشته باشد
	for _, b := range m.Blocks {
		for _, cit := range b.Citations {
			if strings.TrimSpace(cit.Sure) == "" {
				t.Fatalf("استناد بدون سوره در بلوک %s: %+v", b.ID, cit)
			}
		}
	}
	t.Log(fmt.Sprintf("blocks=%d cits=%d\n", len(m.Blocks), len(m.Citations)))
}

func runeCut(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
