// scalefixture — ساخت «کورپوس مقیاس مصنوعی» از نمایهٔ fixture (بند ۲ ممیزی round14).
// کورپوس واقعی در سندباکس در دسترس نیست، پس صادقانه همین fixture ۷۱ passage‌ای
// به‌اندازهٔ factor بار تکرار می‌شود: هر نسخه پسوند "-s{k}" در شناسه‌ها می‌گیرد و
// «همهٔ نسخه‌ها در یک release واحد (rel-scale)» قرار می‌گیرند تا موتور همه را یکجا ببیند.
// متن‌ها (text_original/text_n1/n1_map/role_ranges/citations/fingerprint) عیناً کپی
// می‌شوند — هدف سنجش اثر «تعداد» بر موتور است، نه تغییر محتوا.
//
// اجرا از ریشهٔ mini-services/noor-api:
//
//	go run ./cmd/scalefixture -src data/index.sqlite -out data/index-scale.sqlite -factor 280
//
// نکتهٔ ایمنی داده: منبع فقط SELECT می‌شود (ATTACH فقط‌خواندنی)؛ خروجی همیشه فایل
// تازه‌ای است و به data/index.sqlite دست زده نمی‌شود.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"noor/internal/index"
	"noor/internal/norm"

	_ "modernc.org/sqlite"
)

const scaleRelease = "rel-scale"

// rec ردیف passage منبع برای کپی با شناسه‌های پسونددار.
type rec struct {
	passageUID, collectionUID, workUID, documentUID, sectionUID, pageUID, pageLabel string
	language, localHadith, revayatIdx, textOriginal, textN1, n1Map                  string
	sourceStart, sourceEnd, blockStart, blockEnd                                    int
	roleRanges, citations, fingerprint                                              string
}

type titleRec struct {
	workUID, title, shortTitle, author, publisher, language string
	topics                                                  string
}

