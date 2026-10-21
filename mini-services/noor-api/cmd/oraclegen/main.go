// cmd/oraclegen — تولیدکنندهٔ مجموعهٔ طلایی اوراکل مستقل (فاز ۰ - بخش ۰.۳)
// استخراج کوئری‌ها و محل دقیق وقوع بر روی ۱۰۰ جلد پایلوت
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	_ "modernc.org/sqlite"
	"noor/internal/noordb"
	"noor/internal/norm"
	"noor/internal/xmlparse"
)

type CorpusDoc struct {
	WorkUID     string `json:"work_uid"`
	WorkTitle   string `json:"work_title"`
	DocumentUID string `json:"document_uid"`
	Language    string `json:"language"`
	File        string `json:"file"`
	Filename    string `json:"filename"`
	Disk        string `json:"disk"`
}

type OracleMatch struct {
	DocumentUID  string `json:"document_uid"`
	Filename     string `json:"filename"`
	DocItemID    int64  `json:"doc_item_id"`
	PageNum      string `json:"page_num,omitempty"`
	Role         string `json:"role"` // hadith, sanad, ayah, G, K, matn, heading
	ExactSnippet string `json:"exact_snippet"`
}

type OracleQuery struct {
	ID              string        `json:"id"`
	Category        string        `json:"category"` // strict_phrase, normalized, role_hadith, role_sanad, role_ayah, role_narrator_g, role_source_k, border_crossing, persian, diacritic, negative
	Query           string        `json:"query"`
	Language        string        `json:"language"`
	Description     string        `json:"description"`
	ScopeDocUID     string        `json:"scope_doc_uid,omitempty"`
	RequiredRole    string        `json:"required_role,omitempty"`
	ExpectedMatches []OracleMatch `json:"expected_matches"`
}

type OracleSuite struct {
	Version      string         `json:"version"`
	CorpusFile   string         `json:"corpus_file"`
	TotalQueries int            `json:"total_queries"`
	Categories   map[string]int `json:"categories"`
	Queries      []OracleQuery  `json:"queries"`
}

func main() {
	corpusPath := flag.String("corpus", "data/pilot_100_corpus.json", "مسیر فایل ۱۰۰ جلد پایلوت")
	outPath := flag.String("out", "data/pilot_oracle_100.json", "مسیر فایل اوراکل خروجی")
	flag.Parse()

	data, err := os.ReadFile(*corpusPath)
	if err != nil {
		log.Fatalf("خطا در خواندن فایل پایلوت: %v", err)
	}

	var corpus []CorpusDoc
	if err := json.Unmarshal(data, &corpus); err != nil {
		log.Fatalf("خطا در پارس JSON: %v", err)
	}

	log.Printf("تولید اوراکل جامع از ۱۰۰ جلد پایلوت (%d جلد)...", len(corpus))

	suite := OracleSuite{
		Version:    "1.0-pilot",
		CorpusFile: *corpusPath,
		Categories: make(map[string]int),
	}

	queries := buildOracleQueries(corpus)
	suite.Queries = queries
	suite.TotalQueries = len(queries)
	for _, q := range queries {
		suite.Categories[q.Category]++
	}

	outBytes, err := json.MarshalIndent(suite, "", "  ")
	if err != nil {
		log.Fatalf("خطا در marshal: %v", err)
	}

	if err := os.WriteFile(*outPath, outBytes, 0644); err != nil {
		log.Fatalf("خطا در ذخیره فایل اوراکل: %v", err)
	}

	log.Printf("=== اوراکل با موفقیت تولید شد: %d کوئری در %s ===", len(queries), *outPath)
	for cat, count := range suite.Categories {
		log.Printf("  دسته‌بندی %-16s: %d کوئری", cat, count)
	}
}

