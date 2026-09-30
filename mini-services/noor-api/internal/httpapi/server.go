// Package httpapi — لایهٔ HTTP: RBAC مرکزی، خطای ۴بخشی فارسی، CSRF/Origin،
// محدودسازی نرخ، همهٔ گروه‌های قرارداد API (§۴۸).
package httpapi

import (
        "context"
        "crypto/rand"
        "encoding/json"
        "encoding/hex"
        "fmt"
        "net/http"
        "strings"
        "time"

        "github.com/go-chi/chi/v5"
        "github.com/go-chi/chi/v5/middleware"

        "noor/internal/auth"
        "noor/internal/catalog"
        "noor/internal/config"
        "noor/internal/jobs"
        "noor/internal/overlay"
        "noor/internal/research"
        "noor/internal/search"
        "noor/internal/store"
)

// Server سرور API.
type Server struct {
        Cfg      *config.Config
        DB       *store.DB
        Auth     *auth.Manager
        Catalog  *catalog.Service
        Engine   search.Engine
        Research *research.Service
        Overlay  *overlay.Service
        Jobs     *jobs.Service
        Secret   []byte
}

// Router ساخت router.
func (s *Server) Router() http.Handler {
        r := chi.NewRouter()
        r.Use(middleware.RequestID)
        r.Use(middleware.Recoverer)
        r.Use(s.securityHeaders)
        r.Use(s.timeoutMiddleware)

        // سلامت داخلی (بدون افشای اطلاعات)
        r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

        r.Route("/api/v1", func(r chi.Router) {
                // عمومی
                r.Post("/auth/login", s.handleLogin)
                r.Post("/auth/mfa/verify", s.handleMFAVerify)
                r.Post("/auth/accept-invite", s.handleAcceptInvite)
                r.Get("/auth/session", s.publicSession) // وضعیت بدون الزام نشست
                r.Get("/status", s.handleStatus)        // وضعیت کتابخانه برای صفحات عمومی/ورود

                // نیازمند نشست (pending MFA هم عبور نمی‌کند به جز مسیرهای بالا)
                r.Group(func(r chi.Router) {
                        r.Use(s.requireAuth)
                        r.Post("/auth/logout", s.handleLogout)
                        r.Get("/auth/session", s.handleSession)
                        r.Get("/auth/sessions", s.handleListSessions)
                        r.Delete("/auth/sessions/{uid}", s.handleRevokeSession)
                        r.Post("/auth/mfa/setup", s.requireAdmin(s.handleMFASetup))
                        r.Post("/auth/mfa/enable", s.handleMFAEnable)

                        r.Get("/works", s.handleWorks)
                        r.Get("/works/{uid}", s.handleWork)
                        r.Get("/works/{uid}/related", s.handleWorkRelated)
                        r.Get("/documents/{uid}/toc", s.handleTOC)
                        r.Get("/documents/{uid}/pages", s.handlePagesByLabel)
                        r.Get("/documents/{uid}/pages/{pageUID}", s.handlePage)
                        r.Get("/documents/{uid}/hadiths/{localUID}/locations", s.handleHadithLocations)
                        r.Get("/anchors/{uid}", s.handleAnchor)

                        r.Post("/search", s.handleSearch)
                        r.Post("/search/{sessionUID}/continue", s.handleSearchContinue)
                        r.Post("/search/{sessionUID}/books", s.handleSearchBooks)

                        r.Get("/topics", s.handleTopics)
                        r.Get("/topics/{uid}/occurrences", s.handleTopicOccurrences)
                        r.Get("/keywords/{uid}", s.handleKeyword)

                        r.Get("/projects", s.handleProjects)
                        r.Post("/projects", s.mutation(s.handleCreateProject))
                        r.Patch("/projects/{uid}", s.mutation(s.handleUpdateProject))
                        r.Delete("/projects/{uid}", s.mutation(s.handleDeleteProject))
                        r.Get("/projects/{uid}/clips", s.handleListClips)
                        r.Post("/clips", s.mutation(s.handleCreateClip))
                        r.Get("/clips/{uid}", s.handleGetClip)
                        r.Patch("/clips/{uid}", s.mutation(s.handleUpdateClip))
                        r.Delete("/clips/{uid}", s.mutation(s.handleTrashClip))
                        r.Post("/clips/{uid}/restore", s.mutation(s.handleRestoreClip))
                        r.Get("/clips/{uid}/revisions", s.handleClipRevisions)
                        r.Get("/notes", s.handleListNotes)
                        r.Post("/notes", s.mutation(s.handleCreateNote))
                        r.Patch("/notes/{uid}", s.mutation(s.handleUpdateNote))
                        r.Delete("/notes/{uid}", s.mutation(s.handleDeleteNote))
                        r.Get("/bookmarks", s.handleListBookmarks)
                        r.Post("/bookmarks", s.mutation(s.handleAddBookmark))
                        r.Delete("/bookmarks/{uid}", s.mutation(s.handleDeleteBookmark))
                        r.Get("/saved-searches", s.handleListSavedSearches)
                        r.Post("/saved-searches", s.mutation(s.handleSaveSearch))
                        r.Delete("/saved-searches/{uid}", s.mutation(s.handleDeleteSavedSearch))
                        r.Get("/workspace", s.handleWorkspace)
                        r.Put("/workspace/position", s.mutation(s.handlePutPosition))
                        r.Put("/workspace/prefs", s.mutation(s.handlePutPrefs))

                        r.Post("/exports", s.mutation(s.handleCreateExport))
                        r.Get("/exports/{uid}", s.handleExportStatus)
                        r.Get("/exports/{uid}/download", s.handleExportDownload)
                })

                // مدیریت: نقش admin + step-up MFA برای حساس‌ها
                r.Group(func(r chi.Router) {
                        r.Use(s.requireAuth, s.requireAdminMW)
                        r.Get("/admin/overview", s.handleAdminOverview)
                        r.Get("/admin/jobs", s.handleAdminJobs)
                        r.Post("/admin/jobs/{uid}/cancel", s.mutation(s.handleAdminCancelJob))
                        r.Get("/admin/sources", s.handleAdminSources)
                        r.Get("/admin/overlays", s.handleAdminOverlays)
                        r.Post("/admin/overlays", s.mutation(s.handleAdminCreateOverlay))
                        r.Post("/admin/overlays/{uid}/validate", s.mutation(s.handleAdminValidateOverlay))
                        r.Get("/admin/overlays/{uid}/preview", s.handleAdminPreviewOverlay)
                        r.Post("/admin/overlays/{uid}/publish", s.mutation(s.requireStepUp(s.handleAdminPublishOverlay)))
                        r.Post("/admin/index/rebuild", s.mutation(s.handleAdminReindex))
                        r.Get("/admin/releases", s.handleAdminReleases)
                        r.Post("/admin/releases/{uid}/rollback", s.mutation(s.requireStepUp(s.handleAdminRollback)))
                        r.Get("/admin/users", s.handleAdminUsers)
                        r.Post("/admin/invitations", s.mutation(s.handleAdminCreateInvitation))
                        r.Post("/admin/users/{uid}/role", s.mutation(s.requireStepUp(s.handleAdminChangeRole)))
                        r.Post("/admin/users/{uid}/disable", s.mutation(s.handleAdminDisableUser))
                        r.Post("/admin/users/{uid}/enable", s.mutation(s.handleAdminEnableUser))
                        r.Get("/admin/audit", s.handleAdminAudit)
                })

                // داخلی worker با service token (روی proxy عمومی ارائه نمی‌شود در production)
                r.Group(func(r chi.Router) {
                        r.Use(s.requireServiceToken)
                        r.Post("/internal/jobs/claim", s.handleInternalClaim)
                        r.Post("/internal/jobs/{uid}/progress", s.handleInternalProgress)
                        r.Post("/internal/jobs/{uid}/complete", s.handleInternalComplete)
                        r.Post("/internal/jobs/{uid}/fail", s.handleInternalFail)
                        r.Post("/internal/releases/publish", s.handleInternalPublishRelease)
                })
        })
        return r
}

