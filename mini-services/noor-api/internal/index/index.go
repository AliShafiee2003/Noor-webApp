// Package index — خط استخراج و نمایه‌سازی مستقل (§۴۵).
// passage = واحد متوالی با anchor؛ بدون overlap تکراری؛ شمارش جدا (TECH-11).
package index

import (
        "crypto/sha256"
        "database/sql"
        "encoding/hex"
        "encoding/json"
        "fmt"
        "strings"

        "noor/internal/norm"
        "noor/internal/xmlparse"
)

// Passage واحد نمایه.
type Passage struct {
        PassageUID    string          `json:"passage_uid"`
        ReleaseUID    string          `json:"release_uid"`
        CollectionUID string          `json:"collection_uid"`
        WorkUID       string          `json:"work_uid"`
        DocumentUID   string          `json:"document_uid"`
        SectionUID    string          `json:"section_uid"`
        PageUID       string          `json:"page_uid"`
        PageLabel     string          `json:"page_label"`
        Language      string          `json:"language"`
        LocalHadith   string          `json:"local_hadith_uid,omitempty"`
        TextOriginal  string          `json:"text_original"`
        TextN1        string          `json:"text_n1"`
        N1Map         []int           `json:"n1_map"`
        SourceStart   int             `json:"source_start"`
        SourceEnd     int             `json:"source_end"`
        RoleRanges    json.RawMessage `json:"role_ranges"`
        Citations     json.RawMessage `json:"citations,omitempty"`
        Fingerprint   string          `json:"fingerprint"`
        BlockStart    int             `json:"block_start"`
        BlockEnd      int             `json:"block_end"`
}

// Builder passages را از مدل سند می‌سازد: گروه‌بندی بر پایهٔ صفحه و نقش‌ها.
type Builder struct{}

type roleRange struct {
        Role       string `json:"role"`
        Start int `json:"start"`
	End   int `json:"end"`
}

// BuildDoc passages یک سند را تولید می‌کند (هر صفحه یک passage؛ صفحات بزرگ تکه‌تکه در مرز بلوک).
func (b *Builder) BuildDoc(releaseUID, collectionUID, workUID, documentUID, language string, m *xmlparse.DocModel) []Passage {
        // صفحات؛ سند بدون صفحه → یک passage کل
        type span struct{ from, to int } // بازهٔ بلوک‌ها
        var pageRanges []struct {
                page  xmlparse.PageRec
                blocks span
        }
        if len(m.Pages) > 0 {
                for i, p := range m.Pages {
                        var r span
                        r.from = p.StartBlock
                        r.to = p.EndBlock
                        if r.to < r.from {
                                r.to = r.from
                        }
                        pr := struct {
                                page   xmlparse.PageRec
                                blocks span
                        }{p, r}
                        pageRanges = append(pageRanges, pr)
                        _ = i
                }
                // بلوک‌های قبل از اولین صفحه
                if m.Pages[0].StartBlock > 0 {
                        pageRanges = append([]struct {
                                page   xmlparse.PageRec
                                blocks span
                        }{{xmlparse.PageRec{UID: "p-front", Label: "—", Serial: 0}, span{0, m.Pages[0].StartBlock - 1}}}, pageRanges...)
                }
        } else {
                pageRanges = append(pageRanges, struct {
                        page   xmlparse.PageRec
                        blocks span
                }{xmlparse.PageRec{UID: "p-front", Label: "—", Serial: 0}, span{0, len(m.Blocks) - 1}})
        }

        // section از block_id
        secOf := map[string]string{}
        var walk func([]*xmlparse.SectionRec)
        walk = func(secs []*xmlparse.SectionRec) {
                for _, sc := range secs {
                        secOf[sc.BlockID] = sc.UID
                        walk(sc.Children)
                }
        }
        walk(m.Sections)

        var out []Passage
        for _, pr := range pageRanges {
                if pr.blocks.from > pr.blocks.to || pr.blocks.from >= len(m.Blocks) {
                        continue
                }
                to := pr.blocks.to
                if to >= len(m.Blocks) {
                        to = len(m.Blocks) - 1
                }
                // تکه‌بندی در مرز بلوک اگر خیلی بزرگ (حدود ۱۰۲۴ توکن — ساده: ۶۰۰۰ نویسه)
                start := pr.blocks.from
                for start <= to {
                        end := start
                        size := 0
                        for end <= to {
                                size += len([]rune(m.Blocks[end].Text)) + 1
                                if size > 6000 && end > start {
                                        break
                                }
                                end++
                        }
                        end--
                        p := buildPassage(releaseUID, collectionUID, workUID, documentUID, language, m, secOf, pr.page, start, end)
                        if p != nil {
                                out = append(out, *p)
                        }
                        start = end + 1
                }
        }
        return out
}

