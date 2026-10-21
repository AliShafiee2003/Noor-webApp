// Package index — پیاده‌سازی نمایهٔ بازکاربرد متن (winnowing fingerprints) مطابق بخش ۲۲ سند معماری
// مرجع علمی: مقالهٔ Winnowing (Schleimer, Wilkerson, Aiken - SIGMOD 2003).
// پارامترهای پایه: k = 4 (طول shingle)، w = 4 (اندازهٔ پنجرهٔ انتخاب).
// کران تضمین پوشش: اگر متن و پرسش قطعهٔ مشترک با حداقل t = w + k - 1 = 7 واژه داشته باشند،
// تضمین ریاضی وجود دارد که حداقل یک fingerprint مشترک تولید می‌شود.
package index

import (
	"hash/fnv"
)

const (
	DefaultWinnowingK = 4                                         // طول shingle (k واژه)
	DefaultWinnowingW = 4                                         // طول پنجره (w shingle)
	GuaranteedT       = DefaultWinnowingW + DefaultWinnowingK - 1 // t = 7 واژه
)

// Fingerprint نشان انگشت پایدار محاسبه‌شده با موضع واژه در جریان.
type Fingerprint struct {
	Hash uint64 `json:"hash"`
	Pos  int    `json:"pos"` // موضع واژه در جریان متن (0-based)
}

// HashShingle یک shingle تشکیل‌شده از k واژهٔ متوالی را به عدد ۶۴بیتی تبدیل می‌کند.
func HashShingle(words []string) uint64 {
	h := fnv.New64a()
	for i, w := range words {
		if i > 0 {
			h.Write([]byte{0x1F}) // جداکنندهٔ واحد
		}
		h.Write([]byte(w))
	}
	return h.Sum64()
}

// ComputeFingerprints دنبالهٔ واژه‌ها را گرفته و بر اساس الگوریتم winnowing، فینگرپرینت‌ها را استخراج می‌کند.
func ComputeFingerprints(words []string, k, w int) []Fingerprint {
	n := len(words)
	if n < k {
		return nil
	}

	// ۱. تولید hash برای هر k-shingle
	numShingles := n - k + 1
	shingleHashes := make([]uint64, numShingles)
	for i := 0; i < numShingles; i++ {
		shingleHashes[i] = HashShingle(words[i : i+k])
	}

	// اگر تعداد shingleها کمتر از w باشد، کمینهٔ کل را انتخاب می‌کنیم
	if numShingles < w {
		minIdx := 0
		for i := 1; i < numShingles; i++ {
			if shingleHashes[i] < shingleHashes[minIdx] {
				minIdx = i
			}
		}
		return []Fingerprint{{
			Hash: shingleHashes[minIdx],
			Pos:  minIdx,
		}}
	}

	// ۲. پنجره‌بندی winnowing با اندازهٔ w
	var fingerprints []Fingerprint
	minPos := -1 // موضع کمینهٔ آخرین پنجره

	for i := 0; i <= numShingles-w; i++ {
		// یافتن کمینه‌ترین هش در پنجرهٔ جاری [i .. i+w-1]
		// طبق قاعدهٔ winnowing: در صورت تساوی، راست‌ترین کمینه انتخاب می‌شود
		currentMin := i
		for j := 1; j < w; j++ {
			idx := i + j
			if shingleHashes[idx] <= shingleHashes[currentMin] {
				currentMin = idx
			}
		}

		// اگر کمینه نسبت به پنجرهٔ قبل تغییر کرده باشد، ثبت می‌شود
		if currentMin != minPos {
			fingerprints = append(fingerprints, Fingerprint{
				Hash: shingleHashes[currentMin],
				Pos:  currentMin,
			})
			minPos = currentMin
		}
	}

	return fingerprints
}