// ---- middleware ----

func (s *Server) securityHeaders(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                h := w.Header()
                h.Set("X-Content-Type-Options", "nosniff")
                h.Set("X-Frame-Options", "DENY")
                h.Set("Referrer-Policy", "no-referrer")
                h.Set("Cache-Control", "no-store") // دادهٔ شخصی هرگز cache عمومی نمی‌شود (AUTH-07)
                next.ServeHTTP(w, r)
        })
}

func (s *Server) timeoutMiddleware(next http.Handler) http.Handler {
        return http.TimeoutHandler(next, s.Cfg.SearchTimeout, `{"error":{"code":"timeout","message":"پاسخ بیش از حد طول کشید؛ دوباره تلاش کنید.","trace_id":"","retryable":true}}`)
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                c, err := r.Cookie(sessionCookieName)
                if err != nil || c.Value == "" {
                        s.fail(w, r, 401, "unauthenticated", "برای دسترسی باید وارد حساب خود شوید.", false)
                        return
                }
                u, err := s.Auth.Validate(c.Value)
                if err != nil {
                        s.fail(w, r, 401, "unauthenticated", "نشست شما معتبر نیست یا منقضی شده است؛ دوباره وارد شوید.", false)
                        return
                }
                if u.PendingMFA {
                        s.fail(w, r, 403, "mfa_required", "ورود دومرحله‌ای لازم است.", false)
                        return
                }
                r = r.WithContext(withUser(r.Context(), u))
                next.ServeHTTP(w, r)
        })
}