func main() {
	src := flag.String("src", "data/index.sqlite", "نمایهٔ منبع (فقط‌خواندنی)")
	out := flag.String("out", "data/index-scale.sqlite", "فایل نمایهٔ مقیاس (تازه ساخته می‌شود)")
	factor := flag.Int("factor", 280, "ضریب تکرار passages و titles")
	flag.Parse()

	if *factor < 1 {
		log.Fatal("factor باید ≥ ۱ باشد")
	}
	srcAbs, err := filepathAbs(*src)
	if err != nil {
		log.Fatal("src:", err)
	}
	outAbs, err := filepathAbs(*out)
	if err != nil {
		log.Fatal("out:", err)
	}
	if srcAbs == outAbs {
		log.Fatal("out نباید همان src باشد — نمایهٔ اصلی محافظت‌شده است")
	}
	if _, err := os.Stat(srcAbs); err != nil {
		log.Fatal("نمایهٔ منبع یافت نشد:", err)
	}

	// خروجی از صفر — اجرای دوبارهٔ اسکریپت باید نتیجهٔ یکسان بدهد (idempotent)
	for _, p := range []string{outAbs, outAbs + "-wal", outAbs + "-shm"} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			log.Fatal("حذف خروجی قبلی:", err)
		}
	}

	srcDB, err := sql.Open("sqlite", "file:"+srcAbs+"?mode=ro")
	if err != nil {
		log.Fatal(err)
	}
	defer srcDB.Close()

	outDB, err := index.OpenWrite(outAbs)
	if err != nil {
		log.Fatal(err)
	}
	defer outDB.Close()

	// ۱) ساخت schema از روی sqlite_master منبع (همان استراتژی مصوب در دستور کار؛
	// IndexWriter.Rebuild نیاز به DocModel دارد و برای کپی خام fit نیست)
	for _, t := range []string{"passages", "tokens", "postings", "trigrams", "titles"} {
		var ddl string
		if err := srcDB.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, t).Scan(&ddl); err != nil {
			log.Fatal("schema منبع:", t, err)
		}
		if _, err := outDB.Exec(ddl); err != nil {
			log.Fatal("ساخت جدول", t, ":", err)
		}
	}

	// ۲) اتصال فقط‌خواندنی منبع برای INSERT…SELECT انبوه postings/trigrams/tokens
	// (اول با mode=ro تلاش می‌شود؛ اگر URI در ATTACH پشتیبانی نشود مسیر ساده)
	var attached bool
	for _, att := range []string{"file:" + srcAbs + "?mode=ro", srcAbs} {
		if _, err := outDB.Exec(`ATTACH DATABASE ? AS src`, att); err == nil {
			attached = true
			if att == srcAbs {
				log.Println("هشدار: ATTACH فقط‌خواندنی ممکن نشد؛ اتصال عادی — فقط SELECT اجرا می‌شود")
			}
			break
		}
	}
	if !attached {
		log.Fatal("اتصال منبع به پایگاه خروجی ناموفق بود")
	}
	defer outDB.Exec(`DETACH DATABASE src`)

	// tokens با همان token_id کپی می‌شود تا نگاشت postings دست‌نخورده بماند
	if _, err := outDB.Exec(`INSERT INTO tokens(token_id, token) SELECT token_id, token FROM src.tokens`); err != nil {
		log.Fatal("کپی tokens:", err)
	}

	// ۳) بارگذاری ردیف‌های منبع در حافظه (fixture کوچک است؛ ~۱۲۰کیلوبایت متن)
	recs, err := loadPassages(srcDB)
	if err != nil {
		log.Fatal(err)
	}
	titles, err := loadTitles(srcDB)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("منبع: %d passage، %d title — ضریب تکرار: %d → هدف %d passage\n",
		len(recs), len(titles), *factor, len(recs)**factor)

	// ۴) کپی passages + postings + trigrams برای هر نسخه؛ یک تراکنش برای هر k
	// (تراکنش‌های chunk‌شده حافظهٔ WAL را محدود می‌کند)
	stmtP, err := outDB.Prepare(`INSERT INTO passages(passage_uid,release_uid,collection_uid,work_uid,document_uid,section_uid,page_uid,page_label,language,local_hadith_uid,revayat_index,text_original,text_n1,n1_map,source_start,source_end,role_ranges,citations,fingerprint,block_start,block_end)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		log.Fatal(err)
	}
	defer stmtP.Close()
	stmtPost, err := outDB.Prepare(`INSERT INTO postings(token_id, passage_uid, pos) SELECT token_id, ?, pos FROM src.postings WHERE passage_uid=?`)
	if err != nil {
		log.Fatal(err)
	}
	defer stmtPost.Close()
	stmtTri, err := outDB.Prepare(`INSERT INTO trigrams(tri, passage_uid) SELECT tri, ? FROM src.trigrams WHERE passage_uid=?`)
	if err != nil {
		log.Fatal(err)
	}
	defer stmtTri.Close()

	suffix := func(uid string, k int) string {
		if uid == "" {
			return ""
		}
		return fmt.Sprintf("%s-s%d", uid, k)
	}
	for k := 1; k <= *factor; k++ {
		tx, err := outDB.Begin()
		if err != nil {
			log.Fatal(err)
		}
		txP := tx.Stmt(stmtP)
		txPost := tx.Stmt(stmtPost)
		txTri := tx.Stmt(stmtTri)
		for i := range recs {
			r := &recs[i]
			newUID := suffix(r.passageUID, k)
			// local_hadith_uid شکل «documentUID:hadith» دارد — بخش سند پسوند می‌گیرد
			newHadith := r.localHadith
			if newHadith != "" {
				if j := strings.Index(newHadith, ":"); j >= 0 {
					newHadith = suffix(newHadith[:j], k) + newHadith[j:]
				}
			}
			if _, err := txP.Exec(newUID, scaleRelease, r.collectionUID, suffix(r.workUID, k),
				suffix(r.documentUID, k), suffix(r.sectionUID, k), suffix(r.pageUID, k), r.pageLabel,
				r.language, newHadith, r.revayatIdx, r.textOriginal, r.textN1, r.n1Map,
				r.sourceStart, r.sourceEnd, r.roleRanges, r.citations, r.fingerprint,
				r.blockStart, r.blockEnd); err != nil {
				log.Fatal("insert passage k=", k, ":", err)
			}
			if _, err := txPost.Exec(newUID, r.passageUID); err != nil {
				log.Fatal("copy postings k=", k, ":", err)
			}
			if _, err := txTri.Exec(newUID, r.passageUID); err != nil {
				log.Fatal("copy trigrams k=", k, ":", err)
			}
		}
		if err := tx.Commit(); err != nil {
			log.Fatal(err)
		}
		if k%50 == 0 || k == *factor {
			fmt.Printf("  نسخهٔ %d/%d …\n", k, *factor)
		}
	}

	// ۵) titles — هر عنوان factor بار با work_uid پسونددار و پسوند « - نسخهٔ {k}»
	// (جست‌وجوی نام کتاب هم باید در مقیاس سنجیده شود)
	stmtT, err := outDB.Prepare(`INSERT INTO titles(work_uid,title,title_n1,short_title,author,publisher,language,topics) VALUES(?,?,?,?,?,?,?,?)`)
	if err != nil {
		log.Fatal(err)
	}
	defer stmtT.Close()
	for k := 1; k <= *factor; k++ {
		tx, err := outDB.Begin()
		if err != nil {
			log.Fatal(err)
		}
		txT := tx.Stmt(stmtT)
		for i := range titles {
			t := &titles[i]
			wuid := suffix(t.workUID, k)
			v := fmt.Sprintf(" - نسخهٔ %d", k)
			title := t.title + v
			short := t.shortTitle + v
			if _, err := txT.Exec(wuid, title, norm.Fold(title), short, t.author, t.publisher, t.language, t.topics); err != nil {
				log.Fatal("insert title:", err)
			}
		}
		if err := tx.Commit(); err != nil {
			log.Fatal(err)
		}
	}

	// ۶) ایندکس‌ها در پایان — ساخت B-tree یکجا سریع‌تر از درج تدریجی است
	idxRows, err := srcDB.Query(`SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		log.Fatal(err)
	}
	type ix struct{ name, ddl string }
	var idxs []ix
	for idxRows.Next() {
		var i ix
		if err := idxRows.Scan(&i.name, &i.ddl); err != nil {
			log.Fatal(err)
		}
		idxs = append(idxs, i)
	}
	idxRows.Close()
	for _, i := range idxs {
		if _, err := outDB.Exec(i.ddl); err != nil {
			log.Fatal("ساخت ایندکس", i.name, ":", err)
		}
	}
	if _, err := outDB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		log.Println("checkpoint:", err)
	}

	// ۷) شمارش نهایی + اندازهٔ فایل — گزارش صادقانه
	count := func(q string) int {
		var n int
		if err := outDB.QueryRow(q).Scan(&n); err != nil {
			log.Fatal(q, err)
		}
		return n
	}
	fi, err := os.Stat(outAbs)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("انجام شد: release=%s passages=%d titles=%d trigrams=%d postings=%d tokens=%d indexes=%d size=%d bytes (%.1f MB)\n",
		scaleRelease,
		count(`SELECT COUNT(*) FROM passages`), count(`SELECT COUNT(*) FROM titles`),
		count(`SELECT COUNT(*) FROM trigrams`), count(`SELECT COUNT(*) FROM postings`),
		count(`SELECT COUNT(*) FROM tokens`), len(idxs), fi.Size(), float64(fi.Size())/(1<<20))
	fmt.Printf("release منبع دست‌نخورده ماند؛ خروجی: %s\n", outAbs)
}

