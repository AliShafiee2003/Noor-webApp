package search

// برنامه‌ریزی پرس‌وجو و راستی‌آزمایی L1 تا L3 موتور FTS5 (§۲۰/§۲۱).
//
// اصل: هر mode یک عبارت MATCH «دقیق یا ابرمجموعهٔ دقیق» دارد و همهٔ کاندیدها به ترتیب
// rowid (= ترتیب canonical) و بدون سقف پنهان پیمایش می‌شوند؛ تنها توقف، سقف صریح کل
// نتایج (maxResults) است که lower_bound اعلام می‌شود.
//
//	strict / normalized : عبارت دوواژه‌ای n1_bi (یا n1 برای تک‌واژه/پیشوندی) + گونه‌های فارسی
//	linguistic / L1–L3  : عبارت n2k (کلید هم‌ارزی آزاد) — ابرمجموعهٔ کامل L1 ⊆ L2 ⊆ L3
//	all_words           : n1 : (a AND b …)
//	any_words           : n1 : (a OR b …)
//	near                : n1 : (a AND b …) + verifier near موجود

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
	"unsafe"

	"noor/internal/norm"
)

// layer order
var layerRank = map[string]int{"L1": 1, "L2": 2, "L3": 3, "L4": 4, "L5": 5}

type ftsQuery struct {
	raw       string
	toks      []norm.AlignedToken
	prefix    []bool // واژهٔ i با * پایان یافته است (جست‌وجوی پیشوندی صریح)
	hasPfx    bool
	n1        []string // N1 خام
	n2        []string // N2 خام
	keys      []string // ReuseKey(N2) خام
	core      []rune   // متن اصلی پرسش از آغاز واژهٔ نخست تا پایان واژهٔ آخر
	coreStr   string   // همان core به‌صورت رشته (مقایسهٔ بایتی L1 بدون تبدیل متن passage)
	alts      []map[string]string
	variants  []qVariant // گونه‌های L3 چندواژه‌ای (پاسبانی‌شده با واژگان) — norm.FlexVariants
	varTrunc  bool       // سقف شمار گونه‌ها اعمال شد (اعلام در notice)
	respect   bool       // قید اعراب
	diaStrict bool       // قید سخت‌گیرانه: حرف بی‌حرکت متن هم ناسازگار (§۱۵)
	qDiac     []bool     // واژهٔ i اعراب دارد
}

func parseFTSQuery(raw string, respect bool) *ftsQuery {
	q := &ftsQuery{raw: raw, respect: respect}
	q.toks = norm.TokenizeAligned(raw)
	runes := []rune(raw)
	for _, t := range q.toks {
		p := t.End < len(runes) && runes[t.End] == '*'
		q.prefix = append(q.prefix, p)
		if p {
			q.hasPfx = true
		}
		q.n1 = append(q.n1, t.N1)
		q.n2 = append(q.n2, t.N2)
		q.keys = append(q.keys, norm.ReuseKey(t.N2))
		mp := map[string]string{}
		for _, a := range norm.N2Alternatives(t.N2) {
			mp[a.Form] = a.Diff
		}
		q.alts = append(q.alts, mp)
		q.qDiac = append(q.qDiac, norm.HasDiacritics(t.Surface))
	}
	if len(q.toks) > 0 {
		q.core = runes[q.toks[0].Start:q.toks[len(q.toks)-1].End]
		q.coreStr = string(q.core)
	}
	return q
}

// qVariant یک گونهٔ L3 پرسش با توکن‌های N1/N2 و قیدهای مرز.
type qVariant struct {
	toks  []norm.AlignedToken
	label string
	kind  string
	tight []int
	paren []int
}

// سقف گونه‌ها: هر گونه یک عبارت OR در MATCH است؛ سقف کل و سقف هر گروه، هزینهٔ پرس‌وجو را
// کران‌دار می‌کند و برخورد با سقف در notice اعلام می‌شود (حذف بی‌صدا ممنوع).
const (
	maxVariants        = 24
	maxVariantsPerGrp  = 2
	maxHonorificPerGrp = 8
)

