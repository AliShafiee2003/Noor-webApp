package search

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noor/internal/index"
	"noor/internal/norm"
	"noor/internal/xmlparse"
)

// ——— تست‌های ب-۵/ب-۶ (سقف نتایج، نشست SQLite، re-execute) و الف-۳ (trigram) ———

// buildMultiTextIndex نمایهٔ کوچک با چند passage دلخواه می‌سازد (شامل trigram)؛
// هر متن = یک صفحه = یک passage (مستقل برای شمارش‌ها).
func buildMultiTextIndex(t *testing.T, texts []string) (string, func()) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "index.sqlite")
	db, err := index.OpenWrite(path)
	if err != nil {
		t.Fatal(err)
	}
	w := &index.IndexWriter{DB: db}
	var blocks []xmlparse.Block
	var pages []xmlparse.PageRec
	for i, txt := range texts {
		blocks = append(blocks, xmlparse.Block{
			ID:            fmt.Sprintf("b-%03d", i),
			Type:          "hadith_body",
			Text:          txt,
			SourceOffsets: [2]int{i * 1000, i*1000 + len([]rune(txt))},
		})
		pages = append(pages, xmlparse.PageRec{UID: fmt.Sprintf("p-%03d", i), Label: fmt.Sprint(i + 1), Num: fmt.Sprint(i + 1), Serial: i, StartBlock: i, EndBlock: i})
	}
	m := &xmlparse.DocModel{DocumentUID: "d-t", Text: strings.Join(texts, "\n"), Blocks: blocks, Pages: pages}
	docs := []index.DocInput{{CollectionUID: "c-t", WorkUID: "w-t", DocumentUID: "d-t", Language: "ar", Model: m}}
	if _, err := w.Rebuild("rel-test", docs, []index.TitleRow{{WorkUID: "w-t", Title: "کار آزمون", ShortTitle: "کار", Author: "مؤلف آزمون", Language: "ar"}}, nil); err != nil {
		t.Fatal(err)
	}
	cleanup := func() { _ = db.Close() }
	return path, cleanup
}

