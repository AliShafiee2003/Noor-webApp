// Package httpapi — ugc.go: دادهٔ خصوصی کاربر (§۷-الف) روی app.sqlite.
// ج-۷: هایلایت (annotations)، اشتراک (shares) و کارهای PDF (pdf-jobs) از
// لایهٔ BFF/Prisma به Go منتقل شدند؛ شکل JSON، کدها و پیام‌های فارسی عیناً
// همان قرارداد قبلی BFF است (فقط نویسنده: Go API — ADR-4).
// فایل خروجی PDF سمت runner (Next) روی دیسک نوشته می‌شود؛ Go فقط رکورد را
// نگه می‌دارد و توکن دانلود/انقضای آن را برای مسیر دانلود Next برمی‌گرداند.
package httpapi

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ---- کمکی‌ها ----

// ugcNow تاریخ UTC RFC3339 (مثل 2026-10-01T10:00:00Z) — پیش‌فرض‌ها از Go نه SQLite.
func ugcNow() string { return time.Now().UTC().Format(time.RFC3339) }

// ugcNewID شناسهٔ رندم با پیشوند — همان سبک newID در engine.go.
func ugcNewID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + "-" + hex.EncodeToString(b)
}

// ugcUUID توکن دانلود به شکل UUID (همان سبک randomUUID قبلی BFF).
func ugcUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

// validateAnchor لنگر سند/صفحه را با کاتالوگ می‌سنجد (nil-امن برای تست‌ها):
// هایلایت/اشتراک با مقصد ناموجود ثبت نمی‌شود.
func (s *Server) validateAnchor(w http.ResponseWriter, r *http.Request, documentUID, pageUID string) bool {
	if s.Catalog == nil {
		return true
	}
	model, err := s.Catalog.Model(documentUID)
	if err != nil {
		s.fail(w, r, 422, "validation", "سند ارجاع‌شده در کتابخانه موجود نیست.", false)
		return false
	}
	if pageUID != "" && pageUID != "p-front" {
		found := false
		for i := range model.Pages {
			if model.Pages[i].UID == pageUID {
				found = true
				break
			}
		}
		if !found {
			s.fail(w, r, 422, "validation", "صفحهٔ ارجاع‌شده در سند موجود نیست.", false)
			return false
		}
	}
	return true
}

// ugcColors رنگ‌های مجاز هایلایت — همان HIGHLIGHT_COLORS سمت فرانت.
var ugcColors = map[string]bool{"yellow": true, "green": true, "blue": true, "pink": true, "orange": true}

func isHighlightColor(s string) bool { return ugcColors[s] }

// ugcTrimRunes برش بر پایهٔ نویسه (هم‌ارز String.slice در متن فارسی/BMP).
func ugcTrimRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

// ugcNormalizeDigits ارقام فارسی/عربی → لاتین (تطبیق برچسب صفحه‌های چاپی).
func ugcNormalizeDigits(input string) string {
	r := []rune(input)
	out := make([]rune, 0, len(r))
	for _, c := range r {
		switch {
		case c >= rune(0x06F0) && c <= rune(0x06F9):
			out = append(out, rune('0'+c-rune(0x06F0)))
		case c >= rune(0x0660) && c <= rune(0x0669):
			out = append(out, rune('0'+c-rune(0x0660)))
		default:
			out = append(out, c)
		}
	}
	return string(out)
}

// ugcArg *string → مقدار driver معتبر (nil یا رشته).
func ugcArg(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// ugcStr مقدار رشته‌ای خام (بدون trim) — غیررشته → "".
func ugcStr(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// ugcStrPtr مقدار رشته‌ای اختیاری: رشتهٔ خالی/غایب → nil.
func ugcStrPtr(m map[string]any, key string) *string {
	v, ok := m[key].(string)
	if !ok {
		return nil
	}
	t := strings.TrimSpace(v)
	if t == "" {
		return nil
	}
	return &t
}

// ugcInt عدد صحیح (json.Number) — عدد صحیح‌نما (مثل 1.0) هم پذیرفته می‌شود.
func ugcInt(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	if i, err := n.Int64(); err == nil {
		return i, true
	}
	f, err := n.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) {
		return 0, false
	}
	return int64(f), true
}

// decodeUGCTop بدنهٔ JSON را به map برمی‌گرداند؛ JSON خراب → false.
// بدنهٔ غیر-object (مثل آرایه) مثل BFF به {} نگاشت می‌شود تا اعتبارسنجی‌ها 422 بدهند.
func decodeUGCTop(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var raw any
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, false
	}
	if m, ok := raw.(map[string]any); ok && m != nil {
		return m, true
	}
	return map[string]any{}, true
}

func ugcNil(s sql.NullString) any {
	if s.Valid {
		return s.String
	}
	return nil
}

// ============================================================
// هایلایت‌ها (annotations)
// ============================================================

