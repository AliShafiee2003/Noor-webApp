package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"noor/internal/catalog"
	"noor/internal/jobs"
	"noor/internal/overlay"
)

// ---- داشبورد مدیریت (§۲۸) — بدون نمایش دادهٔ پژوهشی کاربران (ADMIN-10) ----

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	release, _ := s.DB.ActiveRelease()
	works := s.Catalog.Works()
	var users, sessions, overlays, jobsActive, sources int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > datetime('now')`).Scan(&sessions)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM overlay_revisions WHERE status IN ('draft','validated')`).Scan(&overlays)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')`).Scan(&jobsActive)
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM source_registry`).Scan(&sources)
	disk := diskUsage(s.Cfg.DataDir)
	s.ok(w, map[string]any{
		"release_uid": release, "works_count": len(works), "documents_count": countDocs(works),
		"users_count": users, "active_sessions": sessions, "pending_overlays": overlays,
		"active_jobs": jobsActive, "registered_sources": sources,
		"data_dir_bytes": disk,
		"engine":         s.Cfg.Engine,
		"index_version":  s.Cfg.IndexVersion,
		"n1_version":     "n1-1.0.0",
		"note":           "دادهٔ پژوهشی خصوصی کاربران در این داشبورد نمایش داده نمی‌شود.",
	})
}

func countDocs(works []catalog.Work) int {
	n := 0
	for _, w := range works {
		n += len(w.Documents)
	}
	return n
}

func diskUsage(dir string) int64 {
	var total int64
	entries, err := osReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if st, err := e.Info(); err == nil && !e.IsDir() {
			total += st.Size()
		}
	}
	return total
}

func (s *Server) handleAdminJobs(w http.ResponseWriter, r *http.Request) {
	items, err := s.Jobs.List()
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست کارها در دسترس نیست.", true)
		return
	}
	if items == nil {
		items = []jobs.Job{}
	}
	s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleAdminCancelJob(w http.ResponseWriter, r *http.Request) {
	if err := s.Jobs.Cancel(chi.URLParam(r, "uid")); err != nil {
		s.fail(w, r, 422, "invalid_query", "لغو کار ممکن نشد.", false)
		return
	}
	s.DB.Audit(userOf(r).UID, "job_cancel", "job", chi.URLParam(r, "uid"), "", "")
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleAdminSources(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Query(`SELECT uid, source_document_id, file_path, size_bytes, checksum, status, doc_uid, work_uid, label, last_error FROM source_registry ORDER BY uid`)
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست منابع در دسترس نیست.", true)
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var uid, file, status string
		var docID, checksum, docUID, workUID, label, lastErr sql.NullString
		var size sql.NullInt64
		if err := rows.Scan(&uid, &docID, &file, &size, &checksum, &status, &docUID, &workUID, &label, &lastErr); err != nil {
			continue
		}
		// مسیر دیسک هرگز به مرورگر ارائه نمی‌شود (§۲۰)
		items = append(items, map[string]any{
			"uid": uid, "source_document_id": docID.String, "size_bytes": size.Int64,
			"checksum": checksum.String, "status": status, "document_uid": docUID.String,
			"work_uid": workUID.String, "label": label.String, "last_error": lastErr.String,
		})
	}
	if items == nil {
		items = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": items})
}

// ---- overlay ----

func (s *Server) handleAdminOverlays(w http.ResponseWriter, r *http.Request) {
	items, err := s.Overlay.List(r.URL.Query().Get("status"))
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست اصلاحات در دسترس نیست.", true)
		return
	}
	if items == nil {
		items = []overlay.Revision{}
	}
	s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleAdminCreateOverlay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DocumentUID string          `json:"document_uid"`
		ChangeType  string          `json:"change_type"`
		Target      json.RawMessage `json:"target"`
		BaseHash    string          `json:"base_hash"`
		Reason      string          `json:"reason"`
		OldValue    string          `json:"old_value"`
		NewValue    string          `json:"new_value"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	rev, err := s.Overlay.Create(body.DocumentUID, userOf(r).UID, body.ChangeType, body.Reason, body.BaseHash, body.OldValue, body.NewValue, body.Target)
	if err != nil {
		s.fail(w, r, 422, "invalid_query", err.Error(), false)
		return
	}
	w.WriteHeader(201)
	s.ok(w, rev)
}

