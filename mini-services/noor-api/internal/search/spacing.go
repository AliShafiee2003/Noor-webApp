package search

import (
	"noor/internal/norm"
	"unicode"
)

// compactSpacing preserves punctuation and paragraph boundaries. Its map always
// points to original code points, including when NFC or Arabic presentation forms expand.
func compactSpacing(text string) ([]rune, []int) {
	original := []rune(text)
	var out []rune
	var offsets []int
	flush := func(lo, hi int) {
		normalized, mapping := norm.Normalize(string(original[lo:hi]))
		for i, ch := range []rune(normalized) {
			if ch == ' ' || ch == '\u00a0' || ch == '\u200c' {
				continue
			}
			out = append(out, ch)
			offsets = append(offsets, lo+mapping[i])
		}
	}
	start := 0
	for i, ch := range original {
		boundary := unicode.IsPunct(ch) || unicode.IsSymbol(ch) || (unicode.IsSpace(ch) && ch != ' ' && ch != '\u00a0')
		if !boundary {
			continue
		}
		flush(start, i)
		out = append(out, ch)
		offsets = append(offsets, i)
		start = i + 1
	}
	flush(start, len(original))
	return out, offsets
}

func spacingHits(req *Request, row *candRow, stats *verifyStats) []hit {
	query, _ := compactSpacing(req.Query)
	text, mapping := compactSpacing(row.TextOriginal)
	if len(query) == 0 {
		return nil
	}
	original := []rune(row.TextOriginal)
	var hits []hit
	for pos := 0; pos+len(query) <= len(text); {
		found := indexRunes(text[pos:], query)
		if found < 0 {
			break
		}
		at := pos + found
		lo, hi := mapping[at], mapping[at+len(query)-1]+1
		for hi < len(original) && unicode.IsMark(original[hi]) {
			hi++
		}
		if norm.WordBoundaryRunes(original, lo, hi) {
			hits = append(hits, hit{Range: [2]int{lo, hi}})
			if len(hits) >= 50 {
				stats.truncatedPassages++
				break
			}
		}
		pos = at + 1
	}
	return hits
}
