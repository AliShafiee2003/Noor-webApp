// Package search — هم‌ترازی قطعه‌ها و امتیازدهی شباهت L4 مطابق بخش ۲۳ سند معماری.
//
// مدل: Fitting Alignment (کل پرسش در برابر بخشی از پنجرهٔ متن) روی واژه‌های N1/N2 با
// هزینه‌های وزن‌دار IDF سراسری release، همراه با traceback کامل، فهرست تفاوت‌ها،
// شمار ویرایش‌ها و گذر دوم «جابه‌جایی بلوکی».
//
//	S = max(0, 1 − C / W_q)
//
// | عملیات                                   | هزینه                         |
// |------------------------------------------|-------------------------------|
// | تطابق N1                                 | ۰                             |
// | تطابق فقط در N2 یا پیشوند چسبان مصوب      | ۰٫۱ × وزن واژهٔ پرسش           |
// | واژهٔ نزدیک (یک ویرایش حرفی، طول ≥ ۴)     | ۰٫۳ × وزن واژهٔ پرسش           |
// | جایگزینی / حذف                           | وزن واژهٔ پرسش                 |
// | افزوده (واژهٔ اضافهٔ متن)                 | ۰٫۵ × وزن واژهٔ متن            |
// | جابه‌جایی دو واژهٔ مجاور                  | ۰٫۳ × مجموع وزن دو واژه        |
// | جابه‌جایی بلوکی (≥ ۲ واژه)               | ۰٫۲ × وزن قطعه + هزینهٔ ثابت    |
//
// ویژگی‌ها (آزموده در aligner_test.go): تطابق کامل N1 = ۱۰۰٪؛ افزودن تغییر امتیاز را
// بالا نمی‌برد؛ امتیاز به ترتیب شارد/پردازش وابسته نیست.
package search

import (
	"fmt"
	"math"
	"strings"

	"noor/internal/norm"
)

// AlignerAlgorithm و AlignerVersion شناسهٔ پروفایل امتیاز؛ در نتیجه و manifest ثبت می‌شوند.
const (
	AlignerAlgorithm = "A1-weighted-fitting"
	AlignerVersion   = "2.1"
)

// ScoreProfile ثابت‌های نسخه‌دار امتیاز (§۲۳).
type ScoreProfile struct {
	OrthoFactor     float64 // تطابق فقط در N2 / پیشوند مصوب
	NearFactor      float64 // واژهٔ نزدیک
	InsertFactor    float64 // افزوده × وزن واژهٔ متن
	SwapFactor      float64 // جابه‌جایی مجاور × مجموع وزن دو واژه
	MoveFactor      float64 // جابه‌جایی بلوکی × وزن قطعه
	MoveFixed       float64 // هزینهٔ ثابت جابه‌جایی بلوکی
	MinBlockMoveLen int
}

// DefaultScoreProfile پروفایل baseline بخش ۲۳.
var DefaultScoreProfile = ScoreProfile{
	OrthoFactor:     0.1,
	NearFactor:      0.3,
	InsertFactor:    0.5,
	SwapFactor:      0.3,
	MoveFactor:      0.2,
	MoveFixed:       1.0,
	MinBlockMoveLen: 2,
}

// AlignToken یک واژه برای هم‌ترازی (سطوح N1 و N2).
type AlignToken struct {
	N1 string
	N2 string
}

// EditCounts شمار تغییرات (نمایش کنار امتیاز — §۲۳).
type EditCounts struct {
	Exact          int `json:"exact"`
	Orthographic   int `json:"orthographic"`
	NearSpelling   int `json:"near_spelling"`
	Substitutions  int `json:"substitutions"`
	Deletions      int `json:"deletions"`
	Insertions     int `json:"insertions"`
	Transpositions int `json:"transpositions"`
	BlockMoves     int `json:"block_moves"`
	// Honorific افزوده/حذفِ واژه‌های عبارت دعایی شناخته‌شده («صلی الله علیه وآله»، «(ع)»…)
	// — جدا از افزوده/حذف عادی شمرده می‌شود و هزینهٔ کمتری دارد (A1/2.1).
	Honorific int `json:"honorific,omitempty"`
}

// Total شمار کل تغییرات واژه‌ای (بدون تطابق‌ها و تفاوت املایی مصوب).
func (c EditCounts) Total() int {
	return c.NearSpelling + c.Substitutions + c.Deletions + c.Insertions + c.Transpositions + c.BlockMoves + c.Honorific
}

