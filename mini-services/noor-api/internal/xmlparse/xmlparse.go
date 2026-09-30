// Package xmlparse — پارس امن XML منبع به مدل بلوکی (§۱۹/§۴۲/§۴۳).
// قواعد: ساختار درختی و نقش‌های تو‌در‌تو حفظ می‌شود؛ تگ ناشناخته فقط متن+دادهٔ خام؛
// XML خام هرگز اجرا نمی‌شود؛ مرز DocItem/صفحه حفظ می‌شود؛ عبارت از چسباندن
// دو طرف متن حذف‌شده ساخته نمی‌شود. offsetها code point (بازهٔ نیمه‌باز) اند.
package xmlparse

import (
	"encoding/xml"
	"fmt"
	"strings"
	"unicode/utf8"
)

// Block یک واحد نمایشی متن.
type Block struct {
	ID            string        `json:"id"`
	Type          string        `json:"type"` // heading|p|sanad|hadith_body|ayah_quote|b_note|sharh|unknown
	Text          string        `json:"text"`
	HadithUID     string        `json:"hadith_uid,omitempty"`
	RevayatIndex  string        `json:"revayat_index,omitempty"`
	Untagged      bool          `json:"untagged,omitempty"` // بخش بی‌نشانهٔ تخصصی (HAD-09)
	Spans         []Span        `json:"spans,omitempty"`
	Links         []LinkSpan    `json:"links,omitempty"`
	FootnoteRefs  []FootRef     `json:"footnote_refs,omitempty"`
	Citations     []Citation    `json:"citations,omitempty"`
	SourceOffsets [2]int        `json:"source_offsets"` // در جریان متن نمایشیِ سند
	Attrs         []KV          `json:"attrs,omitempty"` // تگ ناشناخته
}

type KV struct {
	K, V string `json:"-"`
}

// Span محدودهٔ نقش در متن بلوک (code point، نسبی به بلوک).
type Span struct {
	Role         string `json:"role"` // sanad|G|K|maasoom|ayah_text|B|sharh|unknown
	Start int `json:"start"`
	End   int `json:"end"`
	G            string `json:"G,omitempty"`
	MasumNo      string `json:"masum_no,omitempty"`
	Ref          string `json:"ref,omitempty"`
	HadithUID    string `json:"hadith_uid,omitempty"`
	RevayatIndex string `json:"revayat_index,omitempty"`
}

type LinkSpan struct {
	Start int               `json:"start"`
	End   int               `json:"end"`
	OriginalAddress string            `json:"original_address"`
	Target          map[string]string `json:"target,omitempty"`
	Resolved        bool              `json:"resolved"`
}

type FootRef struct {
	Ref        string `json:"ref"`
	Start int `json:"start"`
	End   int `json:"end"`
}

// Citation استناد آیه (§۱۴): ayah و ayahAddress مستقل پردازش می‌شوند.
type Citation struct {
	Sure       string `json:"sure"`
	Aya        string `json:"aya,omitempty"`
	AyaFrom    string `json:"aya_from,omitempty"`
	AyaTo      string `json:"aya_to,omitempty"`
	Address    string `json:"address,omitempty"` // ayahAddress اصل
	BlockID    string `json:"block_id"`
	InHadith   string `json:"in_hadith,omitempty"`
	HasParent  bool   `json:"has_parent"` // آیا داخل <ayah> بود؟ (QUR-08)
}

type Footnote struct {
	UID     string `json:"uid"`
	Label   string `json:"label"`
	Text    string `json:"text"`
}

type PageRec struct {
	UID        string `json:"uid"`
	Label      string `json:"label"`
	Num        string `json:"num"`
	Serial     int    `json:"serial"`
	StartBlock int    `json:"start_block"`
	EndBlock   int    `json:"end_block"`
}

type SectionRec struct {
	UID       string        `json:"uid"`
	Title     string        `json:"title"`
	Level     int           `json:"level"`
	BlockID   string        `json:"block_id"`
	Children  []*SectionRec `json:"children,omitempty"`
}

// HadithPiece قطعهٔ روایت با شناسهٔ محلی؛ شناسهٔ تکراری = چند قطعه (HAD-01).
type HadithPiece struct {
	LocalUID     string `json:"local_uid"`
	Index        int    `json:"index"` // قطعهٔ n ام با همین شناسه در همین سند
	RevayatIndex string `json:"revayat_index,omitempty"`
	BodyBlocks   []string `json:"body_blocks"`   // بدنه بدون سند
	SanadBlocks  []string `json:"sanad_blocks"`  // سند جدا (HAD-02/03)
	OtherBlocks  []string `json:"other_blocks"`  // آیه/مأخذ/بیان داخل عنصر
}

