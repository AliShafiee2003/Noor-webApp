package index

import (
	"strings"
	"testing"
)

func TestWinnowingGuaranteedOverlap(t *testing.T) {
	// کران تضمین پوشش: t = w + k - 1 = 4 + 4 - 1 = 7
	// اگر دو متن در یک قطعهٔ ۷ واژه‌ای مشترک باشند، باید حداقل یک فینگرپرینت مشترک داشته باشند.
	commonSnippet := "قال رسول الله انما الاعمال بالنیات و انما"
	commonWords := strings.Fields(commonSnippet) // 7 words

	docWords := append([]string{"مقدمه", "کتاب", "در", "باب", "نیت"}, commonWords...)
	docWords = append(docWords, "توضیح", "پایانی", "روایت")

	queryWords := append([]string{"متن", "پرسش", "درباره"}, commonWords...)
	queryWords = append(queryWords, "در", "منابع")

	docFP := ComputeFingerprints(docWords, DefaultWinnowingK, DefaultWinnowingW)
	queryFP := ComputeFingerprints(queryWords, DefaultWinnowingK, DefaultWinnowingW)

	if len(docFP) == 0 {
		t.Fatal("docFP should not be empty")
	}
	if len(queryFP) == 0 {
		t.Fatal("queryFP should not be empty")
	}

	docHashes := make(map[uint64]bool)
	for _, fp := range docFP {
		docHashes[fp.Hash] = true
	}

	foundShared := false
	for _, qp := range queryFP {
		if docHashes[qp.Hash] {
			foundShared = true
			break
		}
	}

	if !foundShared {
		t.Fatalf("تضمین ریاضی winnowing نقض شد: دو متن با ۷ واژهٔ مشترک فینگرپرینت مشترک تولید نکردند!")
	}
}

func TestWinnowingShortText(t *testing.T) {
	words := []string{"یک", "دو"}
	fp := ComputeFingerprints(words, DefaultWinnowingK, DefaultWinnowingW)
	if len(fp) != 0 {
		t.Fatalf("متن کوتاه‌تر از k نباید فینگرپرینت تولید کند، گرفت: %+v", fp)
	}

	words4 := []string{"یک", "دو", "سه", "چهار"}
	fp4 := ComputeFingerprints(words4, DefaultWinnowingK, DefaultWinnowingW)
	if len(fp4) != 1 {
		t.Fatalf("متن ۴ واژه‌ای باید دقیقاً ۱ فینگرپرینت تولید کند، گرفت: %d", len(fp4))
	}
}
