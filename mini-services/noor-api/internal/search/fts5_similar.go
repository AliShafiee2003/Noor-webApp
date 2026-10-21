package search

// L4 (نقل‌قول مشابه) و L5 (واژهٔ نزدیک) موتور FTS5 (§۲۰/§۲۲/§۲۳).
//
// بازیابی کاندید L4 دو منبع موازی دارد که هر دو «بذر» (seed) به مختصات جریان سند می‌دهند:
//  1. نمایهٔ بازکاربرد (winnowing): fingerprintهای پرسش ← postings (hash, doc, pos)؛ هر
//     برخورد (q_pos, doc, p_pos) قطر d = p_pos − q_pos دارد (تضمین §۲۲ برای m ≥ t(e+1)+2e).
//  2. anchorهای دوواژه‌ای روی ستون n2k (هر جفت مجاور پرسش)، مرتب بر bm25 — برای پرسش‌های
//     کوتاه‌تر از کران تضمین.
//
// بذرهای یک سند با قطر نزدیک (≤ ۸ واژه) یک ناحیه می‌سازند؛ پنجرهٔ ناحیه با حاشیه
// max(8, m/4) از passages همان سند (بدنه‌ها، بدون tail) خوانده و به aligner داده می‌شود.
// هر سقف تعاملی که فعال شود، پوشش L4 «partial» اعلام می‌شود؛ هیچ کاندیدی بی‌اعلام حذف نمی‌شود.

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"noor/internal/index"
	"noor/internal/norm"
)

const (
	reusePostingCap = 20000 // سقف postings هر fingerprint در مسیر تعاملی
	anchorCap       = 2000  // سقف passageهای anchor هر شارد
	// anchorShortTotal سقف کل anchorهای پرسش سه‌واژه‌ای (میان شاردها تقسیم می‌شود، کف
	// anchorShortMin برای هر شارد): کران تضمین بازیابی برای m < 4 برقرار نیست و پاسخ همیشه
	// partial اعلام می‌شود؛ بدون این سقف، جفت‌های واژه‌های پرتکرار در هر شارد تا ۲۰۰۰ passage
	// را برای واژه‌بندی کامل می‌آوردند و هزینهٔ حالت پیش‌فرض با شمار شاردها رشد می‌کرد.
	anchorShortTotal = 1000
	anchorShortMin   = 50
	windowCap        = 800 // سقف پنجره‌های هم‌ترازی هر شارد
	diagSlack        = 8
	maxAnchorPairs   = 64
	l5MaxForms       = 24
)

type seed struct {
	doc  int64
	ppos int
	qpos int
}

type simWindow struct {
	doc        int64
	start, end int // مختصات جریان [start, end)
	support    int // شمار بذرهای متمایز (فقط ترتیب پردازش؛ نه حذف)
}

// winTok یک واژهٔ پنجره با نشانی passage.
type winTok struct {
	tok norm.AlignedToken
	row *ftsRow
}

type similarOutcome struct {
	results []rawResult
	partial bool
	notes   []string
}

// rawResult نتیجهٔ میانی همراه با کلید ترتیب canonical.
type rawResult struct {
	seq    int64
	start  int
	doc    int64
	absLo  int
	absHi  int
	row    *ftsRow
	hit    rawHit
	score  float64
	cover  float64
	layer  string
	result *Result
}

