package search

// رگرسیون یافته‌های بازماندهٔ ممیزی که در round-17 رفع شدند — انتظار: رفتار مطلوب.
// (۱) near دیگر شمارش دکارتیِ بی‌کران نیست؛ (۲) سقف مواضع هر قطعه بی‌اعلام نمانده است.

import (
	"context"
	"strings"
	"testing"
	"time"
)

// ---- (۱) nearWindows: کران‌داری و معناشناسی ----

// TestNearWindowsBounded worst-case قدیمی: دو واژهٔ فراگیر با ۲۰۰هزار موضع.
// شمارش دکارتیِ قبلی ‏4×10^10‎ ترکیب می‌ساخت؛ الگوریتم جدید باید در کسری از ثانیه تمام شود.
func TestNearWindowsBounded(t *testing.T) {
	const n = 200000
	p1 := make([]int, n)
	p2 := make([]int, n)
	for i := 0; i < n; i++ {
		p1[i] = i * 100
		p2[i] = i*100 + 3
	}
	positions := [][]int{p1, p2}
	start := time.Now()
	wins, more := nearWindows(positions, 1, false, 1<<30)
	el := time.Since(start)
	if el > 2*time.Second {
		t.Fatalf("near باید کران‌دار باشد؛ %v طول کشید", el)
	}
	if len(wins) != 10 {
		t.Fatalf("سقف near=10 انتظار؛ گرفت %d", len(wins))
	}
	if !more {
		t.Fatal("با پنجره‌های بیشتر از سقف، پرچم برش باید true باشد")
	}
	// ordered هم باید کران‌دار باشد
	start = time.Now()
	winsO, moreO := nearWindows(positions, 1, true, 1<<30)
	elO := time.Since(start)
	if elO > 2*time.Second {
		t.Fatalf("near ordered باید کران‌دار باشد؛ %v طول کشید", elO)
	}
	if len(winsO) != 10 || !moreO {
		t.Fatalf("ordered: 10/true انتظار؛ گرفت %d/%v", len(winsO), moreO)
	}
}

// TestNearWindowsSemantics معناشناسی پنجره حفظ شده: span ≤ slop*6 و ordered نزول‌نپذیر.
func TestNearWindowsSemantics(t *testing.T) {
	// مواضع: واژهٔ ۱ در 10 و 100؛ واژهٔ ۲ در 12 و 104.
	// پایان خروجی = بیشینهٔ موضع + شمار مواضع واژهٔ آخر (فرمول مرجعِ رفتار پیشین).
	positions := [][]int{{10, 100}, {12, 104}}
	// slop=1 → lim=6: جفت‌های (10,12) و (100,104) هر دو معتبرند
	wins, _ := nearWindows(positions, 1, false, 1000)
	if len(wins) != 2 || wins[0][0] != 10 || wins[0][1] != 14 {
		t.Fatalf("پنجره‌های (10,14)+(100,106) انتظار؛ گرفت %v", wins)
	}
	if wins[1][0] != 100 || wins[1][1] != 106 {
		t.Fatalf("پنجرهٔ دوم (100,106) انتظار؛ گرفت %v", wins)
	}
	// slop=2 → lim=12: همان دو جفت هنوز معتبرند
	wins, _ = nearWindows(positions, 2, false, 1000)
	if len(wins) != 2 {
		t.Fatalf("دو پنجره انتظار؛ گرفت %v", wins)
	}
	// unordered پنجره می‌یابد که ordered با ترتیب وارونه نمی‌یابد:
	// واژهٔ ۱ در 12 و 104؛ واژهٔ ۲ در 10 و 100 → زنجیرهٔ صعودی توکن‌محور وجود ندارد
	posRev := [][]int{{12, 104}, {10, 100}}
	wins, _ = nearWindows(posRev, 2, false, 1000)
	if len(wins) != 2 {
		t.Fatalf("unordered: دو پنجره انتظار؛ گرفت %v", wins)
	}
	wins, _ = nearWindows(posRev, 2, true, 1000)
	if len(wins) != 0 {
		t.Fatalf("ordered با ترتیب وارونه باید صفر باشد؛ گرفت %v", wins)
	}
	// ordered هم‌جهت: زنجیرهٔ 10→12 و 100→104
	wins, _ = nearWindows(positions, 1, true, 1000)
	if len(wins) != 2 || wins[0][0] != 10 || wins[1][0] != 100 {
		t.Fatalf("ordered: دو زنجیرهٔ صعودی انتظار؛ گرفت %v", wins)
	}
	// واژهٔ حاضر نیست → هیچ
	wins, more := nearWindows([][]int{{1}, {}}, 5, false, 1000)
	if wins != nil || more {
		t.Fatal("واژهٔ غایب = هیچ پنجره‌ای")
	}
}

// TestNearTruncationFlag پرچم برش دقیقاً در (سقف+۱)-مین پنجره فعال می‌شود.
func TestNearTruncationFlag(t *testing.T) {
	// 15 لنگرِ مستقل با فاصلهٔ زیاد → 15 پنجرهٔ مجاز
	p1 := make([]int, 15)
	p2 := make([]int, 15)
	for i := 0; i < 15; i++ {
		p1[i] = i * 1000
		p2[i] = i*1000 + 2
	}
	wins, more := nearWindows([][]int{p1, p2}, 1, false, 1<<30)
	if len(wins) != 10 || !more {
		t.Fatalf("10 پنجره + برش انتظار؛ گرفت %d/%v", len(wins), more)
	}
	// فقط 5 لنگر → بدون برش
	wins, more = nearWindows([][]int{p1[:5], p2[:5]}, 1, false, 1<<30)
	if len(wins) != 5 || more {
		t.Fatalf("5 پنجره بدون برش انتظار؛ گرفت %d/%v", len(wins), more)
	}
}

// ---- (۲) صداقت سقف ۵۰ مواضع هر قطعه ----

// TestPerPassageHitCapHonesty قطعه‌ای با ۶۰ رخدادِ عبارت → ۵۰ نتیجه،
// CountRelation=lower_bound و Notice برش — هرگز «exact/کامل» کاذب (ممیزی: سقف بی‌اعلام).
func TestPerPassageHitCapHonesty(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 60; i++ {
		b.WriteString("عبارت ")
	}
	path, cleanup := buildMultiTextIndex(t, []string{b.String()})
	defer cleanup()
	eng := NewLocal(path, []byte("k"), fakeMeta{}, WithLimits(1000, time.Minute))
	resp, err := eng.Search(context.Background(), &Request{Query: "عبارت", Mode: NormalizedPhrase, Scope: Scope{Target: "library"}}, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	if resp.VerifiedOccurrences != 50 {
		t.Fatalf("۵۰ موضع تأییدشده (سقف هر قطعه) انتظار؛ گرفت %d", resp.VerifiedOccurrences)
	}
	if len(resp.Results) != 20 { // صفحهٔ پیش‌فرض ۲۰ است؛ شمارش کامل در VerifiedOccurrences
		t.Fatalf("۲۰ نتیجهٔ صفحه انتظار؛ گرفت %d", len(resp.Results))
	}
	if resp.CountRelation != "lower_bound" {
		t.Fatalf("با برش قطعه، lower_bound انتظار؛ گرفت %s", resp.CountRelation)
	}
	if !strings.Contains(resp.Notice, "برش خورد") {
		t.Fatalf("Notice برش انتظار می‌رفت: %q", resp.Notice)
	}
}