type ugcHighlightRow struct {
	UID, UserUID, DocumentUID, PageUID, BlockID string
	StartCP, EndCP                              int
	Text, Color                                 string
	Note                                        sql.NullString
	GroupUID                                    sql.NullString
	CreatedAt, UpdatedAt                        string
}

const ugcHighlightCols = `uid, user_uid, document_uid, page_uid, block_id, start_cp, end_cp, text, color, note, group_uid, created_at, updated_at`

func scanUGCHighlight(row interface{ Scan(...any) error }) (*ugcHighlightRow, bool) {
	h := &ugcHighlightRow{}
	err := row.Scan(&h.UID, &h.UserUID, &h.DocumentUID, &h.PageUID, &h.BlockID,
		&h.StartCP, &h.EndCP, &h.Text, &h.Color, &h.Note, &h.GroupUID, &h.CreatedAt, &h.UpdatedAt)
	if err != nil {
		return nil, false
	}
	return h, true
}

// highlightJSON همان شکل Highlight فرانت — رنگ نامجاز روی ذخیره‌گاه → yellow.
func highlightJSON(h *ugcHighlightRow) map[string]any {
	color := h.Color
	if !isHighlightColor(color) {
		color = "yellow"
	}
	return map[string]any{
		"uid": h.UID, "document_uid": h.DocumentUID, "page_uid": h.PageUID,
		"block_id": h.BlockID, "start": h.StartCP, "end": h.EndCP,
		"text": h.Text, "color": color, "note": ugcNil(h.Note), "group_uid": ugcNil(h.GroupUID),
		"created_at": h.CreatedAt, "updated_at": h.UpdatedAt,
	}
}

// handleListAnnotations GET /annotations?document_uid= — فقط مالک، قدیمی→جدید.
func (s *Server) handleListAnnotations(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	docUID := strings.TrimSpace(r.URL.Query().Get("document_uid"))
	if docUID == "" {
		s.fail(w, r, 422, "validation", "شناسهٔ سند لازم است.", false)
		return
	}
	rows, err := s.DB.Query(`SELECT `+ugcHighlightCols+` FROM highlights
                WHERE user_uid=? AND document_uid=? ORDER BY created_at ASC, uid ASC`, u.UID, docUID)
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست هایلایت‌ها در دسترس نیست؛ دوباره تلاش کنید.", true)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		if h, ok := scanUGCHighlight(rows); ok {
			items = append(items, highlightJSON(h))
		}
	}
	s.ok(w, map[string]any{"items": items})
}

