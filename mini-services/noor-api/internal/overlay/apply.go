// Package overlay — apply.go: اعمال اصلاحات متن روی مدل سند.
// قرارداد فعلی: text_replace جایگزینی دقیق رشتهٔ old_value با new_value در
// متنِ بلوک‌ها انجام می‌شود؛ بعد از این نقطه، tokenize/آفست/نمایه از متنِ
// اصلاح‌شده ساخته می‌شود (worker) و خواننده هم متنِ اصلاح‌شده می‌بیند (handlePage).
// metadata فعلاً بی‌اثر است و شمرده نمی‌شود (تکمیل بعدی با تعریف قرارداد target).
package overlay

import (
	"strings"

	"noor/internal/xmlparse"
)

// Replacement یک اصلاح قابل اعمال (نرمال‌شده از Revision).
type Replacement struct {
	UID        string
	ChangeType string
	OldValue   string
	NewValue   string
}

// ApplyToBlocks جایگزینی را روی برشِ دلخواه بلوک‌ها (کپی) انجام می‌دهد و شمار
// بلوک‌های تغییریافته را برمی‌گرداند.
func ApplyToBlocks(blocks []xmlparse.Block, revs []Replacement) int {
	changed := 0
	for i := range blocks {
		if applyOne(&blocks[i], revs) {
			changed++
		}
	}
	return changed
}

// ApplyToModel اصلاحات را روی کل مدل (بدنهٔ نمایه‌سازی) اعمال می‌کند و شمار
// بلوک‌های تغییریافته را برمی‌گرداند.
func ApplyToModel(m *xmlparse.DocModel, revs []Replacement) int {
	changed := 0
	for i := range m.Blocks {
		if applyOne(&m.Blocks[i], revs) {
			changed++
		}
	}
	return changed
}

func applyOne(b *xmlparse.Block, revs []Replacement) bool {
	text := b.Text
	orig := text
	for _, r := range revs {
		if r.ChangeType != "text_replace" || r.OldValue == "" || r.NewValue == r.OldValue {
			continue
		}
		if !strings.Contains(text, r.OldValue) {
			continue
		}
		text = strings.ReplaceAll(text, r.OldValue, r.NewValue)
	}
	if text == orig {
		return false
	}
	b.Text = text
	return true
}

// ReplacementsOf فقط اصلاحات واقعاً قابل اعمال را برمی‌گرداند.
func ReplacementsOf(revs []Revision) []Replacement {
	out := make([]Replacement, 0, len(revs))
	for _, r := range revs {
		if r.ChangeType != "text_replace" || r.OldValue == "" || r.NewValue == "" {
			continue
		}
		out = append(out, Replacement{UID: r.UID, ChangeType: r.ChangeType, OldValue: r.OldValue, NewValue: r.NewValue})
	}
	return out
}
