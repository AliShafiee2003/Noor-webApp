// cmd/healthcheck — ابزار ممیزی و بررسی سلامت پایلوت ۱۰۰ جلد (فاز ۰ - دروازه A)
// اجرا از ریشهٔ mini-services/noor-api:
//
//	go run ./cmd/healthcheck -corpus data/pilot_100_corpus.json -out data/pilot_100_health_report.json
package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
	"noor/internal/noordb"
)

type CorpusDoc struct {
	WorkUID       string `json:"work_uid"`
	WorkTitle     string `json:"work_title"`
	WorkAuthor    string `json:"work_author"`
	DocumentUID   string `json:"document_uid"`
	DocumentLabel string `json:"document_label"`
	Language      string `json:"language"`
	File          string `json:"file"`
	Filename      string `json:"filename"`
	Disk          string `json:"disk"`
	SizeBytes     int64  `json:"size_bytes"`
}

type OffsetCheck struct {
	DocItemID   int64  `json:"doc_item_id"`
	PageID      int64  `json:"page_id"`
	StartOffset int64  `json:"start_offset"`
	LengthRunes int    `json:"length_runes"`
	LengthBytes int    `json:"length_bytes"`
	SnippetAtCP string `json:"snippet_at_code_point"`
	TagDetected string `json:"tag_detected"`
}

type DocHealthReport struct {
	DocumentUID     string         `json:"document_uid"`
	Filename        string         `json:"filename"`
	Disk            string         `json:"disk"`
	Language        string         `json:"language"`
	WorkTitle       string         `json:"work_title"`
	SizeBytes       int64          `json:"size_bytes"`
	Status          string         `json:"status"` // ok, partial, failed
	Errors          []string       `json:"errors,omitempty"`
	Warnings        []string       `json:"warnings,omitempty"`
	IntegrityCheck  string         `json:"integrity_check"`
	SchemaFP        string         `json:"schema_fingerprint"`
	TablesFound     []string       `json:"tables_found"`
	DictEntries     int            `json:"dict_entries"`
	Stories         map[string]int `json:"stories"`
	TotalDocItems   int            `json:"total_doc_items"`
	DecodedSamples  int            `json:"decoded_samples"`
	LengthMatches   int            `json:"length_matches"`
	XMLValidSamples int            `json:"xml_valid_samples"`
	TagCoverage     map[string]int `json:"tag_coverage"`
	PageCount       int            `json:"page_count"`
	PageBreakCount  int            `json:"page_break_count"`
	TOCCount        int            `json:"toc_count"`
	OffsetChecks    []OffsetCheck  `json:"offset_checks,omitempty"`
	DurationMs      int64          `json:"duration_ms"`
}

type OverallSummary struct {
	TotalBooks        int            `json:"total_books"`
	StatusCounts      map[string]int `json:"status_counts"`
	DisksCovered      int            `json:"disks_covered"`
	TotalDocItems     int            `json:"total_doc_items"`
	TotalPages        int            `json:"total_pages"`
	UniqueSchemaFPs   int            `json:"unique_schema_fps"`
	GlobalTagCoverage map[string]int `json:"global_tag_coverage"`
	GeneratedAt       string         `json:"generated_at"`
}

type FinalReport struct {
	Summary   OverallSummary    `json:"summary"`
	Documents []DocHealthReport `json:"documents"`
}