// similarShard اجرای L4 روی یک شارد.
func (e *FTS5Engine) similarShard(ctx context.Context, rel *ftsRelease, shard int, q *ftsQuery, allow *docFilter, exact []rawResult, minScore float64, roles []string, rowCache map[int64]*ftsRow) (similarOutcome, error) {
	var out similarOutcome
	m := len(q.toks)
	// هم‌خوان با runL4 (len ≥ 3): پیش‌تر این‌جا m < 4 بود و L4 سه‌واژه‌ای با وجود اعلام
	// «partial» هرگز اجرا نمی‌شد. برای ۳ واژه anchorهای دوواژه‌ای کاندید می‌سازند (winnowing k=4 نه).
	if m < 3 {
		return out, nil
	}
	db := rel.shards[shard]
	seeds := map[int64][]seed{}
	addSeed := func(s seed) {
		if allow != nil && !allow.ok(rel, s.doc) {
			return
		}
		seeds[s.doc] = append(seeds[s.doc], s)
	}

	// ۱. نمایهٔ بازکاربرد
	if m >= index.DefaultWinnowingK {
		fps := index.ComputeFingerprints(q.keys, index.DefaultWinnowingK, index.DefaultWinnowingW)
		byHash := map[uint64][]int{}
		var order []uint64
		for _, fp := range fps {
			if _, ok := byHash[fp.Hash]; !ok {
				order = append(order, fp.Hash)
			}
			byHash[fp.Hash] = append(byHash[fp.Hash], fp.Pos)
		}
		for _, h := range order {
			rows, err := db.QueryContext(ctx, `SELECT doc_ord, pos FROM reuse_postings WHERE hash = ? LIMIT ?`, int64(h), reusePostingCap+1)
			if err != nil {
				return out, fmt.Errorf("fts5 engine: reuse_postings شارد %d: %w", shard, err)
			}
			n := 0
			for rows.Next() {
				var d int64
				var p int
				if err := rows.Scan(&d, &p); err != nil {
					rows.Close()
					return out, fmt.Errorf("fts5 engine: reuse_postings: %w", err)
				}
				n++
				if n > reusePostingCap {
					out.partial = true
					break
				}
				for _, qp := range byHash[h] {
					addSeed(seed{doc: d, ppos: p, qpos: qp})
				}
			}
			rows.Close()
		}
	}

	// ۲. anchorهای دوواژه‌ای روی n2k
	var pairs []string
	var pairPos []int
	step := 1
	if m-1 > maxAnchorPairs {
		step = (m - 1 + maxAnchorPairs - 1) / maxAnchorPairs
	}
	for i := 0; i+1 < m; i += step {
		pairs = append(pairs, norm.FTSPhrase([]string{q.keys[i], q.keys[i+1]}))
		pairPos = append(pairPos, i)
	}
	if len(pairs) > 0 {
		expr := "n2k : (" + strings.Join(pairs, " OR ") + ")"
		aCap := anchorCap
		if m < 4 {
			aCap = max(anchorShortMin, anchorShortTotal/max(1, len(rel.shards)))
		}
		var seqs []int64
		for _, rg := range allow.ranges(rel, shard) {
			rows, err := db.QueryContext(ctx, `SELECT rowid FROM fts_phrase WHERE fts_phrase MATCH ? AND rowid BETWEEN ? AND ? ORDER BY rank LIMIT ?`, expr, rg[0], rg[1], aCap+1)
			if err != nil {
				return out, fmt.Errorf("fts5 engine: anchor شارد %d: %w", shard, err)
			}
			for rows.Next() {
				var s int64
				if rows.Scan(&s) == nil {
					seqs = append(seqs, s)
				}
			}
			rows.Close()
		}
		if len(seqs) > aCap {
			out.partial = true
			seqs = seqs[:aCap]
		}
		need := missingSeqs(seqs, rowCache)
		for start := 0; start < len(need); start += 200 {
			end := start + 200
			if end > len(need) {
				end = len(need)
			}
			rs, err := fetchRows(ctx, rel.main, need[start:end], false)
			if err != nil {
				return out, err
			}
			for _, r := range rs {
				rowCache[r.Seq] = r
			}
		}
		pairKey := map[[2]string][]int{}
		firstKey := map[string]bool{}
		secondKey := map[string]bool{}
		for _, i := range pairPos {
			k := [2]string{q.keys[i], q.keys[i+1]}
			pairKey[k] = append(pairKey[k], i)
			firstKey[q.keys[i]] = true
			secondKey[q.keys[i+1]] = true
		}
		// کلید هر واژهٔ متن یک بار (با کش محلی) و همراه با «آغاز/پایان جفتی از پرسش بودن»
		// محاسبه می‌شود؛ پس هر واژه فقط یک جست‌وجوی map دارد و جست‌وجوی جفت فقط وقتی انجام
		// می‌شود که هر دو واژه در جفت‌های پرسش جای مناسب داشته باشند (نتیجه همان است).
		type rkInfo struct {
			key           string
			first, second bool
		}
		memo := map[string]rkInfo{}
		info := func(n2 string) rkInfo {
			if v, ok := memo[n2]; ok {
				return v
			}
			k := norm.ReuseKey(n2)
			v := rkInfo{key: k, first: firstKey[k], second: secondKey[k]}
			memo[n2] = v
			return v
		}
		for _, s := range seqs {
			r := rowCache[s]
			if r == nil {
				continue
			}
			body := bodyTokens(r)
			var prev rkInfo
			for j := range body {
				cur := info(body[j].N2)
				if j > 0 && prev.first && cur.second {
					for _, qi := range pairKey[[2]string{prev.key, cur.key}] {
						addSeed(seed{doc: r.DocOrd, ppos: r.StreamStart + j - 1, qpos: qi})
					}
				}
				prev = cur
			}
		}
	}
	if len(seeds) == 0 {
		return out, nil
	}

	// ۳. ناحیه‌ها و پنجره‌ها
	margin := m / 4
	if margin < 8 {
		margin = 8
	}
	var wins []simWindow
	docs := make([]int64, 0, len(seeds))
	for d := range seeds {
		docs = append(docs, d)
	}
	sort.Slice(docs, func(i, j int) bool { return docs[i] < docs[j] })
	for _, d := range docs {
		ss := seeds[d]
		sort.Slice(ss, func(i, j int) bool {
			di, dj := ss[i].ppos-ss[i].qpos, ss[j].ppos-ss[j].qpos
			if di != dj {
				return di < dj
			}
			return ss[i].qpos < ss[j].qpos
		})
		streamLen := rel.docs[d-1].StreamLen
		var cur *simWindow
		var curQ map[int]bool
		lastDiag := 0
		flush := func() {
			if cur != nil {
				cur.support = len(curQ)
				wins = append(wins, *cur)
			}
		}
		for _, s := range ss {
			diag := s.ppos - s.qpos
			if cur != nil && diag-lastDiag <= diagSlack {
				if hi := diag + m + margin; hi > cur.end {
					cur.end = hi
				}
				curQ[s.qpos] = true
				lastDiag = diag
				continue
			}
			flush()
			cur = &simWindow{doc: d, start: diag - margin, end: diag + m + margin}
			curQ = map[int]bool{s.qpos: true}
			lastDiag = diag
		}
		flush()
		// برش به جریان و ادغام هم‌پوشان‌ها
		for i := range wins {
			if wins[i].doc != d {
				continue
			}
			if wins[i].start < 0 {
				wins[i].start = 0
			}
			if wins[i].end > streamLen {
				wins[i].end = streamLen
			}
		}
	}
	wins = mergeWindows(wins)
	sort.SliceStable(wins, func(i, j int) bool {
		if wins[i].support != wins[j].support {
			return wins[i].support > wins[j].support
		}
		if wins[i].doc != wins[j].doc {
			return wins[i].doc < wins[j].doc
		}
		return wins[i].start < wins[j].start
	})
	// بذرهای تک (یک واژهٔ مشترک) فقط وقتی پرسش خیلی کوتاه است ارزش دارند
	if len(wins) > windowCap {
		out.partial = true
		wins = wins[:windowCap]
	}

	// ۴. هم‌ترازی
	qa := make([]AlignToken, m)
	var dfWords []string
	for i, t := range q.toks {
		qa[i] = AlignToken{N1: t.N1, N2: t.N2}
		dfWords = append(dfWords, t.N2)
	}
	type prepared struct {
		w    simWindow
		toks []winTok
	}
	// passageهای هر پنجره با یک پرس‌وجو برای هر خوشهٔ پنجره‌های نزدیک یک سند (نه یک پرس‌وجو
	// برای هر پنجره) و ردیف‌های غایب با واکشی دسته‌ای — هم‌ارز دقیق پرس‌وجوی تک‌پنجره.
	winSeqs, err := windowPassages(ctx, rel.main, wins)
	if err != nil {
		return out, err
	}
	var need []int64
	seen := map[int64]bool{}
	for _, ss := range winSeqs {
		for _, sq := range ss {
			if rowCache[sq] == nil && !seen[sq] {
				seen[sq] = true
				need = append(need, sq)
			}
		}
	}
	for start := 0; start < len(need); start += 500 {
		end := min(start+500, len(need))
		rs, err := fetchRows(ctx, rel.main, need[start:end], false)
		if err != nil {
			return out, err
		}
		for _, r := range rs {
			rowCache[r.Seq] = r
		}
	}
	var preps []prepared
	for wi, w := range wins {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		toks := windowTokens(w, winSeqs[wi], rowCache)
		if len(toks) == 0 {
			continue
		}
		for _, t := range toks {
			dfWords = append(dfWords, t.tok.N2)
		}
		preps = append(preps, prepared{w, toks})
	}
	if err := rel.prefetchDF(ctx, dfWords); err != nil {
		return out, err
	}
	al := newAligner(qa, rel.weightFn(), DefaultScoreProfile) // یک بار برای همهٔ پنجره‌های شارد
	var cands []rawResult
	var da []AlignToken
	for _, p := range preps {
		da = da[:0]
		for _, t := range p.toks {
			da = append(da, AlignToken{N1: t.tok.N1, N2: t.tok.N2})
		}
		if al.below(da, minScore) {
			continue // کران بالای امتیاز زیر آستانه: همان نتیجهٔ «رد»، بدون DP
		}
		ar := al.align(da)
		if ar.Score < minScore || ar.MatchEnd <= ar.MatchStart {
			continue
		}
		first := p.toks[ar.MatchStart]
		last := p.toks[ar.MatchEnd-1]
		absLo := first.row.SourceStart + first.tok.Start
		absHi := last.row.SourceStart + last.tok.End
		localHi := first.tok.Start
		if last.row == first.row {
			localHi = last.tok.End
		} else {
			localHi = len([]rune(first.row.TextOriginal))
		}
		// فیلتر نقش (سند/متن/آیه…) همانند L1–L3: آغاز تطبیق باید درون نقش خواسته‌شده باشد
		if len(roles) > 0 && !matchInsideRoles(first.row.RoleRanges, [2]int{first.tok.Start, localHi}, roles...) {
			continue
		}
		sim := &Similarity{Score: ar.Score, Coverage: ar.Coverage, Counts: ar.Counts, Diffs: ar.Diffs, Algorithm: ar.Algorithm, Version: ar.Version}
		h := rawHit{rng: [2]int{first.tok.Start, localHi}, layer: "L4", label: layerLabel("L4", nil, ar.Score), sim: sim, diffs: ar.Diffs}
		if last.row != first.row {
			h.absHi = absHi
		}
		cands = append(cands, rawResult{seq: first.row.Seq, start: first.tok.Start, doc: first.row.DocOrd, absLo: absLo, absHi: absHi,
			row: first.row, hit: h, score: ar.Score, cover: ar.Coverage, layer: "L4"})
	}
	// ۵. حذف تکرار: هم‌پوشانی با L1–L3 همان سند → حذف؛ هم‌پوشانی میان L4ها → بهترین امتیاز
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].score != cands[j].score {
			return cands[i].score > cands[j].score
		}
		if cands[i].cover != cands[j].cover {
			return cands[i].cover > cands[j].cover
		}
		if cands[i].seq != cands[j].seq {
			return cands[i].seq < cands[j].seq
		}
		return cands[i].start < cands[j].start
	})
	exactByDoc := map[int64][][2]int{}
	for _, x := range exact {
		exactByDoc[x.doc] = append(exactByDoc[x.doc], [2]int{x.absLo, x.absHi})
	}
	accepted := map[int64][][2]int{}
	for _, c := range cands {
		if overlapsAny(exactByDoc[c.doc], c.absLo, c.absHi) || overlapsAny(accepted[c.doc], c.absLo, c.absHi) {
			continue
		}
		accepted[c.doc] = append(accepted[c.doc], [2]int{c.absLo, c.absHi})
		out.results = append(out.results, c)
	}
	return out, nil
}