// handleCreateAnnotation POST /annotations → 201 Highlight.
func (s *Server) handleCreateAnnotation(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	m, ok := decodeUGCTop(w, r)
	if !ok {
		s.fail(w, r, 400, "bad_request", "بدنهٔ درخواست نامعتبر است.", false)
		return
	}
	documentUID := strings.TrimSpace(ugcStr(m, "document_uid"))
	pageUID := strings.TrimSpace(ugcStr(m, "page_uid"))
	blockID := strings.TrimSpace(ugcStr(m, "block_id"))
	text := strings.TrimSpace(ugcStr(m, "text"))
	if documentUID == "" || pageUID == "" || blockID == "" || text == "" {
		s.fail(w, r, 422, "validation", "همهٔ بخش‌های هایلایت (سند، صفحه، بلوک و متن) لازم است.", false)
		return
	}
	start, startOK := ugcInt(m["start"])
	end, endOK := ugcInt(m["end"])
	if !startOK || !endOK {
		s.fail(w, r, 422, "validation", "بازهٔ هایلایت باید دو عدد صحیح باشد.", false)
		return
	}
	if start < 0 || start >= end || end > 20000 {
		s.fail(w, r, 422, "validation", "بازهٔ هایلایت نامعتبر است (۰ ≤ ابتدا < انتها ≤ ۲۰٬۰۰۰).", false)
		return
	}
	if !s.validateAnchor(w, r, documentUID, pageUID) {
		return
	}
	color := ugcStr(m, "color")
	if !isHighlightColor(color) {
		color = "yellow"
	}
	/* هایلایت چندپاراگرافی: همهٔ قطعه‌ها یک group_uid مشترک دارند تا حذف/ویرایش
	   هر قطعه به کل گروه اعمال شود. تک‌هایلایت بدون گروه می‌ماند (سازگاری). */
	groupUID := strings.TrimSpace(ugcStr(m, "group_uid"))
	if len(groupUID) > 100 {
		s.fail(w, r, 422, "validation", "شناسهٔ گروه هایلایت نامعتبر است.", false)
		return
	}
	var groupArg any
	if groupUID != "" {
		groupArg = groupUID
	}
	uid := ugcNewID("hl")
	now := ugcNow()
	storedText := ugcTrimRunes(text, 4000)
	if _, err := s.DB.Exec(`INSERT INTO highlights(`+ugcHighlightCols+`)
                VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
		uid, u.UID, documentUID, pageUID, blockID, start, end,
		storedText, color, groupArg, now, now); err != nil {
		s.fail(w, r, 500, "internal", "ثبت هایلایت ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	h := &ugcHighlightRow{UID: uid, UserUID: u.UID, DocumentUID: documentUID, PageUID: pageUID,
		BlockID: blockID, StartCP: int(start), EndCP: int(end), Text: storedText,
		Color: color, GroupUID: sql.NullString{String: groupUID, Valid: groupUID != ""},
		CreatedAt: now, UpdatedAt: now}
	s.okStatus(w, 201, highlightJSON(h))
}

// handleUpdateAnnotation PATCH /annotations/{uid} — فقط مالک (نبودِ مالک/ردیف → 404).
func (s *Server) handleUpdateAnnotation(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	uid := chi.URLParam(r, "uid")
	h, ok := scanUGCHighlight(s.DB.QueryRow(`SELECT `+ugcHighlightCols+` FROM highlights WHERE uid=?`, uid))
	if !ok || h.UserUID != u.UID {
		s.fail(w, r, 404, "not_found", "هایلایت مورد نظر یافت نشد.", false)
		return
	}
	m, ok := decodeUGCTop(w, r)
	if !ok {
		s.fail(w, r, 400, "bad_request", "بدنهٔ درخواست نامعتبر است.", false)
		return
	}
	sets := []string{}
	args := []any{}
	if _, present := m["color"]; present {
		colorRaw := ugcStr(m, "color")
		if !isHighlightColor(colorRaw) {
			s.fail(w, r, 422, "validation", "رنگ انتخابی مجاز نیست.", false)
			return
		}
		sets = append(sets, "color=?")
		args = append(args, colorRaw)
	}
	if _, present := m["note"]; present {
		switch v := m["note"].(type) {
		case nil:
			sets = append(sets, "note=NULL")
		case string:
			sets = append(sets, "note=?")
			args = append(args, ugcTrimRunes(v, 4000))
		default:
			s.fail(w, r, 422, "validation", "یادداشت باید متن باشد.", false)
			return
		}
	}
	if len(sets) == 0 {
		s.fail(w, r, 422, "validation", "چیزی برای تغییر ارسال نشده است.", false)
		return
	}
	now := ugcNow()
	sets = append(sets, "updated_at=?")
	args = append(args, now)
	where := "uid=?"
	if h.GroupUID.Valid && h.GroupUID.String != "" {
		/* رنگ/یادداشت روی هر قطعه به کل گروه چندپاراگرافی اعمال می‌شود. */
		where = "user_uid=? AND group_uid=?"
		args = append(args, u.UID, h.GroupUID.String)
	} else {
		args = append(args, uid)
	}
	if _, err := s.DB.Exec(`UPDATE highlights SET `+strings.Join(sets, ", ")+` WHERE `+where, args...); err != nil {
		s.fail(w, r, 500, "internal", "به‌روزرسانی هایلایت ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	h, ok = scanUGCHighlight(s.DB.QueryRow(`SELECT `+ugcHighlightCols+` FROM highlights WHERE uid=?`, uid))
	if !ok {
		s.fail(w, r, 404, "not_found", "هایلایت مورد نظر یافت نشد.", false)
		return
	}
	s.ok(w, highlightJSON(h))
}

// handleDeleteAnnotation DELETE /annotations/{uid} → 204؛ تکرار/غیرمالک → 404.
func (s *Server) handleDeleteAnnotation(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	uid := chi.URLParam(r, "uid")
	h, ok := scanUGCHighlight(s.DB.QueryRow(`SELECT `+ugcHighlightCols+` FROM highlights WHERE uid=?`, uid))
	if !ok || h.UserUID != u.UID {
		s.fail(w, r, 404, "not_found", "هایلایت مورد نظر یافت نشد.", false)
		return
	}
	if h.GroupUID.Valid && h.GroupUID.String != "" {
		/* حذف یک قطعه = حذف کل هایلایت چندپاراگرافی */
		if _, err := s.DB.Exec(`DELETE FROM highlights WHERE user_uid=? AND group_uid=?`, u.UID, h.GroupUID.String); err != nil {
			s.fail(w, r, 500, "internal", "حذف هایلایت ممکن نشد؛ دوباره تلاش کنید.", true)
			return
		}
	} else if _, err := s.DB.Exec(`DELETE FROM highlights WHERE uid=?`, uid); err != nil {
		s.fail(w, r, 500, "internal", "حذف هایلایت ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// اشتراک‌ها (shares)
// ============================================================

type ugcShareRow struct {
	UID, UserUID, Kind, ItemID, DocumentUID string
	PageUID, PageLabel, WorkTitle           sql.NullString
	Payload                                 string
	Meta                                    sql.NullString
	Revoked                                 bool
	ExpiresAt                               sql.NullString
	CreatedAt                               string
}

const ugcShareCols = `uid, user_uid, kind, item_id, document_uid, page_uid, page_label, work_title, payload, meta, revoked, expires_at, created_at`

func scanUGCShare(row interface{ Scan(...any) error }) (*ugcShareRow, bool) {
	sh := &ugcShareRow{}
	err := row.Scan(&sh.UID, &sh.UserUID, &sh.Kind, &sh.ItemID, &sh.DocumentUID,
		&sh.PageUID, &sh.PageLabel, &sh.WorkTitle, &sh.Payload, &sh.Meta,
		&sh.Revoked, &sh.ExpiresAt, &sh.CreatedAt)
	if err != nil {
		return nil, false
	}
	return sh, true
}

// shareURLPath مسیر مطالعهٔ کتاب‌خوان پس از فاز ۲: /library/book/read?d=<doc>&pg=<N>&shared=<uid>
// (نام اثر را خود کتاب‌خوان پس از بازگشایی می‌نویسد؛ pg عددی می‌شود: p-001 → 1)
func shareURLPath(documentUID, pageUID, id string) string {
	params := url.Values{}
	if documentUID != "" {
		params.Set("d", documentUID)
	}
	if pageUID != "" {
		params.Set("pg", pageTerm(pageUID))
	}
	params.Set("shared", id)
	return "/library/book/read?" + params.Encode()
}

// pageTerm شمارهٔ صفحه در نشانی: p-016 → 16؛ غیرعددی همان raw می‌ماند.
func pageTerm(pageUID string) string {
	m := regexp.MustCompile(`^p-(\d+)$`).FindStringSubmatch(pageUID)
	if m == nil {
		return pageUID
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return pageUID
	}
	return strconv.Itoa(n)
}

func (sh *ugcShareRow) kindJSON() string {
	if sh.Kind == "note" {
		return "note"
	}
	return "highlight"
}

// handleListShares GET /shares — فعال‌های من، جدید→قدیم، با excerpt و url_path.
func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	rows, err := s.DB.Query(`SELECT `+ugcShareCols+` FROM share_links
                WHERE user_uid=? AND revoked=0 ORDER BY created_at DESC, uid DESC`, u.UID)
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست اشتراک‌ها در دسترس نیست؛ دوباره تلاش کنید.", true)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		sh, ok := scanUGCShare(rows)
		if !ok {
			continue
		}
		items = append(items, map[string]any{
			"uid": sh.UID, "kind": sh.kindJSON(), "document_uid": sh.DocumentUID,
			"page_uid": ugcNil(sh.PageUID), "page_label": ugcNil(sh.PageLabel),
			"work_title": ugcNil(sh.WorkTitle),
			"excerpt":    ugcTrimRunes(sh.Payload, 120),
			"created_at": sh.CreatedAt, "expires_at": ugcNil(sh.ExpiresAt),
			"url_path": shareURLPath(sh.DocumentUID, nullStr(sh.PageUID), sh.UID),
		})
	}
	s.ok(w, map[string]any{"items": items})
}

func nullStr(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

// handleCreateShare POST /shares → 201 {uid, url_path}؛ owner_name فقط از نشست.
func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	m, ok := decodeUGCTop(w, r)
	if !ok {
		s.fail(w, r, 400, "bad_request", "بدنهٔ درخواست نامعتبر است.", false)
		return
	}
	kind := ugcStr(m, "kind")
	if kind != "note" && kind != "highlight" {
		s.fail(w, r, 422, "validation", "نوع اشتراک باید «note» یا «highlight» باشد.", false)
		return
	}
	itemID := strings.TrimSpace(ugcStr(m, "item_id"))
	documentUID := strings.TrimSpace(ugcStr(m, "document_uid"))
	if itemID == "" || documentUID == "" {
		s.fail(w, r, 422, "validation", "شناسهٔ مورد و سند برای اشتراک لازم است.", false)
		return
	}
	payload := strings.TrimSpace(ugcStr(m, "payload"))
	if payload == "" {
		s.fail(w, r, 422, "validation", "محتوای اشتراک خالی است.", false)
		return
	}
	if len([]rune(payload)) > 8000 {
		s.fail(w, r, 422, "validation", "محتوای اشتراک بیش از حد بلند است (سقف ۸٬۰۰۰ نویسه).", false)
		return
	}

	/* هویت دارنده فقط از نشست سرور — ورودی meta کلاینت قابل اعتماد نیست */
	clientMeta := map[string]any{}
	if v, ok := m["meta"]; ok && v != nil {
		if cm, isMap := v.(map[string]any); isMap {
			clientMeta = cm
		}
	}
	clientMeta["owner_name"] = u.DisplayName
	metaJSON, _ := json.Marshal(clientMeta)

	pageUID := ""
	if v := ugcStrPtr(m, "page_uid"); v != nil {
		pageUID = *v
	}
	if !s.validateAnchor(w, r, documentUID, pageUID) {
		return
	}
	uid := ugcNewID("sh")
	now := ugcNow()
	_, err := s.DB.Exec(`INSERT INTO share_links(uid, user_uid, kind, item_id, document_uid,
                page_uid, page_label, work_title, payload, meta, revoked, expires_at, created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,0,NULL,?)`,
		uid, u.UID, kind, itemID, documentUID,
		ugcArg(ugcStrPtr(m, "page_uid")), ugcArg(ugcStrPtr(m, "page_label")), ugcArg(ugcStrPtr(m, "work_title")),
		payload, string(metaJSON), now)
	if err != nil {
		s.fail(w, r, 500, "internal", "ثبت اشتراک ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	s.okStatus(w, 201, map[string]any{"uid": uid, "url_path": shareURLPath(documentUID, pageUID, uid)})
}

// parseShareMeta خواندن امن meta ذخیره‌شده — خرابی JSON هرگز مسیر را نمی‌شکند.
// با UseNumber تا اعداد همان json.Number بمانند (و start/end از دست نروند).
func parseShareMeta(raw sql.NullString) map[string]any {
	out := map[string]any{}
	if !raw.Valid || raw.String == "" {
		return out
	}
	var parsed map[string]any
	dec := json.NewDecoder(strings.NewReader(raw.String))
	dec.UseNumber()
	if err := dec.Decode(&parsed); err != nil || parsed == nil {
		return map[string]any{}
	}
	return parsed
}

// handleResolveShare GET /shares/{uid} — برای هر کاربر واردشده؛ لغو/ناموجود → 410.
func (s *Server) handleResolveShare(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	sh, ok := scanUGCShare(s.DB.QueryRow(`SELECT `+ugcShareCols+` FROM share_links WHERE uid=?`, uid))
	if !ok || sh.Revoked {
		s.fail(w, r, 410, "gone_cursor", "این اشتراک لغو شده یا وجود ندارد.", false)
		return
	}
	if sh.ExpiresAt.Valid && sh.ExpiresAt.String != "" {
		if exp, err := time.Parse(time.RFC3339, sh.ExpiresAt.String); err == nil && !exp.After(time.Now()) {
			s.fail(w, r, 410, "gone_cursor", "این اشتراک منقضی شده است.", false)
			return
		}
	}
	meta := parseShareMeta(sh.Meta)
	ownerName, _ := meta["owner_name"].(string)
	metaView := map[string]any{}
	if c, ok := meta["color"].(string); ok {
		metaView["color"] = c
	}
	if v, ok := meta["start"].(json.Number); ok {
		if f, err := v.Float64(); err == nil {
			metaView["start"] = f
		}
	}
	if v, ok := meta["end"].(json.Number); ok {
		if f, err := v.Float64(); err == nil {
			metaView["end"] = f
		}
	}
	if b, ok := meta["block_id"].(string); ok {
		metaView["block_id"] = b
	}
	if rv, ok := meta["revayat_index"].(string); ok {
		metaView["revayat_index"] = rv
	} else {
		metaView["revayat_index"] = nil
	}
	item := map[string]any{
		"kind": sh.kindJSON(), "owner_name": ownerName, "document_uid": sh.DocumentUID,
		"page_uid": ugcNil(sh.PageUID), "page_label": ugcNil(sh.PageLabel),
		"work_title": ugcNil(sh.WorkTitle), "payload": sh.Payload,
		"meta": metaView, "created_at": sh.CreatedAt,
	}
	s.ok(w, item)
}

// handleRevokeShare DELETE /shares/{uid} → 204 فقط مالک؛ غیرمالک/ناموجود → 404 (عین BFF).
func (s *Server) handleRevokeShare(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	uid := chi.URLParam(r, "uid")
	sh, ok := scanUGCShare(s.DB.QueryRow(`SELECT `+ugcShareCols+` FROM share_links WHERE uid=?`, uid))
	if !ok || sh.UserUID != u.UID {
		s.fail(w, r, 404, "not_found", "اشتراک مورد نظر یافت نشد.", false)
		return
	}
	if _, err := s.DB.Exec(`UPDATE share_links SET revoked=1 WHERE uid=?`, uid); err != nil {
		s.fail(w, r, 500, "internal", "لغو اشتراک ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// کارهای خروجی PDF (pdf-jobs)
// ============================================================

const ugcPdfStaleRunning = 30 * time.Minute // کارهای running قدیمی‌تر از این مردود می‌شوند
const ugcPdfTokenTTL = 24 * time.Hour       // اعتبار لینک دانلود
const ugcPdfMaxGlobal = 2                   // سقف هم‌زمانی سراسری
const ugcPdfMaxPerUser = 1                  // سقف هم‌زمانی هر کاربر

type ugcPdfJobRow struct {
	UID, UserUID, DocumentUID, Title, Status string
	WorkUID, WorkTitle                       sql.NullString
	PageFrom, PageTo                         sql.NullString
	IncludeNotes                             bool
	OverlayNote, StatusNote                  sql.NullString
	DownloadToken, TokenExpiresAt            sql.NullString
	FileSize                                 sql.NullInt64
	Progress                                 int
	CreatedAt, UpdatedAt                     string
	FinishedAt                               sql.NullString
}

const ugcPdfCols = `uid, user_uid, work_uid, document_uid, title, work_title, page_from, page_to,
        include_notes, overlay_note, status, progress, status_note, download_token, token_expires_at,
        file_size, created_at, updated_at, finished_at`

func scanUGCPdfJob(row interface{ Scan(...any) error }) (*ugcPdfJobRow, bool) {
	j := &ugcPdfJobRow{}
	err := row.Scan(&j.UID, &j.UserUID, &j.WorkUID, &j.DocumentUID, &j.Title, &j.WorkTitle,
		&j.PageFrom, &j.PageTo, &j.IncludeNotes, &j.OverlayNote, &j.Status, &j.Progress,
		&j.StatusNote, &j.DownloadToken, &j.TokenExpiresAt, &j.FileSize,
		&j.CreatedAt, &j.UpdatedAt, &j.FinishedAt)
	if err != nil {
		return nil, false
	}
	return j, true
}

// pdfJobJSON همان شکل PdfJob فرانت؛ download_url فقط برای done با توکن زنده.
// includeToken: توکن خام فقط برای مالک (GET تکی) و مسیرهای داخلی برگردانده می‌شود.
func pdfJobJSON(j *ugcPdfJobRow, includeToken bool) map[string]any {
	tokenLive := false
	if j.Status == "done" && j.DownloadToken.Valid && j.DownloadToken.String != "" && j.TokenExpiresAt.Valid {
		if exp, err := time.Parse(time.RFC3339, j.TokenExpiresAt.String); err == nil {
			tokenLive = exp.After(time.Now())
		}
	}
	var downloadURL any
	if tokenLive {
		downloadURL = fmt.Sprintf("/api/v1/pdf-jobs/%s/download?token=%s",
			url.PathEscape(j.UID), url.QueryEscape(j.DownloadToken.String))
	}
	view := map[string]any{
		"uid": j.UID, "document_uid": j.DocumentUID, "document_label": j.Title,
		"work_title": ugcNil(j.WorkTitle), "status": j.Status, "progress": j.Progress,
		"status_note": ugcNil(j.StatusNote), "file_bytes": func() any {
			if j.FileSize.Valid {
				return j.FileSize.Int64
			}
			return nil
		}(),
		"created_at": j.CreatedAt, "finished_at": ugcNil(j.FinishedAt),
		"download_url": downloadURL, "token_expires_at": ugcNil(j.TokenExpiresAt),
		"params": map[string]any{
			"from": ugcNil(j.PageFrom), "to": ugcNil(j.PageTo),
			"whole":         !j.PageFrom.Valid && !j.PageTo.Valid,
			"include_notes": j.IncludeNotes,
		},
	}
	if includeToken {
		view["download_token"] = ugcNil(j.DownloadToken)
	}
	return view
}

// reapStalePdfJobs بازیافت تنبل: running قدیمی‌تر از ۳۰ دقیقه → failed.
func (s *Server) reapStalePdfJobs() {
	cutoff := time.Now().UTC().Add(-ugcPdfStaleRunning).Format(time.RFC3339)
	_, _ = s.DB.Exec(`UPDATE pdf_jobs SET status='failed',
                status_note='کار بیش از حد طول کشید؛ دوباره تلاش کنید.',
                finished_at=?, updated_at=? WHERE status='running' AND created_at < ?`,
		ugcNow(), ugcNow(), cutoff)
}

func (s *Server) countActivePdfJobs() int {
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM pdf_jobs WHERE status IN ('queued','running')`).Scan(&n)
	return n
}