// filepathAbs نام کوتاه‌شدهٔ filepath.Abs برای خوانایی.
func filepathAbs(p string) (string, error) { return filepath.Abs(p) }

func loadPassages(db *sql.DB) ([]rec, error) {
	rows, err := db.Query(`SELECT passage_uid, collection_uid, work_uid, document_uid, section_uid, page_uid, page_label,
                language, local_hadith_uid, revayat_index, text_original, text_n1, n1_map, source_start, source_end,
                role_ranges, citations, fingerprint, block_start, block_end
                FROM passages ORDER BY work_uid, document_uid, block_start, passage_uid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []rec
	for rows.Next() {
		var r rec
		var sec, pageUID, pageLabel, hadith, rev sql.NullString
		if err := rows.Scan(&r.passageUID, &r.collectionUID, &r.workUID, &r.documentUID, &sec, &pageUID, &pageLabel,
			&r.language, &hadith, &rev, &r.textOriginal, &r.textN1, &r.n1Map, &r.sourceStart, &r.sourceEnd,
			&r.roleRanges, &r.citations, &r.fingerprint, &r.blockStart, &r.blockEnd); err != nil {
			return nil, err
		}
		r.sectionUID = sec.String
		r.pageUID = pageUID.String
		r.pageLabel = pageLabel.String
		r.localHadith = hadith.String
		r.revayatIdx = rev.String
		out = append(out, r)
	}
	return out, rows.Err()
}

func loadTitles(db *sql.DB) ([]titleRec, error) {
	rows, err := db.Query(`SELECT work_uid, title, short_title, author, publisher, language, topics FROM titles ORDER BY work_uid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []titleRec
	for rows.Next() {
		var t titleRec
		var pub, lang, topics sql.NullString
		if err := rows.Scan(&t.workUID, &t.title, &t.shortTitle, &t.author, &pub, &lang, &topics); err != nil {
			return nil, err
		}
		t.publisher = pub.String
		t.language = lang.String
		t.topics = topics.String
		out = append(out, t)
	}
	return out, rows.Err()
}