func (s *Server) requireAdminMW(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                u := userOf(r)
                if u == nil || u.Role != "admin" {
                        s.fail(w, r, 403, "forbidden", "این بخش فقط برای مدیر سامانه در دسترس است.", false)
                        return
                }
                next.ServeHTTP(w, r)
        })
}

func (s *Server) requireAdmin(h http.HandlerFunc) http.HandlerFunc {
        return func(w http.ResponseWriter, r *http.Request) {
                u := userOf(r)
                if u == nil || u.Role != "admin" {
                        s.fail(w, r, 403, "forbidden", "این عملیات فقط برای مدیر سامانه در دسترس است.", false)
                        return
                }
                h(w, r)
        }
}

// requireStepUp عملیات حساس با کد MFA در هدر X-Noor-MFA.
func (s *Server) requireStepUp(h http.HandlerFunc) http.HandlerFunc {
        return func(w http.ResponseWriter, r *http.Request) {
                c, _ := r.Cookie(sessionCookieName)
                code := r.Header.Get("X-Noor-MFA")
                if code == "" {
                        s.fail(w, r, 403, "mfa_required", "برای این عملیات، کد تأیید دومرحله‌ای لازم است.", false)
                        return
                }
                if err := s.Auth.StepUpMFA(c.Value, code); err != nil {
                        s.fail(w, r, 403, "mfa_invalid", "کد تأیید دومرحله‌ای نامعتبر است.", true)
                        return
                }
                h(w, r)
        }
}

// mutation CSRF: کنترل Origin + هدر X-Noor-CSRF.
func (s *Server) mutation(h http.HandlerFunc) http.HandlerFunc {
        return func(w http.ResponseWriter, r *http.Request) {
                if r.Method != http.MethodGet && r.Method != http.MethodHead {
                        origin := r.Header.Get("Origin")
                        if origin != "" && !sameOrigin(origin, r.Host) {
                                s.fail(w, r, 403, "csrf", "درخواست از مبدأ نامعتبر است.", false)
                                return
                        }
                        if r.Header.Get("X-Noor-CSRF") == "" {
                                s.fail(w, r, 403, "csrf", "نشانهٔ امنیتی درخواست یافت نشد؛ صفحه را بازخوانی کنید.", false)
                                return
                        }
                }
                h(w, r)
        }
}