func (s *Server) countActivePdfJobsForUser(userUID string) int {
	var n int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM pdf_jobs WHERE user_uid=? AND status IN ('queued','running')`, userUID).Scan(&n)
	return n
}

type ugcPageRef struct{ pageUID, label, num string }

// ugcIndexOfLabel تطبیق برچسب چاپی با نرمال‌سازی ارقام — همان indexOfLabel قبلی BFF.
func ugcIndexOfLabel(items []ugcPageRef, label string) int {
	needle := ugcNormalizeDigits(strings.TrimSpace(label))
	for i, it := range items {
		if ugcNormalizeDigits(strings.TrimSpace(it.label)) == needle {
			return i
		}
		if it.num != "" && ugcNormalizeDigits(strings.TrimSpace(it.num)) == needle {
			return i
		}
	}
	return -1
}

// handleCreatePdfJob POST /pdf-jobs → 202 {uid}؛ اعتبارسنجی سند/بازه از کاتالوگ.
func (s *Server) handleCreatePdfJob(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	m, ok := decodeUGCTop(w, r)
	if !ok {
		s.fail(w, r, 422, "invalid_query", "بدنهٔ درخواست معتبر نیست.", false)
		return
	}
	documentUID := strings.TrimSpace(ugcStr(m, "document_uid"))
	if documentUID == "" {
		s.fail(w, r, 422, "invalid_query", "شناسهٔ سند الزامی است.", false)
		return
	}
	fromPtr, toPtr := ugcStrPtr(m, "from"), ugcStrPtr(m, "to")
	if (fromPtr != nil && toPtr == nil) || (fromPtr == nil && toPtr != nil) {
		s.fail(w, r, 422, "invalid_query", "برای بازهٔ صفحهٔ چاپی، هر دو مقدار «از صفحهٔ» و «تا صفحهٔ» لازم است.", false)
		return
	}

	/* اعتبارسنجی سند و برچسب‌های بازه از کاتالوگ خود Go */
	model, err := s.Catalog.Model(documentUID)
	if err != nil {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	pages := make([]ugcPageRef, 0, len(model.Pages))
	for _, p := range model.Pages {
		pages = append(pages, ugcPageRef{pageUID: p.UID, label: p.Label, num: p.Num})
	}
	sort.SliceStable(pages, func(i, j int) bool {
		return model.Pages[i].Serial < model.Pages[j].Serial
	})
	// صفحهٔ آغازین مصنوعی (همان قاعدهٔ handlePagesByLabel) — مقصد واقعی آغاز سند
	if len(model.Blocks) > 0 && (len(model.Pages) == 0 || model.Pages[0].StartBlock > 0) {
		pages = append(pages, ugcPageRef{pageUID: "p-front", label: "—"})
	}
	if fromPtr != nil && toPtr != nil {
		fromIdx := ugcIndexOfLabel(pages, *fromPtr)
		toIdx := ugcIndexOfLabel(pages, *toPtr)
		if fromIdx < 0 || toIdx < 0 || fromIdx > toIdx {
			s.fail(w, r, 422, "invalid_query", "بازهٔ صفحهٔ چاپی معتبر نیست.", false)
			return
		}
	}
	/* بازیافت کارهای گیرکرده + سقف هم‌زمانی */
	s.reapStalePdfJobs()
	if s.countActivePdfJobs() >= ugcPdfMaxGlobal {
		s.fail(w, r, 429, "rate_limited", "کار سنگین دیگری در حال اجراست؛ پس از پایان آن دوباره تلاش کنید.", true)
		return
	}
	if s.countActivePdfJobsForUser(u.UID) >= ugcPdfMaxPerUser {
		s.fail(w, r, 429, "rate_limited", "شما یک کار خروجی در حال اجرا دارید.", true)
		return
	}

	/* برچسب نمایشی سند از بدنه — پیش‌فرض: شناسهٔ سند */
	documentLabel := documentUID
	if v := ugcStrPtr(m, "document_label"); v != nil {
		documentLabel = ugcTrimRunes(*v, 200)
	}
	workTitle := ugcStrPtr(m, "work_title")
	if workTitle != nil {
		t := ugcTrimRunes(*workTitle, 200)
		workTitle = &t
	}
	workUID := ugcStrPtr(m, "work_uid")

	/* یادداشت overlay از نسخهٔ منتشرشدهٔ فعلی سند — بهترین تلاش */
	var overlay any
	if v := s.overlayForDocument(documentUID); v != "" {
		overlay = v
	}

	uid := ugcNewID("pj")
	now := ugcNow()
	includeNotes := 0
	if b, ok := m["include_notes"].(bool); ok && b {
		includeNotes = 1
	}
	if _, err := s.DB.Exec(`INSERT INTO pdf_jobs(`+ugcPdfCols+`)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		uid, u.UID, ugcArg(workUID), documentUID, documentLabel, ugcArg(workTitle),
		ugcArg(fromPtr), ugcArg(toPtr), includeNotes, overlay, "queued", 0, nil,
		ugcUUID(), nil, nil, now, now, nil); err != nil {
		s.fail(w, r, 500, "internal", "ثبت کار خروجی ممکن نشد؛ دوباره تلاش کنید.", true)
		return
	}
	/* GO-08: 202 یک‌بار با بدنهٔ واقعی — WriteHeader دوم (200 در s.ok) superfluous بود */
	s.okStatus(w, 202, map[string]any{"uid": uid})
}

