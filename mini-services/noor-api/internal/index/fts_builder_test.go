package index

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"noor/internal/norm"
	"noor/internal/xmlparse"
)

const testHadithXML = `<hadith id="h-101" revayatindex="112"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> قال</sanadHadith><p>قَالَ‌ رَسُولُ‌ اللَّهِ‌: إِيَّاكُمْ‌ وَ مُحَدَّثَاتِ‌ الأُمُورِ فَإِنَّ‌ كُلَّ‌ مُحْدَثَةٍ‌ بِدْعَةٌ‌ وَ كُلَّ‌ بِدْعَةٍ‌ ضَلاَلَةٌ‌ (C++) و «فالعلم» خيرٌ</p></hadith>`

func buildTestRelease(t *testing.T, dir, rel string) (*FTSIndexWriter, int) {
	t.Helper()
	writer, err := NewFTSIndexWriter(FTSShardOptions{ReleaseUID: rel, OutputDir: dir, NumShards: 2})
	if err != nil {
		t.Fatalf("NewFTSIndexWriter: %v", err)
	}
	model, err := xmlparse.ParseItems("d-001", []xmlparse.ItemInput{{ID: 1, XML: testHadithXML}})
	if err != nil {
		t.Fatalf("ParseItems: %v", err)
	}
	count, err := writer.WriteDocument(rel, "c-01", "w-01", "d-001", "ar", model)
	if err != nil {
		t.Fatalf("WriteDocument: %v", err)
	}
	if count == 0 {
		t.Fatal("expected at least 1 passage written")
	}
	if _, err := writer.WriteDocument("other-rel", "c-01", "w-01", "d-002", "ar", model); err == nil {
		t.Fatal("WriteDocument باید release ناهمخوان را رد کند")
	}
	writer.RecordFailure("d-bad", os.ErrInvalid)
	titles := []TitleRow{{WorkUID: "w-01", Title: "کتاب نمونه بحار", ShortTitle: "بحار", Author: "علامه مجلسی", Language: "ar"}}
	if err := writer.Finalize(titles); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
	return writer, count
}

