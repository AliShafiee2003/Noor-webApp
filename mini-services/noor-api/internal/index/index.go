// Package index — خط استخراج و نمایه‌سازی مستقل (§۴۵).
// passage = واحد متوالی با anchor؛ بدون overlap تکراری؛ شمارش جدا (TECH-11).
package index

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"noor/internal/norm"
	"noor/internal/xmlparse"
)

// Passage واحد نمایه.
type Passage struct {
	PassageUID    string `json:"passage_uid"`
	ReleaseUID    string `json:"release_uid"`
	CollectionUID string `json:"collection_uid"`
	WorkUID       string `json:"work_uid"`
	DocumentUID   string `json:"document_uid"`
	SectionUID    string `json:"section_uid"`
	PageUID       string `json:"page_uid"`
	PageLabel     string `json:"page_label"`
	Language      string `json:"language"`
	LocalHadith   string `json:"local_hadith_uid,omitempty"`
	// RevayatIndex شمارهٔ درون‌منبع روایت (HAD-08) — برای نمایش در کارت نتیجه؛
	// شناسهٔ محلی است و به هیچ کتاب دیگر تعمیم نمی‌یابد.
	RevayatIndex string          `json:"revayat_index,omitempty"`
	TextOriginal string          `json:"text_original"`
	TextN1       string          `json:"text_n1"`
	N1Map        []int           `json:"n1_map"`
	SourceStart  int             `json:"source_start"`
	SourceEnd    int             `json:"source_end"`
	RoleRanges   json.RawMessage `json:"role_ranges"`
	Citations    json.RawMessage `json:"citations,omitempty"`
	Fingerprint  string          `json:"fingerprint"`
	BlockStart   int             `json:"block_start"`
	BlockEnd     int             `json:"block_end"`
	OverlapRunes int             `json:"overlap_runes"`
}

// chunkOverlapRunes هم‌پوشانی طراحی‌شدهٔ مرز قطعه‌ها بر حسب code point (SEARCH-02).
// متن قطعهٔ جدید با «آخرین N نویسهٔ قطعهٔ پیشینِ مجاور» آغاز می‌شود تا عبارتی که
// مرز قطعه یا صفحه را می‌پیماید درون یک passage یافت‌شدنی بماند (وگرنه verifier
// که فقط متن passage را می‌بیند هرگز آن را نمی‌یابد). با NOOR_CHUNK_OVERLAP
// قابل تغییر است (۰ = رفتار قدیمیِ بدون هم‌پوشانی؛ برای آزمون و مقایسه).
const chunkOverlapRunes = 200

// overlapSetting هم‌پوشانی مؤثر را از محیط می‌خواند؛ مقدار نامعتبر/منفی = ۰.
// در هر BuildDoc یک بار خوانده می‌شود تا آزمون‌ها بتوانند پیش از ساخت نمایه تنظیمش کنند.
func overlapSetting() int {
	if v := os.Getenv("NOOR_CHUNK_OVERLAP"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
		return 0
	}
	return chunkOverlapRunes
}

// Builder passages را از مدل سند می‌سازد: گروه‌بندی بر پایهٔ صفحه و نقش‌ها.
type Builder struct{}