func (s *Server) handleAdminValidateOverlay(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	rev, err := s.Overlay.Get(uid)
	if err != nil {
		s.fail(w, r, 404, "not_found", "اصلاح یافت نشد.", false)
		return
	}
	// hash متن مبنا از محتوای فعلی محاسبه می‌شود
	m, err := s.Catalog.Model(rev.DocumentUID)
	hash := ""
	if err == nil {
		for _, b := range m.Blocks {
			if string(rev.Target) != "" && len(b.ID) > 0 {
				hash = overlay.TextHash(m.Text)
				break
			}
		}
		if hash == "" {
			hash = overlay.TextHash(m.Text)
		}
	}
	rev, err = s.Overlay.Validate(uid, hash)
	if err != nil {
		s.fail(w, r, 409, "conflict_version", err.Error(), false)
		return
	}
	s.ok(w, rev)
}

func (s *Server) handleAdminPreviewOverlay(w http.ResponseWriter, r *http.Request) {
	rev, err := s.Overlay.Get(chi.URLParam(r, "uid"))
	if err != nil {
		s.fail(w, r, 404, "not_found", "اصلاح یافت نشد.", false)
		return
	}
	m, err := s.Catalog.Model(rev.DocumentUID)
	if err != nil {
		s.fail(w, r, 404, "not_found", "سند مبنای اصلاح در دسترس نیست.", false)
		return
	}
	affected := []map[string]any{}
	for _, b := range m.Blocks {
		if strings.ContainsAny(b.Text, "x") {
			affected = append(affected, map[string]any{"block_id": b.ID})
		}
	}
	s.ok(w, map[string]any{
		"uid": rev.UID, "status": rev.Status, "change_type": rev.ChangeType,
		"old_value": rev.OldValue, "new_value": rev.NewValue, "reason": rev.Reason,
		"base_hash": rev.BaseHash, "current_hash": overlay.TextHash(m.Text),
		"affected_anchors": affected,
		"note":             "پیش‌نمایش؛ تا انتشار، متن نمایشی کاربران تغییر نمی‌کند.",
	})
}

func (s *Server) handleAdminPublishOverlay(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	rev, err := s.Overlay.Get(uid)
	if err != nil {
		s.fail(w, r, 404, "not_found", "اصلاح یافت نشد.", false)
		return
	}
	if rev.Status != "validated" && rev.Status != "ready" {
		s.fail(w, r, 409, "conflict_version", "انتشار فقط پس از اعتبارسنجی مجاز است.", false)
		return
	}
	// ساخت نسل جدید: نمایهٔ نسل آینده با overlay — در این نسخه، محتوای overlay شده
	// در manifest نسل ثبت و نمایه بازسازی می‌شود (شکست = failed، هرگز نیم‌بنا)
	job, err := s.Jobs.Enqueue("index_rebuild", json.RawMessage(`{"reason":"overlay_publish","overlay_uid":"`+uid+`"}`), userOf(r).UID)
	if err != nil {
		s.fail(w, r, 429, "quota", err.Error(), true)
		return
	}
	_ = s.Overlay.SetStatus(uid, "building", "")
	s.DB.Audit(userOf(r).UID, "overlay_publish_start", "overlay", uid, "job="+job.UID, "")
	s.ok(w, map[string]any{"job_uid": job.UID, "status": "building"})
}

func (s *Server) handleAdminReindex(w http.ResponseWriter, r *http.Request) {
	job, err := s.Jobs.Enqueue("index_rebuild", json.RawMessage(`{"reason":"manual"}`), userOf(r).UID)
	if err != nil {
		s.fail(w, r, 429, "quota", err.Error(), true)
		return
	}
	s.DB.Audit(userOf(r).UID, "index_rebuild_enqueue", "job", job.UID, "", "")
	w.WriteHeader(202)
	s.ok(w, map[string]any{"job_uid": job.UID})
}