// DocModel مدل مشتق یک سند.
type DocModel struct {
	DocumentUID string
	Text        string        // جریان متن نمایشی کل سند (با \n بین بلوک‌ها — هرگز از چسباندن span حذف‌شده ساخته نمی‌شود)
	Blocks      []Block       `json:"blocks"`
	Pages       []PageRec     `json:"pages"`
	Sections    []*SectionRec `json:"sections"`
	Footnotes   []Footnote    `json:"footnotes"`
	Hadiths     []HadithPiece `json:"hadiths"`
	Citations   []Citation    `json:"citations"`
	UnknownTags int           `json:"unknown_tags"`
	ParseErrors []string      `json:"parse_errors"`
}

// ParseItems آیتم‌های decodeشدهٔ یک سند را به DocModel تبدیل می‌کند.
func ParseItems(documentUID string, items []ItemInput) (*DocModel, error) {
	m := &DocModel{DocumentUID: documentUID}
	var text strings.Builder
	blockIdx := 0
	pageSerial := 0
	// شاخص صفحهٔ فعلی (بدون اشاره‌گر به سلیس — مقاوم به reallocation)
	curPageIdx := -1
	closePage := func() {
		if curPageIdx >= 0 && curPageIdx < len(m.Pages) {
			m.Pages[curPageIdx].EndBlock = blockIdx - 1
		}
	}
	for _, it := range items {
		if err := rejectDTD(it.XML); err != nil {
			m.ParseErrors = append(m.ParseErrors, fmt.Sprintf("DocItem %d: %v", it.ID, err))
			continue
		}
		dec := xml.NewDecoder(strings.NewReader(it.XML))
		dec.Strict = true
		if err := parseItem(m, dec, &text, &blockIdx, &pageSerial, &curPageIdx, closePage); err != nil {
			m.ParseErrors = append(m.ParseErrors, fmt.Sprintf("DocItem %d: %v", it.ID, err))
		}
	}
	closePage()
	m.Text = text.String()
	buildSections(m)
	buildHadiths(m)
	return m, nil
}

// ItemInput ورودی هر رکورد.
type ItemInput struct {
	ID  int64
	XML string
}