func TestFTSIndexWriter(t *testing.T) {
	dir := t.TempDir()
	rel := "rel-test-1"
	writer, count := buildTestRelease(t, dir, rel)
	defer writer.Close()

	var passCount int
	if err := writer.mainDB.QueryRow(`SELECT COUNT(*) FROM passages`).Scan(&passCount); err != nil {
		t.Fatal(err)
	}
	if passCount != count {
		t.Errorf("passages = %d; want %d", passCount, count)
	}
	var docs, lo, hi int
	if err := writer.mainDB.QueryRow(`SELECT COUNT(*), MIN(seq_lo), MAX(seq_hi) FROM docs`).Scan(&docs, &lo, &hi); err != nil {
		t.Fatal(err)
	}
	if docs != 1 || lo != 1 || hi != count {
		t.Errorf("docs=%d seq=[%d,%d]; want 1 [1,%d]", docs, lo, hi, count)
	}

	// manifest
	m, err := ReadFTSManifest(writer.mainDB)
	if err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{
		"schema_version": FTSSchemaVersion, "norm_version": norm.Version, "docs_failed": "1", "reuse_hash": ReuseHashName,
	} {
		if m.Values[k] != want {
			t.Errorf("manifest[%s] = %q; want %q", k, m.Values[k], want)
		}
	}
	if !strings.Contains(m.Values["failures"], "d-bad") {
		t.Errorf("failures باید در manifest ثبت شود: %q", m.Values["failures"])
	}

	// واژگان: DF فقط از بدنه، هر N1 یک N2
	var n2 string
	if err := writer.mainDB.QueryRow(`SELECT n2 FROM vocabulary WHERE n1 = ?`, "فالعلم").Scan(&n2); err != nil {
		t.Fatalf("vocabulary فالعلم: %v", err)
	}
	if n2 != "فالعلم" {
		t.Errorf("N2 نباید پیشوند را کور حذف کند: %q", n2)
	}

	shardDBs := make([]*sql.DB, 2)
	for i := range shardDBs {
		db, err := sql.Open("sqlite", filepath.Join(dir, FTSShardFile(rel, i)))
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		shardDBs[i] = db
	}
	match := func(expr string) int {
		n := 0
		for _, db := range shardDBs {
			var c int
			if err := db.QueryRow(`SELECT count(*) FROM fts_phrase WHERE fts_phrase MATCH ?`, expr).Scan(&c); err != nil {
				t.Fatalf("MATCH %s: %v", expr, err)
			}
			n += c
		}
		return n
	}
	if match("n1_bi : "+norm.FTSPhrase([]string{"رسول" + norm.BigramSeparator + "الله"})) == 0 {
		t.Error("bigram رسول·الله یافت نشد")
	}
	if match("n1_bi : "+norm.FTSPhrase([]string{"رسول" + norm.BigramSeparator + "الله", "الله" + norm.BigramSeparator + "إیاکم"})) == 0 {
		t.Error("عبارت دوواژه‌ای پیاپی یافت نشد")
	}
	// n2k: «فالعلم» و «العلم» یک کلید دارند
	if match("n2k : "+norm.FTSPhrase([]string{norm.ReuseKey(norm.TokenizeAligned("العلم")[0].N2)})) == 0 {
		t.Error("ستون n2k باید «فالعلم» را با کلید «العلم» بیابد")
	}
	// توکن غیرحرفی ASCII (C++) باید با FTSToken نگاشت شده و قابل جست‌وجو باشد
	plus := norm.TokenizeAligned("C++")
	if len(plus) == 0 || match("n1 : "+norm.FTSPhrase([]string{plus[0].N1})) == 0 {
		t.Error("توکن C++ در FTS پیدا نشد (ناهم‌خوانی واژه‌بندی Go و FTS)")
	}

	// ناوردایی: تعداد نمونه‌های واژه در FTS = تعداد توکن‌های Go
	var goTokens int
	rows, err := writer.mainDB.Query(`SELECT text_original FROM passages`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		goTokens += len(norm.TokenizeAligned(s))
	}
	rows.Close()
	ftsTokens := 0
	for _, db := range shardDBs {
		if _, err := db.Exec(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.v USING fts5vocab(main, fts_phrase, 'col')`); err != nil {
			t.Fatalf("fts5vocab: %v", err)
		}
		var c sql.NullInt64
		if err := db.QueryRow(`SELECT sum(cnt) FROM temp.v WHERE col = 'n1'`).Scan(&c); err != nil {
			t.Fatal(err)
		}
		ftsTokens += int(c.Int64)
		var c2, c3 sql.NullInt64
		_ = db.QueryRow(`SELECT sum(cnt) FROM temp.v WHERE col = 'n1_bi'`).Scan(&c2)
		_ = db.QueryRow(`SELECT sum(cnt) FROM temp.v WHERE col = 'n2k'`).Scan(&c3)
		if c2.Int64 != c.Int64 || c3.Int64 != c.Int64 {
			t.Errorf("ستون‌های هم‌تراز طول برابر ندارند: n1=%d n1_bi=%d n2k=%d", c.Int64, c2.Int64, c3.Int64)
		}
	}
	if ftsTokens != goTokens {
		t.Errorf("FTS tokens = %d; Go tokens = %d (واژه‌بندی FTS باید ۱:۱ با Go باشد)", ftsTokens, goTokens)
	}

	var reuseCount int
	for _, db := range shardDBs {
		var c int
		_ = db.QueryRow(`SELECT COUNT(*) FROM reuse_postings`).Scan(&c)
		reuseCount += c
	}
	if reuseCount == 0 {
		t.Error("reuse_postings خالی است")
	}

	if paths, err := VerifyFTSRelease(dir, rel, true); err != nil || len(paths) != 2 {
		t.Errorf("VerifyFTSRelease: %v %v", err, paths)
	}
}

func TestFTSReleaseLifecycle(t *testing.T) {
	data := t.TempDir()
	for _, rel := range []string{"rel-a", "rel-b"} {
		w, _ := buildTestRelease(t, FTSBuildingDir(data, rel), rel)
		w.Close()
		if err := CommitFTSBuild(data, rel); err != nil {
			t.Fatalf("commit %s: %v", rel, err)
		}
		if err := PublishFTSRelease(data, rel, 2); err != nil {
			t.Fatalf("publish %s: %v", rel, err)
		}
	}
	if a, _ := ActiveFTSRelease(data); a != "rel-b" {
		t.Fatalf("ACTIVE = %q; want rel-b", a)
	}
	if prev, err := RollbackFTSRelease(data); err != nil || prev != "rel-a" {
		t.Fatalf("rollback = %q, %v", prev, err)
	}
	if a, _ := ActiveFTSRelease(data); a != "rel-a" {
		t.Fatalf("ACTIVE after rollback = %q; want rel-a", a)
	}
	// نسل ناقص نباید commit شود
	rel := "rel-broken"
	w, _ := buildTestRelease(t, FTSBuildingDir(data, rel), rel)
	w.Close()
	if err := os.Truncate(filepath.Join(FTSBuildingDir(data, rel), FTSShardFile(rel, 1)), 100); err != nil {
		t.Fatal(err)
	}
	if err := CommitFTSBuild(data, rel); err == nil {
		t.Fatal("commit نسل خراب باید شکست بخورد")
	}
	// انتشار نسل ناموجود
	if err := PublishFTSRelease(data, "rel-missing", 2); err == nil {
		t.Fatal("publish نسل ناموجود باید شکست بخورد")
	}
	// immutable: بازنویسی همان release ممنوع
	if _, err := NewFTSIndexWriter(FTSShardOptions{ReleaseUID: "rel-a", OutputDir: FTSReleaseDir(data, "rel-a")}); err == nil {
		t.Fatal("بازنویسی نسل موجود باید رد شود")
	}
}

// TestFTSBuildIsReproducible ساخت دوبارهٔ نسل با ورودی یکسان: seq، شارد و checksum شاردها یکسان.
func TestFTSBuildIsReproducible(t *testing.T) {
	sums := make([][]ShardFileInfo, 2)
	docs := make([]string, 2)
	for i := range sums {
		dir := t.TempDir()
		w, _ := buildTestRelease(t, dir, "rel-repro")
		var d strings.Builder
		rows, err := w.mainDB.Query(`SELECT doc_ord, document_uid, shard_id, seq_lo, seq_hi FROM docs ORDER BY doc_ord`)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var a, c, e, f int
			var b string
			_ = rows.Scan(&a, &b, &c, &e, &f)
			d.WriteString(strings.Join([]string{b, string(rune('0' + c)), string(rune('0' + e)), string(rune('0' + f))}, "/"))
		}
		rows.Close()
		docs[i] = d.String()
		m, err := ReadFTSManifest(w.mainDB)
		if err != nil {
			t.Fatal(err)
		}
		sums[i] = m.ShardFiles
		w.Close()
	}
	if docs[0] != docs[1] {
		t.Errorf("docs/seq/shard differ between builds: %q vs %q", docs[0], docs[1])
	}
	for i := range sums[0] {
		if sums[0][i].SHA256 != sums[1][i].SHA256 {
			t.Errorf("shard %d checksum differs between identical builds", i)
		}
	}
}

// TestRevertFTSPublish شکستِ مرحلهٔ بعد از انتشار (pointer app.sqlite) باید ACTIVE را به
// نسل قبلی برگرداند و PREVIOUSِ اشاره‌گر به نسل شکست‌خورده را پاک کند.
func TestRevertFTSPublish(t *testing.T) {
	data := t.TempDir()
	for _, rel := range []string{"rel-a", "rel-b"} {
		w, _ := buildTestRelease(t, FTSBuildingDir(data, rel), rel)
		w.Close()
		if err := CommitFTSBuild(data, rel); err != nil {
			t.Fatal(err)
		}
	}
	if err := PublishFTSRelease(data, "rel-a", 2); err != nil {
		t.Fatal(err)
	}
	if err := PublishFTSRelease(data, "rel-b", 2); err != nil {
		t.Fatal(err)
	}
	if err := RevertFTSPublish(data, "rel-b", "rel-a"); err != nil {
		t.Fatalf("RevertFTSPublish: %v", err)
	}
	if a, _ := ActiveFTSRelease(data); a != "rel-a" {
		t.Fatalf("ACTIVE = %q؛ انتظار rel-a", a)
	}
	if _, err := os.Stat(filepath.Join(FTSRoot(data), "PREVIOUS")); err == nil {
		t.Fatal("PREVIOUS نباید به نسل شکست‌خورده اشاره کند")
	}
	// نخستین انتشار شکست‌خورده: ACTIVE حذف می‌شود
	data2 := t.TempDir()
	w, _ := buildTestRelease(t, FTSBuildingDir(data2, "rel-x"), "rel-x")
	w.Close()
	_ = CommitFTSBuild(data2, "rel-x")
	_ = PublishFTSRelease(data2, "rel-x", 2)
	if err := RevertFTSPublish(data2, "rel-x", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := ActiveFTSRelease(data2); err != ErrNoActiveFTS {
		t.Fatalf("بدون نسل قبلی، ACTIVE باید حذف شود: %v", err)
	}
}
