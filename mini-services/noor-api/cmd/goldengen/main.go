// goldengen — تولیدکنندهٔ فایل مجموعهٔ طلایی (ه-۱۳) از رفتار فعلی موتور محلی روی fixture.
// اجرا از ریشهٔ mini-services/noor-api:
//
//	go run ./cmd/goldengen
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"noor/internal/catalog"
	"noor/internal/index"
	"noor/internal/search"
	"noor/internal/xmlparse"
)

type catMeta struct{ c *catalog.Service }

func (m catMeta) WorkTitle(uid string) (title, short, author string, ok bool) {
	w, ok2 := m.c.Work(uid)
	if !ok2 {
		return "", "", "", false
	}
	return w.Title, w.ShortTitle, w.Author, true
}

func (m catMeta) DocumentMeta(uid string) (workUID, label string, ok bool) {
	w, ok2 := m.c.WorkOfDocument(uid)
	if !ok2 {
		return "", "", false
	}
	d, ok3 := m.c.Document(uid)
	if !ok3 {
		return "", "", false
	}
	return w.UID, d.Label, true
}

func (m catMeta) SectionTitle(docUID, secUID string) (string, bool) {
	mm, err := m.c.Model(docUID)
	if err != nil {
		return "", false
	}
	var find func(secs []*xmlparse.SectionRec) (string, bool)
	find = func(secs []*xmlparse.SectionRec) (string, bool) {
		for _, sc := range secs {
			if sc.UID == secUID {
				return sc.Title, true
			}
			if t, ok2 := find(sc.Children); ok2 {
				return t, ok2
			}
		}
		return "", false
	}
	return find(mm.Sections)
}

type goldenExpectJSON struct {
	Occurrences   int    `json:"occurrences"`
	Books         int    `json:"books"`
	Passages      int    `json:"passages"`
	CountRelation string `json:"count_relation"`
	First         []struct {
		Doc   string `json:"doc"`
		Match [2]int `json:"match"`
		Page  string `json:"page"`
	} `json:"first"`
}

type rawCase struct {
	ID      string            `json:"id"`
	Group   string            `json:"group"`
	Note    string            `json:"note"`
	Request *search.Request   `json:"request"`
	Expect  *goldenExpectJSON `json:"expect"`
}

func main() {
	out := flag.String("out", "internal/search/testdata/golden.json", "مسیر فایل خروجی")
	sources := flag.String("sources", "data/sources", "مسیر fixture")
	flag.Parse()

	cat, err := catalog.Load(*sources)
	if err != nil {
		log.Fatal("کاتالوگ:", err)
	}
	dir, err := os.MkdirTemp("", "golden-idx")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "index.sqlite")
	db, err := index.OpenWrite(path)
	if err != nil {
		log.Fatal(err)
	}
	w := &index.IndexWriter{DB: db}
	var docs []index.DocInput
	var titles []index.TitleRow
	seen := map[string]bool{}
	for _, wk := range cat.Works() {
		for _, d := range wk.Documents {
			m, err := cat.Model(d.UID)
			if err != nil {
				log.Fatal("مدل سند ", d.UID, ":", err)
			}
			docs = append(docs, index.DocInput{CollectionUID: "col-fixture", WorkUID: wk.UID, DocumentUID: d.UID, Language: d.Language, Model: m})
			if !seen[wk.UID] {
				seen[wk.UID] = true
				pub := ""
				if wk.Publisher != nil {
					pub = *wk.Publisher
				}
				titles = append(titles, index.TitleRow{WorkUID: wk.UID, Title: wk.Title, ShortTitle: wk.ShortTitle, Author: wk.Author, Publisher: pub, Language: wk.Language, Topics: wk.Topics})
			}
		}
	}
	n, err := w.Rebuild("rel-golden", docs, titles, nil)
	if err != nil {
		log.Fatal("ساخت نمایه:", err)
	}
	_ = db.Close()

	eng := search.NewLocal(path, []byte("golden-secret"), catMeta{cat})
	cases := search.GoldenQueries()
	var rows []rawCase
	for _, c := range cases {
		resp, err := eng.Search(context.Background(), c.Request, "rel-golden")
		if err != nil {
			log.Fatalf("%s (%s): %v", c.ID, c.Note, err)
		}
		e := &goldenExpectJSON{
			Occurrences:   resp.VerifiedOccurrences,
			Books:         resp.VerifiedBooks,
			Passages:      resp.VerifiedPassages,
			CountRelation: resp.CountRelation,
		}
		for i, r := range resp.Results {
			if i >= 3 {
				break
			}
			page := r.Page.UID
			if page == "" {
				page = r.Page.Label
			}
			e.First = append(e.First, struct {
				Doc   string `json:"doc"`
				Match [2]int `json:"match"`
				Page  string `json:"page"`
			}{Doc: r.Document.UID, Match: r.MatchRange, Page: page})
		}
		rows = append(rows, rawCase{ID: c.ID, Group: c.Group, Note: c.Note, Request: c.Request, Expect: e})
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatal(err)
	}
	f, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(rows); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("فایل طلایی ساخته شد: %s (%d پرس‌وجو، %d passage)\n", *out, len(rows), n)
}
