// Package xmlparse — پارس امن XML منبع به مدل بلوکی (§۱۹/§۴۲/§۴۳).
// قواعد: ساختار درختی و نقش‌های تو‌در‌تو حفظ می‌شود؛ تگ ناشناخته فقط متن+دادهٔ خام؛
// XML خام هرگز اجرا نمی‌شود؛ مرز DocItem/صفحه حفظ می‌شود؛ عبارت از چسباندن
// دو طرف متن حذف‌شده ساخته نمی‌شود. offsetها code point (بازهٔ نیمه‌باز) اند.
package xmlparse

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// Block یک واحد نمایشی متن.
type Block struct {
	ID            string     `json:"id"`
	Type          string     `json:"type"` // heading|p|sanad|hadith_body|ayah_quote|b_note|sharh|unknown
	Text          string     `json:"text"`
	HadithUID     string     `json:"hadith_uid,omitempty"`
	RevayatIndex  string     `json:"revayat_index,omitempty"`
	Untagged      bool       `json:"untagged,omitempty"` // بخش بی‌نشانهٔ تخصصی (HAD-09)
	Spans         []Span     `json:"spans,omitempty"`
	Links         []LinkSpan `json:"links,omitempty"`
	FootnoteRefs  []FootRef  `json:"footnote_refs,omitempty"`
	Citations     []Citation `json:"citations,omitempty"`
	SourceOffsets [2]int     `json:"source_offsets"`  // در جریان متن نمایشیِ سند
	Attrs         []KV       `json:"attrs,omitempty"` // تگ ناشناخته
}

type KV struct {
	K, V string `json:"-"`
}

// Span محدودهٔ نقش در متن بلوک (code point، نسبی به بلوک).
type Span struct {
	Role         string `json:"role"` // sanad|G|K|maasoom|ayah_text|B|sharh|unknown
	Start        int    `json:"start"`
	End          int    `json:"end"`
	G            string `json:"G,omitempty"`
	MasumNo      string `json:"masum_no,omitempty"`
	Ref          string `json:"ref,omitempty"`
	HadithUID    string `json:"hadith_uid,omitempty"`
	RevayatIndex string `json:"revayat_index,omitempty"`
}

type LinkSpan struct {
	Start           int               `json:"start"`
	End             int               `json:"end"`
	OriginalAddress string            `json:"original_address"`
	Target          map[string]string `json:"target,omitempty"`
	Resolved        bool              `json:"resolved"`
}