func main() {
	corpusPath := flag.String("corpus", "data/pilot_100_corpus.json", "مسیر فایل لیست ۱۰۰ جلد پایلوت")
	outPath := flag.String("out", "data/pilot_100_health_report.json", "مسیر گزارش خروجی JSON")
	sampleLimit := flag.Int("sample", 50, "حداکثر تعداد DocItem برای بازگشایی و اعتبارسنجی در هر کتاب (-1 برای همه)")
	flag.Parse()

	data, err := os.ReadFile(*corpusPath)
	if err != nil {
		log.Fatalf("خطا در خواندن فایل پایلوت: %v", err)
	}

	var corpus []CorpusDoc
	if err := json.Unmarshal(data, &corpus); err != nil {
		log.Fatalf("خطا در پارس JSON پایلوت: %v", err)
	}

	log.Printf("شروع بررسی سلامت %d جلد پایلوت...", len(corpus))
	startTotal := time.Now()

	var reports []DocHealthReport
	summary := OverallSummary{
		TotalBooks:        len(corpus),
		StatusCounts:      map[string]int{"ok": 0, "partial": 0, "failed": 0},
		GlobalTagCoverage: make(map[string]int),
		GeneratedAt:       time.Now().Format(time.RFC3339),
	}
	disksSet := make(map[string]bool)
	schemaSet := make(map[string]bool)

	for i, cdoc := range corpus {
		t0 := time.Now()
		rep := auditDocument(cdoc, *sampleLimit)
		rep.DurationMs = time.Since(t0).Milliseconds()
		reports = append(reports, rep)

		summary.StatusCounts[rep.Status]++
		disksSet[rep.Disk] = true
		schemaSet[rep.SchemaFP] = true
		summary.TotalDocItems += rep.TotalDocItems
		summary.TotalPages += rep.PageCount
		for tag, cnt := range rep.TagCoverage {
			summary.GlobalTagCoverage[tag] += cnt
		}

		if (i+1)%10 == 0 || i == len(corpus)-1 {
			log.Printf("[%d/%d] بررسی شد: %s (%s) -> %s (%d ms)",
				i+1, len(corpus), rep.Filename, rep.Disk, rep.Status, rep.DurationMs)
		}
	}

	summary.DisksCovered = len(disksSet)
	summary.UniqueSchemaFPs = len(schemaSet)

	final := FinalReport{
		Summary:   summary,
		Documents: reports,
	}

	outBytes, err := json.MarshalIndent(final, "", "  ")
	if err != nil {
		log.Fatalf("خطا در ساخت JSON نهایی: %v", err)
	}

	if err := os.WriteFile(*outPath, outBytes, 0644); err != nil {
		log.Fatalf("خطا در ذخیره گزارش: %v", err)
	}

	log.Printf("=== پایان ممیزی پایلوت در %v ===", time.Since(startTotal))
	log.Printf("کل کتاب‌ها: %d | سالم (ok): %d | دارای هشدار (partial): %d | ناموفق (failed): %d",
		summary.TotalBooks, summary.StatusCounts["ok"], summary.StatusCounts["partial"], summary.StatusCounts["failed"])
	log.Printf("دیسک‌های پوشش‌داده‌شده: %d | مجموع DocItems: %d | مجموع صفحات: %d",
		summary.DisksCovered, summary.TotalDocItems, summary.TotalPages)
	log.Printf("تنوع شِما (Schema Fingerprints): %d", summary.UniqueSchemaFPs)
	log.Println("پوشش سراسری تگ‌های معنایی:")
	for tag, cnt := range summary.GlobalTagCoverage {
		log.Printf("  - %s: %d", tag, cnt)
	}
	log.Printf("گزارش تفصیلی در %s ذخیره شد.", *outPath)
}