func overlapsAny(rs [][2]int, lo, hi int) bool {
	for _, r := range rs {
		if lo < r[1] && r[0] < hi {
			return true
		}
	}
	return false
}

func mergeWindows(ws []simWindow) []simWindow {
	sort.Slice(ws, func(i, j int) bool {
		if ws[i].doc != ws[j].doc {
			return ws[i].doc < ws[j].doc
		}
		return ws[i].start < ws[j].start
	})
	var out []simWindow
	for _, w := range ws {
		if w.end <= w.start {
			continue
		}
		if n := len(out); n > 0 && out[n-1].doc == w.doc && w.start <= out[n-1].end {
			if w.end > out[n-1].end {
				out[n-1].end = w.end
			}
			out[n-1].support += w.support
			continue
		}
		out = append(out, w)
	}
	return out
}

func missingSeqs(seqs []int64, cache map[int64]*ftsRow) []int64 {
	var out []int64
	seen := map[int64]bool{}
	for _, s := range seqs {
		if cache[s] == nil && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// bodyTokens واژه‌های بدنهٔ passage (بدون tail هم‌پوشانی) — هم‌تراز با مختصات جریان.
func bodyTokens(r *ftsRow) []norm.AlignedToken {
	toks := r.tokens()
	i := 0
	for i < len(toks) && toks[i].Start < r.BodyStart {
		i++
	}
	return toks[i:]
}

// windowClusterGap پنجره‌های یک سند که فاصله‌شان (در مختصات جریان) کمتر از این است با یک
// پرس‌وجوی بازه‌ای مشترک خوانده می‌شوند.
const windowClusterGap = 2048

type passageSpan struct {
	seq        int64
	start, end int
}

// windowPassages برای هر پنجره، seq passageهایی که بازهٔ جریانشان با [start,end) پنجره
// هم‌پوشانی دارد (stream_end > start AND stream_start < end) به ترتیب stream_start.
// passageهای یک سند پیاپی‌اند (stream_start هر passage = stream_end قبلی)، پس هر خوشه از
// آخرین passage آغازشده تا پیش از lo خوانده می‌شود و جست‌وجوی دودویی بازهٔ هر پنجره را می‌یابد.
func windowPassages(ctx context.Context, db *sql.DB, wins []simWindow) ([][]int64, error) {
	out := make([][]int64, len(wins))
	order := make([]int, len(wins))
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(a, b int) bool {
		wa, wb := wins[order[a]], wins[order[b]]
		if wa.doc != wb.doc {
			return wa.doc < wb.doc
		}
		return wa.start < wb.start
	})
	var spans []passageSpan
	for i := 0; i < len(order); {
		w0 := wins[order[i]]
		lo, hi := w0.start, w0.end
		j := i + 1
		for j < len(order) {
			w := wins[order[j]]
			if w.doc != w0.doc || w.start-hi > windowClusterGap {
				break
			}
			hi = max(hi, w.end)
			j++
		}
		rows, err := db.QueryContext(ctx, `SELECT seq, stream_start, stream_end FROM passages
			WHERE doc_ord = ?1 AND stream_start < ?3 AND stream_end > ?2
			  AND stream_start >= COALESCE((SELECT MAX(stream_start) FROM passages WHERE doc_ord = ?1 AND stream_start <= ?2), 0)
			ORDER BY stream_start, seq`, w0.doc, lo, hi)
		if err != nil {
			return nil, fmt.Errorf("fts5 engine: پنجرهٔ جریان: %w", err)
		}
		spans = spans[:0]
		for rows.Next() {
			var p passageSpan
			if err := rows.Scan(&p.seq, &p.start, &p.end); err != nil {
				rows.Close()
				return nil, fmt.Errorf("fts5 engine: پنجرهٔ جریان: %w", err)
			}
			spans = append(spans, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("fts5 engine: پنجرهٔ جریان: %w", err)
		}
		for _, wi := range order[i:j] {
			w := wins[wi]
			k := sort.Search(len(spans), func(k int) bool { return spans[k].end > w.start })
			for ; k < len(spans) && spans[k].start < w.end; k++ {
				if spans[k].end > w.start {
					out[wi] = append(out[wi], spans[k].seq)
				}
			}
		}
		i = j
	}
	return out, nil
}

// windowTokens واژه‌های بازهٔ [start,end) جریان سند از passageهای (کش‌شدهٔ) پنجره.
func windowTokens(w simWindow, seqs []int64, cache map[int64]*ftsRow) []winTok {
	var out []winTok
	for _, s := range seqs {
		r := cache[s]
		body := bodyTokens(r)
		// واژهٔ j بدنه در موضع جریان StreamStart+j است: فقط برش هم‌پوشان پیمایش می‌شود
		lo := max(w.start-r.StreamStart, 0)
		hi := min(w.end-r.StreamStart, len(body))
		for j := lo; j < hi; j++ {
			out = append(out, winTok{tok: body[j], row: r})
		}
	}
	return out
}

// nearForms واژه‌های واژگان با یک ویرایش حرفی از واژهٔ پرسش (L5 — §۲۰). نامزدها با
// پیشوند یا پسوند مشترک k‌حرفی (k=2، برای واژه‌های ۷حرفی به بالا k=3) جست‌وجو می‌شوند؛
// اثبات: یک ویرایش در واژهٔ دست‌کم ۴ حرفی همیشه یکی از این دو را حفظ می‌کند، به‌جز
// جابه‌جایی دو حرف میانی واژهٔ ۴ حرفی که با پیشوند تک‌حرفی پوشش داده می‌شود.
func nearForms(ctx context.Context, db *sql.DB, qN1, qN2 string) ([]string, bool, error) {
	r := []rune(qN1)
	L := len(r)
	if L < 4 {
		return nil, false, nil
	}
	k := 2
	if L >= 7 {
		k = 3
	}
	type form struct {
		n1 string
		df int
	}
	seen := map[string]bool{}
	var forms []form
	scan := func(q string, args ...any) error {
		rows, err := db.QueryContext(ctx, q, args...)
		if err != nil {
			return fmt.Errorf("fts5 engine: واژگان L5: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var n1, n2 string
			var df int
			if err := rows.Scan(&n1, &n2, &df); err != nil {
				return err
			}
			if seen[n1] || n2 == qN2 || !norm.EditDistance1(qN2, n2) {
				continue
			}
			seen[n1] = true
			forms = append(forms, form{n1, df})
		}
		return rows.Err()
	}
	pre := string(r[:k])
	suf := reverseRunes(string(r[L-k:]))
	if err := scan(`SELECT n1, n2, df FROM vocabulary WHERE n1 >= ? AND n1 < ? AND length(n1) BETWEEN ? AND ?`, pre, pre+"\U0010FFFF", L-1, L+1); err != nil {
		return nil, false, err
	}
	if err := scan(`SELECT n1, n2, df FROM vocabulary WHERE rev >= ? AND rev < ? AND length(n1) BETWEEN ? AND ?`, suf, suf+"\U0010FFFF", L-1, L+1); err != nil {
		return nil, false, err
	}
	if L == 4 {
		p1 := string(r[:1])
		if err := scan(`SELECT n1, n2, df FROM vocabulary WHERE n1 >= ? AND n1 < ? AND length(n1) = 4`, p1, p1+"\U0010FFFF"); err != nil {
			return nil, false, err
		}
	}
	sort.Slice(forms, func(i, j int) bool {
		if forms[i].df != forms[j].df {
			return forms[i].df > forms[j].df
		}
		return forms[i].n1 < forms[j].n1
	})
	// برش به ۲۴ صورتِ بیش‌df اعلام می‌شود (بقیه بی‌اعلام حذف نمی‌شوند).
	truncated := len(forms) > l5MaxForms
	out := make([]string, 0, l5MaxForms)
	for i := 0; i < len(forms) && i < l5MaxForms; i++ {
		out = append(out, forms[i].n1)
	}
	return out, truncated, nil
}

func reverseRunes(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}