// HonorificFactor ضریب هزینهٔ افزوده/حذف واژه‌های عبارت دعایی نسبت به واژهٔ عادی.
const HonorificFactor = 0.15

// AlignOp یک گام هم‌ترازی برای diff واژه‌به‌واژه.
type AlignOp struct {
	Op    string `json:"op"` // match|ortho|near|sub|del|ins|swap|move
	Q     int    `json:"q"`  // اندیس واژهٔ پرسش (−۱ برای افزوده)
	D     int    `json:"d"`  // اندیس واژهٔ پنجره (−۱ برای حذف)
	Label string `json:"label,omitempty"`
}

// AlignmentResult نتیجهٔ هم‌ترازی پرسش با یک پنجره از متن.
type AlignmentResult struct {
	Score      float64    `json:"score"`    // [0..1]
	Coverage   float64    `json:"coverage"` // واژه‌های تطبیق‌یافتهٔ پرسش ÷ همهٔ واژه‌ها
	Algorithm  string     `json:"algorithm"`
	Version    string     `json:"version"`
	Diffs      []string   `json:"diffs"`
	Counts     EditCounts `json:"counts"`
	Ops        []AlignOp  `json:"-"`
	MatchStart int        `json:"match_start"` // آغاز بازه در پنجره (اندیس واژه، شامل)
	MatchEnd   int        `json:"match_end"`   // پایان بازه (انحصاری)
	Cost       float64    `json:"-"`
	WeightQ    float64    `json:"-"`
}

// TokenWeight وزن یک واژه: w(t) = clamp(ln(N/df), 1, 5).
func TokenWeight(df, totalDocs int) float64 {
	if totalDocs <= 0 {
		totalDocs = 10000
	}
	if df <= 0 {
		df = 1
	}
	idf := math.Log(float64(totalDocs) / float64(df))
	if idf < 1.0 {
		return 1.0
	}
	if idf > 5.0 {
		return 5.0
	}
	return idf
}

// AlignQueryToText پوشش سازگاری با امضای قدیمی: واژه‌ها خام‌اند و اینجا N1/N2 می‌شوند.
func AlignQueryToText(queryWords, docWords []string, getDF func(w string) int, totalDocs int) AlignmentResult {
	toTok := func(ws []string) []AlignToken {
		out := make([]AlignToken, len(ws))
		for i, w := range ws {
			n1, _ := norm.Normalize(w)
			out[i] = AlignToken{N1: n1, N2: norm.WordToN2(n1)}
		}
		return out
	}
	weight := func(n2 string) float64 {
		df := 1
		if getDF != nil {
			df = getDF(n2)
		}
		return TokenWeight(df, totalDocs)
	}
	return Align(toTok(queryWords), toTok(docWords), weight, DefaultScoreProfile)
}

const (
	opNone byte = iota
	opDiag
	opDel
	opIns
	opSwap
)

// Align هم‌ترازی fitting کامل با traceback. weight(n2) وزن سراسری واژه است (nil = ۱).
// برای چند پنجره با یک پرسش، newAligner را یک بار بسازید و align را برای هر پنجره صدا بزنید:
// گونه‌های پیشوندی پرسش، وزن‌ها و کلاس جفت‌واژه‌ها میان پنجره‌ها بازاستفاده می‌شوند.
func Align(q, d []AlignToken, weight func(n2 string) float64, prof ScoreProfile) AlignmentResult {
	if len(q) == 0 || len(d) == 0 {
		return AlignmentResult{Algorithm: AlignerAlgorithm, Version: AlignerVersion}
	}
	return newAligner(q, weight, prof).align(d)
}

// کلاس جفت (واژهٔ پرسش، واژهٔ متن): ترتیب و معنای همان pairCost پیشین؛ یک بار برای هر جفت
// متمایز محاسبه و کش می‌شود (توزیع Zipf → اکثر خانه‌های DP از کش خوانده می‌شوند).
const (
	pcMatch uint8 = 1 + iota // N1 برابر
	pcOrtho                  // N2 برابر
	pcAlt                    // گونهٔ پیشوندی مصوب L3
	pcNear                   // یک ویرایش حرفی
	pcSub                    // جایگزینی

	pcKind uint8 = 7
	pcEq   uint8 = 8 // eqN2: N2 برابر یا گونهٔ مصوب (شرط جابه‌جایی مجاور و بلوکی)
)

