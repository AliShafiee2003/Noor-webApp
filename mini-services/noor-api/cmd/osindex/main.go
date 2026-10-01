// osindex — نمایه‌سازی fixture از index.sqlite موجود به OpenSearch (یک‌بار برای پاریتی).
// اجرا از ریشهٔ mini-services/noor-api:
//
//      NOOR_OS_URL=http://127.0.0.1:9200 go run ./cmd/osindex
package main

import (
        "bytes"
        "database/sql"
        "encoding/json"
        "flag"
        "fmt"
        "io"
        "log"
        "net/http"

        "noor/internal/norm"
        "noor/internal/search"

        _ "modernc.org/sqlite"
        "os"
        "time"
)

func main() {
        src := flag.String("index", "data/index.sqlite", "مسیر نمایهٔ SQLite")
        url := flag.String("os", "http://127.0.0.1:9200", "آدرس OpenSearch")
        name := flag.String("name", "noor-passages", "نام index در OpenSearch")
        flag.Parse()

        client := &http.Client{Timeout: 60 * time.Second}
        do := func(method, path string, body []byte) ([]byte, int, error) {
                req, err := http.NewRequest(method, *url+path, bytes.NewReader(body))
                if err != nil {
                        return nil, 0, err
                }
                req.Header.Set("Content-Type", "application/json")
                resp, err := client.Do(req)
                if err != nil {
                        return nil, 0, err
                }
                defer resp.Body.Close()
                raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
                return raw, resp.StatusCode, nil
        }

        // ping
        for i := 0; ; i++ {
                if _, code, err := do("GET", "/", nil); err == nil && code < 300 {
                        break
                } else if i > 30 {
                        log.Fatal("OpenSearch در دسترس نیست")
                }
                time.Sleep(2 * time.Second)
        }

        // mapping (هم‌ارز internal/search/opensearch.go)
        if _, code, err := do("HEAD", "/"+*name, nil); err != nil || code != 200 {
                mapping, err := os.ReadFile("cmd/osindex/mapping.json")
                if err != nil {
                        log.Fatal("mapping.json:", err)
                }
                raw, code, err := do("PUT", "/"+*name, mapping)
                if err != nil || code >= 300 {
                        log.Fatalf("ساخت index: code=%d err=%v raw=%s", code, err, string(raw[:min(300, len(raw))]))
                }
        }

        db, err := sql.Open("sqlite", "file:"+*src+"?mode=ro")
        if err != nil {
                log.Fatal(err)
        }
        defer db.Close()
        var release string
        if err := db.QueryRow(`SELECT release_uid FROM passages LIMIT 1`).Scan(&release); err != nil {
                log.Fatal("release:", err)
        }

        rows, err := db.Query(`SELECT passage_uid, release_uid, collection_uid, work_uid, document_uid, section_uid, page_uid, page_label, language, local_hadith_uid, revayat_index, text_original, text_n1, n1_map, source_start, source_end, role_ranges, citations, fingerprint, block_start, block_end FROM passages WHERE release_uid=?`, release)
        if err != nil {
                log.Fatal(err)
        }
        defer rows.Close()
        var buf bytes.Buffer
        n := 0
        push := func() {
                if buf.Len() == 0 {
                        return
                }
                raw, code, err := do("POST", "/_bulk", buf.Bytes())
                if err != nil || code >= 300 {
                        log.Fatalf("bulk: code=%d err=%v raw=%s", code, err, string(raw[:min(300, len(raw))]))
                }
                var out struct {
                        Errors bool `json:"errors"`
                }
                _ = json.Unmarshal(raw, &out)
                if out.Errors {
                        log.Fatalf("bulk با خطای آیتمی: %s", string(raw[:min(300, len(raw))]))
                }
                buf.Reset()
        }
        for rows.Next() {
                var passageUID, relUID, collectionUID, workUID, documentUID, sectionUID, pageUID, pageLabel, language, localHadith, revayatIdx, textOriginal, textN1, n1Map, roleRanges, citations, fingerprint string
                var sourceStart, sourceEnd, blockStart, blockEnd int
                if err := rows.Scan(&passageUID, &relUID, &collectionUID, &workUID, &documentUID, &sectionUID, &pageUID, &pageLabel, &language, &localHadith, &revayatIdx, &textOriginal, &textN1, &n1Map, &sourceStart, &sourceEnd, &roleRanges, &citations, &fingerprint, &blockStart, &blockEnd); err != nil {
                        log.Fatal(err)
                }
                meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": *name, "_id": passageUID}})
                buf.Write(meta)
                buf.WriteByte('\n')
                doc, _ := json.Marshal(map[string]any{
                        "kind": "passage", "passage_uid": passageUID, "release_uid": relUID,
                        "collection_uid": collectionUID, "work_uid": workUID, "document_uid": documentUID,
                        "section_uid": sectionUID, "page_uid": pageUID, "page_label": pageLabel,
                        "language": language, "local_hadith_uid": localHadith, "revayat_index": revayatIdx,
                        "text_original": textOriginal, "text_n1": textN1, "n1_map": n1Map,
                        "source_start": sourceStart, "source_end": sourceEnd,
                        "role_ranges": roleRanges, "citations": citations, "citation_keys": search.CitationKeys(citations), "fingerprint": fingerprint,
                        "block_start": blockStart, "block_end": blockEnd,
                })
                buf.Write(doc)
                buf.WriteByte('\n')
                n++
                if n%200 == 0 {
                        push()
                        time.Sleep(150 * time.Millisecond)
                }
        }
        push()
        _, _, _ = do("POST", "/"+*name+"/_refresh", nil)
        fmt.Printf("passages indexed: %d (release %s)\n", n, release)

        // titles (kind=title) — جست‌وجوی نام کتاب
        trows, err := db.Query(`SELECT work_uid, title, short_title, author FROM titles`)
        if err != nil {
                log.Fatal(err)
        }
        defer trows.Close()
        tn := 0
        for trows.Next() {
                var uid, title, short, author string
                if err := trows.Scan(&uid, &title, &short, &author); err != nil {
                        log.Fatal(err)
                }
                meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": *name, "_id": "title-" + uid}})
                buf.Write(meta)
                buf.WriteByte('\n')
                doc, _ := json.Marshal(map[string]any{
                        "kind": "title", "work_uid": uid, "title": title, "short_title": short,
                        "author": author, "title_search": norm.Fold(title) + " " + norm.Fold(short),
                })
                buf.Write(doc)
                buf.WriteByte('\n')
                tn++
        }
        push()
        _, _, _ = do("POST", "/"+*name+"/_refresh", nil)
        fmt.Printf("titles indexed: %d\n", tn)
}

func min(a, b int) int {
        if a < b {
                return a
        }
        return b
}
