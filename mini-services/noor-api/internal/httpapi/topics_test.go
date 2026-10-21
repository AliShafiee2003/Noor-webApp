package httpapi

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noor/internal/catalog"
)

// TestTopicsOccurrencesUnescape تضمین می‌کند که روت مواضع موضوعات حتی با کاراکترهای درصد-انکودشده
// فارسی یا علائم نگارشی، مواضع کاتالوگ را بدون خطا برمی‌گرداند (TOP-06).
func TestTopicsOccurrencesUnescape(t *testing.T) {
	sources := filepath.Join("..", "..", "data", "sources")
	if _, err := os.Stat(filepath.Join(sources, "catalog.json")); err != nil {
		t.Skip("catalog.json not found")
	}
	cat, err := catalog.Load(sources)
	if err != nil {
		t.Fatalf("catalog.Load: %v", err)
	}

	s, ts := ugcTestServer(t)
	s.Catalog = cat
	tok := ugcUser(t, s, "tester", "تستر")

	// 1. Get all topics
	resp := ugcDo(t, ts, "GET", "/api/v1/topics", tok, nil, nil)
	var topicsPayload struct {
		Items []struct {
			UID   string `json:"uid"`
			Title string `json:"title"`
			Count int    `json:"count"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&topicsPayload); err != nil {
		t.Fatalf("decode topics: %v", err)
	}

	zeroCountOcc := 0
	for _, item := range topicsPayload.Items {
		if !strings.Contains(item.Title, "علی بن ابی طالب") {
			continue
		}
		// Test escaped path as browser sends it
		escapedPath := "/api/v1/topics/" + url.PathEscape(item.UID) + "/occurrences"
		r := ugcDo(t, ts, "GET", escapedPath, tok, nil, nil)
		var occ struct {
			Items []map[string]any `json:"items"`
		}
		_ = json.NewDecoder(r.Body).Decode(&occ)
		if len(occ.Items) == 0 && item.Count > 0 {
			t.Errorf("FAIL for %s: count in list is %d but occurrences returned 0!", item.Title, item.Count)
			zeroCountOcc++
		}
	}
	t.Logf("Total failed topics in Go directly: %d", zeroCountOcc)
}
