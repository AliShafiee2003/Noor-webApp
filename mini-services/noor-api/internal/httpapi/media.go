package httpapi

// media.go — سرو فایل رسانه‌ای (pdf/image/audio) از منابع کاتالوگ (فاز رسانه).
// فقط اسنادِ ثبت‌شدهٔ کاتالوگ سرو می‌شوند: مسیر از uid به دست می‌آید، نه از ورودی
// کاربر؛ متن (.db) از این مسیر عبور نمی‌کند (decode در اندپوینت‌های صفحه است).

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"noor/internal/catalog"
)

// mediaContentType نگاشت فرمت/پسوند به MIME برای اندپوینت متادیتا.
// خود فایل با تشخیص پسوندِ http.ServeContent سرو می‌شود.
func mediaContentType(format, path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".pdf":
		return "application/pdf"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".wma":
		return "audio/x-ms-wma"
	case ".ra", ".rm":
		return "application/vnd.rn-realmedia"
	default:
		_ = format
		return "application/octet-stream"
	}
}

// mediaFileName نام فایل امن برای Content-Disposition: از uid، نه مسیر منبع.
func mediaFileName(uid, path string) string {
	var b strings.Builder
	for _, r := range uid {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	name := b.String()
	if name == "" {
		name = "document"
	}
	return "doc-" + name + filepath.Ext(path)
}

// mediaETag ETag قوی: از checksum کاتالوگ؛ نبود آن از size+mtime.
func mediaETag(d catalog.DocumentMeta, fi os.FileInfo) string {
	seed := d.Checksum
	if seed == "" {
		seed = fmt.Sprintf("%d:%d", fi.Size(), fi.ModTime().UnixNano())
	}
	sum := sha256.Sum256([]byte(seed))
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}

// handleDocumentMedia متادیتای سند رسانه‌ای (بدون بدنه) — UI از آن وضعیت و اندازه می‌خواند.
func (s *Server) handleDocumentMedia(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	d, ok := s.Catalog.Document(uid)
	if !ok || d.Format != "pdf" && d.Format != "image" && d.Format != "audio" || !s.checkDocAccess(uid, r) {
		s.fail(w, r, 404, "not_found", "سند رسانه‌ای در دسترس نیست.", false)
		return
	}
	path, ok := s.Catalog.FilePath(uid)
	if !ok {
		s.fail(w, r, 404, "not_found", "سند رسانه‌ای در دسترس نیست.", false)
		return
	}
	fi, statErr := os.Stat(path)
	size := int64(0)
	if statErr == nil {
		size = fi.Size()
	}
	s.ok(w, map[string]any{
		"uid":           d.UID,
		"format":        d.Format,
		"content_type":  mediaContentType(d.Format, path),
		"size_bytes":    size,
		"accept_ranges": true,
		"available":     statErr == nil,
	})
}

// handleDocumentFile خود فایل رسانه‌ای را سرو می‌کند: auth + access، سپس
// http.ServeContent (Range/If-Range/If-None-Match/HEAD). ETag+private/no-cache
// اعتبارسنجی 304 را زنده نگه می‌دارد بدون نشت بین‌کاربری در مرورگر مشترک.
func (s *Server) handleDocumentFile(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	d, ok := s.Catalog.Document(uid)
	if !ok || d.Format != "pdf" && d.Format != "image" && d.Format != "audio" || !s.checkDocAccess(uid, r) {
		s.fail(w, r, 404, "not_found", "فایل سند در دسترس نیست.", false)
		return
	}
	path, ok := s.Catalog.FilePath(uid)
	if !ok {
		s.fail(w, r, 404, "not_found", "فایل سند در دسترس نیست.", false)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		s.fail(w, r, 404, "not_found", "فایل منبع در دسترس نیست.", false)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		s.fail(w, r, 404, "not_found", "فایل منبع در دسترس نیست.", false)
		return
	}
	h := w.Header()
	h.Set("ETag", mediaETag(d, fi))
	h.Set("Cache-Control", "private, no-cache") // override no-store سراسری — 304/Range زنده می‌ماند
	h.Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, mediaFileName(uid, path)))
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}
