// migrate-bff — مهاجرت یک‌بارهٔ دادهٔ خصوصی کاربر (§۷-الف) از db/custom.db (Prisma/Next BFF)
// به app.sqlite (Go API). uidها عیناً حفظ می‌شوند؛ تاریخ‌های epoch-millis Prisma به
// RFC3339 UTC تبدیل می‌شود. اجرای تکراری ایمن است (INSERT OR IGNORE + شمارندهٔ skip).
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	_ "modernc.org/sqlite"

	"noor/internal/config"
	"noor/internal/store"
)

// rfc3339 مقدار تاریخ Prisma (epoch-millis عددی یا رشته) → RFC3339 UTC؛ nil → nil.
func rfc3339(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case int64:
		return time.UnixMilli(x).UTC().Format(time.RFC3339)
	case int:
		return time.UnixMilli(int64(x)).UTC().Format(time.RFC3339)
	case float64:
		return time.UnixMilli(int64(x)).UTC().Format(time.RFC3339)
	case []byte:
		return rfc3339(string(x))
	case string:
		if n, err := strconv.ParseInt(x, 10, 64); err == nil {
			return time.UnixMilli(n).UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse("2006-01-02 15:04:05", x); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		return x
	default:
		return v
	}
}

// nullStr رشتهٔ خالی → NULL (برای expires_at/finished_at).
func nullStr(v any) any {
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	return v
}