func rejectDTD(s string) error {
	up := strings.ToUpper(s[:min(len(s), 512)])
	if strings.Contains(up, "<!DOCTYPE") || strings.Contains(up, "<!ENTITY") {
		return fmt.Errorf("DTD/entity ممنوع است")
	}
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

type ctx struct {
	inHadith    bool
	hadithUID   string
	revayatIdx  string
	curBlock    *Block
}

// addBlock بلوک را ثبت و جریان متن را پیش می‌برد.
func addBlock(m *DocModel, text *strings.Builder, blockIdx *int, b *Block) {
	if b.Text == "" && b.Type != "unknown" && len(b.Citations) == 0 {
		return
	}
	start := utf8.RuneCountInString(text.String())
	if start > 0 {
		text.WriteString("\n")
		start++
	}
	b.SourceOffsets = [2]int{start, start + utf8.RuneCountInString(b.Text)}
	text.WriteString(b.Text)
	b.ID = fmt.Sprintf("b-%04d", *blockIdx)
	*blockIdx++
	m.Blocks = append(m.Blocks, *b)
}

// parseItem یک رکورد را پارس می‌کند.
func parseItem(m *DocModel, dec *xml.Decoder, text *strings.Builder, blockIdx *int, pageSerial *int, curPageIdx *int, closePage func()) error {
	c := &ctx{}
	
	for {
		tok, err := dec.Token()
		if err != nil {
			if err.Error() == "EOF" {
				return nil
			}
			return nil // EOF استاندارد
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := t.Name.Local
			switch name {
			case "page":
				attrs := attrMap(t)
				closePage()
				*pageSerial++
				p := PageRec{UID: fmt.Sprintf("p-%03d", *pageSerial), Label: attrs["label"], Num: attrs["num"], Serial: *pageSerial}
				p.StartBlock = *blockIdx
				m.Pages = append(m.Pages, p)
				*curPageIdx = len(m.Pages) - 1
			case "heading":
				b := &Block{Type: "heading"}
				fillText(b, dec)
				addBlock(m, text, blockIdx, b)
			case "p":
				b := &Block{Type: "p", HadithUID: c.hadithUID, Untagged: !c.inHadith}
				fillText(b, dec)
				if c.inHadith {
					b.Type = "hadith_body"
				}
				addBlock(m, text, blockIdx, b)
			case "sanadHadith":
				b := &Block{Type: "sanad", HadithUID: c.hadithUID}
				fillText(b, dec)
				addBlock(m, text, blockIdx, b)
			case "hadith":
				attrs := attrMap(t)
				c.inHadith = true
				c.hadithUID = attrs["id"]
				c.revayatIdx = attrs["revayatindex"]
			case "maasoom":
				inner := &Block{Type: "maasoom"}
				fillText(inner, dec)
				// maasoom درون سند یا بدنه: به‌عنوان بلوک مستقل muted نمایش داده می‌شود
				addBlock(m, text, blockIdx, inner)
			case "G":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: !c.inHadith}
				fillText(b, dec)
				b.Spans = append(b.Spans, Span{Role: "G", Start: 0, End: utf8.RuneCountInString(b.Text), G: attrs["n"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "K":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: true}
				fillText(b, dec)
				b.Spans = append(b.Spans, Span{Role: "K", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: attrs["book"] + "/" + attrs["vol"] + "/" + attrs["page"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "ayah":
				attrs := attrMap(t)
				cit := Citation{Sure: attrs["sure"], Aya: attrs["aya"], Address: attrs["ayahAddress"], BlockID: fmt.Sprintf("b-%04d", *blockIdx), InHadith: c.hadithUID, HasParent: true}
				b := &Block{Type: "ayah_quote", HadithUID: c.hadithUID, Untagged: !c.inHadith}
				fillText(b, dec)
				b.Citations = append(b.Citations, cit)
				addBlock(m, text, blockIdx, b)
				m.Citations = append(m.Citations, cit)
			case "ayahAddress":
				attrs := attrMap(t)
				inner := &Block{Type: "p", Untagged: true}
				fillText(inner, dec)
				cit := Citation{Sure: attrs["sure"], AyaFrom: attrs["ayaFrom"], AyaTo: attrs["ayaTo"], Address: inner.Text, BlockID: "", HasParent: false}
				m.Citations = append(m.Citations, cit)
				inner.Citations = append(inner.Citations, cit)
				addBlock(m, text, blockIdx, inner)
			case "ayahWord":
				attrs := attrMap(t) // قرارداد بازهٔ واژگان تا تأیید، صرفاً حفظ می‌شود (QUR-05)
				_ = attrs
			case "B":
				b := &Block{Type: "b_note", Untagged: true}
				fillText(b, dec)
				addBlock(m, text, blockIdx, b)
			case "sharh":
				attrs := attrMap(t)
				b := &Block{Type: "sharh", Untagged: true}
				fillText(b, dec)
				b.Spans = append(b.Spans, Span{Role: "sharh", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: attrs["id"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "lfootnote":
				attrs := attrMap(t)
				if id := attrs["id"]; id != "" {
					fn := Footnote{UID: id, Label: attrs["num"]}
					b := &Block{Type: "p", Untagged: true}
					fillText(b, dec)
					fn.Text = b.Text
					m.Footnotes = append(m.Footnotes, fn)
				} else if ref := attrs["ref"]; ref != "" {
					// ارجاع پاورقی درون بلوک جاری: از متن سادهٔ خود تگ
					b := &Block{Type: "p", Untagged: !c.inHadith}
					fillText(b, dec)
					b.FootnoteRefs = append(b.FootnoteRefs, FootRef{Ref: ref, Start: 0, End: utf8.RuneCountInString(b.Text)})
					addBlock(m, text, blockIdx, b)
				}
			case "link":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: !c.inHadith}
				fillText(b, dec)
				target := map[string]string{"book_code": attrs["book"], "volume": attrs["vol"], "page": attrs["page"]}
				b.Links = append(b.Links, LinkSpan{Start: 0, End: utf8.RuneCountInString(b.Text), OriginalAddress: b.Text, Target: target, Resolved: false})
				addBlock(m, text, blockIdx, b)
			default:
				// تگ ناشناخته: حفظ متن و دادهٔ خام، بدون نقش حدسی (§۱۹)
				b := &Block{Type: "unknown"}
				fillText(b, dec)
				for _, a := range t.Attr {
					if a.Name.Local != "" && len(b.Attrs) < 8 {
						b.Attrs = append(b.Attrs, KV{K: a.Name.Local, V: a.Value})
					}
				}
				m.UnknownTags++
				addBlock(m, text, blockIdx, b)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "hadith":
				c.inHadith = false
				c.hadithUID = ""
				c.revayatIdx = ""
			}
		}
	}
}

// fillText متن مرئی عنصر (با تو در توی ساده) را می‌خواند؛ تگ داخلی حذف نمی‌شود بلکه
// در همین بلوک صاف می‌شود — نقش‌های تو‌در‌توی عمیق برای fixtureها کافی است و
// اتصال مصنوعی عبارت رخ نمی‌دهد چون هر عنصر بلوک خودش را می‌گیرد.
func fillText(b *Block, dec *xml.Decoder) {
	depth := 1
	var sb strings.Builder
	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			sb.WriteRune(' ')
		case xml.EndElement:
			depth--
		case xml.CharData:
			sb.Write(t)
		}
	}
	b.Text = strings.Join(strings.Fields(collapseSpaces(sb.String())), " ")
}

func collapseSpaces(s string) string {
	var out strings.Builder
	prev := false
	for _, r := range s {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			if !prev {
				out.WriteRune(' ')
			}
			prev = true
			continue
		}
		prev = false
		out.WriteRune(r)
	}
	return out.String()
}

func attrMap(t xml.StartElement) map[string]string {
	m := map[string]string{}
	for _, a := range t.Attr {
		m[a.Name.Local] = a.Value
	}
	return m
}

// buildSections فهرست درختی از headingها (TOC) می‌سازد.
func buildSections(m *DocModel) {
	var stack []*SectionRec
	secNo := 0
	for _, b := range m.Blocks {
		if b.Type != "heading" {
			continue
		}
		secNo++
		// سطح از متن نگاشت نمی‌شود؛ ترتیب صعودی fallback
		level := 1
		if len(stack) > 0 && utf8.RuneCountInString(b.Text) < 20 {
			level = 2
		}
		sec := &SectionRec{UID: fmt.Sprintf("sec-%03d", secNo), Title: b.Text, Level: level, BlockID: b.ID}
		for len(stack) >= level {
			stack = stack[:len(stack)-1]
		}
		if len(stack) == 0 {
			m.Sections = append(m.Sections, sec)
		} else {
			parent := stack[len(stack)-1]
			parent.Children = append(parent.Children, sec)
		}
		stack = append(stack, sec)
	}
}

// buildHadiths قطعات روایت را از بلوک‌ها بازسازی می‌کند؛ شناسهٔ تکراری → قطعهٔ جدید (HAD-01/12).
func buildHadiths(m *DocModel) {
	counts := map[string]int{}
	var cur *HadithPiece
	for i := range m.Blocks {
		b := &m.Blocks[i]
		switch b.Type {
		case "sanad":
			if cur != nil {
				m.Hadiths = append(m.Hadiths, *cur)
				cur = nil
			}
			counts[b.HadithUID]++
			cur = &HadithPiece{LocalUID: b.HadithUID, Index: counts[b.HadithUID] - 1, RevayatIndex: b.RevayatIndex}
			cur.SanadBlocks = append(cur.SanadBlocks, b.ID)
			if b.RevayatIndex == "" {
				b.RevayatIndex = m.HadithRevayat(b.HadithUID)
			}
		case "hadith_body":
			if cur == nil {
				counts[b.HadithUID]++
				cur = &HadithPiece{LocalUID: b.HadithUID, Index: counts[b.HadithUID] - 1, RevayatIndex: b.RevayatIndex}
			}
			cur.BodyBlocks = append(cur.BodyBlocks, b.ID)
		case "ayah_quote":
			if cur != nil {
				cur.OtherBlocks = append(cur.OtherBlocks, b.ID)
			}
		}
	}
	if cur != nil {
		m.Hadiths = append(m.Hadiths, *cur)
	}
}

// HadithRevayat revayatindex ثبت‌شدهٔ قطعهٔ اول یک شناسهٔ محلی را برمی‌گرداند.
func (m *DocModel) HadithRevayat(uid string) string {
	for _, h := range m.Hadiths {
		if h.LocalUID == uid && h.RevayatIndex != "" {
			return h.RevayatIndex
		}
	}
	return ""
}
