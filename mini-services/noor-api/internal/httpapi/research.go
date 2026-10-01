package httpapi

import (
        "encoding/json"
        "net/http"
        "os"
        "path/filepath"
        "strings"

        "github.com/go-chi/chi/v5"
        "github.com/go-chi/chi/v5/middleware"

        "noor/internal/exportpkg"
        "noor/internal/research"
)

// ---- پژوهش (§۱۷) — همه owner-bound ----

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
        items, err := s.Research.ListProjects(userOf(r).UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست پرونده‌ها در دسترس نیست.", true)
                return
        }
        if items == nil {
                items = []research.Project{}
        }
        s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Name string `json:"name"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        p, err := s.Research.CreateProject(userOf(r).UID, body.Name)
        if err != nil {
                s.fail(w, r, 422, "invalid_query", err.Error(), false)
                return
        }
        w.WriteHeader(201)
        s.ok(w, p)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Name     *string `json:"name"`
                Archived *bool   `json:"archived"`
                Version  int     `json:"version"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        p, err := s.Research.UpdateProject(userOf(r).UID, chi.URLParam(r, "uid"), body.Name, body.Archived, body.Version)
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, p)
}

func handleResearchErr(s *Server, w http.ResponseWriter, r *http.Request, err error) {
        if err == research.ErrNotFound {
                s.fail(w, r, 404, "not_found", "این مورد در پژوهش‌های شما یافت نشد.", false)
                return
        }
        var c *research.ErrConflict
        if conflictAs(err, &c) {
                w.Header().Set("Content-Type", "application/json; charset=utf-8")
                w.WriteHeader(409)
                _ = json.NewEncoder(w).Encode(map[string]any{
                        "error": apiError{Code: "conflict_version", Message: c.Error(), TraceID: reqID(r), Retryable: false},
                        "current_version": c.CurrentVersion,
                })
                return
        }
        s.fail(w, r, 422, "invalid_query", err.Error(), false)
}

func conflictAs(err error, target **research.ErrConflict) bool {
        if c, ok := err.(*research.ErrConflict); ok {
                *target = c
                return true
        }
        return false
}

func reqID(r *http.Request) string { return middleware.GetReqID(r.Context()) }

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.DeleteProject(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true, "note": "پرونده به سطل بازیافت رفت؛ فیش‌های آن نیز قابل بازیابی‌اند."})
}

func (s *Server) handleListClips(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        items, err := s.Research.ListClips(userOf(r).UID, chi.URLParam(r, "uid"), q.Get("state"), q.Get("q"), q.Get("tag"))
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست فیش‌ها در دسترس نیست.", true)
                return
        }
        if items == nil {
                items = []research.Clip{}
        }
        s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleCreateClip(w http.ResponseWriter, r *http.Request) {
        var in research.ClipInput
        if !decodeBody(w, r, &in) {
                return
        }
        c, err := s.Research.CreateClip(userOf(r).UID, &in)
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        w.WriteHeader(201)
        s.ok(w, c)
}

func (s *Server) handleGetClip(w http.ResponseWriter, r *http.Request) {
        c, err := s.Research.GetClip(userOf(r).UID, chi.URLParam(r, "uid"))
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, c)
}

func (s *Server) handleUpdateClip(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Version      int       `json:"version"`
                Note         *string   `json:"note"`
                QuoteAsRead  *string   `json:"quote_as_read"`
                Tags         *[]string `json:"tags"`
                ProjectUID   *string   `json:"project_uid"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        c, err := s.Research.UpdateClip(userOf(r).UID, chi.URLParam(r, "uid"), body.Version, body.Note, body.QuoteAsRead, body.Tags, body.ProjectUID)
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, c)
}

func (s *Server) handleTrashClip(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.TrashClip(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleRestoreClip(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.RestoreClip(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleClipRevisions(w http.ResponseWriter, r *http.Request) {
        revs, err := s.Research.ClipRevisions(userOf(r).UID, chi.URLParam(r, "uid"))
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"items": revs})
}

// ---- یادداشت‌ها ----

func (s *Server) handleListNotes(w http.ResponseWriter, r *http.Request) {
        items, err := s.Research.ListNotes(userOf(r).UID, r.URL.Query().Get("document_uid"), r.URL.Query().Get("page_uid"))
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست یادداشت‌ها در دسترس نیست.", true)
                return
        }
        if items == nil {
                items = []research.Note{}
        }
        s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
        var n research.Note
        if !decodeBody(w, r, &n) {
                return
        }
        created, err := s.Research.CreateNote(userOf(r).UID, &n)
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        w.WriteHeader(201)
        s.ok(w, created)
}

func (s *Server) handleUpdateNote(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Version int    `json:"version"`
                Body    string `json:"body"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        n, err := s.Research.UpdateNote(userOf(r).UID, chi.URLParam(r, "uid"), body.Version, body.Body)
        if err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, n)
}

