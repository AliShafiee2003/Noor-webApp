package research

// research_test.go — آزمون هم‌زمانی دادهٔ پژوهشی (DB-07/DB-08) و گریزِ LIKE (DB-09).
// همه‌چیز روی app.sqlite موقتِ t.TempDir اجرا می‌شود؛ هیچ DB واقعی لمس نمی‌شود.

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"noor/internal/store"
)

func sptr(s string) *string { return &s }

func researchTestService(t *testing.T) (*Service, string) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	s := New(db)
	// کاربر پایه — FKها فعال‌اند (foreign_keys=1 روی DSN)
	if _, err := s.db.Exec(`INSERT INTO users(uid, username, username_norm, display_name, password_hash, role)
                VALUES('usr-u1', 'u1', 'u1', 'کاربر یک', 'x', 'reader')`); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	p, err := s.CreateProject("usr-u1", "پروندهٔ آزمون")
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	return s, p.UID
}

func researchTestClip(t *testing.T, s *Service, projectUID string) *Clip {
	t.Helper()
	c, err := s.CreateClip("usr-u1", &ClipInput{
		ProjectUID:    projectUID,
		Kind:          "original",
		QuoteOriginal: "نقل‌قول آزمون",
		Note:          sptr("یادداشت"),
		Tags:          []string{"علم"},
		Source:        ClipSource{WorkUID: "w-x", DocumentUID: "doc-x"},
	})
	if err != nil {
		t.Fatalf("CreateClip: %v", err)
	}
	return c
}

// DB-08: تعارض نسخهٔ کهنه باید 409 قابل‌تشخیص بدهد و اثر جانبی (تاریخچه) باقی نماند.
func TestUpdateClipConflictOnStaleVersion(t *testing.T) {
	s, prj := researchTestService(t)
	c := researchTestClip(t, s, prj)

	note := "نسخهٔ جدید"
	up, err := s.UpdateClip("usr-u1", c.UID, c.Version, &note, nil, nil, nil)
	if err != nil {
		t.Fatalf("به‌روزرسانی نخست باید موفق باشد: %v", err)
	}
	if up.Version != c.Version+1 {
		t.Fatalf("نسخه باید +۱ شود: got %d want %d", up.Version, c.Version+1)
	}

	// کلاینت دوم هنوز نسخهٔ کهنه را دارد
	_, err = s.UpdateClip("usr-u1", c.UID, c.Version, &note, nil, nil, nil)
	if err == nil {
		t.Fatal("به‌روزرسانی با نسخهٔ کهنه باید خطا بدهد")
	}
	var cf *ErrConflict
	if !errors.As(err, &cf) {
		t.Fatalf("خطا باید ErrConflict باشد: %v", err)
	}
	if cf.CurrentVersion != c.Version+1 {
		t.Fatalf("CurrentVersion نادرست: got %d want %d", cf.CurrentVersion, c.Version+1)
	}
	// تاریخچهٔ نیم‌نوشته از مسیر تعارض نباید مانده باشد (rollback کامل)
	var revs int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM clip_revisions WHERE clip_uid=?`, c.UID).Scan(&revs); err != nil {
		t.Fatal(err)
	}
	if revs != 1 {
		t.Fatalf("تاریخچه باید فقط یک رکوردِ موفق داشته باشد؛ got %d", revs)
	}
}

// DB-08 — هستهٔ یافته: چند ویرایش هم‌زمان با یک نسخهٔ واحد باید دقیقاً یک
// برنده داشته باشد؛ بقیه ErrConflict (چه از بررسی اولیه چه از RowsAffected
// مسیر race بین خواندن و UPDATE نهایی). موفقیتِ بی‌صدا ممنوع.
func TestUpdateClipConcurrentExactlyOneWinner(t *testing.T) {
	s, prj := researchTestService(t)
	c := researchTestClip(t, s, prj)

	const racers = 8
	note := "ویرایش هم‌زمان"
	var wg sync.WaitGroup
	errs := make([]error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = s.UpdateClip("usr-u1", c.UID, c.Version, &note, nil, nil, nil)
		}(i)
	}
	wg.Wait()

	winners, conflicts := 0, 0
	for _, err := range errs {
		var cf *ErrConflict
		switch {
		case err == nil:
			winners++
		case errors.As(err, &cf):
			conflicts++
		default:
			t.Fatalf("خطای غیرمنتظره (busy_timeout باید کافی باشد): %v", err)
		}
	}
	if winners != 1 || conflicts != racers-1 {
		t.Fatalf("دقیقاً یک برنده باید باشد؛ winners=%d conflicts=%d", winners, conflicts)
	}
	final, err := s.GetClip("usr-u1", c.UID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Version != c.Version+1 {
		t.Fatalf("نسخهٔ نهایی نادرست: %d", final.Version)
	}
	var revs int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM clip_revisions WHERE clip_uid=?`, c.UID).Scan(&revs); err != nil {
		t.Fatal(err)
	}
	if revs != 1 {
		t.Fatalf("هر برنده فقط یک رکورد تاریخچه؛ got %d", revs)
	}
}

