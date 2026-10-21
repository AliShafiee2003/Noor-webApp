package search

// آزمون قرارداد دوحالتهٔ text/words: نگاشت به حالت داخلی، خطاهای ترکیب ناسازگار،
// هم‌ارزی کامل نتایج با حالت‌های قدیمی، کلید کش و فیلتر نمایش result_layers.

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestCanonicalizeMapping(t *testing.T) {
	cases := []struct {
		name     string
		req      Request
		mode     string
		sort     string
		near     *NearOpts
		wantFlex string
	}{
		{"text default", Request{Mode: ModeText}, Tiered, "", nil, FlexSimilar},
		{"text exact", Request{Mode: ModeText, Flex: FlexExact}, StrictPhrase, "", nil, FlexExact},
		{"text written", Request{Mode: ModeText, Flex: FlexWritten}, NormalizedPhrase, "", nil, FlexWritten},
		{"text spelling", Request{Mode: ModeText, Flex: FlexSpelling}, Linguistic, "", nil, FlexSpelling},
		{"text similar", Request{Mode: ModeText, Flex: FlexSimilar, Sort: "source"}, Tiered, "source", nil, FlexSimilar},
		{"text similar sort=similarity", Request{Mode: ModeText, Sort: SortSimilarity}, SimilarQuote, "", nil, FlexSimilar},
		{"text spelling+morph", Request{Mode: ModeText, Flex: FlexSpelling, ExpandMorphology: true}, Linguistic, "", nil, FlexSpelling},
		{"text drops stray near", Request{Mode: ModeText, Near: &NearOpts{Slop: 3}}, Tiered, "", nil, FlexSimilar},
		{"words default", Request{Mode: ModeWords}, AllWords, "", nil, ""},
		{"words all", Request{Mode: ModeWords, Words: &WordsOpts{Match: "all"}}, AllWords, "", nil, ""},
		{"words any", Request{Mode: ModeWords, Words: &WordsOpts{Match: "any"}}, AnyWords, "", nil, ""},
		{"words distance", Request{Mode: ModeWords, Words: &WordsOpts{Distance: 5}}, Near, "", &NearOpts{Slop: 5}, ""},
		{"words distance ordered", Request{Mode: ModeWords, Words: &WordsOpts{Match: "all", Distance: 2, Ordered: true}}, Near, "", &NearOpts{Slop: 2, Ordered: true}, ""},
		{"legacy long_quote", Request{Mode: LongQuote}, Tiered, "", nil, FlexSimilar},
		{"legacy similar_quote sort=similarity", Request{Mode: SimilarQuote, Sort: SortSimilarity}, SimilarQuote, "", nil, FlexSimilar},
		{"legacy near kept", Request{Mode: Near, Near: &NearOpts{Slop: 4}}, Near, "", &NearOpts{Slop: 4}, ""},
	}
	cases = append(cases, struct {
		name     string
		req      Request
		mode     string
		sort     string
		near     *NearOpts
		wantFlex string
	}{"legacy relevance collapses", Request{Mode: Tiered, Sort: "relevance"}, Tiered, "", nil, FlexSimilar})
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := c.req
			if err := canonicalize(&r); err != nil {
				t.Fatalf("canonicalize: %v", err)
			}
			if r.Mode != c.mode || r.Sort != c.sort || !reflect.DeepEqual(r.Near, c.near) {
				t.Fatalf("got mode=%q sort=%q near=%+v; want %q %q %+v", r.Mode, r.Sort, r.Near, c.mode, c.sort, c.near)
			}
			if r.Flex != "" || r.Words != nil {
				t.Fatalf("flex/words must be cleared: %q %+v", r.Flex, r.Words)
			}
			if f := effectiveFlex(r.Mode); f != c.wantFlex {
				t.Fatalf("effectiveFlex(%s)=%q want %q", r.Mode, f, c.wantFlex)
			}
		})
	}
}

