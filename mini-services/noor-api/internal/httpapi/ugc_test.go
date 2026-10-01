package httpapi

// ugc_test.go — آزمون دوکاربهٔ دادهٔ خصوصی کاربر (ج-۸): هایلایت/اشتراک/pdf-jobs.
// همه‌چیز روی httptest با app.sqlite موقت و نشست واقعی دو کاربر (دعوت + CreateSessionFor)
// اجرا می‌شود؛ هیچ درخواست واقعی به :8080 زده نمی‌شود.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"noor/internal/auth"
	"noor/internal/catalog"
	"noor/internal/config"
	"noor/internal/store"
)

func ugcTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	db, err := store.Open(t.TempDir() + "/app.sqlite")
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	am := auth.NewManager(db, 7*24*time.Hour, 24*time.Hour)
	s := &Server{
		Cfg: &config.Config{
			ServiceToken:  "test-internal-token",
			SearchTimeout: 15 * time.Second,
			CookieSecure:  false,
		},
		DB:   db,
		Auth: am,
	}
	ts := httptest.NewServer(s.Router())
	t.Cleanup(ts.Close)
	return s, ts
}

// ugcUser کاربر واقعی با دعوت یک‌بارمصرف می‌سازد و نشست برمی‌گرداند.
func ugcUser(t *testing.T, s *Server, username, display string) string {
	t.Helper()
	code, err := s.Auth.CreateInvitation("usr-system", "reader", time.Hour)
	if err != nil {
		t.Fatalf("CreateInvitation: %v", err)
	}
	u, err := s.Auth.AcceptInvitation(code, username, display, "password-1234")
	if err != nil {
		t.Fatalf("AcceptInvitation: %v", err)
	}
	token, err := s.Auth.CreateSessionFor(u.UID)
	if err != nil {
		t.Fatalf("CreateSessionFor: %v", err)
	}
	return token
}

