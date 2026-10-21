// Package noordb — خوانندهٔ فرمت SQLite نور (شناخته‌شده از PRD §۳/§۴۳):
// پشتیبانی کامل از دیتابیس‌های واقعی SQLite نور (ExtraData, DocItem BLOB LZW)
// و همچنین مجموعه داده‌های fixture. متن با دیکشنری بازگشایی می‌شود (طول دیکشنری ثابت فرض نمی‌شود — DATA-03).
package noordb

import (
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"

	"log"

	_ "modernc.org/sqlite"
)

// NoorAESKey کلید استاندارد رمزگشایی دیکشنری پایه‌ای نور است.
var NoorAESKey = []byte{0x2a, 0x39, 0x4c, 0x22, 0x2b, 0x76, 0x35, 0x2e, 0x29, 0x3d, 0x29, 0x23, 0x38, 0x4e, 0x63, 0x26}

// DocItem رکورد متن یک سند است.
type DocItem struct {
	Id      int64
	ItemNo  int64
	Story   int64
	Section int64
	XML     string
	Length  int64
}

// BookInfo فرادادهٔ سند.
type BookInfo struct {
	Id        int64
	Title     sql.NullString
	Author    sql.NullString
	Version   sql.NullString
	VolumeId  sql.NullString
	Publisher sql.NullString
	Year      sql.NullString
}

// TOCNode ساختار خام رکوردهای فهرست درختی در TableOfContent است.
type TOCNode struct {
	ID       int64
	DocItem  sql.NullInt64
	Title    string
	ParentID sql.NullInt64
	Level    int
}

// PageNode ساختار خام رکوردهای جدول Page است.
type PageNode struct {
	ID       int64
	SerialNo int
	Number   string
}

// Open یک DB منبع را فقط‌خواندنی باز می‌کند (mode=ro — بدون WAL روی منبع).
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?mode=ro&immutable=0&_pragma=busy_timeout(3000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open source db: %w", err)
	}
	db.SetMaxOpenConns(1) // §۳۸: شروع با یک اتصال برای هر فایل
	return db, nil
}

