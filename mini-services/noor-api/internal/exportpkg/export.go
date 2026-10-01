// Package exportpkg — خروجی پژوهش (§۵۱): Markdown، JSON، CSV ایمن، HTML چاپی.
package exportpkg

import (
	"encoding/json"
	"strings"
	"time"
)

// Clip ورودی خروجی (از research).
type Clip struct {
	Kind          string          `json:"kind"`
	QuoteOriginal string          `json:"quote_original"`
	QuoteAsRead   *string         `json:"quote_as_read"`
	Note          *string         `json:"note"`
	Tags          []string        `json:"tags"`
	Project       string          `json:"project"`
	Work          string          `json:"work"`
	Document      string          `json:"document"`
	PageLabel     string          `json:"page_label"`
	Release       string          `json:"release_uid"`
	OverlayStatus string          `json:"overlay_status"`
	CreatedAt     string          `json:"created_at"`
}

// Markdown خروجی خوانا.
func Markdown(project string, clips []Clip) []byte {
	var b strings.Builder
	b.WriteString("# پروندهٔ پژوهشی: " + project + "\n\n")
	b.WriteString("_تاریخ خروجی: " + time.Now().Format("2006-01-02") + "_\n\n")
	for _, c := range clips {
		b.WriteString("## " + c.Work + " — " + c.Document)
		if c.PageLabel != "" {
			b.WriteString("، ص " + c.PageLabel)
		}
		b.WriteString("\n\n")
		b.WriteString("> " + strings.ReplaceAll(c.QuoteOriginal, "\n", "\n> ") + "\n\n")
		if c.QuoteAsRead != nil && *c.QuoteAsRead != "" {
			b.WriteString("**متن خوانده‌شده (اصلاح سامانه):** " + *c.QuoteAsRead + "\n\n")
		}
		if c.Note != nil && *c.Note != "" {
			b.WriteString("**یادداشت:** " + *c.Note + "\n\n")
		}
		if len(c.Tags) > 0 {
			b.WriteString("برچسب‌ها: " + strings.Join(c.Tags, "، ") + "\n\n")
		}
		b.WriteString("_منبع: نسخهٔ " + c.Release + "؛ وضعیت اصلاح: " + overlayFa(c.OverlayStatus) + "_\n\n---\n\n")
	}
	return []byte(b.String())
}

func overlayFa(s string) string {
	switch s {
	case "modified":
		return "شامل اصلاح سامانه"
	case "":
		return "بدون اصلاح"
	}
	return s
}

// CSV خروجی جدولی — ایمن در برابر formula injection.
func CSV(project string, clips []Clip) []byte {
	var b strings.Builder
	b.WriteString("\uFEFF") // BOM برای Excel فارسی
	b.WriteString("پرونده،اثر،سند،صفحه،نوع،نقل‌قول،یادداشت،برچسب‌ها،نسخهٔ منبع،وضعیت اصلاح\n")
	for _, c := range clips {
		row := []string{project, c.Work, c.Document, c.PageLabel, kindFa(c.Kind), c.QuoteOriginal, ptr(c.Note), strings.Join(c.Tags, "؛ "), c.Release, overlayFa(c.OverlayStatus)}
		cells := make([]string, len(row))
		for i, v := range row {
			v = sanitizeCSV(v)
			cells[i] = "\"" + strings.ReplaceAll(v, "\"", "\"\"") + "\""
		}
		b.WriteString(strings.Join(cells, ",") + "\n")
	}
	return []byte(b.String())
}

// sanitizeCSV مقابله با formula injection (SEC).
func sanitizeCSV(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

func kindFa(k string) string {
	switch k {
	case "original":
		return "نقل‌قول اصل"
	case "as_read":
		return "متن خوانده‌شده"
	case "note":
		return "یادداشت"
	}
	return k
}

func ptr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// JSON خروجی کامل.
func JSON(project string, clips []Clip) []byte {
	out, _ := json.MarshalIndent(map[string]any{"project": project, "exported_at": time.Now().UTC(), "clips": clips}, "", "  ")
	return out
}

// PrintHTML خروجی چاپی امن (فقط متن، بدون اسکریپت).
func PrintHTML(project string, clips []Clip) []byte {
	var b strings.Builder
	b.WriteString("<!doctype html><html dir=\"rtl\" lang=\"fa\"><head><meta charset=\"utf-8\"><title>" + esc(project) + "</title>")
	b.WriteString("<style>body{font-family:Vazirmatn,Tahoma,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#182A32;line-height:1.9}blockquote{border-inline-start:3px solid #17665B;margin:0;padding:0.2rem 1rem;background:#FFFCF5}h2{font-size:1.1rem;border-bottom:1px solid #D6DAD7;padding-bottom:.4rem}@media print{body{margin:0}}</style></head><body>")
	b.WriteString("<h1>" + esc(project) + "</h1>")
	for _, c := range clips {
		title := esc(c.Work + " — " + c.Document)
		if c.PageLabel != "" {
			title += "، ص " + esc(c.PageLabel)
		}
		b.WriteString("<h2>" + title + "</h2>")
		b.WriteString("<blockquote>" + esc(c.QuoteOriginal) + "</blockquote>")
		if ptr(c.Note) != "" {
			b.WriteString("<p><strong>یادداشت:</strong> " + esc(ptr(c.Note)) + "</p>")
		}
		b.WriteString("<p style=\"color:#55646B;font-size:.85rem\">منبع: نسخهٔ " + esc(c.Release) + "؛ وضعیت اصلاح: " + esc(overlayFa(c.OverlayStatus)) + "</p>")
	}
	b.WriteString("</body></html>")
	return []byte(b.String())
}

func esc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}