func auditDocument(cdoc CorpusDoc, sampleLimit int) DocHealthReport {
	rep := DocHealthReport{
		DocumentUID: cdoc.DocumentUID,
		Filename:    cdoc.Filename,
		Disk:        cdoc.Disk,
		Language:    cdoc.Language,
		WorkTitle:   cdoc.WorkTitle,
		SizeBytes:   cdoc.SizeBytes,
		Status:      "ok",
		Stories:     make(map[string]int),
		TagCoverage: make(map[string]int),
	}

	db, err := noordb.Open(cdoc.File)
	if err != nil {
		rep.Status = "failed"
		rep.Errors = append(rep.Errors, fmt.Sprintf("خطا در باز کردن دیتابیس: %v", err))
		return rep
	}
	defer db.Close()

	// ۱. Integrity check
	var integ string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&integ); err != nil {
		rep.IntegrityCheck = fmt.Sprintf("error: %v", err)
		rep.Errors = append(rep.Errors, rep.IntegrityCheck)
		rep.Status = "failed"
	} else {
		rep.IntegrityCheck = integ
		if integ != "ok" {
			rep.Errors = append(rep.Errors, "integrity_check is not ok: "+integ)
			rep.Status = "failed"
		}
	}

	// ۲. Schema audit & fingerprint
	tables, schemaFP, err := inspectSchema(db)
	if err != nil {
		rep.Errors = append(rep.Errors, fmt.Sprintf("خطا در بازرسی شِما: %v", err))
		rep.Status = "failed"
	} else {
		rep.TablesFound = tables
		rep.SchemaFP = schemaFP
	}

	// ۳. Dictionary
	dict, err := noordb.LoadDictionary(db)
	if err != nil {
		rep.Errors = append(rep.Errors, fmt.Sprintf("خطا در بارگذاری دیکشنری: %v", err))
		rep.Status = "failed"
		return rep
	}
	rep.DictEntries = len(dict)

	// ۴. Stories & DocItem counts
	storyRows, err := db.Query(`SELECT s.Id, s.Name, COUNT(d.Id) FROM Story s LEFT JOIN DocItem d ON s.Id = d.StoryId GROUP BY s.Id, s.Name`)
	if err == nil {
		defer storyRows.Close()
		for storyRows.Next() {
			var sid int
			var sname string
			var cnt int
			if err := storyRows.Scan(&sid, &sname, &cnt); err == nil {
				rep.Stories[fmt.Sprintf("%d:%s", sid, sname)] = cnt
				rep.TotalDocItems += cnt
			}
		}
	}

	// ۵. Pages and TOC
	_ = db.QueryRow(`SELECT COUNT(*) FROM Page`).Scan(&rep.PageCount)
	_ = db.QueryRow(`SELECT COUNT(*) FROM PageBreak`).Scan(&rep.PageBreakCount)
	_ = db.QueryRow(`SELECT COUNT(*) FROM TableOfContent`).Scan(&rep.TOCCount)

	// ۶. Decode sampling & XML inspection
	queryStr := `SELECT Id, Length, Context FROM DocItem WHERE StoryId = 1 ORDER BY ItemNo`
	if sampleLimit > 0 {
		queryStr = fmt.Sprintf("%s LIMIT %d", queryStr, sampleLimit)
	}

	rows, err := db.Query(queryStr)
	if err != nil {
		rep.Errors = append(rep.Errors, fmt.Sprintf("خطا در استعلام DocItem: %v", err))
		rep.Status = "failed"
		return rep
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var length int64
		var blob []byte
		if err := rows.Scan(&id, &length, &blob); err != nil {
			rep.Errors = append(rep.Errors, fmt.Sprintf("DocItem %d scan error: %v", id, err))
			continue
		}
		rep.DecodedSamples++

		if len(blob) == 0 {
			if length == 0 {
				rep.LengthMatches++
			}
			continue
		}

		decoded, err := noordb.DecodeLZW(blob, dict)
		if err != nil {
			rep.Errors = append(rep.Errors, fmt.Sprintf("DocItem %d decode error: %v", id, err))
			rep.Status = "partial"
			continue
		}

		runesLen := utf8.RuneCountInString(decoded)
		if int64(runesLen) == length {
			rep.LengthMatches++
		} else {
			rep.Warnings = append(rep.Warnings, fmt.Sprintf("DocItem %d length mismatch: expected %d, got %d runes", id, length, runesLen))
		}

		// XML validation
		dec := xml.NewDecoder(strings.NewReader(decoded))
		xmlValid := true
		for {
			tok, err := dec.Token()
			if err != nil {
				if err != io.EOF {
					xmlValid = false
				}
				break
			}
			if se, ok := tok.(xml.StartElement); ok {
				if se.Name.Local == "format" {
					for _, attr := range se.Attr {
						if attr.Name.Local == "class" {
							rep.TagCoverage[attr.Value]++
						}
					}
				} else {
					rep.TagCoverage[se.Name.Local]++
				}
			}
		}
		if xmlValid {
			rep.XMLValidSamples++
		}
	}

	// ۷. Native Offset contract check on PageBreak
	pbRows, err := db.Query(`SELECT pb.PageId, pb.DocItemId, pb.StartOffset, d.Context 
		FROM PageBreak pb JOIN DocItem d ON pb.DocItemId = d.Id 
		WHERE pb.StartOffset > 0 LIMIT 3`)
	if err == nil {
		defer pbRows.Close()
		for pbRows.Next() {
			var pid, did, offset int64
			var blob []byte
			if err := pbRows.Scan(&pid, &did, &offset, &blob); err == nil && len(blob) > 0 {
				if dec, err := noordb.DecodeLZW(blob, dict); err == nil {
					runes := []rune(dec)
					chk := OffsetCheck{
						DocItemID:   did,
						PageID:      pid,
						StartOffset: offset,
						LengthRunes: len(runes),
						LengthBytes: len(dec),
					}
					// Check snippet at offset (as 0-based code point)
					off := int(offset)
					if off < len(runes) {
						end := off + 30
						if end > len(runes) {
							end = len(runes)
						}
						chk.SnippetAtCP = string(runes[off:end])
					}
					rep.OffsetChecks = append(rep.OffsetChecks, chk)
				}
			}
		}
	}

	if len(rep.Errors) > 0 {
		if rep.XMLValidSamples > 0 {
			rep.Status = "partial"
		} else {
			rep.Status = "failed"
		}
	} else if len(rep.Warnings) > 0 {
		rep.Status = "partial"
	}

	return rep
}

func inspectSchema(db *sql.DB) ([]string, string, error) {
	rows, err := db.Query(`SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var tables []string
	hasher := sha256.New()
	for rows.Next() {
		var name string
		var sqlStr sql.NullString
		if err := rows.Scan(&name, &sqlStr); err != nil {
			return nil, "", err
		}
		tables = append(tables, name)
		hasher.Write([]byte(name))
		hasher.Write([]byte(":"))
		hasher.Write([]byte(sqlStr.String))
		hasher.Write([]byte(";"))
	}
	sort.Strings(tables)
	return tables, hex.EncodeToString(hasher.Sum(nil))[:16], nil
}