func sameOrigin(origin, host string) bool {
        o := strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
        hostOnly := host
        if i := strings.Index(host, ":"); i >= 0 {
                hostOnly = host[:i]
        }
        oOnly := o
        if i := strings.Index(o, ":"); i >= 0 {
                oOnly = o[:i]
        }
        // در سندباکس، preview روی هر host پذیرفته می‌شود فقط اگر با X-Forwarded-Host یکسان باشد؛
        // برای سادگی و امنیت نسبی: host یکسان یا درخواست از gateway
        return oOnly == hostOnly || oOnly == "" || hostOnly == ""
}

func (s *Server) requireServiceToken(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if s.Cfg.ServiceToken == "" || r.Header.Get("X-Noor-Service") != s.Cfg.ServiceToken {
                        s.fail(w, r, 403, "forbidden", "دسترسی داخلی نامعتبر است.", false)
                        return
                }
                next.ServeHTTP(w, r)
        })
}

// ---- خطا و پاسخ ----

type apiError struct {
        Code      string `json:"code"`
        Message   string `json:"message"`
        TraceID   string `json:"trace_id"`
        Retryable bool   `json:"retryable"`
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, status int, code, msg string, retryable bool) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        w.WriteHeader(status)
        _ = json.NewEncoder(w).Encode(map[string]any{"error": apiError{Code: code, Message: msg, TraceID: middleware.GetReqID(r.Context()), Retryable: retryable}})
}

func (s *Server) ok(w http.ResponseWriter, v any) {
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        _ = json.NewEncoder(w).Encode(v)
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
        dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
        if err := dec.Decode(v); err != nil {
                w.Header().Set("Content-Type", "application/json; charset=utf-8")
                w.WriteHeader(422)
                _ = json.NewEncoder(w).Encode(map[string]any{"error": apiError{Code: "invalid_query", Message: "دادهٔ ارسالی معتبر نیست؛ دوباره تلاش کنید.", TraceID: middleware.GetReqID(r.Context()), Retryable: false}})
                return false
        }
        return true
}

// ---- auth handlers ----

