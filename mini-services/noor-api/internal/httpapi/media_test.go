package httpapi

// media_test.go — آزمون سرو فایل رسانه‌ای (فاز رسانه): auth، فرمت‌های مجاز،
// Range/206، ETag/304، وضعیت انتشار. کاتالوگ fixture با فایل واقعی در t.TempDir().

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"noor/internal/catalog"
)

func setupMediaTest(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	pdfBody := []byte("%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
	jpgBody := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01}
	if err := os.WriteFile(filepath.Join(dir, "scan.pdf"), pdfBody, 0o644); err != nil {
		t.Fatalf("write pdf: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cover.jpg"), jpgBody, 0o644); err != nil {
		t.Fatalf("write jpg: %v", err)
	}
	catJSON := fmt.Sprintf(`[
	 {"uid":"w-scan","title":"اثر اسکن‌شده","language":"ar","documents":[
	   {"uid":"d-scan-pdf","file":%[1]q,"label":"ج ۱","kind":"volume","language":"ar","checksum":"cs-pdf"}
	 ]},
	 {"uid":"w-text","title":"اثر متنی","language":"fa","documents":[
	   {"uid":"d-text-1","file":"books/t/t_001.db","label":"ج ۱","kind":"volume","language":"fa"}
	 ]},
	 {"uid":"w-cover","title":"اثر کاور","language":"fa","documents":[
	   {"uid":"d-cover-img","file":%[2]q,"label":"جلد","kind":"volume","language":"fa"}
	 ]}
	]`, filepath.ToSlash(filepath.Join(dir, "scan.pdf")), filepath.ToSlash(filepath.Join(dir, "cover.jpg")))
	if err := os.WriteFile(filepath.Join(dir, "catalog.json"), []byte(catJSON), 0o644); err != nil {
		t.Fatalf("write catalog: %v", err)
	}
	cat, err := catalog.Load(dir)
	if err != nil {
		t.Fatalf("catalog.Load: %v", err)
	}
	s, ts := ugcTestServer(t)
	s.Catalog = cat
	return s, ts
}

func mediaAdminToken(t *testing.T, s *Server) string {
	t.Helper()
	code, err := s.Auth.CreateInvitation("usr-system", "admin", time.Hour)
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	u, err := s.Auth.AcceptInvitation(code, "media-admin", "مدیر رسانه", "password-1234")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}
	token, err := s.Auth.CreateSessionFor(u.UID)
	if err != nil {
		t.Fatalf("CreateSessionFor: %v", err)
	}
	return token
}

func mediaBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

func TestDocumentFileRequiresAuth(t *testing.T) {
	_, ts := setupMediaTest(t)
	resp := ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", "", nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 401 {
		t.Fatalf("file without session = %d, want 401", resp.StatusCode)
	}
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/media", "", nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 401 {
		t.Fatalf("media without session = %d, want 401", resp.StatusCode)
	}
}

func TestDocumentFileServesPDFWithRange(t *testing.T) {
	s, ts := setupMediaTest(t)
	token := ugcUser(t, s, "media-user", "کاربر رسانه")

	resp := ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", token, nil, nil)
	body := mediaBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("file = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("content-type = %q, want application/pdf", ct)
	}
	if ar := resp.Header.Get("Accept-Ranges"); ar != "bytes" {
		t.Fatalf("accept-ranges = %q, want bytes", ar)
	}
	if resp.Header.Get("ETag") == "" {
		t.Fatal("ETag missing")
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "private, no-cache" {
		t.Fatalf("cache-control = %q, want private,no-cache (override no-store)", cc)
	}
	if len(body) == 0 {
		t.Fatal("empty body")
	}

	// 304 با If-None-Match
	etag := resp.Header.Get("ETag")
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", token, nil, map[string]string{"If-None-Match": etag})
	mediaBody(t, resp)
	if resp.StatusCode != 304 {
		t.Fatalf("if-none-match = %d, want 304", resp.StatusCode)
	}

	// Range → 206 + Content-Range
	full := len(body)
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", token, nil, map[string]string{"Range": "bytes=0-9"})
	part := mediaBody(t, resp)
	if resp.StatusCode != 206 {
		t.Fatalf("range = %d, want 206", resp.StatusCode)
	}
	if cr := resp.Header.Get("Content-Range"); cr != fmt.Sprintf("bytes 0-9/%d", full) {
		t.Fatalf("content-range = %q, want bytes 0-9/%d", cr, full)
	}
	if len(part) != 10 {
		t.Fatalf("range body len = %d, want 10", len(part))
	}
}

func TestDocumentMediaMetadata(t *testing.T) {
	s, ts := setupMediaTest(t)
	token := ugcUser(t, s, "media-user", "کاربر رسانه")

	resp := ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/media", token, nil, nil)
	m := ugcJSON(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("media = %d, want 200", resp.StatusCode)
	}
	if m["format"] != "pdf" || m["content_type"] != "application/pdf" {
		t.Fatalf("media meta = %v", m)
	}
	if m["accept_ranges"] != true || m["available"] != true {
		t.Fatalf("media flags = %v", m)
	}
	if sz, _ := m["size_bytes"].(float64); sz <= 0 {
		t.Fatalf("size_bytes = %v", m["size_bytes"])
	}

	// سند تصویری → image/jpeg
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-cover-img/file", token, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("cover file = %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}

	// سند متنی از مسیر رسانه عبور نمی‌کند
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-text-1/file", token, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 404 {
		t.Fatalf("text doc file = %d, want 404", resp.StatusCode)
	}
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-text-1/media", token, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 404 {
		t.Fatalf("text doc media = %d, want 404", resp.StatusCode)
	}

	// سند ناموجود
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-nope/file", token, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 404 {
		t.Fatalf("unknown doc = %d, want 404", resp.StatusCode)
	}
}

func TestDocumentFileUnpublished(t *testing.T) {
	s, ts := setupMediaTest(t)
	if err := s.DB.SetWorkPublished("w-scan", false, "test"); err != nil {
		t.Fatalf("SetWorkPublished: %v", err)
	}
	user := ugcUser(t, s, "media-user", "کاربر رسانه")
	resp := ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", user, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 404 {
		t.Fatalf("unpublished file (reader) = %d, want 404", resp.StatusCode)
	}

	// admin از محدودیت انتشار عبور می‌کند
	admin := mediaAdminToken(t, s)
	resp = ugcDo(t, ts, "GET", "/api/v1/documents/d-scan-pdf/file", admin, nil, nil)
	mediaBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("unpublished file (admin) = %d, want 200", resp.StatusCode)
	}
}