func TestCanonicalizeRejectsContradictions(t *testing.T) {
	bad := []struct {
		name string
		req  Request
	}{
		{"near_spelling with exact", Request{Mode: ModeText, Flex: FlexExact, NearSpelling: true}},
		{"near_spelling with spelling", Request{Mode: ModeText, Flex: FlexSpelling, NearSpelling: true}},
		{"layers with written", Request{Mode: ModeText, Flex: FlexWritten, Layers: []string{"L1"}}},
		{"sort=similarity with exact", Request{Mode: ModeText, Flex: FlexExact, Sort: SortSimilarity}},
		{"morphology with exact", Request{Mode: ModeText, Flex: FlexExact, ExpandMorphology: true}},
		{"morphology with written", Request{Mode: ModeText, Flex: FlexWritten, ExpandMorphology: true}},
		{"unknown flex", Request{Mode: ModeText, Flex: "fuzzy"}},
		{"words opts in text", Request{Mode: ModeText, Words: &WordsOpts{Match: "any"}}},
		{"flex in words", Request{Mode: ModeWords, Flex: FlexExact}},
		{"near_spelling in words", Request{Mode: ModeWords, NearSpelling: true}},
		{"morphology in words", Request{Mode: ModeWords, ExpandMorphology: true}},
		{"layers in words", Request{Mode: ModeWords, Layers: []string{"L1"}}},
		{"sort=similarity in words", Request{Mode: ModeWords, Sort: SortSimilarity}},
		{"any + distance", Request{Mode: ModeWords, Words: &WordsOpts{Match: "any", Distance: 3}}},
		{"any + ordered", Request{Mode: ModeWords, Words: &WordsOpts{Match: "any", Ordered: true}}},
		{"ordered without distance", Request{Mode: ModeWords, Words: &WordsOpts{Ordered: true}}},
		{"negative distance", Request{Mode: ModeWords, Words: &WordsOpts{Distance: -1}}},
		{"distance > 50", Request{Mode: ModeWords, Words: &WordsOpts{Distance: 51}}},
		{"unknown match", Request{Mode: ModeWords, Words: &WordsOpts{Match: "some"}}},
		{"flex with legacy mode", Request{Mode: Tiered, Flex: FlexExact}},
		{"words with legacy mode", Request{Mode: AllWords, Words: &WordsOpts{Match: "any"}}},
		{"sort=similarity with legacy tiered", Request{Mode: Tiered, Sort: SortSimilarity}},
	}
	for _, c := range bad {
		r := c.req
		r.Query = "العلم خير"
		if err := validateRequest(&r); err == nil {
			t.Errorf("%s: want error, got mode=%q", c.name, r.Mode)
		}
	}
}

func TestValidateLimitsAndResultLayers(t *testing.T) {
	long := func(n int) string { return strings.Repeat("ب", n) }
	ok := []Request{
		{Query: long(maxTextQueryRunes), Mode: ModeText, Flex: FlexExact},
		{Query: long(maxTextQueryRunes), Mode: Tiered},
		{Query: "العلم خير", Mode: ModeText, ResultLayers: []string{"L1", "L4"}},
		{Query: strings.Repeat("و ", maxAnyWords*3), Mode: ModeWords, Words: &WordsOpts{Match: "any"}},
	}
	for i, r := range ok {
		if err := validateRequest(&r); err != nil {
			t.Errorf("ok[%d]: %v", i, err)
		}
	}
	var many []string
	for i := 0; i <= maxAnyWords; i++ {
		many = append(many, "و"+strings.Repeat("ب", i+1))
	}
	bad := []Request{
		{Query: long(maxTextQueryRunes + 1), Mode: ModeText},
		{Query: long(maxWordsQueryRunes + 1), Mode: ModeWords},
		{Query: long(maxWordsQueryRunes + 1), Mode: AllWords},
		{Query: strings.Join(many, " "), Mode: ModeWords, Words: &WordsOpts{Match: "any"}},
		{Query: "العلم خير", Mode: ModeText, ResultLayers: []string{"L6"}},
		{Query: "العلم خير", Mode: ModeWords, ResultLayers: []string{"L1"}},
	}
	for i, r := range bad {
		if err := validateRequest(&r); err == nil {
			t.Errorf("bad[%d]: want error (mode %s)", i, r.Mode)
		}
	}
}