// DB-07 — merge ترجیحات/موضع مثل قبل کار می‌کند: merge سطح‌بالای Prefs
// (همان معناشناسی قدیمی، عمداً بدون تغییر) و پیش‌فرض‌ها برای کلیدهای غایب.
func TestPutWorkspaceMerge(t *testing.T) {
	s, _ := researchTestService(t)

	if err := s.PutPosition("usr-u1", "doc-1", map[string]any{"page_uid": "p-1", "progress": 0.5}); err != nil {
		t.Fatalf("PutPosition: %v", err)
	}
	if err := s.PutPrefs("usr-u1", map[string]any{"theme": "dark"}); err != nil {
		t.Fatalf("PutPrefs: %v", err)
	}
	ws, err := s.GetWorkspace("usr-u1")
	if err != nil {
		t.Fatal(err)
	}
	pos, ok := ws.Positions["doc-1"].(map[string]any)
	if !ok || pos["page_uid"] != "p-1" || pos["progress"] != float64(0.5) {
		t.Fatalf("موضع ذخیره نشده: %#v", ws.Positions)
	}
	if ws.Prefs["theme"] != "dark" {
		t.Fatalf("ترجیح تازه ذخیره نشده: %#v", ws.Prefs)
	}
	// کلیدهای غایب = پیش‌فرض‌های سرویس (نه حذف)
	reader, ok := ws.Prefs["reader"].(map[string]any)
	if !ok || reader["font_size"] != float64(22) || reader["font_family"] != "amiri" || reader["display"] != "paged" {
		t.Fatalf("پیش‌فرض‌های ترجیحات باید حفظ شوند: %#v", reader)
	}
	// کلید تودرتو در سطح اول مثل قبل «جایگزین کامل» می‌شود (معناشناسی شالود، عمداً محفوظ)
	if err := s.PutPrefs("usr-u1", map[string]any{"reader": map[string]any{"font_size": 30}}); err != nil {
		t.Fatalf("PutPrefs دوم: %v", err)
	}
	ws2, err := s.GetWorkspace("usr-u1")
	if err != nil {
		t.Fatal(err)
	}
	if r2, _ := ws2.Prefs["reader"].(map[string]any); r2["font_size"] != float64(30) {
		t.Fatalf("کلید reader باید طبق قرارداد فعلی جایگزین شود: %#v", ws2.Prefs["reader"])
	}
	if ws2.Positions["doc-1"] == nil {
		t.Fatal("نوشتن دوم prefs نباید positions را گم کند")
	}
}

