// worker — claim کارها از صف و اجرا (import/نمایه‌سازی)؛ وضعیت از طریق API داخلی ثبت می‌شود.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"noor/internal/catalog"
	"noor/internal/config"
	"noor/internal/index"
)

func main() {
	cfg := config.FromEnv()
	api := "http://127.0.0.1:" + cfg.HTTPPort
	log.Println("worker polling", api)
	for {
		job := claim(api)
		if job == nil {
			time.Sleep(2 * time.Second)
			continue
		}
		log.Println("job claimed:", job["uid"])
		switch fmt.Sprint(job["kind"]) {
		case "index_rebuild":
			runIndexRebuild(cfg, api, job)
		default:
			fail(api, fmt.Sprint(job["uid"]), "نوع کار شناخته نشده است")
		}
	}
}

func claim(api string) map[string]any {
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/claim", nil)
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var out struct {
		Job map[string]any `json:"job"`
	}
	if json.NewDecoder(resp.Body).Decode(&out) == nil {
		return out.Job
	}
	return nil
}

func progress(api, uid string, p int, note string) {
	b, _ := json.Marshal(map[string]any{"progress": p, "note": note})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/progress", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

func complete(api, uid string, result map[string]any) {
	b, _ := json.Marshal(map[string]any{"result": result})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/complete", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

func fail(api, uid, msg string) {
	b, _ := json.Marshal(map[string]any{"error": msg})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/fail", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// runIndexRebuild ساخت نسل جدید نمایه؛ شکست → failed (هرگز نیم‌بنا منتشر نمی‌شود).
func runIndexRebuild(cfg *config.Config, api string, job map[string]any) {
	uid := fmt.Sprint(job["uid"])
	var payload struct {
		Reason     string `json:"reason"`
		OverlayUID string `json:"overlay_uid"`
	}
	raw, _ := json.Marshal(job["payload"])
	_ = json.Unmarshal(raw, &payload)

	cat, err := catalog.Load(cfg.SourcesDir)
	if err != nil {
		fail(api, uid, "کاتالوگ خوانده نشد: "+err.Error())
		return
	}
	// نسل جدید در فایل موقت ساخته می‌شود؛ پس از موفقیت جابه‌جا (نسل immutable)
	tmp := filepath.Join(cfg.DataDir, "index.building.sqlite")
	_ = os.Remove(tmp)
	idxDB, err := index.OpenWrite(tmp)
	if err != nil {
		fail(api, uid, "نمایهٔ جدید باز نشد: "+err.Error())
		return
	}
	w := &index.IndexWriter{DB: idxDB}
	var docs []index.DocInput
	var titles []index.TitleRow
	seenTitles := map[string]bool{}
	for i, wk := range cat.Works() {
		for _, d := range wk.Documents {
			m, err := cat.Model(d.UID)
			if err != nil {
				log.Println("skip doc (reported):", d.UID, err)
				continue
			}
			docs = append(docs, index.DocInput{
				CollectionUID: "col-fixture", WorkUID: wk.UID, DocumentUID: d.UID, Language: d.Language, Model: m,
			})
			if !seenTitles[wk.UID] {
				seenTitles[wk.UID] = true
				pub := ""
				if wk.Publisher != nil {
					pub = *wk.Publisher
				}
				titles = append(titles, index.TitleRow{WorkUID: wk.UID, Title: wk.Title, ShortTitle: wk.ShortTitle, Author: wk.Author, Publisher: pub, Language: wk.Language, Topics: wk.Topics})
			}
		}
		progress(api, uid, i*100/len(cat.Works()), "در حال نمایه‌سازی "+wk.Title)
	}
	releaseUID := "rel-" + fmt.Sprint(time.Now().Unix())
	n, err := w.Rebuild(releaseUID, docs, titles, nil)
	if err != nil {
		fail(api, uid, "ساخت نمایه ناموفق: "+err.Error())
		return
	}
	idxDB.Close()
	active, _ := indexFile(cfg.DataDir)
	// جابه‌سازی اتمیک
	if active != "" {
		_ = os.Rename(active, filepath.Join(cfg.DataDir, "index.previous.sqlite"))
	}
	if err := os.Rename(tmp, active2(cfg.DataDir)); err != nil {
		fail(api, uid, "جابه‌سازی نمایه ناموفق: "+err.Error())
		return
	}
	// انتشار نسل: pointer اتمیک در app.sqlite از طریق API داخلی
	b, _ := json.Marshal(map[string]any{"release_uid": releaseUID, "manifest": map[string]any{"passages": n, "docs": len(docs)}})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/releases/publish", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	if resp, err := http.DefaultClient.Do(req); err != nil {
		fail(api, uid, "انتشار نسل ممکن نشد: "+err.Error())
		return
	} else {
		resp.Body.Close()
	}
	complete(api, uid, map[string]any{"passages": n, "release_uid": releaseUID, "docs": len(docs)})
	log.Println("index rebuilt & published:", n, "passages, release", releaseUID)
}

func indexFile(dataDir string) (string, error) {
	p := filepath.Join(dataDir, "index.sqlite")
	if _, err := os.Stat(p); err != nil {
		return "", err
	}
	return p, nil
}

func active2(dataDir string) string {
	return filepath.Join(dataDir, "index.sqlite")
}