// buildVariants گونه‌های L3 پرسش را می‌سازد و فقط گونه‌هایی را نگه می‌دارد که همهٔ
// واژه‌های تازه‌شان در واژگان نسل هست (پاسبان «میوه → می وه»).
// kinds: انواع مجاز در این mode؛ morph فقط با انتخاب کاربر.
func (q *ftsQuery) buildVariants(ctx context.Context, rel *ftsRelease, kinds map[string]bool, morph bool) error {
	if q.respect {
		// قید اعراب روی بازهٔ بازنویسی‌شده (پیوسته/گسسته، اختصار) قابل راستی‌آزمایی حرف‌به‌حرف
		// نیست؛ پس با پرسش اعراب‌دار در حالت respect گونهٔ چندواژه‌ای ساخته نمی‌شود.
		for _, d := range q.qDiac {
			if d {
				return nil
			}
		}
	}
	runes := []rune(q.raw)
	qp := make([]bool, len(q.toks))
	for i, t := range q.toks {
		qp[i] = parenAround(runes, t.Start, t.End)
	}
	vs := norm.FlexVariants(q.n1, norm.VariantOptions{QueryParen: qp, Morph: morph, Kinds: kinds})
	if len(vs) == 0 {
		return nil
	}
	var need []string
	for _, v := range vs {
		need = append(need, v.New...)
	}
	exists := map[string]bool{}
	if len(need) > 0 {
		var err error
		if exists, err = rel.existsN1(ctx, need); err != nil {
			return err
		}
	}
	perGrp := map[string]int{}
	for _, v := range vs {
		ok := true
		for _, w := range v.New {
			if !exists[w] {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		lim := maxVariantsPerGrp
		if v.Kind == norm.KindHonorific {
			lim = maxHonorificPerGrp
		}
		if perGrp[v.Group] >= lim || len(q.variants) >= maxVariants {
			q.varTrunc = true
			continue
		}
		perGrp[v.Group]++
		toks := make([]norm.AlignedToken, len(v.Words))
		for i, w := range v.Words {
			toks[i] = norm.AlignedToken{N1: w, N2: norm.WordToN2(w)}
		}
		q.variants = append(q.variants, qVariant{toks: toks, label: v.Label, kind: v.Kind, tight: v.Tight, paren: v.Paren})
	}
	return nil
}

// parenAround آیا بازهٔ [s,e) درون پرانتز است؟ («(ع)»، «( ع )»؛ فاصلهٔ داخلی مجاز)
func parenAround(rs []rune, s, e int) bool {
	i := s - 1
	for i >= 0 && (rs[i] == ' ' || rs[i] == norm.ZWNJ) {
		i--
	}
	j := e
	for j < len(rs) && (rs[j] == ' ' || rs[j] == norm.ZWNJ) {
		j++
	}
	return i >= 0 && j < len(rs) && (rs[i] == '(' || rs[i] == '\uFD3E' || rs[i] == '\uFD3F') && (rs[j] == ')' || rs[j] == '\uFD3F' || rs[j] == '\uFD3E')
}

// tightGap آیا میان دو واژهٔ متن فقط فاصله/نیم‌فاصله است (نه نشانهٔ نگارشی یا شکست خط)؟
func tightGap(rs []rune, a, b int) bool {
	if a > b || b > len(rs) {
		return false
	}
	for _, r := range rs[a:b] {
		if r != ' ' && r != norm.ZWNJ && r != '\u00A0' && r != '\u200F' && r != '\u200E' && r != '\u200D' {
			return false
		}
	}
	return true
}

func ftsTok(w string) string { return norm.FTSToken(w) }

// phraseN1 عبارت FTS5 برای توالی N1 (دوواژه‌ای اگر پیشوندی نباشد).
func phraseN1(words []string, prefix []bool) string {
	hasPfx := false
	for _, p := range prefix {
		hasPfx = hasPfx || p
	}
	if len(words) == 1 {
		if len(prefix) > 0 && prefix[0] {
			return "n1 : " + `"` + ftsTok(words[0]) + `" *`
		}
		return "n1 : " + norm.FTSPhrase(words)
	}
	if hasPfx {
		// عبارت تک‌واژه‌ای با الحاق «+» تا * فقط روی واژهٔ مشخص اثر کند
		parts := make([]string, len(words))
		for i, w := range words {
			parts[i] = `"` + ftsTok(w) + `"`
			if prefix[i] {
				parts[i] += " *"
			}
		}
		return "n1 : (" + strings.Join(parts, " + ") + ")"
	}
	bi := make([]string, 0, len(words)-1)
	for i := 0; i+1 < len(words); i++ {
		bi = append(bi, ftsTok(words[i])+norm.BigramSeparator+ftsTok(words[i+1]))
	}
	return `n1_bi : "` + strings.Join(bi, " ") + `"`
}

func phraseKeys(keys []string) string {
	return "n2k : " + norm.FTSPhrase(keys)
}

func orJoin(parts []string) string {
	if len(parts) == 1 {
		return parts[0]
	}
	for i, p := range parts {
		parts[i] = "(" + p + ")"
	}
	return strings.Join(parts, " OR ")
}

func wordsExpr(words []string, prefix []bool, op string) string {
	seen := map[string]bool{}
	var parts []string
	for i, w := range words {
		t := `"` + ftsTok(w) + `"`
		if i < len(prefix) && prefix[i] {
			t += " *"
		}
		if !seen[t] {
			seen[t] = true
			parts = append(parts, t)
		}
	}
	return "n1 : (" + strings.Join(parts, " "+op+" ") + ")"
}

// matchExpr عبارت MATCH مرحلهٔ L1–L3 / modeهای غیرلایه‌ای.
func (q *ftsQuery) matchExpr(mode string) string {
	switch mode {
	case StrictPhrase, NormalizedPhrase:
		parts := []string{phraseN1(q.n1, q.prefix)}
		if mode == StrictPhrase {
			return parts[0]
		}
		// گونه‌ها در verifyLayers با N2 سنجیده می‌شوند («مى‌فرمود» ← «ميفرمود»)؛ پس MATCH آن‌ها
		// باید روی n2k باشد تا ابرمجموعهٔ پذیرش verifier بماند. پیش‌تر n1_bi بود و گونهٔ
		// پذیرفتنی هرگز کاندید نمی‌شد (رگرسیون TestPersianVariantArabicYehZWNJ).
		for _, v := range q.variants {
			ks := make([]string, len(v.toks))
			for i, t := range v.toks {
				ks[i] = norm.ReuseKey(t.N2)
			}
			parts = append(parts, phraseKeys(ks))
		}
		return orJoin(parts)
	case AllWords, Near:
		return wordsExpr(q.n1, q.prefix, "AND")
	case AnyWords:
		return wordsExpr(q.n1, q.prefix, "OR")
	default: // linguistic, tiered, long_quote, similar_quote
		if q.hasPfx {
			// پیشوندی در لایه‌ای: L1–L2 روی n1 (کلید n2k با پیشوند تعریف نمی‌شود)
			return phraseN1(q.n1, q.prefix)
		}
		parts := []string{phraseKeys(q.keys)}
		for _, v := range q.variants {
			ks := make([]string, len(v.toks))
			for i, t := range v.toks {
				ks[i] = norm.ReuseKey(t.N2)
			}
			parts = append(parts, phraseKeys(ks))
		}
		return orJoin(parts)
	}
}

// ftsRow ردیف کاندید با فیلدهای نسل FTS5.
type ftsRow struct {
	candRow
	Seq         int64
	DocOrd      int64
	BodyStart   int
	StreamStart int
	StreamEnd   int
	toks        []norm.AlignedToken
}

func (r *ftsRow) tokens() []norm.AlignedToken {
	if r.toks == nil {
		r.toks = norm.TokenizeAligned(r.TextOriginal)
		if r.toks == nil {
			r.toks = []norm.AlignedToken{}
		}
	}
	return r.toks
}

const ftsRowCols = `seq, doc_ord, body_start, stream_start, stream_end, passage_uid, release_uid, collection_uid, work_uid, document_uid,
	section_uid, page_uid, page_label, language, local_hadith_uid, revayat_index,
	text_original, text_n1, n1_map, source_start, source_end, role_ranges, citations, fingerprint, block_start, block_end, overlap_runes`

// ftsRowColsLite همان ستون‌ها بدون text_n1/n1_map: مسیر FTS5 (به‌جز near) واژه‌ها را از
// text_original می‌سازد و n1_map (JSON چند برابر متن) فقط حافظه و کپی هدر می‌داد.
const ftsRowColsLite = `seq, doc_ord, body_start, stream_start, stream_end, passage_uid, release_uid, collection_uid, work_uid, document_uid,
	section_uid, page_uid, page_label, language, local_hadith_uid, revayat_index,
	text_original, '', '', source_start, source_end, role_ranges, citations, fingerprint, block_start, block_end, overlap_runes`

func scanFTSRow(rows *sql.Rows) (*ftsRow, error) {
	r := &ftsRow{}
	err := rows.Scan(&r.Seq, &r.DocOrd, &r.BodyStart, &r.StreamStart, &r.StreamEnd,
		&r.PassageUID, &r.ReleaseUID, &r.CollectionUID, &r.WorkUID, &r.DocumentUID,
		&r.SectionUID, &r.PageUID, &r.PageLabel, &r.Language, &r.LocalHadith, &r.RevayatIndex,
		&r.TextOriginal, &r.TextN1, &r.N1Map, &r.SourceStart, &r.SourceEnd, &r.RoleRanges, &r.Citations, &r.Fingerprint,
		&r.BlockStart, &r.BlockEnd, &r.OverlapRunes)
	return r, err
}

// fetchRows ردیف‌های passages را با seq واکشی و به ترتیب ورودی برمی‌گرداند.
// withN1 فقط برای verifier قدیمی near (text_n1 + n1_map) لازم است.
func fetchRows(ctx context.Context, db *sql.DB, seqs []int64, withN1 bool) ([]*ftsRow, error) {
	if len(seqs) == 0 {
		return nil, nil
	}
	args := make([]any, len(seqs))
	for i, s := range seqs {
		args[i] = s
	}
	cols := ftsRowColsLite
	if withN1 {
		cols = ftsRowCols
	}
	rows, err := db.QueryContext(ctx, `SELECT `+cols+` FROM passages WHERE seq IN (`+placeholders(len(seqs))+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("fts5 engine: واکشی passages: %w", err)
	}
	defer rows.Close()
	by := make(map[int64]*ftsRow, len(seqs))
	for rows.Next() {
		r, err := scanFTSRow(rows)
		if err != nil {
			return nil, fmt.Errorf("fts5 engine: scan candidate: %w", err)
		}
		by[r.Seq] = r
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("fts5 engine: scan candidate: %w", err)
	}
	out := make([]*ftsRow, 0, len(seqs))
	for _, s := range seqs {
		r, ok := by[s]
		if !ok {
			// rowid نمایه بدون passage = نسل ناسازگار؛ حذف خاموش ممنوع
			return nil, fmt.Errorf("fts5 engine: passage با seq=%d در پایگاه اصلی نیست (نسل ناسازگار)", s)
		}
		out = append(out, r)
	}
	return out, nil
}

// rawHit یک تطبیق تأییدشده درون passage.
type rawHit struct {
	rng   [2]int // بازهٔ محلی (code point)
	layer string
	label string // match_type
	diffs []string
	sim   *Similarity
	absHi int // اگر بازه از passage فراتر رود (L4)، پایان مطلق؛ وگرنه ۰
}

const perPassageHitCap = 50

// verifyLayers تطبیق‌های L1/L2/L3 یک passage (و گونه‌های فارسی) را برمی‌گرداند.
// want: لایه‌های مجاز؛ mode برای برچسب‌گذاری.
// loose=false (normalized_phrase): فقط L1/L2 برای توالی اصلی و L3 فقط برای گونه‌های فارسی.
func (q *ftsQuery) verifyLayers(r *ftsRow, want map[string]bool, loose bool, truncated *bool) []rawHit {
	toks := r.tokens()
	m := len(q.toks)
	var out []rawHit
	var origR []rune // متن اصلی به rune فقط وقتی تطبیقی برای سنجش L1/مرز پیدا شد
	orig := func() []rune {
		if origR == nil {
			origR = []rune(r.TextOriginal)
		}
		return origR
	}
	add := func(h rawHit) bool {
		if len(out) >= perPassageHitCap {
			*truncated = true
			return false
		}
		out = append(out, h)
		return true
	}
	for i := 0; i+m <= len(toks); i++ {
		layer := "L2"
		var diffs []string
		ok := true
		for j := 0; j < m; j++ {
			d := toks[i+j]
			if q.prefix[j] {
				if !strings.HasPrefix(d.N1, q.n1[j]) {
					ok = false
					break
				}
				continue
			}
			if d.N1 == q.n1[j] {
				// قید اعراب سخت است: اگر اعرابِ نوشته‌شدهٔ کاربر روی همان حرفِ متن نباشد،
				// تطبیق در هیچ لایه‌ای «قطعی» گزارش نمی‌شود و حذف می‌شود (respect).
				if q.respect && q.qDiac[j] && !q.diaOK(q.toks[j].Surface, d.Surface) {
					ok = false
					break
				}
				continue
			}
			if !loose {
				ok = false
				break
			}
			if q.respect && q.qDiac[j] && !norm.DiacriticsCompatibleAligned(q.toks[j].Surface, d.Surface, q.diaStrict) {
				ok = false // قید اعراب در L3 هم برقرار است (عِلم ↛ العَلَم)
				break
			}
			if d.N2 == q.n2[j] {
				layer = "L3"
				diffs = append(diffs, fmt.Sprintf("%s: «%s» ← «%s»", orthoLabel(q.n1[j], d.N1), d.N1, q.n1[j]))
				continue
			}
			if lab, has := q.alts[j][d.N2]; has && lab != "" {
				layer = "L3"
				diffs = append(diffs, fmt.Sprintf("%s: «%s» ← «%s»", lab, d.N1, q.n1[j]))
				continue
			}
			ok = false
			break
		}
		if !ok {
			continue
		}
		s, e := toks[i].Start, toks[i+m-1].End
		if layer == "L2" && !q.hasPfx && e-s == len(q.core) && q.exactAt(r.TextOriginal, toks[i], toks[i+m-1], s, e, orig) {
			layer = "L1"
		}
		if !want[layer] {
			continue
		}
		if !add(rawHit{rng: [2]int{s, e}, layer: layer, diffs: diffs}) {
			return out
		}
	}
	// گونه‌های چندواژه‌ای → L3 با برچسب قاعده (پیوستگی، یای اضافه، اختصار دعایی، صورت صرفی)
	if want["L3"] {
		for _, v := range q.variants {
			vm := len(v.toks)
			for i := 0; i+vm <= len(toks); i++ {
				ok := true
				for j := 0; j < vm; j++ {
					if toks[i+j].N2 != v.toks[j].N2 {
						ok = false
						break
					}
				}
				for _, j := range v.tight {
					if !ok || j+1 >= vm {
						break
					}
					ok = tightGap(orig(), toks[i+j].End, toks[i+j+1].Start)
				}
				for _, j := range v.paren {
					if !ok || j >= vm {
						break
					}
					ok = parenAround(orig(), toks[i+j].Start, toks[i+j].End)
				}
				if !ok {
					continue
				}
				diffs := []string{v.label}
				for j := 0; j < vm; j++ {
					if d := toks[i+j]; d.N1 != v.toks[j].N1 {
						diffs = append(diffs, fmt.Sprintf("%s: «%s» ← «%s»", orthoLabel(v.toks[j].N1, d.N1), d.N1, v.toks[j].N1))
					}
				}
				h := rawHit{rng: [2]int{toks[i].Start, toks[i+vm-1].End}, layer: "L3", label: variantLabel(v.kind), diffs: diffs}
				if !add(h) {
					return out
				}
			}
		}
	}
	return out
}

// variantLabel match_type نتیجهٔ گونهٔ چندواژه‌ای.
func variantLabel(kind string) string {
	switch kind {
	case norm.KindEzafe:
		return "L3 (یای اضافه)"
	case norm.KindHonorific:
		return "L3 (عبارت دعایی)"
	case norm.KindMorph:
		return "L3 (صورت صرفی)"
	}
	return "L3 (تفاوت پیوستگی)"
}

// wholeWordAt آیا بازهٔ [s,e) یک واژهٔ مستقل در متن است؟ نیم‌فاصله (ZWNJ) مرز
// حساب نمی‌شود — «علم» درون «علم‌ها» واژهٔ مستقل نیست و برچسب L1 نمی‌گیرد.
func wholeWordAt(orig []rune, s, e int) bool {
	return !unicode.IsLetter(wordEdgeRune(orig, s-1, -1)) && !unicode.IsLetter(wordEdgeRune(orig, e, 1))
}

// wordEdgeRune نخستین نویسهٔ مؤثر پس از پرش روی نیم‌فاصله‌ها در جهت dir.
func wordEdgeRune(orig []rune, i int, dir int) rune {
	for i >= 0 && i < len(orig) {
		r := orig[i]
		if r != norm.ZWNJ {
			return r
		}
		i += dir
	}
	return 0
}

// exactAt شرط L1: متن اصلی بازهٔ [s,e) عیناً core پرسش است و بازه واژهٔ کامل است — هم‌ارز
// runesEqual(orig[s:e], core) && wholeWordAt(orig, s, e). وقتی surfaceها برش خود text‌اند (UTF-8
// معتبر؛ مسیر عادی TokenizeAligned) مقایسه روی بایت‌ها انجام می‌شود و کل passage به []rune
// تبدیل نمی‌شود؛ وگرنه (متن نامعتبر که واژه‌بندی روی نسخهٔ تبدیل‌شده بود) همان مسیر rune.
func (q *ftsQuery) exactAt(text string, first, last norm.AlignedToken, s, e int, orig func() []rune) bool {
	if bs, ok := byteOffset(text, first.Surface); ok {
		if bl, ok := byteOffset(text, last.Surface); ok {
			be := bl + len(last.Surface)
			return text[bs:be] == q.coreStr && wholeWordBytes(text, bs, be)
		}
	}
	o := orig()
	return runesEqual(o[s:e], q.core) && wholeWordAt(o, s, e)
}

// byteOffset موضع بایتی sub درون text اگر sub برشی از همان حافظهٔ text باشد. فقط نشانی‌ها مقایسه
// می‌شوند (uintptr هرگز به اشاره‌گر برگردانده نمی‌شود) و هر دو رشته در طول فراخوانی زنده‌اند.
func byteOffset(text, sub string) (int, bool) {
	if len(sub) == 0 || len(text) == 0 {
		return 0, false
	}
	tp := uintptr(unsafe.Pointer(unsafe.StringData(text)))
	sp := uintptr(unsafe.Pointer(unsafe.StringData(sub)))
	if sp < tp || sp+uintptr(len(sub)) > tp+uintptr(len(text)) {
		return 0, false
	}
	return int(sp - tp), true
}

// wholeWordBytes هم‌ارز wholeWordAt روی متن UTF-8 معتبر با آفست بایتی.
func wholeWordBytes(text string, bs, be int) bool {
	var before, after rune
	for i := bs; i > 0; {
		r, sz := utf8.DecodeLastRuneInString(text[:i])
		if r != norm.ZWNJ {
			before = r
			break
		}
		i -= sz
	}
	for j := be; j < len(text); {
		r, sz := utf8.DecodeRuneInString(text[j:])
		if r != norm.ZWNJ {
			after = r
			break
		}
		j += sz
	}
	return !unicode.IsLetter(before) && !unicode.IsLetter(after)
}

func runesEqual(a, b []rune) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// verifyWords تطبیق any_words/all_words روی واژه‌های بدنهٔ passage (مالکیت tail با passage قبل).
func (q *ftsQuery) verifyWords(r *ftsRow, all bool, truncated *bool) []rawHit {
	toks := r.tokens()
	matchAt := func(d norm.AlignedToken, j int) bool {
		if q.prefix[j] {
			if !strings.HasPrefix(d.N1, q.n1[j]) {
				return false
			}
		} else if d.N1 != q.n1[j] {
			return false
		}
		if q.respect && q.qDiac[j] && !q.diaOK(q.toks[j].Surface, d.Surface) {
			return false
		}
		return true
	}
	if !all {
		var out []rawHit
		for _, d := range toks {
			if d.Start < r.BodyStart {
				continue
			}
			for j := range q.toks {
				if matchAt(d, j) {
					if len(out) >= perPassageHitCap {
						*truncated = true
						return out
					}
					out = append(out, rawHit{rng: [2]int{d.Start, d.End}, layer: "", label: "normalized"})
					break
				}
			}
		}
		return out
	}
	lo, hi := -1, -1
	found := make([]bool, len(q.toks))
	for _, d := range toks {
		if d.Start < r.BodyStart {
			continue
		}
		for j := range q.toks {
			if matchAt(d, j) {
				found[j] = true
				if lo < 0 || d.Start < lo {
					lo = d.Start
				}
				if d.End > hi {
					hi = d.End
				}
			}
		}
	}
	for _, f := range found {
		if !f {
			return nil
		}
	}
	return []rawHit{{rng: [2]int{lo, hi}, label: "normalized"}}
}

// layerLabel match_type سازگار با رابط کاربری برای هر لایه.
func layerLabel(layer string, diffs []string, score float64) string {
	switch layer {
	case "L1":
		return "exact"
	case "L2":
		return "normalized"
	case "L3":
		for _, d := range diffs {
			if strings.HasPrefix(d, "تفاوت پیوستگی") {
				return "L3 (تفاوت پیوستگی)"
			}
		}
		return "linguistic"
	case "L4":
		return fmt.Sprintf("L4 (شباهت لفظی %.0f%%)", score*100)
	case "L5":
		return "L5 (واژهٔ نزدیک)"
	}
	return "normalized"
}

// rowToResult ساخت Result از ردیف FTS و تطبیق.
func (e *FTS5Engine) rowToResult(r *candRow, h rawHit) Result {
	res := e.base.toResult(r, hit{Range: h.rng}, h.label)
	res.Layer = h.layer
	if len(h.diffs) > 0 {
		res.Diffs = h.diffs
	}
	res.Similarity = h.sim
	if h.absHi > 0 {
		res.MatchRange[1] = h.absHi
	}
	if res.Citations == nil || len(res.Citations) == 0 || string(res.Citations) == "" {
		res.Citations = nil
	} else if !json.Valid(res.Citations) {
		res.Citations = nil
	}
	return res
}

// diaOK سازگاری اعراب طبق سیاست درخواست (پیش‌فرض: حرف بی‌حرکت متن = سازگار).
func (q *ftsQuery) diaOK(query, doc string) bool {
	if q.diaStrict {
		return norm.DiacriticsCompatibleStrict(query, doc)
	}
	return norm.DiacriticsCompatible(query, doc)
}
