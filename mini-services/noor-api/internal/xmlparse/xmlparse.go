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
	"strconv"
	"strings"
	"unicode/utf8"
)

// Block یک واحد نمایشی متن.
type Block struct {
	ID            string     `json:"id"`
	Type          string     `json:"type"` // heading|p|sanad|hadith_body|ayah_quote|b_note|sharh|unknown
	Level         int        `json:"level,omitempty"`
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
	UID       string        `json:"uid"`
	Title     string        `json:"title"`
	Level     int           `json:"level"`
	BlockID   string        `json:"block_id"`
	PageLabel string        `json:"page_label,omitempty"`
	PageUID   string        `json:"page_uid,omitempty"`
	Children  []*SectionRec `json:"children,omitempty"`
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
	DocumentUID      string
	Text             string           // جریان متن نمایشی کل سند (با \n بین بلوک‌ها — هرگز از چسباندن span حذف‌شده ساخته نمی‌شود)
	Blocks           []Block          `json:"blocks"`
	Pages            []PageRec        `json:"pages"`
	Sections         []*SectionRec    `json:"sections"`
	Footnotes        []Footnote       `json:"footnotes"`
	PagesApproximate bool             `json:"pages_approximate"` // نگاشت صفحه حدسی/تقسیم یکنواخت است
	Hadiths          []HadithPiece    `json:"hadiths"`
	Citations        []Citation       `json:"citations"`
	UnknownTags      int              `json:"unknown_tags"`
	ParseErrors      []string         `json:"parse_errors"`
	DocItemBlocks    map[int64][2]int `json:"-"`
}