func (s *Server) handleAdminReleases(w http.ResponseWriter, r *http.Request) {
	items, err := s.Overlay.Releases()
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست نسل‌ها در دسترس نیست.", true)
		return
	}
	s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleAdminRollback(w http.ResponseWriter, r *http.Request) {
	if err := s.Overlay.Rollback(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
		s.fail(w, r, 409, "conflict_version", err.Error(), false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

// ---- کاربران ----

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Query(`SELECT uid, username, display_name, role, disabled, created_at FROM users ORDER BY created_at`)
	if err != nil {
		s.fail(w, r, 500, "internal", "فهرست کاربران در دسترس نیست.", true)
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var uid, un, dn, role string
		var disabled int
		var at sql.NullString
		if rows.Scan(&uid, &un, &dn, &role, &disabled, &at) == nil {
			items = append(items, map[string]any{"uid": uid, "username": un, "display_name": dn, "role": role, "disabled": disabled == 1, "created_at": at.String})
		}
	}
	if items == nil {
		items = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleAdminCreateInvitation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Role string `json:"role"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	code, err := s.Auth.CreateInvitation(userOf(r).UID, body.Role, 24*time.Hour)
	if err != nil {
		s.fail(w, r, 422, "invalid_query", err.Error(), false)
		return
	}
	s.ok(w, map[string]any{"code": code, "note": "این کد یک‌بارمصرف است و ۲۴ ساعت اعتبار دارد."})
}

func (s *Server) handleAdminChangeRole(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Role string `json:"role"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := s.Auth.ChangeRole(userOf(r).UID, chi.URLParam(r, "uid"), body.Role); err != nil {
		s.fail(w, r, 409, "conflict_version", err.Error(), false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleAdminDisableUser(w http.ResponseWriter, r *http.Request) {
	if err := s.Auth.SetDisabled(userOf(r).UID, chi.URLParam(r, "uid"), true); err != nil {
		s.fail(w, r, 409, "conflict_version", err.Error(), false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleAdminEnableUser(w http.ResponseWriter, r *http.Request) {
	if err := s.Auth.SetDisabled(userOf(r).UID, chi.URLParam(r, "uid"), false); err != nil {
		s.fail(w, r, 409, "conflict_version", err.Error(), false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Query(`SELECT id, actor, action, object_type, object_uid, detail, ip, created_at FROM audit_events ORDER BY id DESC LIMIT 100`)
	if err != nil {
		s.fail(w, r, 500, "internal", "گزارش حسابرسی در دسترس نیست.", true)
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id int
		var actor, action string
		var ot, ou, detail, ip, at sql.NullString
		if rows.Scan(&id, &actor, &action, &ot, &ou, &detail, &ip, &at) == nil {
			items = append(items, map[string]any{"id": id, "actor": actor, "action": action, "object_type": ot.String, "object_uid": ou.String, "detail": detail.String, "ip": ip.String, "created_at": at.String})
		}
	}
	if items == nil {
		items = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": items})
}

// ---- داخلی worker ----

func (s *Server) handleInternalClaim(w http.ResponseWriter, r *http.Request) {
	job, err := s.Jobs.Claim("worker")
	if err != nil {
		s.ok(w, map[string]any{"job": nil})
		return
	}
	s.ok(w, map[string]any{"job": job})
}

func (s *Server) handleInternalProgress(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Progress int    `json:"progress"`
		Note     string `json:"note"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := s.Jobs.Heartbeat(chi.URLParam(r, "uid"), body.Progress, body.Note); err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت پیشرفت ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleInternalComplete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Result json.RawMessage `json:"result"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := s.Jobs.Complete(chi.URLParam(r, "uid"), body.Result); err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت پایان کار ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleInternalFail(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Error string `json:"error"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if err := s.Jobs.Fail(chi.URLParam(r, "uid"), body.Error); err != nil {
		s.fail(w, r, 422, "invalid_query", "ثبت شکست کار ممکن نشد.", false)
		return
	}
	s.ok(w, map[string]any{"ok": true})
}

// handleInternalPublishRelease انتشار نسل پس از ساخت موفق نمایه (pointer اتمیک + audit).
func (s *Server) handleInternalPublishRelease(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReleaseUID string          `json:"release_uid"`
		Manifest   json.RawMessage `json:"manifest"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if body.ReleaseUID == "" {
		s.fail(w, r, 422, "invalid_query", "شناسهٔ نسل الزامی است.", false)
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		s.fail(w, r, 500, "internal", "انتشار نسل ممکن نشد.", true)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO content_releases(uid, created_by, status, manifest, notes) VALUES(?,?,?,?,?)`,
		body.ReleaseUID, "worker", "published", string(body.Manifest), "auto: index rebuild"); err != nil {
		s.fail(w, r, 500, "internal", "ثبت نسل ممکن نشد.", true)
		return
	}
	if _, err := tx.Exec(`INSERT INTO kv(k,v) VALUES('active_release',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, body.ReleaseUID); err != nil {
		s.fail(w, r, 500, "internal", "تغییر pointer نسل ممکن نشد.", true)
		return
	}
	if _, err := tx.Exec(`INSERT INTO outbox(topic, payload) VALUES('release_published', ?)`, body.ReleaseUID); err != nil {
		s.fail(w, r, 500, "internal", "ثبت outbox ممکن نشد.", true)
		return
	}
	if err := tx.Commit(); err != nil {
		s.fail(w, r, 500, "internal", "پایان انتشار ممکن نشد.", true)
		return
	}
	s.DB.Audit("worker", "release_publish", "release", body.ReleaseUID, "internal", "")
	s.ok(w, map[string]any{"ok": true, "release_uid": body.ReleaseUID})
}