// handleListPdfJobs GET /pdf-jobs — ۲۰ کار آخر من.
func (s *Server) handleListPdfJobs(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	s.reapStalePdfJobs()
	rows, err := s.DB.Query(`SELECT `+ugcPdfCols+` FROM pdf_jobs
                WHERE user_uid=? ORDER BY created_at DESC, uid DESC LIMIT 20`, u.UID)
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست کارهای خروجی در دسترس نیست؛ دوباره تلاش کنید.", true)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		if j, ok := scanUGCPdfJob(rows); ok {
			items = append(items, pdfJobJSON(j, false))
		}
	}
	s.ok(w, map[string]any{"items": items})
}

// handleGetPdfJob GET /pdf-jobs/{uid} — فقط مالک (وگرنه 404).
// download_token و token_expires_at برای اجرای منطق 403/410 سمت مسیر دانلود Next
// برگردانده می‌شود (این پاسخ فقط به مالک می‌رسد).
func (s *Server) handleGetPdfJob(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	uid := chi.URLParam(r, "uid")
	s.reapStalePdfJobs()
	j, ok := scanUGCPdfJob(s.DB.QueryRow(`SELECT `+ugcPdfCols+` FROM pdf_jobs WHERE uid=?`, uid))
	if !ok || j.UserUID != u.UID {
		s.fail(w, r, 404, "not_found", "کار خروجی یافت نشد.", false)
		return
	}
	s.ok(w, pdfJobJSON(j, true))
}