func (s *Server) handleDeleteNote(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.DeleteNote(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

// ---- نشانک‌ها ----

func (s *Server) handleListBookmarks(w http.ResponseWriter, r *http.Request) {
        items, err := s.Research.ListBookmarks(userOf(r).UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست نشانک‌ها در دسترس نیست.", true)
                return
        }
        if items == nil {
                items = []research.Bookmark{}
        }
        s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleAddBookmark(w http.ResponseWriter, r *http.Request) {
        var body struct {
                DocumentUID string `json:"document_uid"`
                PageUID     string `json:"page_uid"`
                Label       string `json:"label"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        b, err := s.Research.AddBookmark(userOf(r).UID, body.DocumentUID, body.PageUID, body.Label)
        if err != nil {
                s.fail(w, r, 422, "invalid_query", err.Error(), false)
                return
        }
        w.WriteHeader(201)
        s.ok(w, b)
}

func (s *Server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.DeleteBookmark(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

// ---- جست‌وجوهای ذخیره ----

func (s *Server) handleListSavedSearches(w http.ResponseWriter, r *http.Request) {
        items, err := s.Research.ListSavedSearches(userOf(r).UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست جست‌وجوهای ذخیره‌شده در دسترس نیست.", true)
                return
        }
        if items == nil {
                items = []research.SavedSearch{}
        }
        s.ok(w, map[string]any{"items": items})
}

func (s *Server) handleSaveSearch(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Name    string          `json:"name"`
                Payload json.RawMessage `json:"payload"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        sv, err := s.Research.SaveSearch(userOf(r).UID, body.Name, body.Payload)
        if err != nil {
                s.fail(w, r, 422, "invalid_query", err.Error(), false)
                return
        }
        w.WriteHeader(201)
        s.ok(w, sv)
}

func (s *Server) handleDeleteSavedSearch(w http.ResponseWriter, r *http.Request) {
        if err := s.Research.DeleteSavedSearch(userOf(r).UID, chi.URLParam(r, "uid")); err != nil {
                handleResearchErr(s, w, r, err)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

// ---- میزکار ----

func (s *Server) handleWorkspace(w http.ResponseWriter, r *http.Request) {
        u := userOf(r)
        ws, err := s.Research.GetWorkspace(u.UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "وضعیت میزکار در دسترس نیست.", true)
                return
        }
        bms, _ := s.Research.ListBookmarks(u.UID)
        s.ok(w, map[string]any{"positions": ws.Positions, "prefs": ws.Prefs, "bookmarks": bms})
}

func (s *Server) handlePutPosition(w http.ResponseWriter, r *http.Request) {
        var body struct {
                DocumentUID string         `json:"document_uid"`
                Position    map[string]any `json:"position"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        if err := s.Research.PutPosition(userOf(r).UID, body.DocumentUID, body.Position); err != nil {
                s.fail(w, r, 500, "internal", "ذخیرهٔ موضع مطالعه ناموفق بود؛ دوباره تلاش کنید.", true)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handlePutPrefs(w http.ResponseWriter, r *http.Request) {
        var body map[string]any
        if !decodeBody(w, r, &body) {
                return
        }
        if err := s.Research.PutPrefs(userOf(r).UID, body); err != nil {
                s.fail(w, r, 500, "internal", "ذخیرهٔ ترجیحات ناموفق بود.", true)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

// ---- خروجی (§۵۱) ----

func (s *Server) handleCreateExport(w http.ResponseWriter, r *http.Request) {
        var body struct {
                ProjectUID string `json:"project_uid"`
                Format     string `json:"format"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        if body.Format == "" {
                body.Format = "md"
        }
        if body.Format != "md" && body.Format != "json" && body.Format != "csv" && body.Format != "print" {
                s.fail(w, r, 422, "invalid_query", "قالب خروجی پشتیبانی نمی‌شود.", false)
                return
        }
        uid := "exp-" + randHexLocal(8)
        _, err := s.DB.Exec(`INSERT INTO export_jobs(uid, owner_user_id, project_uid, format, status) VALUES(?,?,?,?, 'queued')`,
                uid, userOf(r).UID, body.ProjectUID, body.Format)
        if err != nil {
                s.fail(w, r, 500, "internal", "ثبت درخواست خروجی ناموفق بود.", true)
                return
        }
        // تولید همگن برای حجم‌های متعارف (job کم‌اولویت در production)
        go s.runExport(uid)
        w.WriteHeader(202)
        s.ok(w, map[string]any{"export_uid": uid})
}

func (s *Server) runExport(uid string) {
        var owner, projectUID, format string
        if err := s.DB.QueryRow(`SELECT owner_user_id, project_uid, format FROM export_jobs WHERE uid=?`, uid).Scan(&owner, &projectUID, &format); err != nil {
                return
        }
        clipsDB, err := s.Research.ListClips(owner, projectUID, "", "", "")
        if err != nil {
                _, _ = s.DB.Exec(`UPDATE export_jobs SET status='failed', error=? WHERE uid=?`, "فهرست فیش‌ها خوانده نشد", uid)
                return
        }
        var projName string
        _ = s.DB.QueryRow(`SELECT name FROM projects WHERE uid=? AND owner_user_id=?`, projectUID, owner).Scan(&projName)
        release, _ := s.DB.ActiveRelease()
        clips := make([]exportpkg.Clip, 0, len(clipsDB))
        for _, c := range clipsDB {
                wt, _, _, _ := (metaAdapter{s.Catalog}).WorkTitle(c.Source.WorkUID)
                dl := c.Source.PageLabel
                status := ""
                if c.Source.OverlayRev != "" {
                        status = "modified"
                }
                clips = append(clips, exportpkg.Clip{
                        Kind: c.Kind, QuoteOriginal: c.QuoteOriginal, QuoteAsRead: c.QuoteAsRead, Note: c.Note,
                        Tags: c.Tags, Project: projName, Work: orStrDefault(wt, c.Source.WorkUID),
                        Document: c.Source.DocumentUID, PageLabel: dl, Release: release,
                        OverlayStatus: status, CreatedAt: c.CreatedAt,
                })
        }
        var data []byte
        switch format {
        case "json":
                data = exportpkg.JSON(projName, clips)
        case "csv":
                data = exportpkg.CSV(projName, clips)
        case "print":
                data = exportpkg.PrintHTML(projName, clips)
        default:
                data = exportpkg.Markdown(projName, clips)
        }
        dir := filepath.Join(s.Cfg.DataDir, "exports")
        _ = os.MkdirAll(dir, 0o700)
        ext := map[string]string{"md": "md", "json": "json", "csv": "csv", "print": "html"}[format]
        path := filepath.Join(dir, uid+"."+ext)
        if err := os.WriteFile(path, data, 0o600); err != nil {
                _, _ = s.DB.Exec(`UPDATE export_jobs SET status='failed', error=? WHERE uid=?`, "نوشتن فایل خروجی ناموفق بود", uid)
                return
        }
        _, _ = s.DB.Exec(`UPDATE export_jobs SET status='done', file_path=?, finished_at=datetime('now') WHERE uid=?`, path, uid)
}

func orStrDefault(s, d string) string {
        if s == "" {
                return d
        }
        return s
}

func (s *Server) handleExportStatus(w http.ResponseWriter, r *http.Request) {
        var owner, status string
        uid := chi.URLParam(r, "uid")
        err := s.DB.QueryRow(`SELECT owner_user_id, status FROM export_jobs WHERE uid=?`, uid).Scan(&owner, &status)
        if err != nil || owner != userOf(r).UID {
                s.fail(w, r, 404, "not_found", "خروجی یافت نشد.", false)
                return
        }
        s.ok(w, map[string]any{"export_uid": uid, "status": status, "download_ready": status == "done"})
}

func (s *Server) handleExportDownload(w http.ResponseWriter, r *http.Request) {
        var owner, status, path string
        uid := chi.URLParam(r, "uid")
        err := s.DB.QueryRow(`SELECT owner_user_id, status, file_path FROM export_jobs WHERE uid=?`, uid).Scan(&owner, &status, &path)
        if err != nil || owner != userOf(r).UID {
                s.fail(w, r, 404, "not_found", "خروجی یافت نشد.", false)
                return
        }
        if status != "done" || path == "" || !strings.HasPrefix(filepath.Clean(path), filepath.Join(s.Cfg.DataDir, "exports")) {
                s.fail(w, r, 404, "not_found", "فایل خروجی آماده نیست.", false)
                return
        }
        data, err := os.ReadFile(path)
        if err != nil {
                s.fail(w, r, 404, "not_found", "فایل خروجی در دسترس نیست.", false)
                return
        }
        ct := map[string]string{"md": "text/markdown; charset=utf-8", "json": "application/json; charset=utf-8", "csv": "text/csv; charset=utf-8", "html": "text/html; charset=utf-8"}
        w.Header().Set("Content-Type", ct[filepath.Ext(path)[1:]])
        w.Header().Set("Content-Disposition", "attachment; filename=\""+uid+"."+filepath.Ext(path)[1:]+"\"")
        w.Write(data)
}

func randHexLocal(n int) string {
        const chars = "0123456789abcdef"
        b := make([]byte, n)
        _, _ = randReadLocal(b)
        for i := range b {
                b[i] = chars[int(b[i])%len(chars)]
        }
        return string(b)
}