// alignerClassBudget سقف خانه‌های کش کلاس (m × واژهٔ متمایز متن) ≈ ۸ مگابایت؛ عبور → بازنشانی.
var alignerClassBudget = 1 << 23

// aligner وضعیت آماده‌شدهٔ یک پرسش برای هم‌ترازی پنجره‌های پیاپی (ایمن برای یک goroutine).
type aligner struct {
	q      []AlignToken
	m      int
	prof   ScoreProfile
	weight func(string) float64
	qw     []float64
	qdel   []float64
	qOrtho []float64
	qNear  []float64
	wq     float64
	hq     []bool
	alts   []map[string]string
	qr     [][]rune

	// فرهنگ واژه‌های متمایز متن، پایدار در طول همهٔ پنجره‌ها
	ids  map[AlignToken]int32
	dTok []AlignToken
	dWt  []float64
	dR   [][]rune
	cls  []uint8 // [id*m + i]؛ ۰ = هنوز محاسبه نشده
	zero []uint8

	// boundOK: در این پروفایل جابه‌جایی مجاور/بلوکی هرگز از هزینهٔ کلاس eq ارزان‌تر نیست، پس
	// کران پایین هزینه (below) معتبر است.
	boundOK bool
	pid     []int32

	// بافرهای بازاستفاده
	dp  []float64
	bt  []byte
	did []int32
	dw  []float64
	ins []float64
	dn2 []string
}

func newAligner(q []AlignToken, weight func(string) float64, prof ScoreProfile) *aligner {
	if weight == nil {
		weight = func(string) float64 { return 1 }
	}
	m := len(q)
	al := &aligner{q: q, m: m, prof: prof, weight: weight, ids: map[AlignToken]int32{}}
	al.qw = make([]float64, m)
	al.qdel = make([]float64, m)
	al.qOrtho = make([]float64, m)
	al.qNear = make([]float64, m)
	for i, t := range q {
		al.qw[i] = weight(t.N2)
		al.wq += al.qw[i]
	}
	qn2 := make([]string, m)
	for i, t := range q {
		qn2[i] = t.N2
	}
	al.hq = norm.HonorificMask(qn2)
	for i := range al.qw {
		al.qdel[i] = al.qw[i]
		if al.hq[i] {
			al.qdel[i] *= HonorificFactor
		}
		al.qOrtho[i] = prof.OrthoFactor * al.qw[i]
		al.qNear[i] = prof.NearFactor * al.qw[i]
	}
	al.alts = make([]map[string]string, m)
	for i, t := range q {
		mp := map[string]string{}
		for _, a := range norm.N2Alternatives(t.N2) {
			if a.Diff != "" {
				mp[a.Form] = a.Diff
			}
		}
		al.alts[i] = mp
	}
	al.qr = make([][]rune, m)
	al.zero = make([]uint8, m)
	al.boundOK = prof.OrthoFactor >= 0 && prof.NearFactor >= 0 && prof.InsertFactor >= 0 &&
		prof.SwapFactor >= prof.OrthoFactor && prof.MoveFactor >= prof.OrthoFactor && prof.MoveFixed >= 0
	return al
}

// below آیا امتیاز گردشدهٔ align(d) قطعاً کمتر از minScore است؟ (هرس دقیق، بی‌اثر بر نتایج)
//
// کران: هر واژهٔ پرسش در هم‌ترازی نهایی دقیقاً یکی از این‌ها را می‌پردازد — قطر (هزینهٔ کلاس با
// یک واژهٔ پنجره)، حذف (qdel)، جابه‌جایی مجاور (SwapFactor·w، فقط با جفت eq) یا جابه‌جایی بلوکی
// (MoveFactor·w + سهم MoveFixed، فقط با eq). کلاس‌های eq هزینهٔ ۰ یا OrthoFactor·w دارند، پس با
// boundOK کمینهٔ min(qdel، کمینهٔ هزینهٔ کلاس روی واژه‌های پنجره) کران پایین سهم هر واژه است؛
// افزوده‌ها نامنفی‌اند. پس cost ≥ LB و score ≤ 1 − LB/wq. کلاس‌ها در همان کش align پر می‌شوند.
func (al *aligner) below(d []AlignToken, minScore float64) bool {
	m, n := al.m, len(d)
	if !al.boundOK || m == 0 || n == 0 || al.wq <= 0 || minScore <= 0 {
		return false
	}
	if len(al.dTok)*m > alignerClassBudget {
		al.resetDict()
	}
	if cap(al.pid) < n {
		al.pid = make([]int32, n)
	}
	ids := al.pid[:n]
	for j, t := range d {
		ids[j] = al.intern(t)
	}
	lb := 0.0
	for i := 0; i < m; i++ {
		best := al.qdel[i]
		for _, id := range ids {
			if c := al.cost(i, al.class(i, id)); c < best {
				best = c
				if c == 0 {
					break
				}
			}
		}
		lb += best
		// حاشیهٔ 1e-9 خطای ترتیب جمع ممیز شناور را می‌پوشاند؛ گرد کردن و برش یکنوا هستند
		ub := 1 - (lb-1e-9)/al.wq
		if ub < 0 {
			ub = 0
		}
		if ub > 1 {
			ub = 1
		}
		if math.Round(ub*1000)/1000 < minScore {
			return true
		}
	}
	return false
}