func buildPassage(releaseUID, collectionUID, workUID, documentUID, language string, m *xmlparse.DocModel, secOf map[string]string, page xmlparse.PageRec, from, to int) *Passage {
        var parts []string
        var roles []roleRange
        offInPassage := 0
        var localHadith string
        secUID := ""
        var citations []xmlparse.Citation
        for i := from; i <= to; i++ {
                b := m.Blocks[i]
                parts = append(parts, b.Text)
                // \n بین بلوک‌ها — هرگز چسباندن بدون مرز
                if secUID == "" {
                        secUID = secOf[b.ID]
                }
                if localHadith == "" && b.HadithUID != "" {
                        localHadith = b.HadithUID
                }
                roleRangesForBlock(rolesForBlock(&b), offInPassage, &roles)
                for _, c := range b.Citations {
                        cit := c
                        cit.BlockID = b.ID
                        citations = append(citations, cit)
                }
                offInPassage += len([]rune(b.Text)) + 1
        }
        textOriginal := strings.Join(parts, "\n")
        textN1, n1Map := norm.Normalize(textOriginal)
        hadithLocal := ""
        if localHadith != "" {
                hadithLocal = documentUID + ":" + localHadith
        }
        fingerprint := docFingerprint(textN1)
        cj, _ := json.Marshal(citations)
        rj, _ := json.Marshal(roles)
        return &Passage{
                PassageUID:   passageUID(releaseUID, documentUID, from, to),
                ReleaseUID:   releaseUID,
                CollectionUID: collectionUID,
                WorkUID:      workUID,
                DocumentUID:  documentUID,
                SectionUID:   secUID,
                PageUID:      page.UID,
                PageLabel:    page.Label,
                Language:     language,
                LocalHadith:  hadithLocal,
                TextOriginal: textOriginal,
                TextN1:       textN1,
                N1Map:        n1Map,
                SourceStart:  m.Blocks[from].SourceOffsets[0],
                SourceEnd:    m.Blocks[to].SourceOffsets[1],
                RoleRanges:   rj,
                Citations:    cj,
                Fingerprint:  fingerprint,
                BlockStart:   from,
                BlockEnd:     to,
        }
}

func rolesForBlock(b *xmlparse.Block) []roleRange {
        var out []roleRange
        add := func(role string, s, e int) {
                if e > s {
                        out = append(out, roleRange{Role: role, Start: s, End: e})
                }
        }
        switch b.Type {
        case "sanad":
                add("sanad", 0, len([]rune(b.Text)))
        case "b_note":
                add("b", 0, len([]rune(b.Text)))
        case "sharh":
                add("sharh", 0, len([]rune(b.Text)))
        }
        for _, sp := range b.Spans {
                add(sp.Role, sp.Start, sp.End)
        }
        return out
}

func roleRangesForBlock(rr []roleRange, offset int, acc *[]roleRange) {
        for _, r := range rr {
                *acc = append(*acc, roleRange{Role: r.Role, Start: r.Start + offset, End: r.End + offset})
        }
}

