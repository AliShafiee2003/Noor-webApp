package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"noor/internal/catalog"
	"noor/internal/norm"
	"noor/internal/overlay"
	"noor/internal/search"
	"noor/internal/xmlparse"
)

// PassagesCounter شمارش passageهای نمایهٔ فعال (تزریق از main).
var PassagesCounter = func() int { return 0 }

// ---- کتابخانه (§۱۰) ----

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	release, _ := s.DB.ActiveRelease()
	works := s.Catalog.Works()
	passages := PassagesCounter()
	engine := s.EngineName
	if engine == "" {
		engine = "local"
	}
	s.ok(w, map[string]any{
		"library_ready":  passages > 0,
		"index_ready":    passages > 0,
		"works_count":    len(works),
		"passages_count": passages,
		"release_uid":    release,
		"engine":         engine, // موتور واقعی فعال (الف-۲) — همیشه همان چیزی که جست‌وجو اجرا می‌کند
		"note":           "پوشش فعلی نمونهٔ آزمون است؛ کل کتابخانه پس از import منابع واقعی در دسترس خواهد بود.",
	})
}

func (s *Server) handleWorks(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	unpubMap, _ := s.DB.UnpublishedWorkUIDs()

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	lang := strings.TrimSpace(r.URL.Query().Get("language"))
	author := strings.TrimSpace(r.URL.Query().Get("author"))
	sortParam := strings.TrimSpace(r.URL.Query().Get("sort"))
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))

	qFold := norm.Fold(q)
	authorFold := norm.Fold(author)

	var filtered []catalog.Work
	for _, wk := range s.Catalog.Works() {
		isPublished := !unpubMap[wk.UID]
		if !isPublished && !isAdmin {
			continue // کاربران عادی آثار از دسترس خارج شده را نمی‌بینند
		}
		if q != "" {
			tFold := norm.Fold(wk.Title + " " + wk.ShortTitle + " " + wk.UID)
			if !strings.Contains(tFold, qFold) {
				continue
			}
		}
		if lang != "" && wk.Language != lang {
			continue
		}
		if author != "" {
			aFold := norm.Fold(wk.Author)
			if !strings.Contains(aFold, authorFold) {
				continue
			}
		}
		filtered = append(filtered, wk)
	}

	switch sortParam {
	case "volumes":
		sort.SliceStable(filtered, func(i, j int) bool {
			return len(filtered[i].Documents) > len(filtered[j].Documents)
		})
	case "author":
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Author < filtered[j].Author
		})
	case "title":
		fallthrough
	default:
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Title < filtered[j].Title
		})
	}

	total := len(filtered)
	var paged []catalog.Work
	if pageSize > 0 {
		start := (page - 1) * pageSize
		end := start + pageSize
		if start < total {
			if end > total {
				end = total
			}
			paged = filtered[start:end]
		} else {
			paged = []catalog.Work{}
		}
	} else {
		paged = filtered
	}

	var out []map[string]any
	for _, wk := range paged {
		feats := s.Catalog.WorkFeatures(&wk)
		isPublished := !unpubMap[wk.UID]
		out = append(out, map[string]any{
			"uid": wk.UID, "title": wk.Title, "short_title": wk.ShortTitle, "author": wk.Author,
			"publisher": wk.Publisher, "year": wk.Year, "language": wk.Language,
			"documents_count": len(wk.Documents), "topics": wk.Topics, "features": feats,
			"published": isPublished,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	s.ok(w, map[string]any{
		"items":     out,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (s *Server) serveWork(w http.ResponseWriter, wk *catalog.Work, isPublished bool) {
	feats := s.Catalog.WorkFeatures(wk)
	var docs []map[string]any
	for _, d := range wk.Documents {
		// پوشش از دادهٔ واقعیِ نمایه‌سازی می‌آید (unknown = هنوز نمایه نشده)
		cov := map[string]string{
			"pages":           feats.Pages,
			"toc":             feats.TOC,
			"hadith":          feats.Hadith,
			"quran":           feats.Quran,
			"footnotes":       feats.Footnotes,
			"searchable_text": feats.SearchableText,
			"topics":          feats.Topics,
			"links":           feats.Links,
		}
		docs = append(docs, map[string]any{
			"uid": d.UID, "label": d.Label, "kind": d.Kind, "language": d.Language, "coverage": cov,
		})
	}
	s.ok(w, map[string]any{
		"uid": wk.UID, "title": wk.Title, "short_title": wk.ShortTitle, "author": wk.Author,
		"publisher": wk.Publisher, "year": wk.Year, "language": wk.Language, "topics": wk.Topics,
		"documents": docs, "features": feats,
		"volumes_count":   countVolumes(docs),
		"documents_count": len(docs),
		"published":       isPublished,
	})
}

func (s *Server) handleWork(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	wk, ok := s.Catalog.Work(uid)
	if !ok {
		s.fail(w, r, 404, "not_found", "این اثر در کتابخانهٔ موجود نیست.", false)
		return
	}
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	isPublished := s.DB.IsWorkPublished(wk.UID)
	if !isPublished && !isAdmin {
		s.fail(w, r, 404, "not_found", "این اثر از دسترس خارج شده است.", false)
		return
	}
	s.serveWork(w, wk, isPublished)
}

func (s *Server) handleDocumentWork(w http.ResponseWriter, r *http.Request) {
	docUID := chi.URLParam(r, "uid")
	wk, ok := s.Catalog.WorkOfDocument(docUID)
	if !ok {
		s.fail(w, r, 404, "not_found", "این سند در کتابخانهٔ موجود نیست.", false)
		return
	}
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	isPublished := s.DB.IsWorkPublished(wk.UID)
	if !isPublished && !isAdmin {
		s.fail(w, r, 404, "not_found", "این اثر از دسترس خارج شده است.", false)
		return
	}
	s.serveWork(w, wk, isPublished)
}

func (s *Server) checkDocAccess(docUID string, r *http.Request) bool {
	wk, ok := s.Catalog.WorkOfDocument(docUID)
	if !ok {
		return true
	}
	u := userOf(r)
	if u != nil && u.Role == "admin" {
		return true
	}
	return s.DB.IsWorkPublished(wk.UID)
}

func countVolumes(docs []map[string]any) int {
	n := 0
	for _, d := range docs {
		if d["kind"] == "volume" {
			n++
		}
	}
	return n
}

func statusOf(b bool) string {
	if b {
		return "supported"
	}
	return "absent"
}

func (s *Server) handleWorkRelated(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	wk, ok := s.Catalog.Work(uid)
	if !ok {
		s.fail(w, r, 404, "not_found", "این اثر در کتابخانهٔ موجود نیست.", false)
		return
	}
	var out []map[string]any
	for _, rel := range wk.Related {
		target, exists := s.Catalog.Work(rel.Target)
		title := rel.Target
		if exists {
			title = target.Title
		}
		out = append(out, map[string]any{
			"relation_type": rel.RelationType, "target_work_uid": rel.Target,
			"target_title": title, "resolved": exists, "note": rel.Note,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": out})
}

// ---- مطالعه (§۱۱) ----

func (s *Server) handleTOC(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	if !s.checkDocAccess(uid, r) {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	m, err := s.Catalog.Model(uid)
	if err != nil {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	secs := m.Sections
	if secs == nil {
		secs = []*xmlparse.SectionRec{}
	}
	s.ok(w, map[string]any{"sections": secs, "release_uid": s.activeReleaseSafe()})
}

func (s *Server) activeReleaseSafe() string {
	rel, err := s.DB.ActiveRelease()
	if err != nil {
		return "rel-genesis"
	}
	return rel
}

func (s *Server) handlePagesByLabel(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	if !s.checkDocAccess(uid, r) {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	label := r.URL.Query().Get("label")
	m, err := s.Catalog.Model(uid)
	if err != nil {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	var out []map[string]any
	for _, p := range m.Pages {
		if label == "" || p.Label == label {
			out = append(out, map[string]any{"page_uid": p.UID, "label": p.Label, "serial": p.Serial, "num": p.Num, "ambiguous": countLabel(m, label) > 1})
		}
	}
	// اگر سند بلوک پیش از نخستین صفحه دارد، p-front هم یک مقصد واقعی است
	// (در جست‌وجو به‌عنوان صفحهٔ آغاز سند نشانی می‌شود)
	if label == "" && len(m.Blocks) > 0 && (len(m.Pages) == 0 || m.Pages[0].StartBlock > 0) {
		out = append(out, map[string]any{"page_uid": "p-front", "label": "—", "serial": 0, "num": "", "ambiguous": false})
	}
	sort.Slice(out, func(i, j int) bool {
		si, _ := out[i]["serial"].(int)
		sj, _ := out[j]["serial"].(int)
		return si < sj
	})
	if out == nil {
		out = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": out, "page_mapping": pageMappingOf(m)})
}

// pageMappingOf صادق بودن نگاشت صفحه را اعلام می‌کند: exact = از PageBreak
// پایگاه نور؛ approximate = تقسیم ریاضی/یکنواخت (ارجاع صفحه ممکن است خطا داشته باشد).
func pageMappingOf(m *xmlparse.DocModel) string {
	if m.PagesApproximate {
		return "approximate"
	}
	return "exact"
}

func countLabel(m *xmlparse.DocModel, label string) int {
	n := 0
	for _, p := range m.Pages {
		if p.Label == label {
			n++
		}
	}
	return n
}

// handlePage صفحهٔ ساخت‌یافته را برمی‌گرداند (قواعد §۱۱/§۱۹).
func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	docUID := chi.URLParam(r, "uid")
	if !s.checkDocAccess(docUID, r) {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	pageUID := chi.URLParam(r, "pageUID")
	m, err := s.Catalog.Model(docUID)
	if err != nil {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	var page *xmlparse.PageRec
	for i := range m.Pages {
		if m.Pages[i].UID == pageUID {
			page = &m.Pages[i]
			break
		}
	}
	if page == nil && pageUID == "p-front" {
		// صفحهٔ آغازین مصنوعی: بلوک‌های پیش از نخستین صفحهٔ چاپی (یا کل سند بی‌صفحه)
		// نشانیِ واقعیِ مواضع جست‌وجوی «پیش از صفحهٔ اول» است — ساختگی نیست.
		if len(m.Pages) == 0 || m.Pages[0].StartBlock > 0 {
			to := len(m.Blocks) - 1
			if len(m.Pages) > 0 {
				to = m.Pages[0].StartBlock - 1
			}
			if to >= 0 && len(m.Blocks) > 0 {
				page = &xmlparse.PageRec{UID: "p-front", Label: "—", Serial: 0, StartBlock: 0, EndBlock: to}
			}
		}
	}
	if page == nil {
		s.fail(w, r, 404, "not_found", "این صفحه در سند موجود نیست.", false)
		return
	}
	from := page.StartBlock
	to := page.EndBlock
	if to >= len(m.Blocks) {
		to = len(m.Blocks) - 1
	}
	blocks := []xmlparse.Block{}
	if from >= 0 && to >= from && from < len(m.Blocks) {
		blocks = append(blocks, m.Blocks[from:to+1]...)
	}
	// فوترهای مربوط به همین صفحه (شناسه در ارجاع‌های بلوک‌ها)
	needFootnotes := map[string]bool{}
	for _, b := range blocks {
		for _, fr := range b.FootnoteRefs {
			needFootnotes[fr.Ref] = true
		}
	}
	fns := []xmlparse.Footnote{}
	seenFn := map[string]bool{}
	for _, f := range m.Footnotes {
		if !needFootnotes[f.UID] && !pageContainsFootnote(m, page, f) {
			continue
		}
		// dedupe: پاورقی از دو منبع (XML و جدول StoryId=2) ممکن است دوبار بیاید
		key := f.Label + "\x00" + f.Text
		if seenFn[key] {
			continue
		}
		seenFn[key] = true
		fns = append(fns, f)
	}
	if fns == nil {
		fns = []xmlparse.Footnote{}
	}
	// متنِ منتشرشدهٔ همین نسل: اصلاحات publishedِ پیوند‌شده با نسل فعال روی بلوک‌های
	// همین صفحه اعمال می‌شود تا خواننده همان متنی را ببیند که نمایه شده است.
	if ovs, oerr := s.Overlay.ListForDocument(docUID, "published", s.activeReleaseSafe()); oerr == nil && len(ovs) > 0 {
		overlay.ApplyToBlocks(blocks, overlay.ReplacementsOf(ovs))
	}
	overlayUID := s.overlayForDocument(docUID)
	s.ok(w, map[string]any{
		"page_uid": page.UID, "label": page.Label, "serial": page.Serial,
		"blocks": blocks, "footnotes": fns,
		"release_uid":          s.activeReleaseSafe(),
		"overlay_revision_uid": overlayUID,
		"overlay_applied":      overlayUID != "",
		"offset_unit":          "codepoint",
		"page_mapping":         pageMappingOf(m),
	})
}

// pageContainsFootnote جایابی پاورقیِ بی‌ارجاع (پاورقی‌های جدول DB): ابتدا ارجاع صریح با
// برچسب در بلوک‌های صفحه؛ سپس — فقط برای متن به‌قدر کافی بلند — حضور متن پاورقی در صفحه.
// متن خالی/کوتاه پیش‌تر با هر صفحه‌ای جور می‌شد.
func pageContainsFootnote(m *xmlparse.DocModel, page *xmlparse.PageRec, f xmlparse.Footnote) bool {
	if page.StartBlock < 0 {
		return false
	}
	if f.Label != "" {
		for i := page.StartBlock; i <= page.EndBlock && i < len(m.Blocks); i++ {
			for _, fr := range m.Blocks[i].FootnoteRefs {
				if fr.Ref == f.Label {
					return true
				}
			}
		}
	}
	if utf8.RuneCountInString(strings.TrimSpace(f.Text)) < 12 {
		return false
	}
	for i := page.StartBlock; i <= page.EndBlock && i < len(m.Blocks); i++ {
		if strings.Contains(m.Blocks[i].Text, f.Text) {
			return true
		}
	}
	return false
}

// handleAnchor حل anchor (پاورقی/ارجاع) — بدون هدایت حدسی (REL-10).
// overlayForDocument آخرین overlay منتشرشدهٔ سند (برای badge نسخهٔ اصلاح‌شده).
func (s *Server) overlayForDocument(docUID string) string {
	var uid string
	err := s.DB.QueryRow(`SELECT uid FROM overlay_revisions WHERE document_uid=? AND status='published' ORDER BY updated_at DESC LIMIT 1`, docUID).Scan(&uid)
	if err != nil {
		return ""
	}
	return uid
}

func (s *Server) handleAnchor(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	// uid فرمت: docUID:anchor یا footnote uid
	parts := strings.SplitN(uid, ":", 2)
	if len(parts) == 2 {
		m, err := s.Catalog.Model(parts[0])
		if err == nil {
			for _, f := range m.Footnotes {
				if f.UID == parts[1] {
					s.ok(w, map[string]any{"kind": "footnote", "uid": f.UID, "label": f.Label, "text": f.Text, "document_uid": parts[0]})
					return
				}
			}
			for _, h := range m.Hadiths {
				if h.LocalUID == parts[1] {
					s.ok(w, map[string]any{"kind": "hadith", "uid": h.LocalUID, "index": h.Index, "body_blocks": h.BodyBlocks, "sanad_blocks": h.SanadBlocks, "document_uid": parts[0]})
					return
				}
			}
		}
	}
	s.fail(w, r, 404, "not_found", "مقصد این ارجاع در مجموعهٔ موجود قابل حل نیست؛ نشانی اصلی حفظ شده است.", false)
}

// ---- جست‌وجو (§۱۲/§۱۸/§۲۴/§۴۴–۴۷) ----

type asyncSearchJob struct {
	mu         sync.RWMutex
	userUID    string // برای سقف هر کاربر
	sessionUID string
	// engineSID شناسهٔ نشست واقعی موتور (cursor و «کتاب‌ها» به آن بسته‌اند)؛ شناسهٔ async
	// فقط برای پیگیری وضعیت است و ادامه/کتاب‌ها از طریق این نگاشت به نشست موتور می‌رسند.
	engineSID  string
	releaseUID string
	req        search.Request
	status     string // "in_progress", "complete", "failed"
	resp       *search.Response
	err        error
	createdAt  time.Time
}

const (
	maxAsyncJobsTotal = 40               // سقف کل جاب‌های ناهمگام در نصب (§۲۶)
	asyncJobTTL       = 30 * time.Minute // طول عمر مجاز هر جاب (§۲۶)
)

// asyncSem سقف گوروتین‌های جست‌وجوی پس‌زمینه — بدون آن هر کاربر با چند پرس
// بلند می‌توانست بی‌کران گوروتین L4 بسازد (اشباع CPU).
var asyncSem = make(chan struct{}, 4)

const maxAsyncJobsPerUser = 2

var (
	asyncJobsMu sync.RWMutex
	asyncJobs   = make(map[string]*asyncSearchJob)
)

func cleanupAsyncJobsLocked() {
	now := time.Now()
	for sid, job := range asyncJobs {
		if now.Sub(job.createdAt) > asyncJobTTL {
			delete(asyncJobs, sid)
		}
	}
	for len(asyncJobs) >= maxAsyncJobsTotal {
		var oldestSID string
		var oldestTime time.Time
		for sid, job := range asyncJobs {
			if oldestSID == "" || job.createdAt.Before(oldestTime) {
				oldestSID = sid
				oldestTime = job.createdAt
			}
		}
		if oldestSID != "" {
			delete(asyncJobs, oldestSID)
		} else {
			break
		}
	}
}

func (s *Server) filterUnpublishedSearchResults(resp *search.Response) {
	if resp == nil || len(resp.Results) == 0 {
		return
	}
	unpub, err := s.DB.UnpublishedWorkUIDs()
	if err != nil || len(unpub) == 0 {
		return
	}
	var clean []search.Result
	for _, it := range resp.Results {
		if !unpub[it.Work.UID] {
			clean = append(clean, it)
		}
	}
	resp.Results = clean
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	var req search.Request
	if !decodeBody(w, r, &req) {
		return
	}
	if !isAdmin && req.Scope.WorkUID != nil && *req.Scope.WorkUID != "" {
		if !s.DB.IsWorkPublished(*req.Scope.WorkUID) {
			s.fail(w, r, 404, "not_found", "این اثر در دسترس نیست.", false)
			return
		}
	}
	release, _ := s.DB.ActiveRelease()

	// بررسی طول کوئری: بالای ۱۲۸ واژه به صف پردازشی ناهمگام پس‌زمینه هدایت می‌شود (§۱۸/§۲۴)
	tokens := norm.TokenizeAligned(req.Query)
	if len(tokens) > 128 {
		sid := ugcNewID("s-async")
		job := &asyncSearchJob{
			userUID:    u.UID,
			sessionUID: sid,
			releaseUID: release,
			req:        req,
			status:     "in_progress",
			createdAt:  time.Now(),
		}
		asyncJobsMu.Lock()
		cleanupAsyncJobsLocked()
		userJobs := 0
		for _, j := range asyncJobs {
			if j.userUID == u.UID {
				userJobs++
			}
		}
		if userJobs >= maxAsyncJobsPerUser {
			asyncJobsMu.Unlock()
			s.fail(w, r, 429, "rate_limited", "شما چند پرس‌وجوی بلند در حال اجرا دارید؛ پس از پایان دوباره تلاش کنید.", true)
			return
		}
		asyncJobs[sid] = job
		asyncJobsMu.Unlock()

		// اجرای ناهمگام با سقف هم‌زمانی؛ panic هرگز کل سرویس را نمی‌اندازد.
		go func(targetSID string, targetJob *asyncSearchJob) {
			asyncSem <- struct{}{}
			defer func() { <-asyncSem }()
			defer func() {
				if p := recover(); p != nil {
					log.Printf("async search panic: sid=%s panic=%v", targetSID, p)
					targetJob.mu.Lock()
					targetJob.status = "failed"
					targetJob.err = errors.New("خطای داخلی در پردازش پرس‌وجوی بلند")
					targetJob.mu.Unlock()
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()

			resp, err := s.Engine.Search(ctx, &req, release)
			targetJob.mu.Lock()
			defer targetJob.mu.Unlock()
			if err != nil {
				targetJob.status = "failed"
				targetJob.err = err
			} else {
				targetJob.status = "complete"
				// session_uid پاسخ همان نشست موتور می‌ماند (cursor امضاشده با نشست می‌خواند).
				targetJob.engineSID = resp.SessionUID
				targetJob.resp = resp
			}
		}(sid, job)

		// پاسخ فوری Accepted با وضعیت in_progress جهت آزادسازی سریع ترد HTTP
		s.okStatus(w, http.StatusAccepted, &search.Response{
			SessionUID:      sid,
			ReleaseUID:      release,
			CompletionState: "in_progress",
			CountJobUID:     sid,
			CountRelation:   "lower_bound",
			Notice:          "پرس‌وجوی بلند (بیش از ۱۲۸ واژه) به صف پردازش ناهمگام پس‌زمینه ارسال شد.",
		})
		return
	}

	resp, err := s.Engine.Search(r.Context(), &req, release)
	if err != nil {
		s.failSearchErr(w, r, err)
		return
	}
	if !isAdmin {
		s.filterUnpublishedSearchResults(resp)
	}
	s.ok(w, resp)
}

func (s *Server) handleSearchSessionStatus(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "sessionUID")
	asyncJobsMu.Lock()
	cleanupAsyncJobsLocked()
	job, ok := asyncJobs[sid]
	asyncJobsMu.Unlock()

	if !ok {
		s.fail(w, r, 404, "session_not_found", "نشست جست‌وجوی درخواستی یافت نشد یا منقضی شده است.", false)
		return
	}

	job.mu.RLock()
	defer job.mu.RUnlock()

	if job.status == "in_progress" {
		s.ok(w, &search.Response{
			SessionUID:      sid,
			ReleaseUID:      job.releaseUID,
			CompletionState: "in_progress",
			CountJobUID:     sid,
			CountRelation:   "lower_bound",
			Notice:          "پردازش در صف پس‌زمینه در حال اجراست...",
		})
		return
	}

	if job.status == "failed" {
		s.failSearchErr(w, r, job.err)
		return
	}

	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	if !isAdmin {
		s.filterUnpublishedSearchResults(job.resp)
	}
	s.ok(w, job.resp)
}

func (s *Server) handleSearchContinue(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "sessionUID")
	asyncJobsMu.RLock()
	job, isAsync := asyncJobs[sid]
	asyncJobsMu.RUnlock()

	if isAsync {
		job.mu.RLock()
		defer job.mu.RUnlock()
		if job.status == "in_progress" {
			s.ok(w, &search.Response{
				SessionUID:      sid,
				ReleaseUID:      job.releaseUID,
				CompletionState: "in_progress",
				CountJobUID:     sid,
				CountRelation:   "lower_bound",
				Notice:          "پردازش در صف پس‌زمینه در حال اجراست...",
			})
			return
		}
		if job.status == "failed" {
			s.failSearchErr(w, r, job.err)
			return
		}
		if job.engineSID != "" {
			sid = job.engineSID
		}
	}

	var body struct {
		Cursor string `json:"cursor"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	release, _ := s.DB.ActiveRelease()
	resp, err := s.Engine.Continue(r.Context(), sid, body.Cursor, release)
	if err != nil {
		s.failSearchErr(w, r, err)
		return
	}
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	if !isAdmin {
		s.filterUnpublishedSearchResults(resp)
	}
	s.ok(w, resp)
}

func (s *Server) handleSearchBooks(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "sessionUID")
	asyncJobsMu.RLock()
	job, isAsync := asyncJobs[sid]
	asyncJobsMu.RUnlock()
	if isAsync {
		job.mu.RLock()
		status, engineSID, jerr := job.status, job.engineSID, job.err
		job.mu.RUnlock()
		switch {
		case status == "in_progress":
			s.fail(w, r, 409, "search_in_progress", "جست‌وجوی بلند هنوز در حال اجراست؛ پس از پایان دوباره تلاش کنید.", true)
			return
		case status == "failed":
			s.failSearchErr(w, r, jerr)
			return
		case engineSID != "":
			sid = engineSID
		}
	}
	resp, err := s.Engine.BooksGrouped(r.Context(), sid)
	if err != nil {
		s.failSearchErr(w, r, err)
		return
	}
	u := userOf(r)
	isAdmin := u != nil && u.Role == "admin"
	if !isAdmin && len(resp) > 0 {
		unpub, _ := s.DB.UnpublishedWorkUIDs()
		if len(unpub) > 0 {
			var clean []search.BookGroup
			for _, b := range resp {
				if !unpub[b.Work.UID] {
					clean = append(clean, b)
				}
			}
			resp = clean
		}
	}
	s.ok(w, map[string]any{"groups": resp})
}

func errorsAs(err error, target any) bool {
	if g, ok := err.(*search.GoneError); ok {
		if tp, ok2 := target.(**search.GoneError); ok2 {
			*tp = g
			return true
		}
	}
	return false
}

// failSearchErr نگاشت یکنواخت خطاهای موتور جست‌وجو به قرارداد خطا (GO-07):
// نشست منقضی → 410 gone_cursor؛ خرابی زیرساخت موتور/نمایه → 503 engine_unavailable
// قابل‌تلاش؛ بقیه (خطای اعتبارسنجی پرس‌وجوی کاربر) → 422 invalid_query. خرابی
// موتور/OS نباید به کاربر «پرس‌وجوی نامعتبر» گزارش شود.
func (s *Server) failSearchErr(w http.ResponseWriter, r *http.Request, err error) {
	var gone *search.GoneError
	if errorsAs(err, &gone) {
		s.fail(w, r, 410, "gone_cursor", gone.Message, true)
		return
	}
	if isEngineFailure(err) {
		s.fail(w, r, 503, "engine_unavailable", "موتور جست‌وجو موقتاً در دسترس نیست؛ کمی بعد تلاش کنید.", true)
		return
	}
	s.fail(w, r, 422, "invalid_query", err.Error(), true)
}

/*
isEngineFailure classifier حداقلی خطاهای زیرساختی موتور (GO-07).

	بستهٔ search هنوز خطاها را کلاسه‌بندی نمی‌کند؛ این تشخیص افزودنی است و
	رفتار خود موتور تغییر نمی‌دهد. دو مسیر: خطاهای تایپ‌دار (مهلت/شبکه) و
	پیام‌های پایدار زیرساختی بستهٔ search (نمایهٔ در دسترس نیست، خطای SQLite
	پیمایش کاندید، خطاهای HTTP آداپتور OpenSearch). لغوِ سمت کلاینت
	(context.Canceled) خرابی موتور نیست. خطای ناشناخته مثل قبل 422 می‌ماند —
	یعنی تغییر قرارداد فقط 422→503 برای خرابی‌های قطعی موتور است.
*/
func isEngineFailure(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false // قطع اتصال کلاینت، نه خرابی موتور
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	var nerr net.Error
	if errors.As(err, &nerr) {
		return true // *url.Error کلاینت HTTP و timeoutهای شبکه همین‌جا می‌افتند
	}
	msg := err.Error()
	for _, marker := range []string{
		"نمایهٔ جست‌وجو در دسترس نیست", // engine.go: dbHandle بدون نمایه
		"scan candidate", // خطای خواندن نمایهٔ SQLite در پیمایش کاندید
		"opensearch ",    // خطاهای HTTP آداپتور OS («opensearch GET … → HTTP 5xx»)
		"OpenSearch",     // پیام‌های آداپتور OS (سرویس پاسخ نمی‌دهد / پاسخ قابل تحلیل نیست)
		"SQLITE_",        // خطاهای زیرساختی SQLite (نشست/شمارش)
		"database is locked",
		"fts5 engine:", // خطاهای زیرساختی موتور FTS5 (شارد/نسل/MATCH) — search.wrapFTSErr
	} {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

// handleHadithLocations «این روایت در چه کتاب‌هایی آمده؟» (§۴۷، HAD).
// متن بدنهٔ روایت از بلوک‌های ثبت‌شدهٔ مدل سند ساخته می‌شود (بدون سند — HAD-02/03)
// و با حالت normalized_phrase روی کل کتابخانه جست‌وجو می‌شود؛ گروه‌بندی فقط
// تطبیق‌های تأییدشده را نشان می‌دهد. خروجی صادقانه «منابع دارای این عبارت» است —
// ادعای یکسانیِ کامل روایت بدون بررسی کارشناسی نمی‌شود (disclaimer در پاسخ).
func (s *Server) handleHadithLocations(w http.ResponseWriter, r *http.Request) {
	docUID := chi.URLParam(r, "uid")
	if !s.checkDocAccess(docUID, r) {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	localUID := chi.URLParam(r, "localUID")
	// نتایج جست‌وجو شناسهٔ روایت را در شکل anchor (docUID:local) می‌دهند؛
	// شکل محلی (h-101) و کدگذاری %3A نیز پذیرفته می‌شود — هر دو همان روایت‌اند.
	if u, uerr := url.PathUnescape(localUID); uerr == nil {
		localUID = u
	}
	localUID = strings.TrimPrefix(localUID, docUID+":")
	m, err := s.Catalog.Model(docUID)
	if err != nil {
		s.fail(w, r, 404, "not_found", "این سند در دسترس نیست.", false)
		return
	}
	var piece *xmlparse.HadithPiece
	for i := range m.Hadiths {
		if m.Hadiths[i].LocalUID == localUID {
			piece = &m.Hadiths[i] // نخستین قطعه با این شناسه محلی (قطعه‌های هم‌شناسه — HAD-01)
			break
		}
	}
	if piece == nil {
		s.fail(w, r, 404, "not_found", "این شناسهٔ روایت در سند ثبت نشده است.", false)
		return
	}
	hadithInfo := map[string]any{
		"document_uid":  docUID,
		"local_uid":     localUID,
		"piece_index":   piece.Index,
		"revayat_index": piece.RevayatIndex,
		"body_blocks":   len(piece.BodyBlocks),
		"sanad_blocks":  len(piece.SanadBlocks),
	}
	blockByID := make(map[string]string, len(m.Blocks))
	for _, b := range m.Blocks {
		blockByID[b.ID] = b.Text
	}
	var parts []string
	for _, id := range piece.BodyBlocks {
		if t, ok := blockByID[id]; ok && strings.TrimSpace(t) != "" {
			parts = append(parts, t)
		}
	}
	body := strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
	runes := []rune(body)
	hadithInfo["body_length"] = len(runes)
	if len(runes) == 0 {
		s.ok(w, map[string]any{
			"hadith": hadithInfo, "groups": []any{}, "verified_occurrences": 0, "verified_books": 0,
			"query_truncated": false,
			"note":            "بدنهٔ متنی برای این روایت ثبت نشده است (فقط سند یا نشانه‌گذاری ناقص)؛ جست‌وجویی انجام نشد.",
			"disclaimer":      "این فهرست «منابع دارای این عبارت» است؛ یکسانیِ کامل روایت بدون بررسی کارشناسی ادعا نمی‌شود.",
		})
		return
	}
	// سقف قرارداد §۴۴: normalized_phrase تا ۲۰۴۸ code point.
	// جست‌وجو پلکانی و صادقانه است: نخست بدنهٔ کامل (یا برش ۲۰۴۸ با پرچم)،
	// اگر هیچ تطبیق تأییدشده‌ای نیامد، بخش آغازین متن (نقل‌قول‌های جزئی در
	// کتاب‌های دیگر) — هر گذر با «query_excerpt» گزارش می‌شود تا UI صادق بماند.
	runFull := body
	truncated := false
	if len([]rune(runFull)) > 2048 {
		truncated = true
		runFull = strings.TrimSpace(string([]rune(runFull)[:2048]))
		if i := strings.LastIndex(runFull, " "); i > 512 {
			runFull = runFull[:i]
		}
	}
	runesAll := []rune(body)
	cutAt := func(n int) string {
		if n > len(runesAll) {
			n = len(runesAll)
		}
		s := strings.TrimSpace(string(runesAll[:n]))
		if i := strings.LastIndex(s, " "); i > n/3 {
			s = s[:i]
		}
		return s
	}
	type passT struct {
		q    string
		note string
	}
	passes := []passT{{q: runFull, note: "متن کامل بدنهٔ روایت"}}
	if len([]rune(runesAll)) > 160 {
		passes = append(passes, passT{q: cutAt(160), note: "بخش آغازین متن روایت (نخستین ۱۶۰ نویسه)"})
	}
	if len([]rune(runesAll)) > 60 {
		passes = append(passes, passT{q: cutAt(60), note: "عبارت آغازین کوتاه (نخستین ۶۰ نویسه)"})
	}
	release, _ := s.DB.ActiveRelease()
	var groups []search.BookGroup
	// اجتماع کتاب‌ها روی همهٔ گذرها (§۴۶: کامل‌بودن پاسخ «در چه کتاب‌هایی»
	// مقدم بر صرفه است): کتابی که فقط بخش آغازین روایت را نقل کرده هم باید بیاید.
	// هر اثر فقط از نخستین گذری که پیدایش کرده، شمرده می‌شود (بدون دوبارشماری).
	seenWorks := map[string]bool{}
	type passMetaT struct {
		Note       string `json:"note"`
		Query      string `json:"query_excerpt"`
		WorksFound int    `json:"works_found"`
		WorksAdded int    `json:"works_added"`
	}
	passMeta := []passMetaT{}
	for _, p := range passes {
		if strings.TrimSpace(p.q) == "" {
			continue
		}
		req := &search.Request{
			Query:    p.q,
			Mode:     search.NormalizedPhrase,
			Scope:    search.Scope{Target: "library"},
			Sort:     "source",
			PageSize: 50,
		}
		r2, err := s.Engine.Search(r.Context(), req, release)
		if err != nil {
			s.failSearchErr(w, r, err)
			return
		}
		g2, err := s.Engine.BooksGrouped(r.Context(), r2.SessionUID)
		if err != nil {
			s.failSearchErr(w, r, err)
			return
		}
		meta := passMetaT{Note: p.note, Query: p.q, WorksFound: len(g2)}
		for _, g := range g2 {
			if seenWorks[g.Work.UID] {
				continue
			}
			seenWorks[g.Work.UID] = true
			groups = append(groups, g)
			meta.WorksAdded++
		}
		passMeta = append(passMeta, meta)
	}
	// شمارش تجمیعی صادقانه: هر اثر/سند فقط از گذر کشفشده شمرده می‌شود
	totalOcc := 0
	for _, g := range groups {
		for _, d := range g.Documents {
			totalOcc += d.VerifiedOccurrences
		}
	}
	excerpt := body
	if len([]rune(excerpt)) > 320 {
		excerpt = string([]rune(excerpt)[:320]) + "…"
	}
	hadithInfo["body_excerpt"] = excerpt
	/* «فیش‌های من» روی هر سند (RES): شمار فیش‌های فعالِ همین کاربر برای
	   این روایت محلی، گروه‌شده بر سند؛ روی خروجی گروه‌ها لحاظ می‌شود
	   تا کاربر ببیند کدام منبع را قبلاً فیش‌برداری کرده است. */
	clipCounts, cerr := s.Research.CountMyClipsForHadith(userOf(r).UID, localUID)
	if cerr != nil {
		s.fail(w, r, 500, "internal", "شمار فیش‌های این روایت در دسترس نیست.", true)
		return
	}
	type locDoc struct {
		search.DocEvidence
		MyClips int `json:"my_clips"`
	}
	type locGroup struct {
		Work      search.Ref `json:"work"`
		Documents []locDoc   `json:"documents"`
	}
	outGroups := make([]locGroup, 0, len(groups))
	for _, g := range groups {
		lg := locGroup{Work: g.Work, Documents: make([]locDoc, 0, len(g.Documents))}
		for _, d := range g.Documents {
			lg.Documents = append(lg.Documents, locDoc{DocEvidence: d, MyClips: clipCounts[d.Document.UID]})
		}
		outGroups = append(outGroups, lg)
	}
	out := map[string]any{
		"hadith":               hadithInfo,
		"query_truncated":      truncated,
		"query_excerpt":        passes[0].q,
		"pass_note":            passes[0].note,
		"verified_occurrences": totalOcc,
		"verified_books":       len(groups),
		"groups":               outGroups,
		"disclaimer":           "این فهرست «منابع دارای این عبارت» است؛ یکسانیِ کامل روایت بدون بررسی کارشناسی ادعا نمی‌شود.",
	}
	if len(passMeta) > 1 {
		out["passes"] = passMeta
	}
	s.ok(w, out)
}

// ---- موضوعات (§۱۵) — از کاتالوگ (TOP با پوشش صریح) ----

func (s *Server) handleTopics(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	qFold := norm.Fold(q)
	type topicRow struct {
		UID    string `json:"uid"`
		Title  string `json:"title"`
		Count  int    `json:"count"`
		Parent string `json:"parent"`
	}
	// موضوعات از کاتالوگ آثار جمع می‌شود؛ پوشش صریح اعلام می‌شود
	counts := map[string]int{}
	var all []topicRow
	for _, wk := range s.Catalog.Works() {
		for _, t := range wk.Topics {
			counts[t]++
		}
	}
	for t, c := range counts {
		if q != "" {
			tFold := norm.Fold(t)
			if !strings.Contains(tFold, qFold) {
				continue
			}
		}
		all = append(all, topicRow{UID: "topic-" + t, Title: t, Count: c, Parent: ""})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Count != all[j].Count {
			return all[i].Count > all[j].Count
		}
		return all[i].Title < all[j].Title
	})
	if all == nil {
		all = []topicRow{}
	}
	s.ok(w, map[string]any{
		"items":         all,
		"coverage_note": "موضوع‌ها از کاتالوگ آثار می‌آید؛ نبود موضوع به معنی نبود محتوا نیست.",
	})
}

func (s *Server) handleTopicOccurrences(w http.ResponseWriter, r *http.Request) {
	// مواضع از موضوع در کاتالوگ → آثار دارای موضوع
	uid := chi.URLParam(r, "uid")
	if unescaped, err := url.PathUnescape(uid); err == nil {
		uid = unescaped
	}
	title := strings.TrimPrefix(uid, "topic-")
	titleFold := norm.Fold(title)
	var out []map[string]any
	for _, wk := range s.Catalog.Works() {
		hasTopic := false
		for _, t := range wk.Topics {
			if t == title || norm.Fold(t) == titleFold {
				hasTopic = true
				break
			}
		}
		if hasTopic {
			out = append(out, map[string]any{
				"kind":       "work",
				"work_uid":   wk.UID,
				"work_title": wk.Title,
				"note":       "مؤلف: " + wk.Author,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i]["work_title"]) < fmt.Sprint(out[j]["work_title"])
	})
	if out == nil {
		out = []map[string]any{}
	}
	s.ok(w, map[string]any{"items": out, "coverage_note": "پوشش موضوعی در این نسخه در سطح اثر است."})
}

func (s *Server) handleAuthors(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	qFold := norm.Fold(q)
	qComp := strings.ReplaceAll(strings.ReplaceAll(qFold, " ", ""), "\u200c", "")
	toks := norm.Tokenize(qFold)

	counts := map[string]int{}
	for _, wk := range s.Catalog.Works() {
		if wk.Author != "" {
			counts[wk.Author]++
		}
	}

	type authorRow struct {
		Name       string `json:"name"`
		WorksCount int    `json:"works_count"`
	}
	var all []authorRow
	for author, c := range counts {
		if q != "" {
			aFold := norm.Fold(author)
			aComp := strings.ReplaceAll(strings.ReplaceAll(aFold, " ", ""), "\u200c", "")
			matched := strings.Contains(aFold, qFold) || (len([]rune(qComp)) >= 3 && strings.Contains(aComp, qComp))
			if !matched && len(toks) > 1 {
				allToks := true
				authorToks := norm.Tokenize(aFold)
				for _, tk := range toks {
					found := false
					for _, atk := range authorToks {
						if strings.Contains(atk, tk) {
							found = true
							break
						}
					}
					if !found {
						allToks = false
						break
					}
				}
				matched = allToks
			}
			if !matched {
				continue
			}
		}
		all = append(all, authorRow{Name: author, WorksCount: c})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].WorksCount != all[j].WorksCount {
			return all[i].WorksCount > all[j].WorksCount
		}
		return all[i].Name < all[j].Name
	})
	if len(all) > 50 {
		all = all[:50]
	}
	if all == nil {
		all = []authorRow{}
	}
	s.ok(w, map[string]any{
		"items": all,
	})
}

var _ = json.Marshal
