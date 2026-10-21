package noordb

import (
	"os"
	"strings"
	"testing"

	"noor/internal/fixturegen"
	"noor/internal/xmlparse"
)

func TestDecodeFixtureItem4(t *testing.T) {
	// همان آیتم ۴ بحار — باید ayah و K حفظ شوند
	xmlText := `<hadith id="h-101" revayatindex="112"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> <maasoom mno="7">الإمام الصادق عليه السلام</maasoom> قال</sanadHadith><p>كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول.</p><ayah sure="2" aya="213" ayahAddress="البقرة: ٢١٣"><p>كانَ النَّاسُ أُمَّةً وَاحِدَةً فَبَعَثَ اللهُ النَّبِيِّينَ</p></ayah><K book="الخصال" vol="۱" page="۱۳۰">مأخذ</K></hadith>`
	dict := strings.Split(fixturegen.DictForTest(), "|")
	enc := encodeForTest(xmlText, dict)
	dec, err := Decode(enc, dict)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dec, "<ayah") {
		t.Errorf("تگ ayah باید در خروجی decode حفظ شود:\n%s", dec)
	}
	if !strings.Contains(dec, "<K book") {
		t.Errorf("تگ K باید حفظ شود:\n%s", dec)
	}
}

func encodeForTest(s string, dict []string) string {
	var b strings.Builder
	for _, p := range strings.Split(s, " ") {
		if p == "" {
			continue
		}
		idx := -1
		for i, d := range dict {
			if d == p {
				idx = i
				break
			}
		}
		if idx >= 0 {
			b.WriteString("|" + itoa(idx) + "|")
		} else {
			b.WriteString(strings.ReplaceAll(p, "|", "⁄"))
		}
		b.WriteByte(' ')
	}
	return strings.TrimRight(b.String(), " ")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func TestRealNoorSQLiteDecode(t *testing.T) {
	dbPath := "D:/Noor/00285/Data/books/01407/01407_011.db"
	if _, err := os.Stat(dbPath); err != nil {
		t.Skip("real database not accessible")
	}
	db, err := Open(dbPath)
	if err != nil {
		t.Skip("real database not accessible")
	}
	defer db.Close()

	schema, err := DetectSchema(db)
	if err != nil {
		t.Fatal(err)
	}
	if schema != "noor-v1" {
		t.Fatalf("expected noor-v1, got %s", schema)
	}

	dict, err := LoadDictionary(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(dict) != 125 {
		t.Fatalf("expected 125 dictionary entries, got %d", len(dict))
	}

	items, err := ReadDocItems(db, dict)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("expected docitems to be decoded")
	}

	// Verify DocItem 425 contains expected tags
	found425 := false
	for _, it := range items {
		if it.Id == 425 {
			found425 = true
			t.Logf("DocItem 425 XML:\n%s", it.XML)
			if !strings.Contains(it.XML, `<format class="hadith"`) {
				t.Fatalf("docitem 425 missing hadith format tag: %s", it.XML)
			}
			if len([]rune(it.XML)) != int(it.Length) {
				t.Fatalf("docitem 425 length mismatch: expected %d, got %d", it.Length, len([]rune(it.XML)))
			}
			break
		}
	}
	if !found425 {
		t.Fatal("docitem 425 not found in items")
	}
}

func TestInspect01314(t *testing.T) {
	dbPath := "D:/Noor/00166/Data/books/01314/01314_001.db"
	if _, err := os.Stat(dbPath); err != nil {
		t.Skip("01314_001.db not found")
	}
	db, err := Open(dbPath)
	if err != nil {
		t.Skip("01314_001.db not found")
	}
	defer db.Close()
	dict, err := LoadDictionary(db)
	if err != nil {
		t.Fatal(err)
	}
	// Decode DocItem 2075 (StoryId=2, ItemNo=1)
	var blob []byte
	err = db.QueryRow("SELECT Context FROM DocItem WHERE StoryId=2 ORDER BY ItemNo LIMIT 1").Scan(&blob)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := DecodeLZW(blob, dict)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Footnote DocItem 2075:\n%s", dec)
	// Check DocItems vs Blocks
	items, err := ReadDocItems(db, dict)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Read %d DocItems for Story 1", len(items))
	in := make([]xmlparse.ItemInput, 0, len(items))
	for _, it := range items {
		in = append(in, xmlparse.ItemInput{ID: it.Id, XML: it.XML})
	}
	model, err := xmlparse.ParseItems("d-test", in)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("ParseItems generated %d pages, %d blocks", len(model.Pages), len(model.Blocks))
	for i := 0; i < min(15, len(model.Pages)); i++ {
		p := model.Pages[i]
		t.Logf("Page %s (Label=%s, Serial=%d): StartBlock=%d, EndBlock=%d", p.UID, p.Label, p.Serial, p.StartBlock, p.EndBlock)
	}

	// Test ReadFootnotes
	fns, err := ReadFootnotes(db, dict)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Read %d Footnotes", len(fns))
	if len(fns) > 3 {
		t.Logf("Sample FN 0: UID=%d, Label=%s, Text=%s", fns[0].ItemNo, fns[0].Label, fns[0].Text)
		t.Logf("Sample FN 1: UID=%d, Label=%s, Text=%s", fns[1].ItemNo, fns[1].Label, fns[1].Text)
		t.Logf("Sample FN 2: UID=%d, Label=%s, Text=%s", fns[2].ItemNo, fns[2].Label, fns[2].Text)
	}

	// Test new disjoint allocation algorithm
	pbDetails, err := ReadPageBreakDetails(db)
	if err != nil {
		t.Fatal(err)
	}
	type docGroup struct {
		docID   int64
		indices []int
	}
	var groups []docGroup
	for i, pb := range pbDetails {
		if len(groups) == 0 || groups[len(groups)-1].docID != pb.DocItemID {
			groups = append(groups, docGroup{docID: pb.DocItemID, indices: []int{i}})
		} else {
			groups[len(groups)-1].indices = append(groups[len(groups)-1].indices, i)
		}
	}

	allocated := make(map[int][2]int)
	currentBlock := 0
	for gi, g := range groups {
		blks, ok := model.DocItemBlocks[g.docID]
		if !ok {
			for _, idx := range g.indices {
				allocated[idx] = [2]int{currentBlock, currentBlock - 1}
			}
			continue
		}
		startB := blks[0]
		if startB < currentBlock {
			startB = currentBlock
		}
		endB := len(model.Blocks) - 1
		if gi+1 < len(groups) {
			nextDocID := groups[gi+1].docID
			if nextBlks, ok2 := model.DocItemBlocks[nextDocID]; ok2 {
				if nextBlks[0] > startB {
					endB = nextBlks[0] - 1
				} else {
					endB = startB
				}
			}
		}
		if endB < startB {
			for _, idx := range g.indices {
				allocated[idx] = [2]int{currentBlock, currentBlock - 1}
			}
			continue
		}
		numBlocks := endB - startB + 1
		k := len(g.indices)
		if k == 1 {
			allocated[g.indices[0]] = [2]int{startB, endB}
			currentBlock = endB + 1
		} else if numBlocks < k {
			emptyCount := k - numBlocks
			for j := 0; j < emptyCount; j++ {
				allocated[g.indices[j]] = [2]int{startB, startB - 1}
			}
			cur := startB
			for j := emptyCount; j < k; j++ {
				allocated[g.indices[j]] = [2]int{cur, cur}
				cur++
			}
			currentBlock = endB + 1
		} else {
			cur := startB
			for j := 0; j < k; j++ {
				remPages := k - j
				remBlocks := endB - cur + 1
				take := remBlocks / remPages
				if take < 1 {
					take = 1
				}
				pEnd := cur + take - 1
				if j == k-1 || pEnd > endB {
					pEnd = endB
				}
				allocated[g.indices[j]] = [2]int{cur, pEnd}
				cur = pEnd + 1
			}
			currentBlock = endB + 1
		}
	}

	// Verify no overlaps
	seenBlocks := make(map[int]int)
	for i, pb := range pbDetails {
		r := allocated[i]
		if r[1] >= r[0] {
			for b := r[0]; b <= r[1]; b++ {
				if prevPage, exists := seenBlocks[b]; exists {
					t.Fatalf("Block %d assigned to page %d (serial %d) and page %d (serial %d)!", b, prevPage, pbDetails[prevPage].SerialNo, i, pb.SerialNo)
				}
				seenBlocks[b] = i
			}
		}
	}
	t.Logf("SUCCESS: All %d blocks mapped with ZERO overlap across %d pages!", len(seenBlocks), len(pbDetails))
	for i := 0; i < 15; i++ {
		r := allocated[i]
		t.Logf("Page %d (Serial %d, Num %s, DocID %d): blocks [%d..%d]", i+1, pbDetails[i].SerialNo, pbDetails[i].Number, pbDetails[i].DocItemID, r[0], r[1])
	}
}