// DB-07 — هستهٔ یافته: نوشتن هم‌زمان position و prefs نباید هیچ به‌روزرسانی
// را گم کند (اتمیک‌بودن خواندن-نوشتن در BEGIN IMMEDIATE).
func TestPutWorkspaceConcurrentNoLostUpdate(t *testing.T) {
	s, _ := researchTestService(t)

	const n = 12
	var wg sync.WaitGroup
	errCh := make(chan error, 2*n)
	for i := 0; i < n; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			errCh <- s.PutPosition("usr-u1", fmt.Sprintf("doc-%02d", i), map[string]any{"progress": i})
		}(i)
		go func(i int) {
			defer wg.Done()
			errCh <- s.PutPrefs("usr-u1", map[string]any{fmt.Sprintf("key-%02d", i): i})
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("نوشتن هم‌زمان میزکار نباید خطا بدهد (busy_timeout کافی است): %v", err)
		}
	}
	ws, err := s.GetWorkspace("usr-u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(ws.Positions) != n {
		t.Fatalf("lost update در positions: %d از %d", len(ws.Positions), n)
	}
	for i := 0; i < n; i++ {
		key := fmt.Sprintf("key-%02d", i)
		if _, ok := ws.Prefs[key]; !ok {
			t.Fatalf("lost update در prefs: کلید %s گم شد", key)
		}
	}
}

func TestLikeEscape(t *testing.T) {
	got := likeEscape(`50%_off\d`)
	want := `50\%\_off\\d`
	if got != want {
		t.Fatalf("likeEscape نادرست: got %q want %q", got, want)
	}
	if likeEscape("یادداشت معمولی") != "یادداشت معمولی" {
		t.Fatal("رشتهٔ معمولی نباید تغییر کند")
	}
}

// DB-09 — ورودی با % و _ دیگر wildcard نیست و تطبیق برچسب «عضو دقیق» است.
func TestListClipsFilteringWithWildcardsAndTags(t *testing.T) {
	s, prj := researchTestService(t)

	seed := []struct {
		note string
		tags []string
	}{
		{note: "دربارهٔ کعبه"},
		{note: "a_c"},
		{note: "a%bc"},
		{tags: []string{"علم"}},
		{tags: []string{"علم کلام"}},
	}
	for _, in := range seed {
		_, err := s.CreateClip("usr-u1", &ClipInput{
			ProjectUID:    prj,
			Kind:          "original",
			QuoteOriginal: "q",
			Note:          sptr(in.note),
			Tags:          in.tags,
		})
		if err != nil {
			t.Fatalf("CreateClip(%v): %v", in, err)
		}
	}

	cases := []struct {
		q, tag string
		want   int
		why    string
	}{
		{q: "_", want: 1, why: "زیرخطِ تنها فقط ردیفِ دارای _ واقعی را می‌گیرد (قبلاً wildcard بود و همه را می‌گرفت)"},
		{q: "a_c", want: 1, why: "الگوی a_c دیگر aXc را نمی‌گیرد؛ فقط a_c واقعی"},
		{q: "%", want: 1, why: "درصدِ تنها فقط ردیفِ دارای % واقعی را می‌گیرد"},
		{q: "a%bc", want: 1, why: "رشتهٔ دارای % دقیق پیدا می‌شود"},
		{q: "کعبه", want: 1, why: "رفتار رشتهٔ معمولی (شامل) بدون تغییر"},
		{tag: "علم", want: 1, why: "برچسب «علم» برچسب «علم کلام» را نمی‌گیرد"},
		{tag: "علم کلام", want: 1, why: "برچسب دقیق خودش را می‌گیرد"},
		{tag: "ناموجود", want: 0, why: "برچسب غایب بی‌نتیجه"},
	}
	for _, tc := range cases {
		items, err := s.ListClips("usr-u1", prj, "", tc.q, tc.tag)
		if err != nil {
			t.Fatalf("ListClips(q=%q tag=%q): %v", tc.q, tc.tag, err)
		}
		if len(items) != tc.want {
			t.Fatalf("ListClips(q=%q tag=%q) = %d، want %d — %s", tc.q, tc.tag, len(items), tc.want, tc.why)
		}
	}
	// نمای «همهٔ فیش‌های من» همین قرارداد را دارد (همان builder شرط)
	_, total, err := s.ListMyClips("usr-u1", "", "", "علم")
	if err != nil {
		t.Fatalf("ListMyClips: %v", err)
	}
	if total != 1 {
		t.Fatalf("ListMyClips tag=علم total = %d، want 1", total)
	}
}