// IndexWriter نمایهٔ نسل مشخص را می‌سازد (immutable per release).
type IndexWriter struct {
        DB *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS passages(
        passage_uid TEXT PRIMARY KEY, release_uid TEXT, collection_uid TEXT, work_uid TEXT, document_uid TEXT,
        section_uid TEXT, page_uid TEXT, page_label TEXT, language TEXT, local_hadith_uid TEXT,
        text_original TEXT, text_n1 TEXT, n1_map TEXT, source_start INTEGER, source_end INTEGER,
        role_ranges TEXT, citations TEXT, fingerprint TEXT, block_start INTEGER, block_end INTEGER);
CREATE INDEX IF NOT EXISTS idx_p_doc ON passages(document_uid);
CREATE INDEX IF NOT EXISTS idx_p_work ON passages(work_uid);
CREATE TABLE IF NOT EXISTS tokens(token_id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE);
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE TABLE IF NOT EXISTS postings(token_id INTEGER, passage_uid TEXT, pos INTEGER);
CREATE INDEX IF NOT EXISTS idx_post_tok ON postings(token_id, passage_uid);
CREATE TABLE IF NOT EXISTS titles(work_uid TEXT PRIMARY KEY, title TEXT, title_n1 TEXT, short_title TEXT, author TEXT, publisher TEXT, language TEXT, topics TEXT);
CREATE INDEX IF NOT EXISTS idx_titles ON titles(title_n1);
`

// OpenRead نمایه را فقط‌خواندنی باز می‌کند.
func OpenRead(path string) (*sql.DB, error) {
        return sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro", path))
}

// OpenWrite برای worker.
func OpenWrite(path string) (*sql.DB, error) {
        return sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path))
}

// TitleRow ردیف عنوان برای نمایهٔ کتاب‌شناسی.
type TitleRow struct {
        WorkUID   string
        Title     string
        ShortTitle string
        Author    string
        Publisher string
        Language  string
        Topics    []string
}

// Rebuild نمایهٔ یک release را از صفر می‌سازد؛ خطا = نسل نامعتبر (هرگز نیم‌بنا منتشر نمی‌شود).
func (w *IndexWriter) Rebuild(releaseUID string, docs []DocInput, titles []TitleRow, progress func(done, total int)) (int, error) {
        if err := w.reset(); err != nil {
                return 0, err
        }
        b := &Builder{}
        total := 0
        for _, d := range docs {
                ps := b.BuildDoc(releaseUID, d.CollectionUID, d.WorkUID, d.DocumentUID, d.Language, d.Model)
                if err := w.writePassages(ps); err != nil {
                        return 0, err
                }
                total += len(ps)
                if progress != nil {
                        progress(total, len(docs))
                }
        }
        if err := w.writeTitles(titles); err != nil {
                return 0, err
        }
        return total, nil
}

type DocInput struct {
        CollectionUID string
        WorkUID       string
        DocumentUID   string
        Language      string
        Model         *xmlparse.DocModel
}

func (w *IndexWriter) reset() error {
        if _, err := w.DB.Exec(schema); err != nil {
                return err
        }
        for _, t := range []string{"postings", "tokens", "passages", "titles"} {
                if _, err := w.DB.Exec(`DELETE FROM ` + t); err != nil {
                        return err
                }
        }
        return nil
}
func (w *IndexWriter) writePassages(ps []Passage) error {
        tx, err := w.DB.Begin()
        if err != nil {
                return err
        }
        defer tx.Rollback()
        tokenIDs := map[string]int{}
        for i := range ps {
                p := &ps[i]
                nm, _ := json.Marshal(p.N1Map)
                if _, err := tx.Exec(`INSERT INTO passages(passage_uid,release_uid,collection_uid,work_uid,document_uid,section_uid,page_uid,page_label,language,local_hadith_uid,text_original,text_n1,n1_map,source_start,source_end,role_ranges,citations,fingerprint,block_start,block_end)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                        p.PassageUID, p.ReleaseUID, p.CollectionUID, p.WorkUID, p.DocumentUID, p.SectionUID, p.PageUID, p.PageLabel, p.Language, p.LocalHadith,
                        p.TextOriginal, p.TextN1, string(nm), p.SourceStart, p.SourceEnd, string(p.RoleRanges), string(p.Citations), p.Fingerprint, p.BlockStart, p.BlockEnd); err != nil {
                        return err
                }
                toks := norm.Tokenize(p.TextN1)
                for pos, t := range toks {
                        id, ok := tokenIDs[t]
                        if !ok {
                                if err := tx.QueryRow(`INSERT INTO tokens(token) VALUES(?) ON CONFLICT(token) DO NOTHING RETURNING token_id`, t).Scan(&id); err != nil {
                                        if err := tx.QueryRow(`SELECT token_id FROM tokens WHERE token=?`, t).Scan(&id); err != nil {
                                                return err
                                        }
                                }
                                tokenIDs[t] = id
                        }
                        if _, err := tx.Exec(`INSERT INTO postings(token_id, passage_uid, pos) VALUES(?,?,?)`, id, p.PassageUID, pos); err != nil {
                                return err
                        }
                }
        }
        return tx.Commit()
}

func (w *IndexWriter) writeTitles(titles []TitleRow) error {
        for _, t := range titles {
                topics, _ := json.Marshal(t.Topics)
                tn := norm.Fold(t.Title)
                sn := norm.Fold(t.ShortTitle)
                if _, err := w.DB.Exec(`INSERT INTO titles(work_uid,title,title_n1,short_title,author,publisher,language,topics)
                        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(work_uid) DO UPDATE SET title=excluded.title`,
                        t.WorkUID, t.Title, tn, sn, t.Author, t.Publisher, t.Language, string(topics)); err != nil {
                        return err
                }
        }
        return nil
}

func passageUID(release, doc string, from, to int) string {
        h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d|%d", release, doc, from, to)))
        return "psg-" + hex.EncodeToString(h[:8])
}

func docFingerprint(textN1 string) string {
        toks := norm.Tokenize(textN1)
        if len(toks) == 0 {
                return ""
        }
        joined := strings.Join(toks, " ")
        h := sha256.Sum256([]byte(joined))
        return "fp-" + hex.EncodeToString(h[:12])
}