type FootRef struct {
	Ref   string `json:"ref"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// Citation استناد آیه (§۱۴): ayah و ayahAddress مستقل پردازش می‌شوند.
type Citation struct {
	Sure      string `json:"sure"`
	Aya       string `json:"aya,omitempty"`
	AyaFrom   string `json:"aya_from,omitempty"`
	AyaTo     string `json:"aya_to,omitempty"`
	Address   string `json:"address,omitempty"` // ayahAddress اصل
	BlockID   string `json:"block_id"`
	InHadith  string `json:"in_hadith,omitempty"`
	HasParent bool   `json:"has_parent"` // آیا داخل <ayah> بود؟ (QUR-08)
}

type Footnote struct {
	UID   string `json:"uid"`
	Label string `json:"label"`
	Text  string `json:"text"`
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
	UID      string        `json:"uid"`
	Title    string        `json:"title"`
	Level    int           `json:"level"`
	BlockID  string        `json:"block_id"`
	Children []*SectionRec `json:"children,omitempty"`
}

// HadithPiece قطعهٔ روایت با شناسهٔ محلی؛ شناسهٔ تکراری = چند قطعه (HAD-01).
type HadithPiece struct {
	LocalUID     string   `json:"local_uid"`
	Index        int      `json:"index"` // قطعهٔ n ام با همین شناسه در همین سند
	RevayatIndex string   `json:"revayat_index,omitempty"`
	BodyBlocks   []string `json:"body_blocks"`  // بدنه بدون سند
	SanadBlocks  []string `json:"sanad_blocks"` // سند جدا (HAD-02/03)
	OtherBlocks  []string `json:"other_blocks"` // آیه/مأخذ/بیان داخل عنصر
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
	text := &textStream{}
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
		if err := parseItem(m, dec, text, &blockIdx, &pageSerial, &curPageIdx, closePage); err != nil {
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
	inHadith   bool
	hadithUID  string
	revayatIdx string
	curBlock   *Block
}

// textStream جریان متن نمایشی سند همراه با شمارِ rune جاری.
// شمارشِ مجدد کل متن انباشته برای هر بلوک حذف شده است (DB-02: O(n²) → O(n))؛
// برون‌داد نهایی (متن و SourceOffsets) بایت‌به‌بایت با رفتار پیشین یکسان است.
type textStream struct {
	sb    strings.Builder
	runes int
}

func (t *textStream) String() string { return t.sb.String() }

// Len طول جریان بر حسب code point (نه بایت).
func (t *textStream) Len() int { return t.runes }

// writeSeg قطعه‌ای را می‌نویسد و شمار rune را فقط به اندازهٔ همان قطعه پیش می‌برد.
func (t *textStream) writeSeg(s string) {
	t.sb.WriteString(s)
	t.runes += utf8.RuneCountInString(s)
}

// addBlock بلوک را ثبت و جریان متن را پیش می‌برد.
func addBlock(m *DocModel, text *textStream, blockIdx *int, b *Block) {
	if b.Text == "" && b.Type != "unknown" && len(b.Citations) == 0 {
		return
	}
	start := text.Len()
	if start > 0 {
		text.writeSeg("\n")
		start++
	}
	b.SourceOffsets = [2]int{start, start + utf8.RuneCountInString(b.Text)}
	text.writeSeg(b.Text)
	b.ID = fmt.Sprintf("b-%04d", *blockIdx)
	*blockIdx++
	m.Blocks = append(m.Blocks, *b)
}

// parseItem یک رکورد را پارس می‌کند.
func parseItem(m *DocModel, dec *xml.Decoder, text *textStream, blockIdx *int, pageSerial *int, curPageIdx *int, closePage func()) error {
	c := &ctx{}

	// fill متن بلوک را پر می‌کند؛ هر خطای decoder اینجا پایان سکوت نیست (DB-03):
	// بلوک جزئی ثبت می‌شود (سندِ ناقص قابل مشاهده می‌ماند) و خطا به caller برمی‌گردد.
	fill := func(b *Block) error {
		if err := fillText(b, dec); err != nil {
			addBlock(m, text, blockIdx, b)
			return err
		}
		return nil
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			// فقط io.EOF پایان موفق است؛ هر خطای دیگر decoder (syntax/ناقص/…) ثبت
			// و بازگردانده می‌شود — با بایت‌آفست در دسترس برای ردیابی (DB-03).
			return fmt.Errorf("%w (بایت‌آفست %d)", err, dec.InputOffset())
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
				if err := fill(b); err != nil {
					return err
				}
				addBlock(m, text, blockIdx, b)
			case "p":
				b := &Block{Type: "p", HadithUID: c.hadithUID, RevayatIndex: c.revayatIdx, Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				if c.inHadith {
					b.Type = "hadith_body"
				}
				addBlock(m, text, blockIdx, b)
			case "sanadHadith":
				b := &Block{Type: "sanad", HadithUID: c.hadithUID, RevayatIndex: c.revayatIdx}
				if err := fill(b); err != nil {
					return err
				}
				addBlock(m, text, blockIdx, b)
			case "hadith":
				attrs := attrMap(t)
				c.inHadith = true
				c.hadithUID = attrs["id"]
				c.revayatIdx = attrs["revayatindex"]
			case "maasoom":
				inner := &Block{Type: "maasoom"}
				if err := fill(inner); err != nil {
					return err
				}
				// maasoom درون سند یا بدنه: به‌عنوان بلوک مستقل muted نمایش داده می‌شود
				addBlock(m, text, blockIdx, inner)
			case "G":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				b.Spans = append(b.Spans, Span{Role: "G", Start: 0, End: utf8.RuneCountInString(b.Text), G: attrs["n"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "K":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				b.Spans = append(b.Spans, Span{Role: "K", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: attrs["book"] + "/" + attrs["vol"] + "/" + attrs["page"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "ayah":
				attrs := attrMap(t)
				cit := Citation{Sure: attrs["sure"], Aya: attrs["aya"], Address: attrs["ayahAddress"], BlockID: fmt.Sprintf("b-%04d", *blockIdx), InHadith: c.hadithUID, HasParent: true}
				b := &Block{Type: "ayah_quote", HadithUID: c.hadithUID, RevayatIndex: c.revayatIdx, Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				b.Citations = append(b.Citations, cit)
				addBlock(m, text, blockIdx, b)
				m.Citations = append(m.Citations, cit)
			case "ayahAddress":
				attrs := attrMap(t)
				inner := &Block{Type: "p", Untagged: true}
				if err := fill(inner); err != nil {
					return err
				}
				cit := Citation{Sure: attrs["sure"], AyaFrom: attrs["ayaFrom"], AyaTo: attrs["ayaTo"], Address: inner.Text, BlockID: "", HasParent: false}
				m.Citations = append(m.Citations, cit)
				inner.Citations = append(inner.Citations, cit)
				addBlock(m, text, blockIdx, inner)
			case "ayahWord":
				attrs := attrMap(t) // قرارداد بازهٔ واژگان تا تأیید، صرفاً حفظ می‌شود (QUR-05)
				_ = attrs
			case "B":
				b := &Block{Type: "b_note", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				addBlock(m, text, blockIdx, b)
			case "sharh":
				attrs := attrMap(t)
				b := &Block{Type: "sharh", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				b.Spans = append(b.Spans, Span{Role: "sharh", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: attrs["id"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "lfootnote":
				attrs := attrMap(t)
				if id := attrs["id"]; id != "" {
					fn := Footnote{UID: id, Label: attrs["num"]}
					b := &Block{Type: "p", Untagged: true}
					// پاورقی مستقل به جریان نمایش اضافه نمی‌شود (SEARCH-06)؛ خطا اما
					// اینجا هم بی‌صدا بلعیده نمی‌شود (DB-03) — متن جزئی ثبت و خطا برمی‌گردد.
					err := fillText(b, dec)
					fn.Text = b.Text
					m.Footnotes = append(m.Footnotes, fn)
					if err != nil {
						return err
					}
				} else if ref := attrs["ref"]; ref != "" {
					// ارجاع پاورقی درون بلوک جاری: از متن سادهٔ خود تگ
					b := &Block{Type: "p", Untagged: !c.inHadith}
					if err := fill(b); err != nil {
						return err
					}
					b.FootnoteRefs = append(b.FootnoteRefs, FootRef{Ref: ref, Start: 0, End: utf8.RuneCountInString(b.Text)})
					addBlock(m, text, blockIdx, b)
				}
			case "link":
				attrs := attrMap(t)
				b := &Block{Type: "p", Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				target := map[string]string{"book_code": attrs["book"], "volume": attrs["vol"], "page": attrs["page"]}
				b.Links = append(b.Links, LinkSpan{Start: 0, End: utf8.RuneCountInString(b.Text), OriginalAddress: b.Text, Target: target, Resolved: false})
				addBlock(m, text, blockIdx, b)
			default:
				// تگ ناشناخته: حفظ متن و دادهٔ خام، بدون نقش حدسی (§۱۹)
				b := &Block{Type: "unknown"}
				if err := fill(b); err != nil {
					return err
				}
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

// fillText متن مرئی عنصر را با حفظ نقش‌های تو‌در‌تو می‌خواند (§۱۹):
// عناصر معنایی درون پاراگراف به‌صورت inline-span با نگاشت code point ثبت می‌شوند —
// هرگز حذف یا صاف نمی‌شوند؛ اتصال مصنوعی عبارت از دو طرف عنصر حذف‌شده رخ نمی‌دهد
// چون متنِ عنصر باقی می‌ماند و فقط نقشش ثبت می‌شود.
// خطای بازگشتی fillText (DB-03): رسیدن به io.EOF در حالی که عنصر هنوز باز است
// یعنی XML ناقص/بریده — هرگز موفقیت تلقی نمی‌شود؛ سایر خطاهای decoder هم عیناً
// برمی‌گردند. caller بلوک جزئی را ثبت می‌کند تا سند ناقص قابل مشاهده بماند.
func fillText(b *Block, dec *xml.Decoder) error {
	var raw []rune
	depth := 1
	type marker struct {
		role string
		attr map[string]string
		at   int // جایگاه در raw
	}
	var open []marker
	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			// متن جزئی خوانده‌شده پیش از بازگرداندن خطا حفظ می‌شود تا سندِ ناقص
			// قابل مشاهده بماند (DB-03) — بلوک ناقص با متن جزئی ثبت می‌شود.
			b.Text = strings.Join(strings.Fields(collapseSpaces(string(raw))), " ")
			if errors.Is(err, io.EOF) {
				return fmt.Errorf("پایان نابه‌هنگام XML درون عنصر (تگ بسته‌نشده)")
			}
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := t.Name.Local
			switch name {
			case "G", "K", "maasoom", "sharh", "ayah", "link", "ayahAddress", "B":
				attrs := attrMap(t)
				open = append(open, marker{role: roleOf(name, attrs), attr: attrs, at: len(raw)})
			}
			depth++
		case xml.EndElement:
			depth--
			if depth == 0 {
				break
			}
			// بستن نزدیک‌ترین نشانهٔ بازِ همین عمق
			for i := len(open) - 1; i >= 0; i-- {
				if _, done := open[i].attr["__done"]; !done {
					addInlineSpan(b, &raw, open[i].role, open[i].attr, open[i].at, len(raw))
					open[i].attr["__done"] = "1"
					break
				}
			}
		case xml.CharData:
			raw = append(raw, []rune(string(t))...)
		}
	}
	b.Text = strings.Join(strings.Fields(collapseSpaces(string(raw))), " ")
	return nil
}

func roleOf(name string, attrs map[string]string) string {
	switch name {
	case "G":
		return "G"
	case "K":
		return "K"
	case "maasoom":
		return "maasoom"
	case "sharh":
		return "sharh"
	case "B":
		return "B"
	case "ayah", "ayahAddress":
		return "ayah_text"
	case "link":
		return "link"
	}
	return "unknown"
}

// addInlineSpan نقش تو در تو را روی بلوک ثبت می‌کند (بازهٔ تقریبی روی متن صاف‌شده).
func addInlineSpan(b *Block, raw *[]rune, role string, attrs map[string]string, from, to int) {
	// نگاشت raw → متن صاف‌شده: جایگاه تقریبی با تناسب طول
	total := len(*raw)
	if total == 0 {
		return
	}
	clean := strings.Join(strings.Fields(collapseSpaces(string(*raw))), " ")
	if len([]rune(clean)) == 0 {
		return
	}
	ratio := float64(len([]rune(clean))) / float64(total)
	s := int(float64(from) * ratio)
	e := int(float64(to) * ratio)
	if e <= s {
		e = s + 1
	}
	switch role {
	case "link":
		b.Links = append(b.Links, LinkSpan{Start: s, End: e, OriginalAddress: string((*raw)[from:to]), Target: attrs, Resolved: false})
	case "ayah_text":
		b.Citations = append(b.Citations, Citation{
			Sure: attrs["sure"], Aya: attrs["aya"], AyaFrom: attrs["ayaFrom"], AyaTo: attrs["ayaTo"],
			Address: attrs["ayahAddress"], BlockID: "", HasParent: name2parent(role),
			InHadith: b.HadithUID,
		})
	case "lfootnote_ref":
		// در fillText رخ نمی‌دهد؛ ارجاع پاورقی در case خودش است
	default:
		b.Spans = append(b.Spans, Span{Role: role, Start: s, End: e, G: attrs["n"], MasumNo: attrs["mno"], Ref: attrs["id"]})
	}
	_ = attrs["ref"]
}

func name2parent(role string) bool { return role == "ayah_text" }

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
