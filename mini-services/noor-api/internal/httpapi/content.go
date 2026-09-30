package httpapi


import (
        "sort"

        "encoding/json"
        "net/http"
        "net/url"
        "strings"

        "github.com/go-chi/chi/v5"

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
        s.ok(w, map[string]any{
                "library_ready": passages > 0,
                "index_ready":   passages > 0,
                "works_count":   len(works),
                "passages_count": passages,
                "release_uid":   release,
                "note":          "پوشش فعلی نمونهٔ آزمون است؛ کل کتابخانه پس از import منابع واقعی در دسترس خواهد بود.",
        })
}

func (s *Server) handleWorks(w http.ResponseWriter, r *http.Request) {
        q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
        lang := r.URL.Query().Get("language")
        author := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("author")))
        var out []map[string]any
        for _, w := range s.Catalog.Works() {
                if q != "" && !strings.Contains(strings.ToLower(w.Title), q) && !strings.Contains(strings.ToLower(w.ShortTitle), q) && w.UID != q {
                        continue
                }
                if lang != "" && w.Language != lang {
                        continue
                }
                if author != "" && !strings.Contains(strings.ToLower(w.Author), author) {
                        continue
                }
                feats := s.Catalog.WorkFeatures(&w)
                out = append(out, map[string]any{
                        "uid": w.UID, "title": w.Title, "short_title": w.ShortTitle, "author": w.Author,
                        "publisher": w.Publisher, "year": w.Year, "language": w.Language,
                        "documents_count": len(w.Documents), "topics": w.Topics, "features": feats,
                        "published": true,
                })
        }
        if out == nil {
                out = []map[string]any{}
        }
        s.ok(w, map[string]any{"items": out, "total": len(out)})
}

func (s *Server) handleWork(w http.ResponseWriter, r *http.Request) {
        uid := chi.URLParam(r, "uid")
        wk, ok := s.Catalog.Work(uid)
        if !ok {
                s.fail(w, r, 404, "not_found", "این اثر در کتابخانهٔ موجود نیست.", false)
                return
        }
        feats := s.Catalog.WorkFeatures(wk)
        var docs []map[string]any
        for _, d := range wk.Documents {
                var cov map[string]string
                if m, err := s.Catalog.Model(d.UID); err == nil {
                        cov = map[string]string{
                                "pages": statusOf(len(m.Pages) > 0), "toc": statusOf(len(m.Sections) > 0),
                                "hadith": statusOf(len(m.Hadiths) > 0), "quran": statusOf(len(m.Citations) > 0),
                                "footnotes": statusOf(len(m.Footnotes) > 0), "searchable_text": statusOf(len(m.Blocks) > 0),
                                "topics": "absent",
                        }
                        for i := range m.Blocks {
                                if len(m.Blocks[i].Links) > 0 {
                                        cov["links"] = "supported"
                                }
                        }
                        if cov["links"] == "" {
                                cov["links"] = "absent"
                        }
                } else {
                        cov = map[string]string{"searchable_text": "failed"}
                }
                docs = append(docs, map[string]any{
                        "uid": d.UID, "label": d.Label, "kind": d.Kind, "language": d.Language, "coverage": cov,
                })
        }
        s.ok(w, map[string]any{
                "uid": wk.UID, "title": wk.Title, "short_title": wk.ShortTitle, "author": wk.Author,
                "publisher": wk.Publisher, "year": wk.Year, "language": wk.Language, "topics": wk.Topics,
                "documents": docs, "features": feats,
                "volumes_count": countVolumes(docs),
        })
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
        s.ok(w, map[string]any{"items": out})
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
        for _, f := range m.Footnotes {
                if needFootnotes[f.UID] || pageContainsFootnote(m, page, f) {
                        fns = append(fns, f)
                }
        }
        if fns == nil {
                fns = []xmlparse.Footnote{}
        }
        overlayUID := s.overlayForDocument(docUID)
        s.ok(w, map[string]any{
                "page_uid": page.UID, "label": page.Label, "serial": page.Serial,
                "blocks": blocks, "footnotes": fns,
                "release_uid": s.activeReleaseSafe(),
                "overlay_revision_uid": overlayUID,
                "overlay_applied":      overlayUID != "",
                "offset_unit":          "codepoint",
        })
}

func pageContainsFootnote(m *xmlparse.DocModel, page *xmlparse.PageRec, f xmlparse.Footnote) bool {
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

// ---- جست‌وجو (§۱۲/§۴۴–۴۷) ----

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
        var req search.Request
        if !decodeBody(w, r, &req) {
                return
        }
        release, _ := s.DB.ActiveRelease()
        resp, err := s.Engine.Search(r.Context(), &req, release)
        if err != nil {
                var gone *search.GoneError
                if errorsAs(err, &gone) {
                        s.fail(w, r, 410, "gone_cursor", gone.Message, true)
                        return
                }
                s.fail(w, r, 422, "invalid_query", err.Error(), true)
                return
        }
        s.ok(w, resp)
}