// DetectSchema پروفایل شِما را کشف می‌کند؛ ناسازگارها quarantine منطقی می‌شوند (§۴۳-۲).
func DetectSchema(db *sql.DB) (profile string, err error) {
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type='table'`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	has := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return "", err
		}
		has[strings.ToLower(n)] = true
	}
	switch {
	case has["docitem"] && (has["extradata"] || has["bookinfo"]):
		return "noor-v1", nil
	default:
		return "unknown", nil
	}
}

// DecryptDictionary دیکشنری رمزگذاری‌شدهٔ AES-128-CBC را بازگشایی می‌کند.
func DecryptDictionary(encrypted []byte) ([]string, error) {
	if len(encrypted) == 0 || len(encrypted)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("ciphertext is not a multiple of the block size")
	}
	block, err := aes.NewCipher(NoorAESKey)
	if err != nil {
		return nil, err
	}
	mode := cipher.NewCBCDecrypter(block, NoorAESKey)
	decrypted := make([]byte, len(encrypted))
	mode.CryptBlocks(decrypted, encrypted)

	padLen := int(decrypted[len(decrypted)-1])
	if padLen < 1 || padLen > aes.BlockSize {
		return nil, fmt.Errorf("invalid padding length: %d", padLen)
	}
	raw := string(decrypted[:len(decrypted)-padLen])
	runes := []rune(raw)
	dict := make([]string, len(runes))
	for i, r := range runes {
		dict[i] = string(r)
	}
	return dict, nil
}

// LoadDictionary دیکشنری همان فایل را می‌خواند.
func LoadDictionary(db *sql.DB) ([]string, error) {
	// ۱. ابتدا بررسی دیکشنری در دیتابیس‌های رسمی نور (ExtraData WHERE Key='dictionary')
	var dictBlob []byte
	err := db.QueryRow(`SELECT Value FROM ExtraData WHERE Key='dictionary'`).Scan(&dictBlob)
	if err == nil && len(dictBlob) > 0 {
		return DecryptDictionary(dictBlob)
	}

	// ۲. فرمت fixture: جدول Letters با یک ستون متن، به ترتیب index
	rows, err := db.Query(`SELECT Txt FROM Letters ORDER BY Id`)
	if err != nil {
		return nil, fmt.Errorf("dictionary: %w", err)
	}
	defer rows.Close()
	var dict []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		dict = append(dict, t)
	}
	if len(dict) == 0 {
		return nil, fmt.Errorf("dictionary empty")
	}
	return dict, nil
}

// maxDecodedBytes سقف خروجی بازگشایی هر DocItem — بمب فشرده‌سازی (blob کوچک با
// خروجی چندصد مگابایتی) را رد می‌کند.
const maxDecodedBytes = 8 << 20

// DecodeLZW استریم فشرده‌شده با LZW دیتابیس‌های نور را بازگشایی می‌کند.
func DecodeLZW(blob []byte, dict []string) (string, error) {
	if len(blob) == 0 {
		return "", nil
	}
	codes := []rune(string(blob))
	if len(codes) == 0 {
		return "", nil
	}

	dictionary := make([]string, len(dict), len(dict)+len(codes))
	copy(dictionary, dict)

	prevCode := int(codes[0])
	if prevCode >= len(dictionary) {
		return "", fmt.Errorf("initial code %d out of dictionary bounds (%d)", prevCode, len(dictionary))
	}

	var out strings.Builder
	out.WriteString(dictionary[prevCode])

	for _, c := range codes[1:] {
		code := int(c)
		var entry string
		if code < len(dictionary) {
			entry = dictionary[code]
		} else if code == len(dictionary) {
			prevEntry := dictionary[prevCode]
			firstRune, _ := utf8.DecodeRuneInString(prevEntry)
			entry = prevEntry + string(firstRune)
		} else {
			return "", fmt.Errorf("bad LZW code: %d at dict size %d", code, len(dictionary))
		}

		out.WriteString(entry)
		if out.Len() > maxDecodedBytes {
			return "", fmt.Errorf("decoded output too large (>%d bytes)", maxDecodedBytes)
		}
		firstRune, _ := utf8.DecodeRuneInString(entry)
		dictionary = append(dictionary, dictionary[prevCode]+string(firstRune))
		prevCode = code
	}

	return out.String(), nil
}

// Decode رشتهٔ کدگذاری‌شده را با دیکشنری باز می‌کند (برای fixture).
// قرارداد fixture: هر توکن <d> یا ارجاع «|n|» به index دیکشنری است.
func Decode(encoded string, dict []string) (string, error) {
	if !strings.Contains(encoded, "|") {
		return encoded, nil // متن ذخیره‌نشده (رمزنشده)
	}
	var b strings.Builder
	for _, part := range strings.Split(encoded, "|") {
		if part == "" {
			continue
		}
		idx := 0
		isRef := true
		for _, c := range part {
			if c < '0' || c > '9' {
				isRef = false
				break
			}
			idx = idx*10 + int(c-'0')
		}
		if isRef {
			if idx >= len(dict) {
				return "", fmt.Errorf("dictionary index %d out of range (len=%d)", idx, len(dict))
			}
			b.WriteString(dict[idx])
		} else {
			b.WriteString(part)
		}
	}
	return b.String(), nil
}

// ReadBookInfo فرادادهٔ سند.
func ReadBookInfo(db *sql.DB) (*BookInfo, error) {
	cols, err := tableColumns(db, "BookInfo")
	if err != nil {
		return nil, err
	}
	has := func(c string) bool {
		for _, x := range cols {
			if strings.EqualFold(x, c) {
				return true
			}
		}
		return false
	}
	bi := &BookInfo{}
	row := db.QueryRow(`SELECT Id FROM BookInfo LIMIT 1`)
	if err := row.Scan(&bi.Id); err != nil {
		return nil, err
	}
	if has("Title") {
		_ = db.QueryRow(`SELECT Title FROM BookInfo LIMIT 1`).Scan(&bi.Title)
	}
	if has("Auther") {
		_ = db.QueryRow(`SELECT Auther FROM BookInfo LIMIT 1`).Scan(&bi.Author)
	} else if has("Author") {
		_ = db.QueryRow(`SELECT Author FROM BookInfo LIMIT 1`).Scan(&bi.Author)
	}
	if has("Version") {
		_ = db.QueryRow(`SELECT Version FROM BookInfo LIMIT 1`).Scan(&bi.Version)
	}
	if has("VolumeInPapers") {
		_ = db.QueryRow(`SELECT VolumeInPapers FROM BookInfo LIMIT 1`).Scan(&bi.VolumeId)
	}
	if has("Publisher") {
		_ = db.QueryRow(`SELECT Publisher FROM BookInfo LIMIT 1`).Scan(&bi.Publisher)
	}
	return bi, nil
}

// ReadDocItems همهٔ DocItemها را به ترتیب Story و ItemNo می‌خواند (DATA-04: ترتیب واقعی، نه Id).
func ReadDocItems(db *sql.DB, dict []string) ([]DocItem, error) {
	cols, err := tableColumns(db, "DocItem")
	if err != nil {
		return nil, err
	}
	hasContext := false
	for _, c := range cols {
		if strings.EqualFold(c, "Context") {
			hasContext = true
			break
		}
	}

	var out []DocItem
	var decodeErrs []string

	if hasContext {
		// دیتابیس رسمی نور: ستون Context نوع BLOB بوده و فشرده با LZW است.
		// StoryId = 1 متن اصلی (MainText) است.
		rows, err := db.Query(`SELECT Id, ItemNo, StoryId, SectionId, Context, Length FROM DocItem WHERE StoryId = 1 ORDER BY StoryId, ItemNo, Id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var it DocItem
			var blob []byte
			if err := rows.Scan(&it.Id, &it.ItemNo, &it.Story, &it.Section, &blob, &it.Length); err != nil {
				return nil, err
			}
			if len(blob) > 0 {
				decoded, err := DecodeLZW(blob, dict)
				if err != nil {
					decodeErrs = append(decodeErrs, fmt.Sprintf("DocItem %d: %v", it.Id, err))
					continue
				}
				it.XML = decoded
			}
			if msg := checkLength(it); msg != "" {
				decodeErrs = append(decodeErrs, fmt.Sprintf("DocItem %d: %s", it.Id, msg))
			}
			out = append(out, it)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	} else {
		// فرمت fixture: جدول ستون XmlText با ارجاع دیکشنری |n|
		rows, err := db.Query(`SELECT Id, ItemNo, Story, Section, XmlText, Length FROM DocItem ORDER BY Story, ItemNo, Id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var it DocItem
			var xmlText string
			if err := rows.Scan(&it.Id, &it.ItemNo, &it.Story, &it.Section, &xmlText, &it.Length); err != nil {
				return nil, err
			}
			decoded, err := Decode(xmlText, dict)
			if err != nil {
				decodeErrs = append(decodeErrs, fmt.Sprintf("DocItem %d: %v", it.Id, err))
				continue
			}
			it.XML = decoded
			if msg := checkLength(it); msg != "" {
				decodeErrs = append(decodeErrs, fmt.Sprintf("DocItem %d: %s", it.Id, msg))
			}
			out = append(out, it)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	if len(decodeErrs) > 0 {
		return out, &DecodeErrors{Items: decodeErrs}
	}
	return out, nil
}

// ReadTableOfContent فهرست درختی را از جدول TableOfContent در صورت وجود می‌خواند.
func ReadTableOfContent(db *sql.DB) ([]TOCNode, error) {
	rows, err := db.Query(`SELECT Id, DocItemId, Title, ParentId, LevelNo FROM TableOfContent ORDER BY Id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var nodes []TOCNode
	for rows.Next() {
		var n TOCNode
		if err := rows.Scan(&n.ID, &n.DocItem, &n.Title, &n.ParentID, &n.Level); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

// ReadPages صفحات را از جدول Page در صورت وجود می‌خواند.
func ReadPages(db *sql.DB) ([]PageNode, error) {
	rows, err := db.Query(`SELECT Id, SerialNo, Number FROM Page ORDER BY SerialNo`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pages []PageNode
	for rows.Next() {
		var p PageNode
		if err := rows.Scan(&p.ID, &p.SerialNo, &p.Number); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

// FootnoteRecord رکوردهای جدول DocItem مربوط به StoryId = 2 (پاورقی).
type FootnoteRecord struct {
	ID     int64
	ItemNo int64
	Label  string
	Text   string
}

// PageBreakDetail نگاشت صفحه به رکورد متن.
type PageBreakDetail struct {
	PageID      int64
	SerialNo    int
	Number      string
	DocItemID   int64
	StartOffset int64
}

// ReadPageBreakDetails جزئیات شکست صفحه را با شمارهٔ چاپ و ترتیب صفحه می‌خواند.
func ReadPageBreakDetails(db *sql.DB) ([]PageBreakDetail, error) {
	rows, err := db.Query(`
		SELECT pb.PageId, p.SerialNo, p.Number, pb.DocItemId, pb.StartOffset
		FROM PageBreak pb
		JOIN Page p ON pb.PageId = p.Id
		JOIN DocItem di ON pb.DocItemId = di.Id
		WHERE di.StoryId = 1
		ORDER BY p.SerialNo ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PageBreakDetail
	failed := 0
	for rows.Next() {
		var d PageBreakDetail
		if err := rows.Scan(&d.PageID, &d.SerialNo, &d.Number, &d.DocItemID, &d.StartOffset); err == nil {
			out = append(out, d)
		} else {
			failed++
		}
	}
	if failed > 0 {
		log.Printf("noordb: pagebreak rows skipped: %d", failed)
	}
	return out, nil
}

// ParseFootnoteXML ساختار XML پانویس نور را تفکیک می‌کند.
func ParseFootnoteXML(rawXML string) (label string, text string) {
	raw := rawXML
	if idx := strings.Index(raw, "<mnote>"); idx != -1 {
		endIdx := strings.Index(raw, "</mnote>")
		if endIdx != -1 {
			label = strings.TrimSpace(raw[idx+len("<mnote>") : endIdx])
			label = strings.Trim(label, "() ")
			raw = raw[:idx] + raw[endIdx+len("</mnote>"):]
		}
	}
	var sb strings.Builder
	inTag := false
	for _, r := range raw {
		if r == '<' {
			inTag = true
		} else if r == '>' {
			inTag = false
		} else if !inTag {
			sb.WriteRune(r)
		}
	}
	text = strings.TrimSpace(sb.String())
	text = strings.TrimPrefix(text, "-")
	text = strings.TrimPrefix(text, "ـ")
	text = strings.TrimSpace(text)
	return label, text
}

// ReadFootnotes پانویس‌های پایگاه داده‌های رسمی نور را می‌خواند (StoryId = 2).
func ReadFootnotes(db *sql.DB, dict []string) ([]FootnoteRecord, error) {
	cols, err := tableColumns(db, "DocItem")
	if err != nil {
		return nil, err
	}
	hasContext := false
	for _, c := range cols {
		if strings.EqualFold(c, "Context") {
			hasContext = true
			break
		}
	}
	if !hasContext {
		return nil, nil
	}
	rows, err := db.Query(`SELECT Id, ItemNo, Context FROM DocItem WHERE StoryId = 2 ORDER BY ItemNo, Id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FootnoteRecord
	failed := 0
	for rows.Next() {
		var id, itemNo int64
		var blob []byte
		if err := rows.Scan(&id, &itemNo, &blob); err != nil {
			failed++
			continue
		}
		if len(blob) == 0 {
			continue
		}
		decoded, err := DecodeLZW(blob, dict)
		if err != nil {
			failed++
			continue
		}
		lbl, txt := ParseFootnoteXML(decoded)
		if lbl == "" {
			lbl = fmt.Sprintf("%d", itemNo)
		}
		out = append(out, FootnoteRecord{
			ID:     id,
			ItemNo: itemNo,
			Label:  lbl,
			Text:   txt,
		})
	}
	if failed > 0 {
		// رکوردهای خطاخورده بی‌صدا حذف نمی‌شوند؛ شمارشان لاگ می‌شود (DB-03).
		log.Printf("noordb: footnotes decode failed for %d rows", failed)
	}
	return out, nil
}

// checkLength سنجش DocItem.Length با متن بازگشوده (DATA-05). واحد Length در فایل‌های
// نور مستند نیست؛ پس همیشه فقط حالت قطعیِ «طول اعلام‌شده ولی خروجی خالی» خطا است و
// مقایسهٔ دقیق (rune یا byte) فقط با NOOR_CHECK_DOCITEM_LENGTH=true فعال می‌شود — تا
// پس از تأیید واحد روی فایل واقعی، سند سالم به‌اشتباه «ناقص» علامت نخورد.
func checkLength(it DocItem) string {
	if it.Length <= 0 {
		return ""
	}
	if it.XML == "" {
		return fmt.Sprintf("Length=%d ولی متن بازگشوده خالی است (احتمال بریدگی)", it.Length)
	}
	if !strictLengthCheck {
		return ""
	}
	if int64(utf8.RuneCountInString(it.XML)) != it.Length && int64(len(it.XML)) != it.Length {
		return fmt.Sprintf("Length=%d با طول بازگشوده (%d نویسه، %d بایت) نمی‌خواند", it.Length, utf8.RuneCountInString(it.XML), len(it.XML))
	}
	return ""
}

var strictLengthCheck = os.Getenv("NOOR_CHECK_DOCITEM_LENGTH") == "true"

// DecodeErrors خطاهای بازگشایی هر رکورد را جمع می‌کند (DATA-05).
type DecodeErrors struct {
	Items []string
}

func (e *DecodeErrors) Error() string { return fmt.Sprintf("decode errors: %d", len(e.Items)) }

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, nil
}