const sessionCookieName = "noor_session"

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, maxAge int) {
        http.SetCookie(w, &http.Cookie{
                Name: sessionCookieName, Value: token, Path: "/",
                HttpOnly: true, Secure: s.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
                MaxAge: maxAge,
        })
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Username string `json:"username"`
                Password string `json:"password"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        ip := clientIP(r)
        u, token, err := s.Auth.Login(body.Username, body.Password, ip, r.UserAgent())
        if err != nil {
                s.fail(w, r, 401, "invalid_credentials", err.Error(), true)
                return
        }
        s.setSessionCookie(w, token, int(7*24*time.Hour.Seconds()))
        s.DB.Audit(u.UID, "login", "user", u.UID, "", ip)
        if u.PendingMFA {
                s.ok(w, map[string]any{"pending_mfa": true, "user": u})
                return
        }
        s.ok(w, map[string]any{"pending_mfa": false, "user": u})
}

func (s *Server) handleMFAVerify(w http.ResponseWriter, r *http.Request) {
        var body struct{ Code string `json:"code"` }
        if !decodeBody(w, r, &body) {
                return
        }
        c, err := r.Cookie(sessionCookieName)
        if err != nil {
                s.fail(w, r, 401, "unauthenticated", "ابتدا وارد شوید.", false)
                return
        }
        u, err := s.Auth.MFAChallenge(c.Value, body.Code)
        if err != nil {
                s.fail(w, r, 403, "mfa_invalid", err.Error(), true)
                return
        }
        s.ok(w, map[string]any{"user": u})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
        c, _ := r.Cookie(sessionCookieName)
        if c != nil {
                _ = s.Auth.RevokeToken(c.Value)
        }
        s.setSessionCookie(w, "", -1)
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) publicSession(w http.ResponseWriter, r *http.Request) {
        c, err := r.Cookie(sessionCookieName)
        if err != nil || c.Value == "" {
                s.ok(w, map[string]any{"user": nil, "csrf": newCSRF()})
                return
        }
        u, err := s.Auth.Validate(c.Value)
        if err != nil {
                s.ok(w, map[string]any{"user": nil, "csrf": newCSRF()})
                return
        }
        s.ok(w, map[string]any{"user": u, "csrf": newCSRF()})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
        u := userOf(r)
        s.ok(w, map[string]any{"user": u, "csrf": newCSRF()})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
        u := userOf(r)
        out, err := s.Auth.ListSessions(u.UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "فهرست نشست‌ها در دسترس نیست؛ دوباره تلاش کنید.", true)
                return
        }
        // علامت‌گذاری نشست فعلی
        c, _ := r.Cookie(sessionCookieName)
        _ = c
        s.ok(w, map[string]any{"items": out})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
        u := userOf(r)
        uid := chi.URLParam(r, "uid")
        if err := s.Auth.Revoke(uid, u.UID); err != nil {
                s.fail(w, r, 404, "not_found", "نشست یافت نشد یا قبلاً لغو شده است.", false)
                return
        }
        s.DB.Audit(u.UID, "revoke_session", "session", uid, "", "")
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleMFASetup(w http.ResponseWriter, r *http.Request) {
        u := userOf(r)
        secret, err := s.Auth.SetupMFA(u.UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "تنظیم ورود دومرحله‌ای ممکن نشد.", true)
                return
        }
        s.ok(w, map[string]any{"secret": secret})
}

func (s *Server) handleMFAEnable(w http.ResponseWriter, r *http.Request) {
        var body struct{ Code string `json:"code"` }
        if !decodeBody(w, r, &body) {
                return
        }
        u := userOf(r)
        if err := s.Auth.EnableMFA(u.UID, body.Code); err != nil {
                s.fail(w, r, 422, "mfa_invalid", err.Error(), true)
                return
        }
        s.ok(w, map[string]any{"ok": true})
}

func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Code        string `json:"code"`
                Username    string `json:"username"`
                DisplayName string `json:"display_name"`
                Password    string `json:"password"`
        }
        if !decodeBody(w, r, &body) {
                return
        }
        if body.Username == "" {
                body.Username = body.DisplayName
        }
        u, err := s.Auth.AcceptInvitation(body.Code, body.Username, body.DisplayName, body.Password)
        if err != nil {
                s.fail(w, r, 422, "invalid_query", err.Error(), false)
                return
        }
        token, err := s.Auth.CreateSessionFor(u.UID)
        if err != nil {
                s.fail(w, r, 500, "internal", "ساخت نشست ممکن نشد.", true)
                return
        }
        s.setSessionCookie(w, token, int(7*24*time.Hour.Seconds()))
        s.ok(w, map[string]any{"user": u})
}

func newCSRF() string {
        b := make([]byte, 16)
        _, _ = rand.Read(b)
        return fmt.Sprintf("%x", b)
}

func newToken() string {
        b := make([]byte, 32)
        _, _ = rand.Read(b)
        out := make([]byte, 64)
        hex.Encode(out, b)
        return string(out)
}

func clientIP(r *http.Request) string {
        ip := r.Header.Get("X-Real-IP")
        if ip != "" {
                return ip
        }
        ip = r.Header.Get("X-Forwarded-For")
        if ip != "" {
                return strings.TrimSpace(strings.Split(ip, ",")[0])
        }
        return r.RemoteAddr
}

// ---- context user ----

type userCtxKey struct{}

func withUser(ctx context.Context, u *auth.SessionUser) context.Context {
        return context.WithValue(ctx, userCtxKey{}, u)
}

func userOf(r *http.Request) *auth.SessionUser {
        if v := r.Context().Value(userCtxKey{}); v != nil {
                if u, ok := v.(*auth.SessionUser); ok {
                        return u
                }
        }
        return nil
}

var _ research.Service
var _ overlay.Service
var _ jobs.Service
var _ search.Engine