// legacyPairs هر جفت (قدیمی، تازه) باید پس از canonicalize یک درخواست داخلی بسازد.
func legacyPairs(q string) [][2]Request {
	return [][2]Request{
		{{Query: q, Mode: StrictPhrase}, {Query: q, Mode: ModeText, Flex: FlexExact}},
		{{Query: q, Mode: NormalizedPhrase}, {Query: q, Mode: ModeText, Flex: FlexWritten}},
		{{Query: q, Mode: Linguistic}, {Query: q, Mode: ModeText, Flex: FlexSpelling}},
		{{Query: q, Mode: Linguistic, ExpandMorphology: true}, {Query: q, Mode: ModeText, Flex: FlexSpelling, ExpandMorphology: true}},
		{{Query: q, Mode: Tiered}, {Query: q, Mode: ModeText}},
		{{Query: q, Mode: Tiered, NearSpelling: true}, {Query: q, Mode: ModeText, Flex: FlexSimilar, NearSpelling: true}},
		{{Query: q, Mode: Tiered, Layers: []string{"L1", "L2", "L3"}}, {Query: q, Mode: ModeText, Layers: []string{"L1", "L2", "L3"}}},
		{{Query: q, Mode: LongQuote}, {Query: q, Mode: ModeText, Flex: FlexSimilar}},
		{{Query: q, Mode: SimilarQuote}, {Query: q, Mode: ModeText, Sort: SortSimilarity}},
		{{Query: q, Mode: AllWords}, {Query: q, Mode: ModeWords}},
		{{Query: q, Mode: AnyWords}, {Query: q, Mode: ModeWords, Words: &WordsOpts{Match: "any"}}},
		{{Query: q, Mode: Near, Near: &NearOpts{Slop: 3, Ordered: true}}, {Query: q, Mode: ModeWords, Words: &WordsOpts{Distance: 3, Ordered: true}}},
		{{Query: q, Mode: Near, Near: &NearOpts{Slop: 6}}, {Query: q, Mode: ModeWords, Words: &WordsOpts{Distance: 6}}},
	}
}

func TestRequestKeyLegacyEquivalence(t *testing.T) {
	for _, p := range legacyPairs("العلم خير من المال") {
		a, b := p[0], p[1]
		if err := validateRequest(&a); err != nil {
			t.Fatalf("legacy %s: %v", a.Mode, err)
		}
		if err := validateRequest(&b); err != nil {
			t.Fatalf("new %s: %v", p[1].Mode, err)
		}
		if ka, kb := requestKey("r", &a), requestKey("r", &b); ka != kb {
			t.Errorf("%s: cache keys differ\n%s\n%s", a.Mode, ka, kb)
		}
	}
	a := Request{Query: "العلم خير", Mode: ModeText}
	b := Request{Query: "العلم خير", Mode: ModeText, ResultLayers: []string{"L4"}}
	_ = validateRequest(&a)
	_ = validateRequest(&b)
	if requestKey("r", &a) != requestKey("r", &b) {
		t.Error("result_layers must not change the cache key (view filter over one run)")
	}
}