func TestStrictPhraseTrigramPrefilterParity(t *testing.T) {
	// رفتار نتایج نباید تغییر کند: نتیجهٔ پیش‌فیلتر trigram باید با اسکن کامل یکی باشد (الف-۳)
	texts := []string{
		"هذا نصٌّ عن الكعبة بيت الله في أول الفصل",
		"نصّ دیگر بدون عبارت موردنظر",
		"و هذا هم الكعبةَ بيت الله در وسط جمله", // اعراب: تطبیق دقیق خام نمی‌دهد ولی token n1 دارد
		"الكعبة بيت الله ثانیاً و باز هم الكعبة بيت الله",
	}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{})
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	req := &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: Scope{Target: "library"}, PageSize: 20}
	got, capped, err := eng.run(context.Background(), db, req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	if capped {
		t.Fatal("سقف نباید فعال می‌شد")
	}
	// اسکن کامل = مرجع
	rows, err := db.Query(`SELECT `+candCols+` FROM passages WHERE release_uid=? ORDER BY work_uid, document_uid, block_start`, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var expected []Result
	seen := map[string]bool{}
	for rows.Next() {
		var r candRow
		if err := scanCand(rows, &r); err != nil {
			t.Fatal(err)
		}
		hits, matchType := verifyInText(req, &r)
		for _, h := range hits {
			key := fmt.Sprint(r.SourceStart+h.Range[0]) + ":" + fmt.Sprint(r.SourceStart+h.Range[1])
			if seen[key] {
				continue
			}
			seen[key] = true
			expected = append(expected, eng.toResult(&r, h, matchType))
		}
	}
	if len(got) != len(expected) {
		t.Fatalf("تعداد نتایج trigram=%d با اسکن کامل=%d یکی نیست", len(got), len(expected))
	}
	for i := range got {
		if got[i].MatchRange != expected[i].MatchRange {
			t.Errorf("بازهٔ تطبیق %d: %v با %v یکی نیست", i, got[i].MatchRange, expected[i].MatchRange)
		}
	}
	if len(got) != 3 {
		t.Errorf("انتظار ۳ تطبیق دقیق (یکی دو بار در متن چهارم)، گرفت %d", len(got))
	}
}

func TestMaxResultsCap(t *testing.T) {
	// ب-۵: سقف کل نتایج؛ فعال‌شدن سقف → lower_bound صادقانه
	texts := make([]string, 0, 40)
	for i := 0; i < 40; i++ {
		texts = append(texts, fmt.Sprintf("النص رقم %d ذكر الرسول مرارا في هذا السطر الطويل بما يكفي", i))
	}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{}, WithLimits(7, time.Minute))
	req := &Request{Query: "الرسول", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 5}
	resp, err := eng.Search(context.Background(), req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	if resp.VerifiedOccurrences != 7 {
		t.Errorf("سقف ۷ رعایت نشد: %d", resp.VerifiedOccurrences)
	}
	if resp.CountRelation != "lower_bound" {
		t.Errorf("count_relation باید lower_bound باشد: %s", resp.CountRelation)
	}
	if resp.Notice == "" || !strings.Contains(resp.Notice, "سقف") {
		t.Errorf("پیام فارسی سقف صادقانه لازم است: %q", resp.Notice)
	}
	if !resp.ContinuationAvailable {
		t.Error("در حالت سقف باید ادامهٔ صفحه‌بندی تا سقف ممکن باشد")
	}
}

func TestContinueReexecuteParity(t *testing.T) {
	// ب-۶: صفحه‌بندی با re-execute باید دقیقاً همان صفحه‌های آرایهٔ کامل را بدهد
	texts := make([]string, 0, 30)
	for i := 0; i < 30; i++ {
		texts = append(texts, fmt.Sprintf("سطر شمارهٔ %d حاوی كلمة علم در جایگاه متفاوت از متن", i))
	}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{})
	req := &Request{Query: "علم", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 4}
	resp, err := eng.Search(context.Background(), req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	total := resp.VerifiedOccurrences
	if total < 10 {
		t.Fatalf("دادهٔ آزمون باید ≥۱۰ تطبیق داشته باشد؛ %d", total)
	}
	// صفحه‌بندی تا انتها
	var collected []Result
	collected = append(collected, resp.Results...)
	cursor := resp.NextCursor
	sid := resp.SessionUID
	pages := 1
	for resp.ContinuationAvailable {
		resp, err = eng.Continue(context.Background(), sid, cursor, "rel-test")
		if err != nil {
			t.Fatal(err)
		}
		collected = append(collected, resp.Results...)
		cursor = resp.NextCursor
		pages++
		if pages > 50 {
			t.Fatal("حلقهٔ بی‌پایان صفحه‌بندی")
		}
	}
	if len(collected) != total {
		t.Fatalf("جمع صفحه‌ها=%d با کل=%d یکی نیست", len(collected), total)
	}
	for i, r := range collected {
		if r.MatchRange == [2]int{0, 0} {
			t.Errorf("نتیجهٔ %d بدون بازهٔ تطبیق", i)
		}
	}
}

func TestSessionGoneAfterTTL(t *testing.T) {
	// رفتار GoneError برای انقضا حفظ شود (ب-۶)
	texts := []string{"نصّی دربارهٔ العلم در اینجا"}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{}, WithLimits(0, 30*time.Millisecond))
	req := &Request{Query: "العلم", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 5}
	resp, err := eng.Search(context.Background(), req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	_, err = eng.Continue(context.Background(), resp.SessionUID, resp.NextCursor, "rel-test")
	if _, ok := err.(*GoneError); !ok {
		t.Fatalf("باید GoneError بدهد؛ گرفت: %v", err)
	}
}

func TestSessionStoreSQLite(t *testing.T) {
	// نشست در SQLite (همان قرارداد store.DB) — با پیاده‌سازی سبک روی فایل موقت
	texts := []string{"نصّی دربارهٔ العلم در اینجا", "العلم بار دوم"}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	dbFile := filepath.Join(t.TempDir(), "app.sqlite")
	sdb, err := sql.Open("sqlite", "file:"+dbFile+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer sdb.Close()
	if _, err := sdb.Exec(`CREATE TABLE search_sessions(uid TEXT PRIMARY KEY, release_uid TEXT NOT NULL, request TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), expire_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	st := &sqliteSessionStoreForTest{db: sdb}
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{}, WithSessionStore(st))
	req := &Request{Query: "العلم", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 5}
	resp, err := eng.Search(context.Background(), req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	// نشست باید در SQLite باشد
	var n int
	if err := sdb.QueryRow(`SELECT COUNT(*) FROM search_sessions WHERE uid=?`, resp.SessionUID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("نشست باید در SQLite ذخیره می‌شد (n=%d err=%v)", n, err)
	}
	if resp.VerifiedOccurrences != 2 {
		t.Fatalf("با دو passage مستقل انتظار ۲ تطبیق است؛ %d", resp.VerifiedOccurrences)
	}
	// Continue با re-execute از SQLite
	if resp.ContinuationAvailable {
		r2, err := eng.Continue(context.Background(), resp.SessionUID, resp.NextCursor, "rel-test")
		if err != nil {
			t.Fatal(err)
		}
		_ = r2
	}
	// BooksGrouped هم از همان نشست
	groups, err := eng.BooksGrouped(context.Background(), resp.SessionUID)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].Work.UID != "w-t" {
		t.Errorf("گروه‌بندی از نشست SQLite درست نیست: %+v", groups)
	}
	if len(groups) == 1 && groups[0].Documents[0].VerifiedOccurrences != 2 {
		t.Errorf("شمار گروه‌بندی باید ۲ باشد؛ %d", groups[0].Documents[0].VerifiedOccurrences)
	}
}

// sqliteSessionStoreForTest قرارداد SessionStore را همان‌طور که store.DB می‌سازد رعایت می‌کند.
type sqliteSessionStoreForTest struct{ db *sql.DB }

func (s *sqliteSessionStoreForTest) SaveSearchSession(uid, releaseUID string, reqJSON []byte, ttl time.Duration) error {
	_, _ = s.db.Exec(`DELETE FROM search_sessions WHERE expire_at < datetime('now')`)
	_, err := s.db.Exec(`INSERT INTO search_sessions(uid, release_uid, request, expire_at)
                VALUES(?,?,?, datetime('now', ?))
                ON CONFLICT(uid) DO UPDATE SET release_uid=excluded.release_uid, request=excluded.request, expire_at=excluded.expire_at`,
		uid, releaseUID, string(reqJSON), fmt.Sprintf("+%d seconds", int(ttl.Seconds())))
	return err
}

func (s *sqliteSessionStoreForTest) LoadSearchSession(uid string) (string, []byte, error) {
	var release, req string
	err := s.db.QueryRow(`SELECT release_uid, request FROM search_sessions WHERE uid=? AND expire_at >= datetime('now')`, uid).Scan(&release, &req)
	if err != nil {
		return "", nil, err
	}
	return release, []byte(req), nil
}

func (s *sqliteSessionStoreForTest) TouchSearchSession(uid string, ttl time.Duration) error {
	_, err := s.db.Exec(`UPDATE search_sessions SET expire_at=datetime('now', ?) WHERE uid=?`,
		fmt.Sprintf("+%d seconds", int(ttl.Seconds())), uid)
	return err
}

func TestMemSessionEvictionPerSession(t *testing.T) {
	// تخلیهٔ per-session جای تخلیهٔ کلی (ب-۵): نشست‌های تازه نباید با پر شدن سقف از بین بروند
	path, cleanup := buildMultiTextIndex(t, []string{"نصّی دربارهٔ العلم"})
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{})
	req := &Request{Query: "العلم", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 5}
	var first string
	for i := 0; i < maxMemSessions+50; i++ {
		resp, err := eng.Search(context.Background(), req, "rel-test")
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = resp.SessionUID
		}
	}
	// قدیمی‌ترین حذف شده (تخلیهٔ LRU-مانند) — ولی map یکجا خالی نشده
	eng.mu.Lock()
	n := len(eng.memSess)
	_, firstAlive := eng.memSess[first]
	eng.mu.Unlock()
	if n == 0 {
		t.Error("تخلیهٔ کلی ممنوع است — باید نشست‌های تازه باقی بمانند")
	}
	if firstAlive {
		t.Error("قدیمی‌ترین نشست باید تخلیه شده باشد")
	}
}

func TestTrigramQuerySoundness(t *testing.T) {
	// سه‌گانهٔ عبارت باید زیرمجموعهٔ سه‌گانه‌های n1 عبارت‌دار باشد
	q := "الكعبة بيت الله"
	qN, _ := norm.Normalize(q)
	tris := norm.Trigrams(qN)
	if len(tris) == 0 {
		t.Fatal("سه‌گانه‌ها خالی است")
	}
	text := "النص عن الكعبة بيت الله في المدينة"
	tN, _ := norm.Normalize(text)
	tSet := map[string]bool{}
	for _, tr := range norm.Trigrams(tN) {
		tSet[tr] = true
	}
	for _, tr := range tris {
		if !tSet[tr] {
			t.Errorf("سه‌گانهٔ %q از عبارت در متنِ دارای تطبیق نیست — صدا شکسته است", tr)
		}
	}
}

func TestCursorPayloadValidation(t *testing.T) {
	// cursor نشست دیگر نباید برای ادامهٔ نشست فعلی بپذیرفته شود (سخت‌گیری امنیتی)
	texts := []string{"نصّ العلم اول", "نصّ العلم دوم"}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{})
	req := &Request{Query: "العلم", Mode: AllWords, Scope: Scope{Target: "library"}, PageSize: 5}
	resp, err := eng.Search(context.Background(), req, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	// cursor نشست دیگر با امضای درست
	other := signCursor(map[string]any{"s": "s-other", "o": 1}, eng.Secret)
	if _, err := eng.Continue(context.Background(), resp.SessionUID, other, "rel-test"); err == nil {
		t.Error("cursor متعلق به نشست دیگر باید رد شود")
	}
}

func TestMain(m *testing.M) {
	// تضمین تمیزکاری tmp
	os.Exit(m.Run())
}