// ParseItems آیتم‌های decodeشدهٔ یک سند را به DocModel تبدیل می‌کند.
func ParseItems(documentUID string, items []ItemInput) (*DocModel, error) {
	m := &DocModel{DocumentUID: documentUID, DocItemBlocks: make(map[int64][2]int, len(items))}
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
		startBlockIdx := blockIdx
		dec := xml.NewDecoder(strings.NewReader(it.XML))
		dec.Strict = true
		if err := parseItem(m, dec, text, &blockIdx, &pageSerial, &curPageIdx, closePage); err != nil {
			m.ParseErrors = append(m.ParseErrors, fmt.Sprintf("DocItem %d: %v", it.ID, err))
		}
		endBlockIdx := blockIdx - 1
		if endBlockIdx >= startBlockIdx {
			m.DocItemBlocks[it.ID] = [2]int{startBlockIdx, endBlockIdx}
		} else {
			m.DocItemBlocks[it.ID] = [2]int{startBlockIdx, startBlockIdx}
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

// rejectDTD کل متن را می‌سنجد نه فقط ۵۱۲ بایت اول: DOCTYPE/ENTITY می‌تواند بعد
// از ریشهٔ سند درج شود و decoder آن را پردازش کند (بمب entity). اسکن تک‌گذر
// بدون تخصیص است.
func rejectDTD(s string) error {
	for i := 0; i+1 < len(s); i++ {
		if s[i] != '<' || s[i+1] != '!' {
			continue
		}
		j := i + 2
		for j < len(s) && (s[j] == ' ' || s[j] == '\t') {
			j++
		}
		word := ""
		for k := j; k < len(s) && k-j < 8; k++ {
			c := s[k]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c < 'a' || c > 'z' {
				break
			}
			word += string(c)
		}
		if word == "doctype" || word == "entity" {
			return fmt.Errorf("DTD/entity ممنوع است")
		}
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
	hadithDepth int
	hadithUID   string
	revayatIdx  string
	curBlock    *Block
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
	curDepth := 0

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
			curDepth++
			name := t.Name.Local
			attrs := attrMap(t)

			if name == "format" {
				if cls := attrs["class"]; cls != "" {
					name = cls
				}
			}
			if name == "br" || name == "gap" {
				continue
			}

			switch name {
			case "page":
				closePage()
				*pageSerial++
				lbl := attrs["label"]
				if lbl == "" {
					lbl = attrs["number"]
					if lbl == "" {
						lbl = attrs["num"]
					}
				}
				num := attrs["num"]
				if num == "" {
					num = attrs["number"]
				}
				p := PageRec{UID: fmt.Sprintf("p-%03d", *pageSerial), Label: lbl, Num: num, Serial: *pageSerial}
				p.StartBlock = *blockIdx
				m.Pages = append(m.Pages, p)
				*curPageIdx = len(m.Pages) - 1
			case "heading":
				lvl := 0
				if lStr := attrs["level"]; lStr != "" {
					lvl, _ = strconv.Atoi(lStr)
				}
				b := &Block{Type: "heading", Level: lvl}
				if err := fill(b); err != nil {
					return err
				}
				b.Text = CleanTitle(b.Text)
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
				c.inHadith = true
				c.hadithDepth = curDepth
				hUID := attrs["id"]
				if hUID == "" {
					hUID = attrs["Id"]
				}
				c.hadithUID = hUID
				rIdx := attrs["revayatindex"]
				if rIdx == "" {
					rIdx = attrs["RevayatIndex"]
					if rIdx == "" {
						rIdx = attrs["index"]
					}
				}
				c.revayatIdx = rIdx
			case "maasoom":
				inner := &Block{Type: "maasoom"}
				if err := fill(inner); err != nil {
					return err
				}
				// maasoom درون سند یا بدنه: به‌عنوان بلوک مستقل muted نمایش داده می‌شود
				addBlock(m, text, blockIdx, inner)
			case "G":
				b := &Block{Type: "p", Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				b.Spans = append(b.Spans, Span{Role: "G", Start: 0, End: utf8.RuneCountInString(b.Text), G: attrs["n"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "K":
				b := &Block{Type: "p", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				b.Spans = append(b.Spans, Span{Role: "K", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: attrs["book"] + "/" + attrs["vol"] + "/" + attrs["page"], HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "ayah":
				sure := attrs["sure"]
				if sure == "" {
					sure = attrs["surah"]
				}
				aya := attrs["aya"]
				if aya == "" {
					aya = attrs["ayah"]
				}
				cit := Citation{Sure: sure, Aya: aya, Address: attrs["ayahAddress"], BlockID: fmt.Sprintf("b-%04d", *blockIdx), InHadith: c.hadithUID, HasParent: true}
				b := &Block{Type: "ayah_quote", HadithUID: c.hadithUID, RevayatIndex: c.revayatIdx, Untagged: !c.inHadith}
				if err := fill(b); err != nil {
					return err
				}
				b.Citations = append(b.Citations, cit)
				addBlock(m, text, blockIdx, b)
				m.Citations = append(m.Citations, cit)
			case "ayahAddress":
				sure := attrs["sure"]
				if sure == "" {
					sure = attrs["surah"]
				}
				inner := &Block{Type: "p", Untagged: true}
				if err := fill(inner); err != nil {
					return err
				}
				cit := Citation{Sure: sure, AyaFrom: attrs["ayaFrom"], AyaTo: attrs["ayaTo"], Address: inner.Text, BlockID: "", HasParent: false}
				m.Citations = append(m.Citations, cit)
				inner.Citations = append(inner.Citations, cit)
				addBlock(m, text, blockIdx, inner)
			case "ayahWord", "AyahSeprator":
				_ = attrs // قرارداد بازهٔ واژگان تا تأیید، صرفاً حفظ می‌شود (QUR-05)
			case "B":
				b := &Block{Type: "b_note", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				addBlock(m, text, blockIdx, b)
			case "sharh":
				b := &Block{Type: "sharh", Untagged: true}
				if err := fill(b); err != nil {
					return err
				}
				sID := attrs["id"]
				if sID == "" {
					sID = attrs["Id"]
				}
				b.Spans = append(b.Spans, Span{Role: "sharh", Start: 0, End: utf8.RuneCountInString(b.Text), Ref: sID, HadithUID: c.hadithUID})
				addBlock(m, text, blockIdx, b)
			case "lfootnote":
				ref := attrs["ref"]
				if ref == "" {
					ref = attrs["noteId"]
				}
				id := attrs["id"]
				if id != "" {
					fn := Footnote{UID: id, Label: attrs["num"]}
					b := &Block{Type: "p", Untagged: true}
					err := fillText(b, dec)
					fn.Text = b.Text
					m.Footnotes = append(m.Footnotes, fn)
					if err != nil {
						return err
					}
				} else if ref != "" {
					// ارجاع پاورقی درون بلوک جاری: از متن سادهٔ خود تگ
					b := &Block{Type: "p", Untagged: !c.inHadith}
					if err := fill(b); err != nil {
						return err
					}
					b.FootnoteRefs = append(b.FootnoteRefs, FootRef{Ref: ref, Start: 0, End: utf8.RuneCountInString(b.Text)})
					addBlock(m, text, blockIdx, b)
				}
			case "link":
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
			if c.inHadith && curDepth == c.hadithDepth {
				c.inHadith = false
				c.hadithDepth = 0
				c.hadithUID = ""
				c.revayatIdx = ""
			}
			curDepth--
		}
	}
}

// cleanTextWithMap فشرده‌سازی فاصله‌ها را با حفظ نگاشت دقیق 1-به-1 اندیس‌های raw به clean انجام می‌دهد (§۱۹).
func cleanTextWithMap(raw []rune) (string, []int) {
	n := len(raw)
	if n == 0 {
		return "", []int{0}
	}
	mapRawToClean := make([]int, n+1)
	var out []rune
	inSpace := true // حذف فاصله‌های ابتدایی
	for i, r := range raw {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			if !inSpace {
				out = append(out, ' ')
				inSpace = true
			}
		} else {
			out = append(out, r)
			inSpace = false
		}
		if len(out) == 0 {
			mapRawToClean[i] = 0
		} else if inSpace {
			mapRawToClean[i] = len(out)
		} else {
			mapRawToClean[i] = len(out) - 1
		}
	}
	// حذف فاصلهٔ انتهایی در صورت وجود
	for len(out) > 0 && out[len(out)-1] == ' ' {
		out = out[:len(out)-1]
	}
	for i := range mapRawToClean {
		if mapRawToClean[i] > len(out) {
			mapRawToClean[i] = len(out)
		}
	}
	mapRawToClean[n] = len(out)
	return string(out), mapRawToClean
}

// fillText متن مرئی عنصر را با حفظ نقش‌های تو‌در‌تو و نگاشت دقیق مختصات می‌خواند (§۱۹):
func fillText(b *Block, dec *xml.Decoder) error {
	var raw []rune
	depth := 1
	type marker struct {
		role string
		attr map[string]string
		from int
		to   int
	}
	var open []*marker
	var closed []*marker

	for depth > 0 {
		tok, err := dec.Token()
		if err != nil {
			clean, _ := cleanTextWithMap(raw)
			b.Text = clean
			if errors.Is(err, io.EOF) {
				return fmt.Errorf("پایان نابه‌هنگام XML درون عنصر (تگ بسته‌نشده)")
			}
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := t.Name.Local
			attrs := attrMap(t)
			if name == "format" {
				if cls := attrs["class"]; cls != "" {
					name = cls
				}
			}
			if name == "br" || name == "gap" {
				raw = append(raw, ' ')
				continue
			}
			switch name {
			case "hadith":
				b.HadithUID = attrs["id"]
				if b.HadithUID == "" {
					b.HadithUID = attrs["Id"]
				}
				b.RevayatIndex = attrs["revayatindex"]
				if b.RevayatIndex == "" {
					b.RevayatIndex = attrs["RevayatIndex"]
				}
				if b.RevayatIndex == "" {
					b.RevayatIndex = attrs["index"]
				}
				open = append(open, &marker{role: "hadith", attr: attrs, from: len(raw)})
			case "sanadHadith":
				open = append(open, &marker{role: "sanad", attr: attrs, from: len(raw)})
			case "G", "K", "maasoom", "sharh", "ayah", "link", "ayahAddress", "B":
				open = append(open, &marker{role: roleOf(name, attrs), attr: attrs, from: len(raw)})
			case "lfootnote":
				open = append(open, &marker{role: "lfootnote_ref", attr: attrs, from: len(raw)})
			case "heading":
				if b.Type == "p" {
					b.Type = "heading"
				}
			}
			depth++
		case xml.EndElement:
			depth--
			if depth == 0 {
				break
			}
			for i := len(open) - 1; i >= 0; i-- {
				if open[i].to == 0 {
					open[i].to = len(raw)
					closed = append(closed, open[i])
					open = append(open[:i], open[i+1:]...)
					break
				}
			}
		case xml.CharData:
			raw = append(raw, []rune(string(t))...)
		}
	}

	clean, mapRawToClean := cleanTextWithMap(raw)
	b.Text = clean
	if b.Type == "heading" {
		b.Text = CleanTitle(b.Text)
	}

	runesLen := utf8.RuneCountInString(b.Text)
	for _, m := range closed {
		s := mapRawToClean[m.from]
		e := mapRawToClean[m.to]
		if e <= s && m.to > m.from && s < runesLen {
			e = s + 1
		}
		var orig string
		if m.from < len(raw) && m.to <= len(raw) && m.to >= m.from {
			orig = string(raw[m.from:m.to])
		}
		addInlineSpanExact(b, m.role, m.attr, s, e, orig)
	}
	return nil
}

func roleOf(name string, attrs map[string]string) string {
	switch name {
	case "hadith":
		return "hadith"
	case "sanadHadith":
		return "sanad"
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

// addInlineSpanExact نقش تو در تو را با مختصات دقیق روی بلوک ثبت می‌کند.
func addInlineSpanExact(b *Block, role string, attrs map[string]string, s, e int, orig string) {
	runesLen := utf8.RuneCountInString(b.Text)
	if s > runesLen {
		s = runesLen
	}
	if e > runesLen {
		e = runesLen
	}
	if e < s {
		e = s
	}

	switch role {
	case "link":
		b.Links = append(b.Links, LinkSpan{Start: s, End: e, OriginalAddress: orig, Target: attrs, Resolved: false})
	case "ayah_text":
		b.Citations = append(b.Citations, Citation{
			Sure: attrs["sure"], Aya: attrs["aya"], AyaFrom: attrs["ayaFrom"], AyaTo: attrs["ayaTo"],
			Address: attrs["ayahAddress"], BlockID: "", HasParent: name2parent(role),
			InHadith: b.HadithUID,
		})
	case "lfootnote_ref":
		ref := attrs["noteId"]
		if ref == "" {
			ref = attrs["ref"]
		}
		if ref == "" {
			ref = attrs["id"]
		}
		if ref != "" {
			b.FootnoteRefs = append(b.FootnoteRefs, FootRef{Ref: ref, Start: s, End: e})
		}
	default:
		b.Spans = append(b.Spans, Span{Role: role, Start: s, End: e, G: attrs["n"], MasumNo: attrs["mno"], Ref: attrs["id"]})
	}
}

// CleanTitle پیراستن نمادهای اضافی < > یا &lt; &gt; و نرمال‌سازی نویسه‌های عربی/فارسی (ک/ی/هٔ)
func CleanTitle(s string) string {
	s = strings.TrimSpace(s)
	for {
		changed := false
		if strings.HasPrefix(s, "&lt;") && strings.HasSuffix(s, "&gt;") {
			s = strings.TrimPrefix(s, "&lt;")
			s = strings.TrimSuffix(s, "&gt;")
			s = strings.TrimSpace(s)
			changed = true
		}
		if strings.HasPrefix(s, "<") && strings.HasSuffix(s, ">") {
			s = strings.TrimPrefix(s, "<")
			s = strings.TrimSuffix(s, ">")
			s = strings.TrimSpace(s)
			changed = true
		}
		if !changed {
			break
		}
	}
	s = strings.Trim(s, "<> \t\r\n\u200C\u200D\u0640\uFEFF\u200B")

	var b strings.Builder
	runes := []rune(s)
	n := len(runes)
	for i := 0; i < n; i++ {
		r := runes[i]
		switch r {
		case '\u200D', '\u200B', '\uFEFF', '\u0640':
			// حذف ZWJ، کشیده (Tatweel)، و نویسه‌های نامرئی هرز در عناوین
			continue
		case '\u0643': // ك
			b.WriteRune('\u06A9') // ک
		case '\u0649', '\u064A': // ى, ي
			b.WriteRune('\u06CC') // ی
		case '\u06C0': // ۀ
			b.WriteString("\u0647\u0654") // هٔ
		default:
			// ه + ZWNJ + ا + [ى/ي/ی] -> ه‌ای
			if r == '\u0647' && i+3 < n && runes[i+1] == '\u200C' && runes[i+2] == '\u0627' &&
				(runes[i+3] == '\u0649' || runes[i+3] == '\u064A' || runes[i+3] == '\u06CC') {
				b.WriteString("ه‌ای")
				i += 3
				continue
			}
			b.WriteRune(r)
		}
	}
	res := strings.TrimSpace(b.String())
	res = strings.Trim(res, "<> \t\r\n\u200C\u200D\u0640\uFEFF\u200B")
	return res
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
		sec := &SectionRec{UID: fmt.Sprintf("sec-%03d", secNo), Title: CleanTitle(b.Text), Level: level, BlockID: b.ID}
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