// ---- داخلی runner (service token): claim/progress/complete/fail ----

// handleInternalPdfJobClaim قدیمی‌ترین queued → running + برگرداندن کل ردیف.
// اگر بدنه uid بدهد همان کارِ در صف claim می‌شود (runner همان BFF برای کار خودش)؛
// بدون uid رفتار FIFO پیش‌فرض (worker عمومی).
func (s *Server) handleInternalPdfJobClaim(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UID string `json:"uid"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body)
	now := ugcNow()
	claim := func(where string, args ...any) *ugcPdfJobRow {
		var uid string
		q := `SELECT uid FROM pdf_jobs WHERE status='queued' ` + where + ` ORDER BY created_at ASC, uid ASC LIMIT 1`
		qargs := args
		if err := s.DB.QueryRow(q, qargs...).Scan(&uid); err != nil {
			return nil
		}
		res, err := s.DB.Exec(`UPDATE pdf_jobs SET status='running', updated_at=? WHERE uid=? AND status='queued'`, now, uid)
		if err != nil {
			return nil
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil // دیگری زودتر برداشت
		}
		j, ok := scanUGCPdfJob(s.DB.QueryRow(`SELECT `+ugcPdfCols+` FROM pdf_jobs WHERE uid=?`, uid))
		if !ok {
			return nil
		}
		return j
	}
	var job *ugcPdfJobRow
	if body.UID != "" {
		job = claim(`AND uid=?`, body.UID)
	}
	if job == nil {
		job = claim("")
	}
	if job == nil {
		s.ok(w, map[string]any{"job": nil})
		return
	}
	s.ok(w, map[string]any{"job": pdfJobJSON(job, true)})
}

// handleInternalPdfJobProgress POST /internal/pdf-jobs/{uid}/progress {progress, status_note}.
func (s *Server) handleInternalPdfJobProgress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Progress   int     `json:"progress"`
		StatusNote *string `json:"status_note"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	uid := chi.URLParam(r, "uid")
	if body.Progress < 0 {
		body.Progress = 0
	}
	if body.Progress > 100 {
		body.Progress = 100
	}
	var res sql.Result
	var err error
	if body.StatusNote != nil {
		res, err = s.DB.Exec(`UPDATE pdf_jobs SET progress=?, status_note=?, updated_at=? WHERE uid=?`,
			body.Progress, *body.StatusNote, ugcNow(), uid)
	} else {
		res, err = s.DB.Exec(`UPDATE pdf_jobs SET progress=?, updated_at=? WHERE uid=?`,
			body.Progress, ugcNow(), uid)
	}
	if err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت پیشرفت ممکن نشد.", false)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		s.fail(w, r, 422, "invalid_query", "ثبت پیشرفت ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

// handleInternalPdfJobComplete POST .../complete {token, file_size, status_note?}
// → status=done + progress=100 + token_expires_at=+24h.
func (s *Server) handleInternalPdfJobComplete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token      string  `json:"token"`
		FileSize   int64   `json:"file_size"`
		StatusNote *string `json:"status_note"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	uid := chi.URLParam(r, "uid")
	now := ugcNow()
	exp := time.Now().UTC().Add(ugcPdfTokenTTL).Format(time.RFC3339)
	token := body.Token
	if token == "" {
		token = ugcUUID()
	}
	res, err := s.DB.Exec(`UPDATE pdf_jobs SET status='done', progress=100, status_note=NULL,
                file_size=?, download_token=?, token_expires_at=?, finished_at=?, updated_at=? WHERE uid=?`,
		body.FileSize, token, exp, now, now, uid)
	if err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت پایان کار ممکن نشد.", false)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		s.fail(w, r, 422, "invalid_query", "ثبت پایان کار ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

// handleInternalPdfJobFail POST .../fail {status_note} → failed (فقط کارهای فعال).
func (s *Server) handleInternalPdfJobFail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		StatusNote string `json:"status_note"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	uid := chi.URLParam(r, "uid")
	now := ugcNow()
	res, err := s.DB.Exec(`UPDATE pdf_jobs SET status='failed', status_note=?,
                finished_at=?, updated_at=? WHERE uid=? AND status IN ('queued','running')`,
		body.StatusNote, now, now, uid)
	if err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت شکست کار ممکن نشد.", false)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		s.fail(w, r, 422, "invalid_query", "ثبت شکست کار ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}