func main() {
	src := flag.String("src", "/home/z/my-project/db/custom.db", "مسیر دیتابیس Prisma")
	dry := flag.Bool("dry-run", false, "فقط شمارش، بدون نوشتن")
	flag.Parse()

	cfg := config.FromEnv()
	dstPath := cfg.DataDir + "/app.sqlite"
	if _, err := os.Stat(*src); err != nil {
		log.Fatalf("دیتابیس مبدأ یافت نشد: %v", err)
	}
	sdb, err := sql.Open("sqlite", "file:"+*src+"?mode=ro")
	if err != nil {
		log.Fatal("open src:", err)
	}
	defer sdb.Close()

	var ddb *store.DB
	if !*dry {
		ddb, err = store.Open(dstPath) // migrations جدول‌های جدید را هم اجرا می‌کند
		if err != nil {
			log.Fatal("open dst:", err)
		}
		defer ddb.Close()
	}

	count := func(table string) int {
		var n int
		_ = sdb.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n)
		return n
	}
	totalMigrated, totalSkipped := 0, 0

	migrate := func(name, insertSQL string, rowArgs func(*sql.Rows) ([]any, error)) {
		srcRows, err := sdb.Query("SELECT * FROM " + name)
		if err != nil {
			log.Fatalf("%s: %v", name, err)
		}
		defer srcRows.Close()
		migrated, skipped := 0, 0
		for srcRows.Next() {
			args, err := rowArgs(srcRows)
			if err != nil {
				log.Fatalf("%s row: %v", name, err)
			}
			if *dry {
				migrated++
				continue
			}
			res, err := ddb.Exec(insertSQL, args...)
			if err != nil {
				log.Fatalf("%s insert %v: %v", name, args[0], err)
			}
			if n, _ := res.RowsAffected(); n > 0 {
				migrated++
			} else {
				skipped++
			}
		}
		fmt.Printf("%-12s موجود در مبدأ: %d | منتقل‌شده: %d | از قبل موجود: %d\n",
			name, count(name), migrated, skipped)
		totalMigrated += migrated
		totalSkipped += skipped
	}

	migrate("Highlight", `INSERT OR IGNORE INTO highlights
                (uid, user_uid, document_uid, page_uid, block_id, start_cp, end_cp, text, color, note, created_at, updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		func(r *sql.Rows) ([]any, error) {
			var id, userUID, docUID, pageUID, blockID, text, createdAt, updatedAt string
			var start, end int
			var color string
			var note sql.NullString
			if err := r.Scan(&id, &userUID, &docUID, &pageUID, &blockID, &start, &end, &text, &color, &note, &createdAt, &updatedAt); err != nil {
				return nil, err
			}
			if color == "" {
				color = "yellow"
			}
			return []any{id, userUID, docUID, pageUID, blockID, start, end, text, color, note,
				rfc3339(createdAt), rfc3339(updatedAt)}, nil
		})

	migrate("ShareLink", `INSERT OR IGNORE INTO share_links
                (uid, user_uid, kind, item_id, document_uid, page_uid, page_label, work_title, payload, meta, revoked, expires_at, created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?, ?, ?)`,
		func(r *sql.Rows) ([]any, error) {
			var id, userUID, kind, itemID, docUID, payload, createdAt string
			var pageUID, pageLabel, workTitle, meta sql.NullString
			var revoked bool
			var expiresAt, revokedAt sql.NullString // revokedAt در قرارداد JSON نیست — رها می‌شود
			if err := r.Scan(&id, &userUID, &kind, &itemID, &docUID, &pageUID, &pageLabel, &workTitle, &payload, &meta, &revoked, &createdAt, &expiresAt, &revokedAt); err != nil {
				return nil, err
			}
			revInt := 0
			if revoked {
				revInt = 1
			}
			return []any{id, userUID, kind, itemID, docUID, pageUID, pageLabel, workTitle, payload, meta,
				revInt, nullStr(rfc3339(expiresAt.String)), rfc3339(createdAt)}, nil
		})

	migrate("PdfJob", `INSERT OR IGNORE INTO pdf_jobs
                (uid, user_uid, work_uid, document_uid, title, work_title, page_from, page_to, include_notes,
                 overlay_note, status, progress, status_note, download_token, token_expires_at, file_size,
                 created_at, updated_at, finished_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		func(r *sql.Rows) ([]any, error) {
			var id, userUID, docUID, documentLabel, paramsJSON, status string
			var progress int
			var workUID, workTitle, statusNote, downloadToken sql.NullString
			var filePath sql.NullString // فایل سمت Next می‌ماند — در Go ذخیره نمی‌شود
			var fileBytes sql.NullInt64
			var tokenExpiresAt, createdAt, finishedAt sql.NullString
			if err := r.Scan(&id, &userUID, &docUID, &documentLabel, &workUID, &workTitle, &paramsJSON,
				&status, &progress, &statusNote, &filePath, &fileBytes, &downloadToken,
				&tokenExpiresAt, &createdAt, &finishedAt); err != nil {
				return nil, err
			}
			// paramsJson: {"from":…,"to":…,"whole":…,"include_notes":…} — برچسب‌های چاپی
			var from, to any
			includeNotes := 0
			var parsed map[string]any
			if err := json.Unmarshal([]byte(paramsJSON), &parsed); err == nil && parsed != nil {
				if v, ok := parsed["from"].(string); ok && v != "" {
					from = v
				}
				if v, ok := parsed["to"].(string); ok && v != "" {
					to = v
				}
				if parsed["include_notes"] == true {
					includeNotes = 1
				}
			}
			title := documentLabel
			if title == "" {
				title = docUID
			}
			updated := finishedAt
			if !updated.Valid || updated.String == "" {
				updated = sql.NullString{String: createdAt.String, Valid: true}
			}
			return []any{id, userUID, workUID, docUID, title, workTitle, from, to, includeNotes,
				nil, status, progress, statusNote, downloadToken, nullStr(rfc3339(tokenExpiresAt.String)), fileBytes,
				rfc3339(createdAt.String), rfc3339(updated.String), nullStr(rfc3339(finishedAt.String))}, nil
		})

	if *dry {
		fmt.Println("dry-run — چیزی نوشته نشد.")
	}
	fmt.Printf("جمع: %d ردیف منتقل شد، %d از قبل موجود بود.\n", totalMigrated, totalSkipped)
}