func stripTiming(s string) string {
	if i := strings.Index(s, "(موتور FTS5"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// TestModesEquivalentResults اجرای واقعی (بدون کش) هر جفت قدیمی/تازه باید پاسخ یکسان بدهد.
func TestModesEquivalentResults(t *testing.T) {
	docs := append(append([]testDoc{}, engineCorpus...), flexCorpus()...)
	e, _ := newTestEngine(t, docs)
	e.cache = newResultCache(0)
	queries := []string{"العلم خير من المال", "رسول الله", "المسألة مهمة عند الفقهاء", "خانه علم", "کتاب ها", "قال", "امام صادق فرمود"}
	for _, q := range queries {
		for _, p := range legacyPairs(q) {
			a, b := p[0], p[1]
			ra, errA := e.Search(context.Background(), &a, "")
			rb, errB := e.Search(context.Background(), &b, "")
			if (errA == nil) != (errB == nil) {
				t.Fatalf("%q %s: errors differ: %v / %v", q, p[0].Mode, errA, errB)
			}
			if errA != nil {
				continue
			}
			ja, _ := json.Marshal(ra.Results)
			jb, _ := json.Marshal(rb.Results)
			if string(ja) != string(jb) {
				t.Errorf("%q %s: results differ\n%s\n%s", q, p[0].Mode, ja, jb)
			}
			if !reflect.DeepEqual(ra.LayerCounts, rb.LayerCounts) || ra.TotalResults != rb.TotalResults ||
				ra.VerifiedOccurrences != rb.VerifiedOccurrences || ra.CountRelation != rb.CountRelation ||
				ra.SimilarCoverage != rb.SimilarCoverage || ra.EffectiveMode != rb.EffectiveMode ||
				ra.EffectiveFlex != rb.EffectiveFlex || stripTiming(ra.Notice) != stripTiming(rb.Notice) {
				t.Errorf("%q %s: response metadata differs\n%+v\n%+v", q, p[0].Mode, ra, rb)
			}
		}
	}
}

func TestResultLayersView(t *testing.T) {
	e, _ := newTestEngine(t, flexCorpus())
	ctx := context.Background()
	full := search(t, e, Request{Query: "کتاب ها", Mode: ModeText, Layers: []string{"L1", "L2", "L3"}})
	if full.EffectiveMode != Tiered || full.EffectiveFlex != FlexSimilar {
		t.Fatalf("effective: %q %q", full.EffectiveMode, full.EffectiveFlex)
	}
	if len(full.LayerCounts) < 2 {
		t.Fatalf("need ≥2 layers for the view test, got %v", full.LayerCounts)
	}
	for layer, n := range full.LayerCounts {
		v := search(t, e, Request{Query: "کتاب ها", Mode: ModeText, Layers: []string{"L1", "L2", "L3"}, ResultLayers: []string{layer}, PageSize: 5})
		if v.TotalResults != n {
			t.Errorf("%s: total_results=%d want %d", layer, v.TotalResults, n)
		}
		if !reflect.DeepEqual(v.LayerCounts, full.LayerCounts) || v.VerifiedOccurrences != full.VerifiedOccurrences {
			t.Errorf("%s: counts must describe the whole run: %v / %d", layer, v.LayerCounts, v.VerifiedOccurrences)
		}
		got := 0
		for {
			for _, r := range v.Results {
				if r.Layer != layer {
					t.Errorf("%s view returned %s", layer, r.Layer)
				}
				got++
			}
			if !v.ContinuationAvailable {
				break
			}
			var err error
			v, err = e.Continue(ctx, v.SessionUID, v.NextCursor, "")
			if err != nil {
				t.Fatalf("Continue: %v", err)
			}
		}
		if got != n {
			t.Errorf("%s: paged %d want %d", layer, got, n)
		}
	}
}

func TestSimilarCoverageReporting(t *testing.T) {
	e, _ := newTestEngine(t, engineCorpus)
	two := search(t, e, Request{Query: "العلم خير", Mode: ModeText})
	if two.SimilarCoverage != "not_run" || !strings.Contains(two.Notice, "کمتر از ۳ واژه اجرا نمی‌شود") {
		t.Errorf("2 words: coverage=%q notice=%q", two.SimilarCoverage, two.Notice)
	}
	noL4 := search(t, e, Request{Query: "العلم خير", Mode: ModeText, Layers: []string{"L1", "L2", "L3"}})
	if strings.Contains(noL4.Notice, "اجرا نمی‌شود") {
		t.Errorf("L4 not requested → no skip note: %q", noL4.Notice)
	}
	exact := search(t, e, Request{Query: "العلم خير", Mode: ModeText, Flex: FlexExact})
	if exact.SimilarCoverage != "" || exact.EffectiveFlex != FlexExact {
		t.Errorf("exact: coverage=%q flex=%q", exact.SimilarCoverage, exact.EffectiveFlex)
	}
	words := search(t, e, Request{Query: "العلم المال", Mode: ModeWords})
	if words.EffectiveMode != AllWords || words.EffectiveFlex != "" || words.SimilarCoverage != "" {
		t.Errorf("words: %q %q %q", words.EffectiveMode, words.EffectiveFlex, words.SimilarCoverage)
	}
}

// TestThreeWordSimilarRuns L4 برای پرسش سه‌واژه‌ای واقعاً اجرا می‌شود (پیش‌تر نگهبان m<4 آن را
// بی‌صدا خالی برمی‌گرداند در حالی که پاسخ «partial» می‌گفت).
func TestThreeWordSimilarRuns(t *testing.T) {
	e, _ := newTestEngine(t, engineCorpus)
	resp := search(t, e, Request{Query: "مهمة جدا الفقهاء", Mode: ModeText})
	if resp.SimilarCoverage != "partial" {
		t.Errorf("coverage=%q", resp.SimilarCoverage)
	}
	if resp.LayerCounts["L4"] == 0 {
		t.Fatalf("3-word similar quote not found in L4: %v %q", resp.LayerCounts, resp.Notice)
	}
	if n := strings.Count(resp.Notice, "حداقل واقعی‌اند"); n != 1 {
		t.Errorf("want exactly one lower-bound note for a 3-word query, got %d: %q", n, resp.Notice)
	}
}
