// Package noordb — خوانندهٔ فرمت SQLite نور (شناخته‌شده از PRD §۳/§۴۳):
// جدول BookInfo و DocItem(Id, ItemNo, Story, XmlText, Length, ...)؛ متن با دیکشنری
// کدگذاری‌شده در همان فایل بازگشایی می‌شود (طول دیکشنری ثابت فرض نمی‌شود — DATA-03).
package noordb

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

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
	case has["bookinfo"] && has["docitem"]:
		return "noor-v1", nil
	default:
		return "unknown", nil
	}
}

// LoadDictionary دیکشنری همان فایل را می‌خواند.
func LoadDictionary(db *sql.DB) ([]string, error) {
	// فرمت fixture: جدول Letters با یک ستون متن، به ترتیب index
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

// Decode رشتهٔ کدگذاری‌شده را با دیکشنری باز می‌کند.
// قرارداد fixture: هر توکن <d> یا ارجاع «|n|» به index دیکشنری است.
// این قرارداد با fixture اعتبارسنجی می‌شود؛ ادعای سازگاری با فرمت واقعی چاپی نور نیست.
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
	// شِما ممکن است ستون‌های متفاوت داشته باشد؛ تدریجی‌ترین حالت:
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
	sels := []string{"Id"}
	_ = sels
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
	rows, err := db.Query(`SELECT Id, ItemNo, Story, Section, XmlText, Length FROM DocItem ORDER BY Story, ItemNo, Id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocItem
	var decodeErrs []string
	for rows.Next() {
		var it DocItem
		var xmlText string
		if err := rows.Scan(&it.Id, &it.ItemNo, &it.Story, &it.Section, &xmlText, &it.Length); err != nil {
			return nil, err
		}
		decoded, err := Decode(xmlText, dict)
		if err != nil {
			decodeErrs = append(decodeErrs, fmt.Sprintf("DocItem %d: %v", it.Id, err))
			continue // خطای بازگشایی گزارش می‌شود؛ به‌عنوان محتوای خالی موفق ثبت نمی‌شود (§۴۳)
		}
		it.XML = decoded
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(decodeErrs) > 0 {
		return out, &DecodeErrors{Items: decodeErrs}
	}
	return out, nil
}

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
