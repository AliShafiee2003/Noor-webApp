package search

import (
	"context"
	"encoding/json"
	"testing"
)

func TestSpacingPreservesOriginalOffsetsAndBoundaries(t *testing.T) {
	for _, tc := range []struct {
		query, text string
		want        bool
	}{
		{"میرویم", "ما می\u200cرویم امروز", true},
		{"می رویم", "ما میرویم امروز", true},
		{"میرویم", "ما می\u00a0رویم امروز", true},
		{"میرویم", "ما می،رویم امروز", false},
		{"میرویم", "ما می\nرویم امروز", false},
		{"میرویم", "ما نمیرویم امروز", false},
		{"رسولالله", "رَسُولُ اللَّهِ", true},
	} {
		stats := &verifyStats{}
		hits := spacingHits(&Request{Query: tc.query}, &candRow{TextOriginal: tc.text}, stats)
		if (len(hits) > 0) != tc.want {
			t.Errorf("%q in %q: %v", tc.query, tc.text, hits)
		}
		for _, h := range hits {
			got, _ := compactSpacing(string([]rune(tc.text)[h.Range[0]:h.Range[1]]))
			want, _ := compactSpacing(tc.query)
			if string(got) != string(want) {
				t.Fatalf("incorrect original offset: %v", h.Range)
			}
		}
	}
}

func TestFTS5IgnoreSpacingScopedCachedAndPersisted(t *testing.T) {
	engine, _ := newTestEngine(t, []testDoc{
		{"c", "w-01", "d-01", "fa", []string{`<p>ما می رویم و میرویم.</p>`}},
		{"c", "w-02", "d-02", "fa", []string{`<p>ما میرویم.</p>`}},
	})
	req := Request{Query: "میرویم", Mode: NormalizedPhrase, Scope: Scope{Target: "document", DocumentUIDs: []string{"d-01"}}, IgnoreSpacing: true}
	response := search(t, engine, req)
	if len(response.Results) != 2 {
		t.Fatalf("got %d results: %+v", len(response.Results), response)
	}
	for _, result := range response.Results {
		if result.Document.UID != "d-01" {
			t.Fatal("scope escaped")
		}
	}
	onKey := requestKey("test", &req)
	req.IgnoreSpacing = false
	if onKey == requestKey("test", &req) {
		t.Fatal("cache ignores option")
	}
	req.IgnoreSpacing = true
	data, _ := json.Marshal(&req)
	var restored Request
	if err := json.Unmarshal(data, &restored); err != nil || !restored.IgnoreSpacing {
		t.Fatal("session loses option")
	}
	restored.Scope.Target = "library"
	if _, err := engine.Search(context.Background(), &restored, ""); err == nil {
		t.Fatal("unbounded scope accepted")
	}
}