type roleRange struct {
	Role  string `json:"role"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// BuildDoc passages یک سند را تولید می‌کند (هر صفحه یک passage؛ صفحات بزرگ تکه‌تکه در مرز بلوک).
func (b *Builder) BuildDoc(releaseUID, collectionUID, workUID, documentUID, language string, m *xmlparse.DocModel) []Passage {
	// صفحات؛ سند بدون صفحه → یک passage کل
	type span struct{ from, to int } // بازهٔ بلوک‌ها
	var pageRanges []struct {
		page   xmlparse.PageRec
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
	// وضعیت قطعهٔ پیشین برای هم‌پوشانی مرزی (SEARCH-02): دنبالهٔ متن و آخرین بلوک آن.
	// هم‌پوشانی فقط وقتی اعمال می‌شود که قطعهٔ پیشین دقیقاً پیش از قطعهٔ فعلی در
	// جریان همان سند باشد (بلوک مجاور) — هیچ اتصال مصنوعی میان متن‌های غیرمجاور
	// یا میان دو سند مستقل ساخته نمی‌شود (معیار §4.2 ممیزی).
	overlapLen := overlapSetting()
	var prevTail string
	prevTailRunes := 0
	prevEndBlock := -2 // هنوز هیچ قطعه‌ای ساخته نشده
	prevEnd := 0       // انتهای مطلق متن قطعهٔ پیشین (لنگر tail)
	psgIdx := 0
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
			// هم‌پوشانی مرزی: فقط با قطعهٔ مجاورِ قبلی (درون صفحه یا در گذر مرز صفحه)
			tail, tailRunes := "", 0
			tailAbs := 0 // آغاز مطلق tail در جریان سند (لنگر نگاشت خطی و dedupe صحیح)
			if overlapLen > 0 && prevEndBlock == start-1 && prevTailRunes > 0 {
				tail, tailRunes = prevTail, prevTailRunes
				tailAbs = prevEnd - tailRunes
			}
			p := buildPassage(releaseUID, collectionUID, workUID, documentUID, language, m, secOf, pr.page, start, end, tail, tailRunes, tailAbs, psgIdx)
			psgIdx++
			if p != nil {
				out = append(out, *p)
				if overlapLen > 0 {
					// دنبالهٔ متن برای قطعهٔ بعد: آخرین N نویسهٔ متن همین passage
					rn := []rune(p.TextOriginal)
					if len(rn) > overlapLen {
						prevTail, prevTailRunes = string(rn[len(rn)-overlapLen:]), overlapLen
					} else {
						prevTail, prevTailRunes = p.TextOriginal, len(rn)
					}
				}
				prevEnd = p.SourceEnd
				prevEndBlock = end
			}
			start = end + 1
		}
	}

	// پاورقی‌ها: هر پاورقی یک passage مستقل می‌شود تا متن حاشیه‌ها قابل جست‌وجو
	// باشد (ممیزی: متن پاورقی هیچ‌گاه نمایه نمی‌شد). آفست مطلق پاورقی در فضای
	// جداگانهٔ «پس از جریان سند» قرار می‌گیرد تا dedupe موتور هرگز وقوعِ حاشیه را
	// با وقوعِ بدنه اشتباه نگیرد.
	fnBase := len([]rune(m.Text)) + 1
	for fi := range m.Footnotes {
		fn := m.Footnotes[fi]
		if strings.TrimSpace(fn.Text) == "" {
			continue
		}
		p := buildFootnotePassage(releaseUID, collectionUID, workUID, documentUID, language, fn, psgIdx, fnBase)
		out = append(out, *p)
		psgIdx++
		fnBase += len([]rune(fn.Text)) + 2
	}
	return out
}

// buildFootnotePassage passageی برای متن یک پاورقی می‌سازد — بدون صفحهٔ چاپی،
// با برچسب «حاشیه»؛ بدون نقش و استناد (RoleRanges خالی).
func buildFootnotePassage(releaseUID, collectionUID, workUID, documentUID, language string, fn xmlparse.Footnote, idx, absBase int) *Passage {
	textN1, n1Map := norm.Normalize(fn.Text)
	label := fn.Label
	if label == "" {
		label = "حاشیه"
	}
	cj, _ := json.Marshal([]xmlparse.Citation{})
	rj, _ := json.Marshal([]roleRange{})
	return &Passage{
		PassageUID:    passageUID(releaseUID, documentUID, "fn", 0, 0, idx),
		ReleaseUID:    releaseUID,
		CollectionUID: collectionUID,
		WorkUID:       workUID,
		DocumentUID:   documentUID,
		SectionUID:    "",
		PageUID:       "",
		PageLabel:     "حاشیه " + label,
		Language:      language,
		TextOriginal:  fn.Text,
		TextN1:        textN1,
		N1Map:         n1Map,
		SourceStart:   absBase,
		SourceEnd:     absBase + len([]rune(fn.Text)),
		RoleRanges:    rj,
		Citations:     cj,
		Fingerprint:   docFingerprint(textN1),
		BlockStart:    -1,
		BlockEnd:      -1,
	}
}

// tail/tailRunes: هم‌پوشانی مرزی (SEARCH-02) — دنبالهٔ متنِ قطعهٔ مجاورِ قبلی که
// صرفاً برای تطبیقِ عبارتِ گذرنده از مرز به ابتدای متن افزوده می‌شود؛ صفات نمایشی
// (صفحه/بخش/روایت) فقط از بلوک‌های خودِ passage گرفته می‌شود و page همان صفحهٔ
// خودِ passage می‌ماند. آفست‌ها مطلق می‌مانند: SourceStart به اندازهٔ
// tailRunes+1 (جداکنندهٔ \n) عقب می‌رود تا «محلی + SourceStart» همیشه جایگاه
// واقعی در جریان متن سند باشد؛ dedupe موتور بر document+offset مطلق است و
// تطبیقِ ناحیهٔ هم‌پوشانی در دو قطعهٔ مجاور به یک نتیجه می‌رسد.
func buildPassage(releaseUID, collectionUID, workUID, documentUID, language string, m *xmlparse.DocModel, secOf map[string]string, page xmlparse.PageRec, from, to int, tail string, tailRunes int, tailAbs int, psgIdx int) *Passage {
	var parts []string
	var roles []roleRange
	offInPassage := 0
	gapRunes := 0
	if tailRunes > 0 {
		// متن هم‌پوشانی + جداکنندهٔ \n پیش از نخستین بلوک؛ مختصات محلی بلوک‌ها
		// (برای role_ranges) با همین اندازه جابه‌جا می‌شود.
		// فاصلهٔ واقعی tail تا نخستین بلوک در جریان مطلق سند (جریان پیوسته = ۰).
		gapRunes = m.Blocks[from].SourceOffsets[0] - (tailAbs + tailRunes) - 1
		if gapRunes < 0 {
			gapRunes = 0
		}
		// نگاشت خطی «محلی + SourceStart» همیشه جایگاه مطلق واقعی می‌دهد.
		offInPassage = tailRunes + 1 + gapRunes
	}
	var localHadith string
	var revayatIdx string
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
			revayatIdx = b.RevayatIndex
			if revayatIdx == "" {
				revayatIdx = m.HadithRevayat(b.HadithUID)
			}
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
	if tailRunes > 0 {
		// پرکنندهٔ gap فقط \n است — توکن/سه‌گانهٔ کاذب نمی‌سازد و در n1 به فاصله فرومی‌ریزد.
		textOriginal = tail + "\n" + strings.Repeat("\n", gapRunes) + textOriginal
	}
	textN1, n1Map := norm.Normalize(textOriginal)
	hadithLocal := ""
	if localHadith != "" {
		hadithLocal = documentUID + ":" + localHadith
	}
	fingerprint := docFingerprint(textN1)
	cj, _ := json.Marshal(citations)
	rj, _ := json.Marshal(roles)
	return &Passage{
		PassageUID:    passageUID(releaseUID, documentUID, page.UID, from, to, psgIdx),
		ReleaseUID:    releaseUID,
		CollectionUID: collectionUID,
		WorkUID:       workUID,
		DocumentUID:   documentUID,
		SectionUID:    secUID,
		PageUID:       page.UID,
		PageLabel:     page.Label,
		Language:      language,
		LocalHadith:   hadithLocal,
		RevayatIndex:  revayatIdx,
		OverlapRunes:  tailRunes,
		TextOriginal:  textOriginal,
		TextN1:        textN1,
		N1Map:         n1Map,
		SourceStart: func() int {
			if tailRunes > 0 {
				return tailAbs // آغاز مطلق tail
			}
			return m.Blocks[from].SourceOffsets[0]
		}(),
		SourceEnd:   m.Blocks[to].SourceOffsets[1],
		RoleRanges:  rj,
		Citations:   cj,
		Fingerprint: fingerprint,
		BlockStart:  from,
		BlockEnd:    to,
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
	case "ayah_quote":
		add("ayah", 0, len([]rune(b.Text)))
	case "hadith_body":
		add("hadith", 0, len([]rune(b.Text)))
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
        overlap_runes INTEGER DEFAULT 0,
        role_ranges TEXT, citations TEXT, fingerprint TEXT, block_start INTEGER, block_end INTEGER, revayat_index TEXT);
CREATE INDEX IF NOT EXISTS idx_p_doc ON passages(document_uid);
CREATE INDEX IF NOT EXISTS idx_p_work ON passages(work_uid);
-- DB-05: همهٔ پرس‌وجوهای موتور با release_uid=? فیلتر می‌کنند؛ بدون ایندکس،
-- مسیر citationOnly/اسکن کامل به SCAN passages + TEMP B-TREE می‌رسد.
CREATE INDEX IF NOT EXISTS idx_passages_release ON passages(release_uid);
CREATE TABLE IF NOT EXISTS tokens(token_id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE);
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE TABLE IF NOT EXISTS postings(token_id INTEGER, passage_uid TEXT, pos INTEGER);
CREATE INDEX IF NOT EXISTS idx_post_tok ON postings(token_id, passage_uid);
-- سه‌گانه‌های نویسه‌ای text_n1 برای پیش‌فیلتر «عبارت دقیق» (§۴۴) —
-- جایگزین اسکن کامل؛ تأیید نهایی همیشه روی متن اصلی در موتور می‌ماند.
CREATE TABLE IF NOT EXISTS trigrams(tri TEXT NOT NULL, passage_uid TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tri ON trigrams(tri, passage_uid);
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
	WorkUID    string
	Title      string
	ShortTitle string
	Author     string
	Publisher  string
	Language   string
	Topics     []string
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

// RebuildStream نسخهٔ جریانی Rebuild (DB-01/PERF-07 — حافظهٔ کران‌دار): به‌جای
// انباشت همهٔ مدل‌های اسناد در RAM، هر سند در لحظه از next گرفته، build و نوشته
// و بلافاصله رها می‌شود؛ peak حافظه به شمار اسناد کورپوس وابسته نمی‌ماند.
// قرارداد next: هر فراخوانی سند بعدی را می‌دهد؛ پایان = (nil, io.EOF)؛ هر خطای
// دیگر = شکست rebuild (نسل نیم‌بنا هرگز منتشر نمی‌شود). رفتار خروجی (ترتیب،
// passageها، titles) دقیقاً با Rebuild یکی است؛ Rebuild فعلی برای سازگاری
// فراخواننده‌های موجود دست‌نخورده مانده و پیش‌بود پیشرفت بر عهدهٔ caller است.
func (w *IndexWriter) RebuildStream(releaseUID string, titles []TitleRow, next func() (*DocInput, error)) (int, error) {
	if err := w.reset(); err != nil {
		return 0, err
	}
	b := &Builder{}
	total := 0
	for {
		d, err := next()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return 0, fmt.Errorf("جریان اسناد: %w", err)
		}
		if d == nil {
			break
		}
		ps := b.BuildDoc(releaseUID, d.CollectionUID, d.WorkUID, d.DocumentUID, d.Language, d.Model)
		if err := w.writePassages(ps); err != nil {
			return 0, err
		}
		total += len(ps)
	}
	if err := w.writeTitles(titles); err != nil {
		return 0, err
	}
	return total, nil
}

func (w *IndexWriter) reset() error {
	if _, err := w.DB.Exec(schema); err != nil {
		return err
	}
	// مهاجرت افزاینده: پایگاه موجود ممکن است ستون revayat_index را نداشته باشد
	// (SELECT * ترتیبی اسکن می‌شود؛ ستون تازه باید انتهای جدول باشد).
	if !w.hasColumn("passages", "revayat_index") {
		if _, err := w.DB.Exec(`ALTER TABLE passages ADD COLUMN revayat_index TEXT`); err != nil {
			return err
		}
	}
	for _, t := range []string{"postings", "tokens", "passages", "trigrams", "titles"} {
		if _, err := w.DB.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	return nil
}

// hasColumn بررسی وجود ستون در جدول (PRAGMA table_info).
func (w *IndexWriter) hasColumn(table, col string) bool {
	rows, err := w.DB.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false
		}
		if name == col {
			return true
		}
	}
	return false
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
		if _, err := tx.Exec(`INSERT INTO passages(passage_uid,release_uid,collection_uid,work_uid,document_uid,section_uid,page_uid,page_label,language,local_hadith_uid,text_original,text_n1,n1_map,source_start,source_end,role_ranges,citations,fingerprint,block_start,block_end,revayat_index,overlap_runes)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			p.PassageUID, p.ReleaseUID, p.CollectionUID, p.WorkUID, p.DocumentUID, p.SectionUID, p.PageUID, p.PageLabel, p.Language, p.LocalHadith,
			p.TextOriginal, p.TextN1, string(nm), p.SourceStart, p.SourceEnd, string(p.RoleRanges), string(p.Citations), p.Fingerprint, p.BlockStart, p.BlockEnd, p.RevayatIndex, p.OverlapRunes); err != nil {
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
		// سه‌گانه‌های متمایز n1 — پایگاه پیش‌فیلتر عبارت دقیق
		tris := norm.Trigrams(p.TextN1)
		seenTri := make(map[string]bool, len(tris))
		for _, t := range tris {
			if seenTri[t] {
				continue
			}
			seenTri[t] = true
			if _, err := tx.Exec(`INSERT INTO trigrams(tri, passage_uid) VALUES(?,?)`, t, p.PassageUID); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// HasTrigrams بررسی وجود جدول سه‌گانه‌ها در نمایه (نمایه‌های قدیمی پیش از مهاجرت).
func HasTrigrams(db *sql.DB) bool {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='trigrams'`).Scan(&n); err != nil {
		return false
	}
	return n > 0
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

// passageUID مستقل از release است (فقط سند + بازهٔ بلوک) تا شناسهٔ موضع در نسل‌های
// مختلف نمایه و میان دو موتور (محلی/OpenSearch) پایدار بماند؛ نسخه در release_uid
// جداگانه ثبت می‌شود و uid هرگز به‌عنوان حامل نسخه استفاده نمی‌شود.
func passageUID(release, doc, pageUID string, from, to, idx int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%d|%d|%d", release, doc, pageUID, from, to, idx)))
	return "psg-" + hex.EncodeToString(h[:12])
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