func ugcDo(t *testing.T, ts *httptest.Server, method, path, token string, body any, headers map[string]string) *http.Response {
	t.Helper()
	var rd io.Reader
	if body != nil {
		bts, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rd = bytes.NewReader(bts)
	}
	req, err := http.NewRequest(method, ts.URL+path, rd)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Noor-CSRF", "test") // سپر mutation سرور — کوکی نشست کافی نیست
	if token != "" {
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func ugcJSON(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode body %q: %v", string(b), err)
	}
	return m
}

func ugcErrMsg(t *testing.T, m map[string]any) string {
	t.Helper()
	errObj, ok := m["error"].(map[string]any)
	if !ok {
		t.Fatalf("no error object: %v", m)
	}
	msg, _ := errObj["message"].(string)
	return msg
}

func ugcItems(t *testing.T, m map[string]any) []any {
	t.Helper()
	items, ok := m["items"].([]any)
	if !ok {
		t.Fatalf("no items array: %v", m)
	}
	return items
}

// ---- هایلایت‌ها ----

func TestUGCHighlightsTwoUsers(t *testing.T) {
	s, ts := ugcTestServer(t)
	tokenA := ugcUser(t, s, "hl-user-a", "کاربر الف")
	tokenB := ugcUser(t, s, "hl-user-b", "کاربر ب")

	// بدون نشست → 401
	resp := ugcDo(t, ts, "GET", "/api/v1/annotations?document_uid=doc-bahar-2", "", nil, nil)
	if resp.StatusCode != 401 {
		t.Fatalf("anon GET status = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// ساخت توسط A
	body := map[string]any{
		"document_uid": "doc-bahar-2", "page_uid": "p-001", "block_id": "b-0012",
		"start": 2, "end": 25, "text": "علم خيرٌ من المال", "color": "not-a-color",
	}
	resp = ugcDo(t, ts, "POST", "/api/v1/annotations", tokenA, body, nil)
	if resp.StatusCode != 201 {
		t.Fatalf("POST annotation status = %d, want 201", resp.StatusCode)
	}
	hl := ugcJSON(t, resp)
	uid, _ := hl["uid"].(string)
	if !strings.HasPrefix(uid, "hl-") {
		t.Fatalf("uid = %q, want hl- prefix", uid)
	}
	// رنگ نامجاز در POST → پیش‌فرض yellow
	if hl["color"] != "yellow" {
		t.Fatalf("color = %v, want yellow", hl["color"])
	}
	if hl["note"] != nil {
		t.Fatalf("note = %v, want null", hl["note"])
	}
	if hl["created_at"] == nil || hl["updated_at"] == nil {
		t.Fatalf("timestamps missing: %v", hl)
	}

	// A می‌بیند
	resp = ugcDo(t, ts, "GET", "/api/v1/annotations?document_uid=doc-bahar-2", tokenA, nil, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("A GET status = %d", resp.StatusCode)
	}
	if n := len(ugcItems(t, ugcJSON(t, resp))); n != 1 {
		t.Fatalf("A list len = %d, want 1", n)
	}

	// document_uid خالی → 422
	resp = ugcDo(t, ts, "GET", "/api/v1/annotations", tokenA, nil, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("GET without document_uid = %d, want 422", resp.StatusCode)
	}

	// B در همان سند چیزی نمی‌بیند
	resp = ugcDo(t, ts, "GET", "/api/v1/annotations?document_uid=doc-bahar-2", tokenB, nil, nil)
	if n := len(ugcItems(t, ugcJSON(t, resp))); n != 0 {
		t.Fatalf("B list len = %d, want 0", n)
	}

	// B PATCH/DELETE روی هایلایت A → 404 با همان پیام فارسی
	resp = ugcDo(t, ts, "PATCH", "/api/v1/annotations/"+uid, tokenB, map[string]any{"color": "pink"}, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("B PATCH status = %d, want 404", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "هایلایت مورد نظر یافت نشد." {
		t.Fatalf("B PATCH message = %q", msg)
	}
	resp = ugcDo(t, ts, "DELETE", "/api/v1/annotations/"+uid, tokenB, nil, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("B DELETE status = %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()

	// A ویرایش رنگ/یادداشت
	resp = ugcDo(t, ts, "PATCH", "/api/v1/annotations/"+uid, tokenA,
		map[string]any{"color": "pink", "note": "یادداشت آزمون"}, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("A PATCH status = %d", resp.StatusCode)
	}
	patched := ugcJSON(t, resp)
	if patched["color"] != "pink" {
		t.Fatalf("patched color = %v, want pink", patched["color"])
	}
	if patched["note"] != "یادداشت آزمون" {
		t.Fatalf("patched note = %v", patched["note"])
	}

	// رنگ نامجاز در PATCH → 422
	resp = ugcDo(t, ts, "PATCH", "/api/v1/annotations/"+uid, tokenA, map[string]any{"color": "purple"}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("PATCH purple = %d, want 422", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "رنگ انتخابی مجاز نیست." {
		t.Fatalf("purple message = %q", msg)
	}

	// چیزی برای تغییر → 422
	resp = ugcDo(t, ts, "PATCH", "/api/v1/annotations/"+uid, tokenA, map[string]any{}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("PATCH empty = %d, want 422", resp.StatusCode)
	}
	resp.Body.Close()

	// بازهٔ نامعتبر در POST → 422
	resp = ugcDo(t, ts, "POST", "/api/v1/annotations", tokenA, map[string]any{
		"document_uid": "doc-bahar-2", "page_uid": "p-001", "block_id": "b-0012",
		"start": 5, "end": 5, "text": "x",
	}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("POST bad range = %d, want 422", resp.StatusCode)
	}
	resp.Body.Close()

	// حذف توسط A → 204؛ تکرار → 404
	resp = ugcDo(t, ts, "DELETE", "/api/v1/annotations/"+uid, tokenA, nil, nil)
	if resp.StatusCode != 204 {
		t.Fatalf("A DELETE status = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "DELETE", "/api/v1/annotations/"+uid, tokenA, nil, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("A DELETE again = %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}

// ---- اشتراک‌ها ----

func TestUGCSharesTwoUsers(t *testing.T) {
	s, ts := ugcTestServer(t)
	tokenA := ugcUser(t, s, "sh-user-a", "کاربر الف")
	tokenB := ugcUser(t, s, "sh-user-b", "کاربر ب")

	body := map[string]any{
		"kind": "highlight", "item_id": "hl-x", "document_uid": "doc-bahar-2",
		"page_uid": "p-001", "page_label": "۱۱۵", "work_title": "بحار الأنوار",
		"payload": "علم خيرٌ من المال",
		"meta":    map[string]any{"color": "green", "start": 2, "end": 25, "block_id": "b-0012", "owner_name": "هکر"},
	}
	resp := ugcDo(t, ts, "POST", "/api/v1/shares", tokenA, body, nil)
	if resp.StatusCode != 201 {
		t.Fatalf("POST share status = %d, want 201", resp.StatusCode)
	}
	created := ugcJSON(t, resp)
	uid, _ := created["uid"].(string)
	if !strings.HasPrefix(uid, "sh-") {
		t.Fatalf("share uid = %q", uid)
	}
	wantURL := fmt.Sprintf("#/read/doc-bahar-2?pg=p-001&shared=%s", uid)
	if created["url_path"] != wantURL {
		t.Fatalf("url_path = %q, want %q", created["url_path"], wantURL)
	}

	// فهرست B خالی؛ فهرست A شامل با excerpt
	resp = ugcDo(t, ts, "GET", "/api/v1/shares", tokenB, nil, nil)
	if n := len(ugcItems(t, ugcJSON(t, resp))); n != 0 {
		t.Fatalf("B shares len = %d, want 0", n)
	}
	resp = ugcDo(t, ts, "GET", "/api/v1/shares", tokenA, nil, nil)
	items := ugcItems(t, ugcJSON(t, resp))
	if len(items) != 1 {
		t.Fatalf("A shares len = %d, want 1", len(items))
	}
	first, _ := items[0].(map[string]any)
	if first["excerpt"] != "علم خيرٌ من المال" {
		t.Fatalf("excerpt = %v", first["excerpt"])
	}

	// kind نامجاز → 422
	resp = ugcDo(t, ts, "POST", "/api/v1/shares", tokenA, map[string]any{"kind": "page", "item_id": "x", "document_uid": "d", "payload": "p"}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("bad kind = %d, want 422", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "نوع اشتراک باید «note» یا «highlight» باشد." {
		t.Fatalf("kind message = %q", msg)
	}

	// payload بلند (8001) → 422
	resp = ugcDo(t, ts, "POST", "/api/v1/shares", tokenA, map[string]any{
		"kind": "note", "item_id": "n1", "document_uid": "doc-bahar-2", "payload": strings.Repeat("الف", 8001),
	}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("long payload = %d, want 422", resp.StatusCode)
	}
	resp.Body.Close()

	// B resolve می‌کند (واردشده) → 200 با owner_name از نشست A (نه کلاینت)
	resp = ugcDo(t, ts, "GET", "/api/v1/shares/"+uid, tokenB, nil, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("B resolve status = %d, want 200", resp.StatusCode)
	}
	resolved := ugcJSON(t, resp)
	if resolved["owner_name"] != "کاربر الف" {
		t.Fatalf("owner_name = %v, want از نشست", resolved["owner_name"])
	}
	meta, _ := resolved["meta"].(map[string]any)
	if meta == nil || meta["color"] != "green" || meta["block_id"] != "b-0012" {
		t.Fatalf("meta = %v", meta)
	}
	if rv, ok := meta["revayat_index"]; !ok || rv != nil {
		t.Fatalf("revayat_index = %v ( باید کلید موجود و null باشد)", rv)
	}

	// B DELETE → همان پاسخ غیرمالک (404 عین BFF)
	resp = ugcDo(t, ts, "DELETE", "/api/v1/shares/"+uid, tokenB, nil, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("B DELETE = %d, want 404", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "اشتراک مورد نظر یافت نشد." {
		t.Fatalf("B DELETE message = %q", msg)
	}

	// اشتراک منقضی → 410
	_, _ = s.DB.Exec(`UPDATE share_links SET expires_at=? WHERE uid=?`, "2020-01-01T00:00:00Z", uid)
	resp = ugcDo(t, ts, "GET", "/api/v1/shares/"+uid, tokenB, nil, nil)
	if resp.StatusCode != 410 {
		t.Fatalf("expired resolve = %d, want 410", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "این اشتراک منقضی شده است." {
		t.Fatalf("expired message = %q", msg)
	}
	_, _ = s.DB.Exec(`UPDATE share_links SET expires_at=NULL WHERE uid=?`, uid)

	// لغو توسط A → 204؛ resolve بعدی → 410
	resp = ugcDo(t, ts, "DELETE", "/api/v1/shares/"+uid, tokenA, nil, nil)
	if resp.StatusCode != 204 {
		t.Fatalf("A revoke = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "GET", "/api/v1/shares/"+uid, tokenB, nil, nil)
	if resp.StatusCode != 410 {
		t.Fatalf("revoked resolve = %d, want 410", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "این اشتراک لغو شده یا وجود ندارد." {
		t.Fatalf("revoked message = %q", msg)
	}
	// uid ناموجود → همان 410
	resp = ugcDo(t, ts, "GET", "/api/v1/shares/sh-does-not-exist", tokenB, nil, nil)
	if resp.StatusCode != 410 {
		t.Fatalf("unknown resolve = %d, want 410", resp.StatusCode)
	}
	resp.Body.Close()
}

// ---- کارهای PDF ----

func TestUGCPdfJobsTwoUsers(t *testing.T) {
	s, ts := ugcTestServer(t)
	cat, err := catalog.Load("../../data/sources")
	if err != nil {
		t.Fatalf("catalog.Load: %v", err)
	}
	s.Catalog = cat

	tokenA := ugcUser(t, s, "pj-user-a", "کاربر الف")
	tokenB := ugcUser(t, s, "pj-user-b", "کاربر ب")
	svcHdr := map[string]string{"X-Noor-Service": "test-internal-token"}

	// اعتبارسنجی: سند ناموجود → 404، نیم‌بازه → 422، برچسب ناموجود → 422
	resp := ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{"document_uid": "doc-nope"}, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("unknown doc = %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{"document_uid": "doc-bahar-2", "from": "۱۱۵"}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("half range = %d, want 422", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{"document_uid": "doc-bahar-2", "from": "۹۹۹", "to": "۹۹۹"}, nil)
	if resp.StatusCode != 422 {
		t.Fatalf("bad labels = %d, want 422", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "بازهٔ صفحهٔ چاپی معتبر نیست." {
		t.Fatalf("labels message = %q", msg)
	}

	// A کار می‌سازد
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{
		"document_uid": "doc-bahar-2", "from": "۱۱۵", "to": "۱۱۶",
		"include_notes": true, "document_label": "ج ۲", "work_title": "بحار الأنوار",
	}, nil)
	if resp.StatusCode != 202 {
		t.Fatalf("A POST = %d, want 202", resp.StatusCode)
	}
	created := ugcJSON(t, resp)
	jobUID, _ := created["uid"].(string)
	if !strings.HasPrefix(jobUID, "pj-") {
		t.Fatalf("job uid = %q", jobUID)
	}

	// B همان uid → 404
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs/"+jobUID, tokenB, nil, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("B GET job = %d, want 404", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "کار خروجی یافت نشد." {
		t.Fatalf("B GET message = %q", msg)
	}

	// A وضعیت کار خودش: queued + params + توکن تخصیص‌یافته
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs/"+jobUID, tokenA, nil, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("A GET job = %d", resp.StatusCode)
	}
	job := ugcJSON(t, resp)
	if job["status"] != "queued" || job["download_token"] == nil || job["download_token"] == "" {
		t.Fatalf("job = %v", job)
	}
	params, _ := job["params"].(map[string]any)
	if params == nil || params["from"] != "۱۱۵" || params["to"] != "۱۱۶" || params["whole"] != false || params["include_notes"] != true {
		t.Fatalf("params = %v", params)
	}

	// سقف 1-per-user: کار A را ابتدا done می‌کنیم تا سقف سراسری فعال نشود؛
	// سپس ردیف running مصنوعی برای A → 429 کاربری
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/"+jobUID+"/complete", "",
		map[string]any{"token": "tok-abc-123", "file_size": 12345}, svcHdr)
	if resp.StatusCode != 200 {
		t.Fatalf("complete = %d", resp.StatusCode)
	}
	resp.Body.Close()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.DB.Exec(`INSERT INTO pdf_jobs(uid, user_uid, document_uid, title, status, progress, download_token, created_at, updated_at)
                VALUES('pj-synth', (SELECT user_uid FROM pdf_jobs WHERE uid=?), 'doc-bahar-2', 'ج ۲', 'running', 50, 'tk', ?, ?)`, jobUID, now, now)
	if err != nil {
		t.Fatalf("insert synthetic: %v", err)
	}
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{"document_uid": "doc-bahar-2"}, nil)
	if resp.StatusCode != 429 {
		t.Fatalf("A second job = %d, want 429", resp.StatusCode)
	}
	if msg := ugcErrMsg(t, ugcJSON(t, resp)); msg != "شما یک کار خروجی در حال اجرا دارید." {
		t.Fatalf("429 message = %q", msg)
	}

	// ردیف مصنوعی حذف می‌شود تا «آزاد بودن B» بررسی شود؛ B کار می‌سازد (کار A قبلاً done شد)
	_, _ = s.DB.Exec(`DELETE FROM pdf_jobs WHERE uid='pj-synth'`)

	// claim داخلی با service token — قدیمی‌ترین queued (کار B)
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenB, map[string]any{"document_uid": "doc-bahar-2"}, nil)
	if resp.StatusCode != 202 {
		t.Fatalf("B POST = %d, want 202", resp.StatusCode)
	}
	jobBUID, _ := ugcJSON(t, resp)["uid"].(string)
	if !strings.HasPrefix(jobBUID, "pj-") {
		t.Fatalf("B job uid = %q", jobBUID)
	}
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/claim", "", map[string]any{}, svcHdr)
	if resp.StatusCode != 200 {
		t.Fatalf("claim = %d", resp.StatusCode)
	}
	claim := ugcJSON(t, resp)
	jobObj, _ := claim["job"].(map[string]any)
	if jobObj == nil || jobObj["uid"] != jobBUID {
		t.Fatalf("claim job = %v, want %q", jobObj, jobBUID)
	}
	if jobObj["status"] != "running" || jobObj["download_token"] == nil || jobObj["download_token"] == "" {
		t.Fatalf("claimed job = %v", jobObj)
	}

	// بدون service token → 403
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/claim", "", map[string]any{}, nil)
	if resp.StatusCode != 403 {
		t.Fatalf("claim no token = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// progress
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/"+jobBUID+"/progress", "", map[string]any{"progress": 50}, svcHdr)
	if resp.StatusCode != 200 {
		t.Fatalf("progress = %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs/"+jobBUID, tokenB, nil, nil)
	job = ugcJSON(t, resp)
	if job["status"] != "running" || job["progress"] != float64(50) {
		t.Fatalf("after progress: %v", job)
	}

	// complete → done + download_url در فهرست B
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/"+jobBUID+"/complete", "",
		map[string]any{"token": "tok-abc-123", "file_size": 12345}, svcHdr)
	if resp.StatusCode != 200 {
		t.Fatalf("complete = %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs", tokenB, nil, nil)
	items := ugcItems(t, ugcJSON(t, resp))
	var listed map[string]any
	for _, it := range items {
		m, _ := it.(map[string]any)
		if m["uid"] == jobBUID {
			listed = m
		}
	}
	if listed == nil {
		t.Fatalf("job %q not in B list", jobBUID)
	}
	if listed["status"] != "done" || listed["file_bytes"] != float64(12345) {
		t.Fatalf("listed = %v", listed)
	}
	if dl, _ := listed["download_url"].(string); !strings.Contains(dl, "token=tok-abc-123") {
		t.Fatalf("download_url = %v", listed["download_url"])
	}
	if te, _ := listed["token_expires_at"].(string); te == "" {
		t.Fatalf("token_expires_at empty")
	}

	// توکن منقضی → download_url خالی
	_, _ = s.DB.Exec(`UPDATE pdf_jobs SET token_expires_at='2020-01-01T00:00:00Z' WHERE uid=?`, jobBUID)
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs", tokenB, nil, nil)
	for _, it := range ugcItems(t, ugcJSON(t, resp)) {
		m, _ := it.(map[string]any)
		if m["uid"] == jobBUID && m["download_url"] != nil {
			t.Fatalf("expired token should have no download_url: %v", m["download_url"])
		}
	}

	// fail داخلی: کار تازهٔ A → claim → fail → A وضعیت failed می‌بیند
	resp = ugcDo(t, ts, "POST", "/api/v1/pdf-jobs", tokenA, map[string]any{"document_uid": "doc-bahar-2"}, nil)
	if resp.StatusCode != 202 {
		t.Fatalf("A POST 2 = %d, want 202", resp.StatusCode)
	}
	jobA2, _ := ugcJSON(t, resp)["uid"].(string)
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/claim", "", map[string]any{}, svcHdr)
	if job := ugcJSON(t, resp)["job"]; job == nil {
		t.Fatalf("expected claim of A2")
	}
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/"+jobA2+"/fail", "",
		map[string]any{"status_note": "خطای آزمایشی موتور PDF"}, svcHdr)
	if resp.StatusCode != 200 {
		t.Fatalf("fail = %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = ugcDo(t, ts, "GET", "/api/v1/pdf-jobs/"+jobA2, tokenA, nil, nil)
	jobA2View := ugcJSON(t, resp)
	if jobA2View["status"] != "failed" || jobA2View["status_note"] != "خطای آزمایشی موتور PDF" {
		t.Fatalf("failed job = %v", jobA2View)
	}
	if dl := jobA2View["download_url"]; dl != nil {
		t.Fatalf("failed job download_url = %v, want null", dl)
	}

	// claim بدون صف → job null
	resp = ugcDo(t, ts, "POST", "/api/v1/internal/pdf-jobs/claim", "", map[string]any{}, svcHdr)
	if job := ugcJSON(t, resp)["job"]; job != nil {
		t.Fatalf("expected null job, got %v", job)
	}
}
