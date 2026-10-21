package search

// مرجع آزمون هم‌ارزی: نسخهٔ پیشین Align کلمه‌به‌کلمه. aligner بهینه‌شده باید روی هر ورودی
// دقیقاً همان AlignmentResult را بسازد (TestAlignerMatchesReference).

import (
	"fmt"
	"math"
	"strings"

	"noor/internal/norm"
)

// alignReference پیاده‌سازی پیشین Align (مرجع آزمون هم‌ارزی؛ فقط در آزمون).
// Align هم‌ترازی fitting کامل با traceback. weight(n2) وزن سراسری واژه است (nil = ۱).
func alignReference(q, d []AlignToken, weight func(n2 string) float64, prof ScoreProfile) AlignmentResult {
	m, n := len(q), len(d)
	res := AlignmentResult{Algorithm: AlignerAlgorithm, Version: AlignerVersion}
	if m == 0 || n == 0 {
		return res
	}
	if weight == nil {
		weight = func(string) float64 { return 1 }
	}
	qw := make([]float64, m)
	wq := 0.0
	for i, t := range q {
		qw[i] = weight(t.N2)
		wq += qw[i]
	}
	dw := make([]float64, n)
	for j, t := range d {
		dw[j] = weight(t.N2)
	}
	// عبارت دعایی: افزوده/حذفش ارزان‌تر است (نقل‌قول با/بدون صلوات) ولی صفر نیست و جدا گزارش می‌شود
	qn2 := make([]string, m)
	for i, t := range q {
		qn2[i] = t.N2
	}
	dn2 := make([]string, n)
	for j, t := range d {
		dn2[j] = t.N2
	}
	hq, hd := norm.HonorificMask(qn2), norm.HonorificMask(dn2)
	qdel := make([]float64, m)
	for i := range qw {
		qdel[i] = qw[i]
		if hq[i] {
			qdel[i] *= HonorificFactor
		}
	}
	for j := range dw {
		if hd[j] {
			dw[j] *= HonorificFactor
		}
	}
	// گونه‌های پیشوندی L3 برای هر واژهٔ پرسش
	alts := make([]map[string]string, m)
	for i, t := range q {
		mp := map[string]string{}
		for _, a := range norm.N2Alternatives(t.N2) {
			if a.Diff != "" {
				mp[a.Form] = a.Diff
			}
		}
		alts[i] = mp
	}
	// هزینهٔ جفت (i,j) و برچسب
	type pair struct {
		cost  float64
		op    string
		label string
	}
	pairCost := func(i, j int) pair {
		a, b := q[i], d[j]
		switch {
		case a.N1 == b.N1:
			return pair{0, "match", ""}
		case a.N2 == b.N2:
			return pair{prof.OrthoFactor * qw[i], "ortho", orthoLabel(a.N1, b.N1)}
		}
		if lab, ok := alts[i][b.N2]; ok {
			return pair{prof.OrthoFactor * qw[i], "ortho", lab}
		}
		if norm.EditDistance1(a.N2, b.N2) {
			return pair{prof.NearFactor * qw[i], "near", "املای نزدیک"}
		}
		return pair{qw[i], "sub", ""}
	}
	eqN2 := func(i, j int) bool {
		if q[i].N2 == d[j].N2 {
			return true
		}
		_, ok := alts[i][d[j].N2]
		return ok
	}

	W := n + 1
	dp := make([]float64, (m+1)*W)
	bt := make([]byte, (m+1)*W)
	for i := 1; i <= m; i++ {
		dp[i*W] = dp[(i-1)*W] + qdel[i-1]
		bt[i*W] = opDel
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			pc := pairCost(i-1, j-1)
			best := dp[(i-1)*W+j-1] + pc.cost
			op := opDiag
			if c := dp[(i-1)*W+j] + qdel[i-1]; c < best {
				best, op = c, opDel
			}
			if c := dp[i*W+j-1] + prof.InsertFactor*dw[j-1]; c < best {
				best, op = c, opIns
			}
			if i > 1 && j > 1 && eqN2(i-1, j-2) && eqN2(i-2, j-1) && !(eqN2(i-1, j-1) && eqN2(i-2, j-2)) {
				if c := dp[(i-2)*W+j-2] + prof.SwapFactor*(qw[i-1]+qw[i-2]); c < best {
					best, op = c, opSwap
				}
			}
			dp[i*W+j] = best
			bt[i*W+j] = op
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
			pc := pairCost(i-1, j-1)
			ops = append(ops, AlignOp{Op: pc.op, Q: i - 1, D: j - 1, Label: pc.label})
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
				if used[p+k] || !eqN2(rn[0]+k, p+k) {
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