func (al *aligner) resetDict() {
	al.ids = map[AlignToken]int32{}
	al.dTok, al.dWt, al.dR, al.cls = al.dTok[:0], al.dWt[:0], al.dR[:0], al.cls[:0]
}

func (al *aligner) intern(t AlignToken) int32 {
	if id, ok := al.ids[t]; ok {
		return id
	}
	id := int32(len(al.dTok))
	al.ids[t] = id
	al.dTok = append(al.dTok, t)
	al.dWt = append(al.dWt, al.weight(t.N2))
	al.dR = append(al.dR, nil)
	al.cls = append(al.cls, al.zero...)
	return id
}

func (al *aligner) qRunes(i int) []rune {
	if al.qr[i] == nil {
		al.qr[i] = []rune(al.q[i].N2)
	}
	return al.qr[i]
}

func (al *aligner) dRunes(id int32) []rune {
	if al.dR[id] == nil {
		al.dR[id] = []rune(al.dTok[id].N2)
	}
	return al.dR[id]
}

// class کلاس جفت (i، id) با همان ترتیب تصمیم pairCost/eqN2 پیشین.
func (al *aligner) class(i int, id int32) uint8 {
	p := int(id)*al.m + i
	if c := al.cls[p]; c != 0 {
		return c
	}
	x, y := al.q[i], al.dTok[id]
	var c uint8
	alt := false
	switch {
	case x.N1 == y.N1:
		c = pcMatch
	case x.N2 == y.N2:
		c = pcOrtho
	default:
		_, alt = al.alts[i][y.N2]
		switch {
		case alt:
			c = pcAlt
		case norm.EditDistance1Runes(al.qRunes(i), al.dRunes(id)):
			c = pcNear
		default:
			c = pcSub
		}
	}
	if x.N2 == y.N2 || alt {
		c |= pcEq
	} else if c == pcMatch {
		if _, ok := al.alts[i][y.N2]; ok {
			c |= pcEq
		}
	}
	al.cls[p] = c
	return c
}

func (al *aligner) eq(i int, id int32) bool { return al.class(i, id)&pcEq != 0 }

func (al *aligner) cost(i int, c uint8) float64 {
	switch c & pcKind {
	case pcMatch:
		return 0
	case pcOrtho, pcAlt:
		return al.qOrtho[i]
	case pcNear:
		return al.qNear[i]
	}
	return al.qw[i]
}

// opLabel نام عمل و برچسب diff (فقط در traceback ساخته می‌شود، نه در هر خانهٔ DP).
func (al *aligner) opLabel(i int, id int32) (string, string) {
	switch al.class(i, id) & pcKind {
	case pcMatch:
		return "match", ""
	case pcOrtho:
		return "ortho", orthoLabel(al.q[i].N1, al.dTok[id].N1)
	case pcAlt:
		return "ortho", al.alts[i][al.dTok[id].N2]
	case pcNear:
		return "near", "املای نزدیک"
	}
	return "sub", ""
}

func growF(b []float64, n int) []float64 {
	if cap(b) < n {
		return make([]float64, n)
	}
	return b[:n]
}

