package catalog

// catalog_test.go — مشتقات فرمت/رسانه از پسوند فایل (فاز رسانه).
// کاتالوگ آزمون در t.TempDir() ساخته می‌شود؛ هیچ فایل منبعی لازم نیست
// (LoadFile فایل‌ها را باز نمی‌کند — decode در تقاضاست).

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

const mediaFixtureJSON = `[
 {"uid":"w-text","title":"اثر متنی","language":"fa","documents":[
   {"uid":"d-text-1","file":"books/t/t_001.db","label":"ج ۱","kind":"volume","language":"fa"}
 ]},
 {"uid":"w-scan","title":"اثر اسکن‌شده","language":"ar","documents":[
   {"uid":"d-scan-1","file":"books/s/s_001.PDF","label":"ج ۱","kind":"volume","language":"ar"}
 ]},
 {"uid":"w-cover","title":"اثر فقط-کاور","language":"fa","documents":[
   {"uid":"d-cover-1","file":"books/c/c.jpg","label":"جلد","kind":"volume","language":"fa"}
 ]},
 {"uid":"w-mixed","title":"اثر ترکیبی","language":"ar","documents":[
   {"uid":"d-mixed-db","file":"books/m/m_001.db","label":"ج ۱","kind":"volume","language":"ar"},
   {"uid":"d-mixed-pdf","file":"books/m/m_001.pdf","label":"ج ۱ اسکن","kind":"volume","language":"ar"}
 ]},
 {"uid":"w-audio","title":"اثر صوتی","language":"fa","documents":[
   {"uid":"d-audio-1","file":"books/a/a_001.mp3","label":"جلسه ۱","kind":"volume","language":"fa"}
 ]},
 {"uid":"w-escape","title":"اثر گریز","language":"fa","documents":[
   {"uid":"d-escape","file":"../escape.db","label":"خارج","kind":"volume","language":"fa"}
 ]}
]`

func loadMediaFixture(t *testing.T) (string, *Service) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), []byte(mediaFixtureJSON), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	s, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return dir, s
}

func TestFormatOf(t *testing.T) {
	cases := []struct{ path, want string }{
		{"books/t/t_001.db", "text"},
		{"books/s/s_001.PDF", "pdf"},
		{"books/c/c.jpg", "image"},
		{"books/c/c.JPEG", "image"},
		{"books/c/c.png", "image"},
		{"a/a_001.mp3", "audio"},
		{"a/a_001.ra", "audio"},
		{"a/a_001.RM", "audio"},
		{"x/x.xyz", "other"},
		{"noext", "other"},
	}
	for _, c := range cases {
		if got := FormatOf(c.path); got != c.want {
			t.Errorf("FormatOf(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestWorkMediaDerivatives(t *testing.T) {
	_, s := loadMediaFixture(t)
	cases := []struct {
		uid     string
		formats []string
		hasFmt  map[string]bool
		cover   string
		media   bool
	}{
		{"w-text", []string{"text"}, map[string]bool{"text": true, "pdf": false}, "", false},
		{"w-scan", []string{"pdf"}, map[string]bool{"pdf": true}, "", true},
		{"w-cover", []string{"image"}, map[string]bool{"image": true}, "d-cover-1", false},
		{"w-mixed", []string{"text", "pdf"}, map[string]bool{"text": true, "pdf": true}, "", true},
		{"w-audio", []string{"audio"}, map[string]bool{"audio": true}, "", true},
	}
	for _, c := range cases {
		w, ok := s.Work(c.uid)
		if !ok {
			t.Fatalf("work %s missing", c.uid)
		}
		if got := s.WorkFormats(w); !reflect.DeepEqual(got, c.formats) {
			t.Errorf("%s formats = %v, want %v", c.uid, got, c.formats)
		}
		for f, want := range c.hasFmt {
			if got := s.WorkHasFormat(w, f); got != want {
				t.Errorf("%s has %s = %v, want %v", c.uid, f, got, want)
			}
		}
		if got := s.CoverUID(w); got != c.cover {
			t.Errorf("%s cover = %q, want %q", c.uid, got, c.cover)
		}
		if got := s.HasMedia(w); got != c.media {
			t.Errorf("%s media = %v, want %v", c.uid, got, c.media)
		}
	}
}

func TestDocumentFormatPopulated(t *testing.T) {
	_, s := loadMediaFixture(t)
	d, ok := s.Document("d-scan-1")
	if !ok {
		t.Fatal("doc d-scan-1 missing")
	}
	if d.Format != "pdf" {
		t.Fatalf("d-scan-1 format = %q, want pdf", d.Format)
	}
}

func TestFilePathGuard(t *testing.T) {
	dir, s := loadMediaFixture(t)
	// مسیر نسبی مجاز زیر sourcesDir
	if p, ok := s.FilePath("d-text-1"); !ok || p != filepath.Join(dir, "books", "t", "t_001.db") {
		t.Fatalf("FilePath(d-text-1) = %q,%v", p, ok)
	}
	// گریز از sourcesDir رد می‌شود
	if p, ok := s.FilePath("d-escape"); ok {
		t.Fatalf("FilePath(d-escape) = %q, want refused", p)
	}
	// سند ناموجود
	if _, ok := s.FilePath("d-nope"); ok {
		t.Fatal("FilePath(d-nope) = ok, want false")
	}
}

func TestMediaFeatureDerivation(t *testing.T) {
	_, s := loadMediaFixture(t)
	ws, _ := s.Work("w-scan")
	wt, _ := s.Work("w-text")

	if f := s.WorkFeatures(ws).Media; f != "supported" {
		t.Fatalf("w-scan media = %q, want supported", f)
	}
	if f := s.WorkFeatures(wt).Media; f != "absent" {
		t.Fatalf("w-text media = %q, want absent", f)
	}

	// بدون کلید media در knownFeats → مشتق کاتالوگ
	s.SetKnownFeatures(map[string]map[string]bool{
		"w-scan": {"searchable": true},
		"w-text": {"searchable": true},
	})
	if f := s.WorkFeatures(ws).Media; f != "supported" {
		t.Fatalf("w-scan media (known w/o key) = %q, want supported", f)
	}
	if f := s.WorkFeatures(wt).Media; f != "absent" {
		t.Fatalf("w-text media (known w/o key) = %q, want absent", f)
	}
	if f := s.WorkFeatures(ws).SearchableText; f != "supported" {
		t.Fatalf("w-scan searchable = %q, want supported", f)
	}

	// کلید صریح worker بر مشتق مقدم است
	s.SetKnownFeatures(map[string]map[string]bool{
		"w-scan": {"searchable": true, "media": false},
	})
	if f := s.WorkFeatures(ws).Media; f != "absent" {
		t.Fatalf("w-scan media (known false) = %q, want absent", f)
	}
}