func (s *Server) handleSearchContinue(w http.ResponseWriter, r *http.Request) {
        var body struct{ Cursor string `json:"cursor"` }
        if !decodeBody(w, r, &body) {
                return
        }
        release, _ := s.DB.ActiveRelease()
        resp, err := s.Engine.Continue(r.Context(), chi.URLParam(r, "sessionUID"), body.Cursor, release)
        if err != nil {
                var gone *search.GoneError
                if errorsAs(err, &gone) {
                        s.fail(w, r, 410, "gone_cursor", gone.Message, true)
                        return
                }
                s.fail(w, r, 422, "invalid_query", err.Error(), true)
                return
        }
        s.ok(w, resp)
}

func (s *Server) handleSearchBooks(w http.ResponseWriter, r *http.Request) {
        resp, err := s.Engine.BooksGrouped(r.Context(), chi.URLParam(r, "sessionUID"))
        if err != nil {
                var gone *search.GoneError
                if errorsAs(err, &gone) {
                        s.fail(w, r, 410, "gone_cursor", gone.Message, true)
                        return
                }
                s.fail(w, r, 422, "invalid_query", err.Error(), true)
                return
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

// handleHadithLocations «این روایت در چه کتاب‌هایی آمده؟» (§۴۷، HAD).
// متن بدنهٔ روایت از بلوک‌های ثبت‌شدهٔ مدل سند ساخته می‌شود (بدون سند — HAD-02/03)
// و با حالت normalized_phrase روی کل کتابخانه جست‌وجو می‌شود؛ گروه‌بندی فقط
// تطبیق‌های تأییدشده را نشان می‌دهد. خروجی صادقانه «منابع دارای این عبارت» است —
// ادعای یکسانیِ کامل روایت بدون بررسی کارشناسی نمی‌شود (disclaimer در پاسخ).
func (s *Server) handleHadithLocations(w http.ResponseWriter, r *http.Request) {
        docUID := chi.URLParam(r, "uid")
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
                        s.fail(w, r, 422, "invalid_query", err.Error(), true)
                        return
                }
                g2, err := s.Engine.BooksGrouped(r.Context(), r2.SessionUID)
                if err != nil {
                        var gone *search.GoneError
                        if errorsAs(err, &gone) {
                                s.fail(w, r, 410, "gone_cursor", gone.Message, true)
                                return
                        }
                        s.fail(w, r, 422, "invalid_query", err.Error(), true)
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
        out := map[string]any{
                "hadith":               hadithInfo,
                "query_truncated":      truncated,
                "query_excerpt":        passes[0].q,
                "pass_note":            passes[0].note,
                "verified_occurrences": totalOcc,
                "verified_books":       len(groups),
                "groups":               groups,
                "disclaimer":           "این فهرست «منابع دارای این عبارت» است؛ یکسانیِ کامل روایت بدون بررسی کارشناسی ادعا نمی‌شود.",
        }
        if len(passMeta) > 1 {
                out["passes"] = passMeta
        }
        s.ok(w, out)
}

// ---- موضوعات (§۱۵) — از کاتالوگ (TOP با پوشش صریح) ----

func (s *Server) handleTopics(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query().Get("q")
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
                if q != "" && !strings.Contains(t, q) {
                        continue
                }
                all = append(all, topicRow{UID: "topic-" + t, Title: t, Count: c, Parent: ""})
        }
        if all == nil {
                all = []topicRow{}
        }
        s.ok(w, map[string]any{"items": all, "coverage_note": "فهرست موضوعی فقط منابع دارای نمایهٔ موضوعی را پوشش می‌دهد؛ نبود موضوع به معنی نبود محتوا نیست."})
}

func (s *Server) handleTopicOccurrences(w http.ResponseWriter, r *http.Request) {
        // پیاده‌سازی ساده و صادقانه: مواضع از موضوع در کاتالوگ → آثار دارای موضوع
        uid := chi.URLParam(r, "uid")
        title := strings.TrimPrefix(uid, "topic-")
        var out []map[string]any
        for _, wk := range s.Catalog.Works() {
                for _, t := range wk.Topics {
                        if t == title {
                                out = append(out, map[string]any{
                                        "kind": "work", "work_uid": wk.UID, "work_title": wk.Title,
                                        "note": "این اثر در فهرست موضوعی ثبت شده است؛ برای مواضع دقیق، جست‌وجوی متنی در آن انجام دهید.",
                                })
                        }
                }
        }
        if out == nil {
                out = []map[string]any{}
        }
        s.ok(w, map[string]any{"items": out, "coverage_note": "پوشش موضوعی در این نسخه در سطح اثر است."})
}

func (s *Server) handleKeyword(w http.ResponseWriter, r *http.Request) {
        s.ok(w, map[string]any{"items": []any{}, "note": "کلیدواژه‌های تفصیلی پس از نمایه‌سازی منابع دارای این نشانه‌گذاری فعال می‌شوند."})
}

var _ = json.Marshal