func buildOracleQueries(corpus []CorpusDoc) []OracleQuery {
	var list []OracleQuery
	qIndex := 1

	addQ := func(cat, qText, lang, desc, scope, role string, matches []OracleMatch) {
		id := fmt.Sprintf("ORACLE-%03d", qIndex)
		qIndex++
		list = append(list, OracleQuery{
			ID:              id,
			Category:        cat,
			Query:           qText,
			Language:        lang,
			Description:     desc,
			ScopeDocUID:     scope,
			RequiredRole:    role,
			ExpectedMatches: matches,
		})
	}

	// هدف‌گذاری سقف استخراج برای هر دسته‌بندی
	hadithTarget := 15
	sanadTarget := 12
	ayahTarget := 12
	gTarget := 10
	kTarget := 6
	diacriticTarget := 20
	normTarget := 20
	faTarget := 15
	borderTarget := 10

	hadithCount, sanadCount, ayahCount, gCount, kCount := 0, 0, 0, 0, 0
	diacriticCount, normCount, faCount, borderCount := 0, 0, 0, 0

	for _, cdoc := range corpus {
		if hadithCount >= hadithTarget && sanadCount >= sanadTarget && ayahCount >= ayahTarget &&
			gCount >= gTarget && kCount >= kTarget && diacriticCount >= diacriticTarget &&
			normCount >= normTarget && faCount >= faTarget && borderCount >= borderTarget {
			break
		}

		db, err := noordb.Open(cdoc.File)
		if err != nil {
			continue
		}
		dict, err := noordb.LoadDictionary(db)
		if err != nil {
			db.Close()
			continue
		}
		items, err := noordb.ReadDocItems(db, dict)
		if err != nil || len(items) == 0 {
			db.Close()
			continue
		}
		db.Close()

		in := make([]xmlparse.ItemInput, 0, len(items))
		for i := 0; i < len(items); i++ {
			in = append(in, xmlparse.ItemInput{ID: items[i].Id, XML: items[i].XML})
		}

		docModel, err := xmlparse.ParseItems(cdoc.DocumentUID, in)
		if err != nil {
			continue
		}

		// الف: Hadith
		if hadithCount < hadithTarget {
			for _, b := range docModel.Blocks {
				if (b.Type == "hadith_body" || b.HadithUID != "") && len(b.Text) > 50 {
					words := strings.Fields(b.Text)
					if len(words) >= 6 {
						phrase := strings.Join(words[1:6], " ")
						addQ("role_hadith", phrase, cdoc.Language, "عبارت بدنه روایت در "+cdoc.Filename, cdoc.DocumentUID, "hadith", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: phrase,
							Role:         "hadith",
						}})
						hadithCount++
						if hadithCount >= hadithTarget {
							break
						}
					}
				}
			}
		}

		// ب: Sanad
		if sanadCount < sanadTarget {
			for _, b := range docModel.Blocks {
				if b.Type == "sanad" && len(b.Text) > 25 {
					words := strings.Fields(b.Text)
					if len(words) >= 4 {
						phrase := strings.Join(words[:4], " ")
						addQ("role_sanad", phrase, cdoc.Language, "عبارت سلسله سند در "+cdoc.Filename, cdoc.DocumentUID, "sanadHadith", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: phrase,
							Role:         "sanadHadith",
						}})
						sanadCount++
						if sanadCount >= sanadTarget {
							break
						}
					}
				}
				for _, sp := range b.Spans {
					if sp.Role == "sanad" && sp.End-sp.Start > 20 && sanadCount < sanadTarget {
						runes := []rune(b.Text)
						if sp.End <= len(runes) {
							sub := string(runes[sp.Start:sp.End])
							words := strings.Fields(sub)
							if len(words) >= 4 {
								phrase := strings.Join(words[:4], " ")
								addQ("role_sanad", phrase, cdoc.Language, "عبارت محدوده سند در "+cdoc.Filename, cdoc.DocumentUID, "sanadHadith", []OracleMatch{{
									DocumentUID:  cdoc.DocumentUID,
									Filename:     cdoc.Filename,
									ExactSnippet: phrase,
									Role:         "sanadHadith",
								}})
								sanadCount++
								if sanadCount >= sanadTarget {
									break
								}
							}
						}
					}
				}
			}
		}

		// ج: Ayah
		if ayahCount < ayahTarget {
			for _, c := range docModel.Citations {
				if c.Address != "" && len(c.Address) > 5 {
					addQ("role_ayah", c.Address, "ar", "استناد قرآنی با نشانی "+c.Address+" در "+cdoc.Filename, cdoc.DocumentUID, "ayah", []OracleMatch{{
						DocumentUID:  cdoc.DocumentUID,
						Filename:     cdoc.Filename,
						ExactSnippet: c.Address,
						Role:         "ayah",
					}})
					ayahCount++
					if ayahCount >= ayahTarget {
						break
					}
				}
			}
			for _, b := range docModel.Blocks {
				if b.Type == "ayah_quote" && len(b.Text) > 20 {
					words := strings.Fields(b.Text)
					if len(words) >= 4 {
						phrase := strings.Join(words[:4], " ")
						addQ("role_ayah", phrase, "ar", "متن آیه در "+cdoc.Filename, cdoc.DocumentUID, "ayah", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: phrase,
							Role:         "ayah",
						}})
						ayahCount++
						if ayahCount >= ayahTarget {
							break
						}
					}
				}
			}
		}

		// د: G (راوی)
		if gCount < gTarget {
			for _, b := range docModel.Blocks {
				for _, sp := range b.Spans {
					if sp.Role == "G" && sp.G != "" {
						addQ("role_narrator_g", sp.G, cdoc.Language, "نام راوی با برچسب G در "+cdoc.Filename, cdoc.DocumentUID, "G", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: sp.G,
							Role:         "G",
						}})
						gCount++
						if gCount >= gTarget {
							break
						}
					}
				}
			}
		}

		// ه: K (مأخذ)
		if kCount < kTarget {
			for _, b := range docModel.Blocks {
				for _, sp := range b.Spans {
					if sp.Role == "K" && sp.Ref != "" {
						addQ("role_source_k", sp.Ref, cdoc.Language, "مأخذ با برچسب K در "+cdoc.Filename, cdoc.DocumentUID, "K", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: sp.Ref,
							Role:         "K",
						}})
						kCount++
						if kCount >= kTarget {
							break
						}
					}
				}
			}
		}

		// و: اعراب‌دار و نرمال‌شده
		if diacriticCount < diacriticTarget {
			for _, b := range docModel.Blocks {
				if len(b.Text) > 50 {
					words := strings.Fields(b.Text)
					if len(words) >= 5 {
						exact := strings.Join(words[1:5], " ")
						nText, _ := norm.Normalize(exact)
						if nText != exact && len(exact) > 15 {
							addQ("diacritic", exact, cdoc.Language, "عبارت اعراب‌دار اصل در "+cdoc.Filename, cdoc.DocumentUID, "", []OracleMatch{{
								DocumentUID:  cdoc.DocumentUID,
								Filename:     cdoc.Filename,
								ExactSnippet: exact,
							}})
							diacriticCount++
							if normCount < normTarget {
								addQ("normalized", nText, cdoc.Language, "عبارت نرمال‌شده بدون اعراب در "+cdoc.Filename, cdoc.DocumentUID, "", []OracleMatch{{
									DocumentUID:  cdoc.DocumentUID,
									Filename:     cdoc.Filename,
									ExactSnippet: exact,
								}})
								normCount++
							}
							if diacriticCount >= diacriticTarget {
								break
							}
						}
					}
				}
			}
		}

		// ز: فارسی
		if cdoc.Language == "fa" && faCount < faTarget {
			for _, b := range docModel.Blocks {
				if len(b.Text) > 50 {
					words := strings.Fields(b.Text)
					if len(words) >= 5 {
						phrase := strings.Join(words[1:5], " ")
						addQ("persian", phrase, "fa", "عبارت متوالی فارسی در "+cdoc.Filename, cdoc.DocumentUID, "", []OracleMatch{{
							DocumentUID:  cdoc.DocumentUID,
							Filename:     cdoc.Filename,
							ExactSnippet: phrase,
						}})
						faCount++
						if faCount >= faTarget {
							break
						}
					}
				}
			}
		}

		// ح: عبور از مرز (Border crossing)
		if borderCount < borderTarget && len(docModel.Blocks) >= 2 {
			for i := 0; i < len(docModel.Blocks)-1; i++ {
				b1 := docModel.Blocks[i]
				b2 := docModel.Blocks[i+1]
				w1 := strings.Fields(b1.Text)
				w2 := strings.Fields(b2.Text)
				if len(w1) >= 2 && len(w2) >= 2 {
					borderPhrase := w1[len(w1)-2] + " " + w1[len(w1)-1] + " " + w2[0] + " " + w2[1]
					addQ("border_crossing", borderPhrase, cdoc.Language, "عبارت متوالی روی مرز بلوک‌های مجاور در "+cdoc.Filename, cdoc.DocumentUID, "", []OracleMatch{{
						DocumentUID:  cdoc.DocumentUID,
						Filename:     cdoc.Filename,
						ExactSnippet: borderPhrase,
					}})
					borderCount++
					break
				}
			}
		}
	}

	// ط: کوئری‌های منفی (Negative Queries)
	negatives := []struct {
		query string
		lang  string
		desc  string
	}{
		{"زردشت اسفندیار رستم زال سهراب", "fa", "عبارت ساختگی شاهنامه در کتب روایی عربی"},
		{"اینترنت وب‌اپلیکیشن پایگاه داده کوئری", "fa", "اصطلاحات رایانه مدرن"},
		{"فلمّا فتح الإسكندر الأكبر بلاد الصين باحثاً عن الإنترنت", "ar", "ترکیب ناممکن تاریخی"},
		{"أخبرنا فلان بن فلان عن علان الساحر في كوكب المريخ", "ar", "سند ساختگی نجومی"},
		{"برنامه‌نویسی گو لنگ و نکس جی اس در قرن دهم", "fa", "اصطلاح فنی ناموجود"},
		{"عن زرارة بن أعين عن أبي عبد الله عليه السلام في حكم استخدام الحاسوب", "ar", "حدیث ساختگی مدرن"},
		{"الدرهم الإلكتروني والبيتكوين في المعاملات المالية", "ar", "اصطلاح مالی رمزارز"},
		{"قال المؤرخ البريطاني في كتاب تاریخ روما القديمة", "fa", "عبارت غربی ناموجود"},
		{"سفینه‌های فضایی در کهکشان آندرومدا", "fa", "داستان علمی‌تخیلی مدرن"},
		{"موتور جستجوی اف تی اس فایو با زبان برنامه‌نویسی راست", "fa", "ترکیب ناموجود فناوری"},
	}

	for _, n := range negatives {
		addQ("negative", n.query, n.lang, n.desc, "", "", []OracleMatch{})
	}

	return list
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