// align هم‌ترازی یک پنجره؛ خروجی دقیقاً برابر نسخهٔ پیشین (TestAlignerMatchesReference).
func (al *aligner) align(d []AlignToken) AlignmentResult {
	m, n := al.m, len(d)
	res := AlignmentResult{Algorithm: AlignerAlgorithm, Version: AlignerVersion}
	if m == 0 || n == 0 {
		return res
	}
	if len(al.dTok)*m > alignerClassBudget {
		al.resetDict()
	}
	q, prof, qw, qdel, hq, wq := al.q, al.prof, al.qw, al.qdel, al.hq, al.wq
	if cap(al.did) < n {
		al.did = make([]int32, n)
		al.dn2 = make([]string, n)
	}
	did, dn2 := al.did[:n], al.dn2[:n]
	for j, t := range d {
		did[j] = al.intern(t)
		dn2[j] = t.N2
	}
	hd := norm.HonorificMask(dn2)
	al.dw, al.ins = growF(al.dw, n), growF(al.ins, n)
	dw, ins := al.dw, al.ins
	for j := range d {
		w := al.dWt[did[j]]
		if hd[j] {
			w *= HonorificFactor
		}
		dw[j] = w
		ins[j] = prof.InsertFactor * w
	}

	W := n + 1
	al.dp = growF(al.dp, (m+1)*W)
	if cap(al.bt) < (m+1)*W {
		al.bt = make([]byte, (m+1)*W)
	}
	dp, bt := al.dp, al.bt[:(m+1)*W]
	for j := 0; j < W; j++ {
		dp[j] = 0 // پایان آزاد: سطر صفر هزینهٔ صفر
	}
	for i := 1; i <= m; i++ {
		dp[i*W] = dp[(i-1)*W] + qdel[i-1]
		bt[i*W] = opDel
	}
	for i := 1; i <= m; i++ {
		ci := i - 1
		row, prev := dp[i*W:(i+1)*W], dp[(i-1)*W:i*W]
		var prev2 []float64
		if i > 1 {
			prev2 = dp[(i-2)*W : (i-1)*W]
		}
		swapCost := 0.0
		if i > 1 {
			swapCost = prof.SwapFactor * (qw[ci] + qw[ci-1])
		}
		btRow := bt[i*W : (i+1)*W]
		for j := 1; j <= n; j++ {
			c := al.class(ci, did[j-1])
			best := prev[j-1] + al.cost(ci, c)
			op := opDiag
			if x := prev[j] + qdel[ci]; x < best {
				best, op = x, opDel
			}
			if x := row[j-1] + ins[j-1]; x < best {
				best, op = x, opIns
			}
			if i > 1 && j > 1 && al.eq(ci, did[j-2]) && al.eq(ci-1, did[j-1]) && !(c&pcEq != 0 && al.eq(ci-1, did[j-2])) {
				if x := prev2[j-2] + swapCost; x < best {
					best, op = x, opSwap
				}
			}
			row[j] = best
			btRow[j] = op
		}
	}
	// بهترین پایان؛ در تساوی، کوتاه‌ترین (نخستین) پایان
	bestEnd := 0
	bestCost := dp[m*W]
	for j := 1; j <= n; j++ {
		if dp[m*W+j] < bestCost-1e-12 {
			bestCost = dp[m*W+j]
			bestEnd = j
		}
	}
	// traceback
	var ops []AlignOp
	i, j := m, bestEnd
	for i > 0 {
		switch bt[i*W+j] {
		case opDiag:
			op, lab := al.opLabel(i-1, did[j-1])
			ops = append(ops, AlignOp{Op: op, Q: i - 1, D: j - 1, Label: lab})
			i--
			j--
		case opDel:
			ops = append(ops, AlignOp{Op: "del", Q: i - 1, D: -1})
			i--
		case opIns:
			ops = append(ops, AlignOp{Op: "ins", Q: -1, D: j - 1})
			j--
		case opSwap:
			ops = append(ops, AlignOp{Op: "swap", Q: i - 1, D: j - 2}, AlignOp{Op: "swap", Q: i - 2, D: j - 1})
			i -= 2
			j -= 2
		default:
			ops = append(ops, AlignOp{Op: "del", Q: i - 1, D: -1})
			i--
		}
	}
	// برعکس کردن به ترتیب متن
	for a, b := 0, len(ops)-1; a < b; a, b = a+1, b-1 {
		ops[a], ops[b] = ops[b], ops[a]
	}
	start := j
	end := bestEnd
	// اگر هیچ واژه‌ای در متن مصرف نشد، بازه تهی است
	if end < start {
		end = start
	}
	cost := bestCost

	// گذر دوم: جابه‌جایی بلوکی (§۲۳) — قطعهٔ حذف‌شدهٔ پرسش که جای دیگری از پنجره آمده
	used := make([]bool, n)
	for _, o := range ops {
		if o.D >= 0 && o.Op != "ins" {
			used[o.D] = true
		}
	}
	runs := deletedRuns(ops, prof.MinBlockMoveLen)
	for _, rn := range runs {
		L := rn[1] - rn[0]
		bestP := -1
		bestDist := 1 << 30
		for p := 0; p+L <= n; p++ {
			ok := true
			for k := 0; k < L; k++ {
				if used[p+k] || !al.eq(rn[0]+k, did[p+k]) {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			dist := 0
			if p+L <= start {
				dist = start - (p + L)
			} else if p >= end {
				dist = p - end
			}
			if dist < bestDist {
				bestDist, bestP = dist, p
			}
		}
		if bestP < 0 {
			continue
		}
		segW, segDel := 0.0, 0.0
		for k := rn[0]; k < rn[1]; k++ {
			segW += qw[k]
			segDel += qdel[k] // هزینهٔ حذفی که پیش‌تر شمرده شد
		}
		delta := -segDel + prof.MoveFactor*segW + prof.MoveFixed
		// واژه‌های بلوک که قبلاً «افزوده» شمرده شده بودند دیگر هزینهٔ افزوده ندارند
		insIdx := map[int]bool{}
		for oi, o := range ops {
			if o.Op == "ins" && o.D >= bestP && o.D < bestP+L {
				delta -= prof.InsertFactor * dw[o.D]
				insIdx[oi] = true
			}
		}
		// اگر بلوک بیرون بازه است، واژه‌های میانی افزوده می‌شوند و بازه گسترش می‌یابد
		newStart, newEnd := start, end
		var gapIns []int
		if bestP < start {
			for x := bestP + L; x < start; x++ {
				gapIns = append(gapIns, x)
			}
			newStart = bestP
		} else if bestP+L > end {
			for x := end; x < bestP; x++ {
				gapIns = append(gapIns, x)
			}
			newEnd = bestP + L
		}
		for _, x := range gapIns {
			delta += prof.InsertFactor * dw[x]
		}
		if delta >= 0 {
			continue
		}
		cost += delta
		start, end = newStart, newEnd
		// به‌روزرسانی ops
		var nops []AlignOp
		for oi, o := range ops {
			if insIdx[oi] {
				continue
			}
			if o.Op == "del" && o.Q >= rn[0] && o.Q < rn[1] {
				nops = append(nops, AlignOp{Op: "move", Q: o.Q, D: bestP + (o.Q - rn[0])})
				continue
			}
			nops = append(nops, o)
		}
		for _, x := range gapIns {
			nops = append(nops, AlignOp{Op: "ins", Q: -1, D: x})
		}
		ops = nops
		for k := 0; k < L; k++ {
			used[bestP+k] = true
		}
	}

	// شمارش و diff
	var cnt EditCounts
	matchedQ := 0
	var diffs []string
	addDiff := func(s string) {
		if len(diffs) < 24 {
			diffs = append(diffs, s)
		}
	}
	moveSeen := map[int]bool{}
	for k := 0; k < len(ops); k++ {
		o := ops[k]
		switch o.Op {
		case "match":
			cnt.Exact++
			matchedQ++
		case "ortho":
			cnt.Orthographic++
			matchedQ++
			addDiff(fmt.Sprintf("%s: «%s» ← «%s»", o.Label, d[o.D].N1, q[o.Q].N1))
		case "near":
			cnt.NearSpelling++
			matchedQ++
			addDiff(fmt.Sprintf("املای نزدیک: «%s» به‌جای «%s»", d[o.D].N1, q[o.Q].N1))
		case "sub":
			cnt.Substitutions++
			addDiff(fmt.Sprintf("جایگزینی: «%s» به‌جای «%s»", d[o.D].N1, q[o.Q].N1))
		case "del":
			if hq[o.Q] {
				cnt.Honorific++
				addDiff(fmt.Sprintf("حذف (عبارت دعایی): «%s»", q[o.Q].N1))
				break
			}
			cnt.Deletions++
			addDiff(fmt.Sprintf("حذف: «%s»", q[o.Q].N1))
		case "ins":
			if hd[o.D] {
				cnt.Honorific++
				addDiff(fmt.Sprintf("افزوده (عبارت دعایی): «%s»", d[o.D].N1))
				break
			}
			cnt.Insertions++
			addDiff(fmt.Sprintf("افزوده: «%s»", d[o.D].N1))
		case "swap":
			matchedQ++
			if k+1 < len(ops) && ops[k+1].Op == "swap" {
				cnt.Transpositions++
				matchedQ++
				addDiff(fmt.Sprintf("جابه‌جایی: «%s %s»", q[ops[k+1].Q].N1, q[o.Q].N1))
				k++
			}
		case "move":
			matchedQ++
			grp := o.Q
			for _, rn := range runs {
				if o.Q >= rn[0] && o.Q < rn[1] {
					grp = rn[0]
				}
			}
			if !moveSeen[grp] {
				moveSeen[grp] = true
				cnt.BlockMoves++
				var ws []string
				for _, rn := range runs {
					if rn[0] == grp {
						for x := rn[0]; x < rn[1]; x++ {
							ws = append(ws, q[x].N1)
						}
					}
				}
				addDiff(fmt.Sprintf("جابه‌جایی بلوکی: «%s»", strings.Join(ws, " ")))
			}
		}
	}
	score := 1.0
	if wq > 0 {
		score = 1.0 - cost/wq
	}
	if score < 0 {
		score = 0
	}
	if score > 1 {
		score = 1
	}
	res.Score = math.Round(score*1000) / 1000
	res.Coverage = math.Round(float64(matchedQ)/float64(m)*1000) / 1000
	res.Counts = cnt
	res.Ops = ops
	res.Diffs = diffs
	res.MatchStart = start
	res.MatchEnd = end
	res.Cost = cost
	res.WeightQ = wq
	return res
}

// deletedRuns بازه‌های پیوستهٔ واژه‌های حذف‌شدهٔ پرسش (به طول دست‌کم minLen).
func deletedRuns(ops []AlignOp, minLen int) [][2]int {
	var out [][2]int
	runStart, prev := -1, -2
	flush := func() {
		if runStart >= 0 && prev-runStart+1 >= minLen {
			out = append(out, [2]int{runStart, prev + 1})
		}
		runStart = -1
	}
	for _, o := range ops {
		if o.Op != "del" {
			if o.Op != "ins" { // افزوده‌های میان حذف‌ها زنجیره را نمی‌شکنند
				flush()
				prev = -2
			}
			continue
		}
		if runStart >= 0 && o.Q == prev+1 {
			prev = o.Q
			continue
		}
		flush()
		runStart, prev = o.Q, o.Q
	}
	flush()
	return out
}

// orthoLabel برچسب تفاوت املایی مصوب میان دو واژهٔ N1 هم‌ارز در N2.
func orthoLabel(a, b string) string {
	if l := norm.LexicalLabel(a, b); l != "" {
		return l
	}
	ra, rb := []rune(a), []rune(b)
	if len(ra) == len(rb) {
		kind := ""
		for i := range ra {
			if ra[i] == rb[i] {
				continue
			}
			k := "رسم‌الخط"
			switch {
			case isAlifHamza(ra[i]) && isAlifHamza(rb[i]):
				k = "همزه/الف"
			case isTaHa(ra[i]) && isTaHa(rb[i]):
				k = "ة/ه"
			case isYa(ra[i]) && isYa(rb[i]):
				k = "ی/ى"
			case (ra[i] == 'ؤ' && rb[i] == 'و') || (ra[i] == 'و' && rb[i] == 'ؤ'):
				k = "همزه/الف"
			}
			if kind == "" {
				kind = k
			} else if kind != k {
				return "تفاوت املایی"
			}
		}
		if kind != "" {
			return kind
		}
	}
	if strings.ContainsRune(a, 'ء') || strings.ContainsRune(b, 'ء') {
		return "همزه/الف"
	}
	return "رسم‌الخط قرآنی"
}

func isAlifHamza(r rune) bool {
	switch r {
	case 'ا', 'أ', 'إ', 'آ', 'ٱ', 'ئ', 'ی':
		return true
	}
	return false
}
func isTaHa(r rune) bool { return r == 'ة' || r == 'ه' || r == 'ۀ' }
func isYa(r rune) bool   { return r == 'ی' || r == 'ى' || r == 'ي' }

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
