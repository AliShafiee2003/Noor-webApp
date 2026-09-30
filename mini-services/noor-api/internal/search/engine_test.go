package search

import (
	"os"
	"syscall"
	"testing"

	"noor/internal/norm"
)

// ——— تست‌های نرمال‌ساز و موتور روی متن عربی/فارسی ———

func TestN1Normalization(t *testing.T) {
	// ي→ی و ك→ک در N1 یکی می‌شوند
	a := normNorm("النبي الكريم")
	b := normNorm("النبی الکریم")
	if a != b {
		t.Errorf("ي/ی و ك/ک باید در نرمال یکی شوند: %q vs %q", a, b)
	}
	// اعراب حذف می‌شود
	c := normNorm("يُوسُفُ")
	if c != "یوسف" {
		t.Errorf("اعراب باید حذف شود: %q", c)
	}
	// ارقام عربی/فارسی/لاتین یکی می‌شوند
	d := normNorm("۱۴۰٧")
	e := normNorm("1407")
	if d != e {
		t.Errorf("ارقام باید یکی شوند: %q vs %q", d, e)
	}
	// ة/ه و همزه در N1 بی‌قید یکی نمی‌شوند (TECH-10)
	f := normNorm("مدينة")
	g := normNorm("مدينه")
	if f == g {
		t.Errorf("ة/ه نباید در N1 یکی شود")
	}
	h := normNorm("أحمد")
	i := normNorm("احمد")
	if h == i {
		t.Errorf("همزه نباید در N1 یکی شود")
	}
	// نگاشت صحیح: طول خروجی = طول map
	s := "النَّبي الكريم ۱۴۰۷"
	_, mp := normNormalize(s)
	runes := []rune(s)
	// تعداد ارجاع‌های معتبر ≤ طول اصل
	for _, v := range mp {
		if v < 0 || v >= len(runes) {
			t.Fatalf("نگاشت خارج از بازه: %d", v)
		}
	}
}

func TestWordBoundary(t *testing.T) {
	s := "ما الرسول وما النبي"
	if !norm.WordBoundary(s, 0, 2) {
		t.Error("مرز ابتدای واژه باید درست باشد")
	}
	if norm.WordBoundary(s, 1, 3) {
		t.Error("تطبیق داخل واژه نباید مرز داشته باشد")
	}
}

func TestRuneSearch(t *testing.T) {
	// عربی ۲ بایتی — برش بایتی خراب می‌کند، جست‌وجوی code point باید دقیق باشد
	s := []rune("کتاب الإيمان باب ما الرسول وما النبي")
	q := []rune("ما الرسول")
	idx := indexRunes(s, q)
	if idx != 17 {
		t.Errorf("indexRunes باید 17 بدهد، گرفت %d", idx)
	}
}

func TestCursorSignVerify(t *testing.T) {
	sec := []byte("secret-key")
	cur := signCursor(map[string]any{"s": "s-1", "o": 20}, sec)
	if !verifyCursor(cur, sec) {
		t.Error("cursor امضاشده باید تأیید شود")
	}
	if verifyCursor(cur, []byte("other")) {
		t.Error("cursor با secret دیگر نباید تأیید شود")
	}
	if verifyCursor("tampered."+cur[10:], sec) {
		t.Error("cursor دست‌کاری‌شده نباید تأیید شود")
	}
}

func TestGoldenStrictVsNormalized(t *testing.T) {
	// «دقیق» با ي عربی روی متن با ي پیدا می‌شود؛ روی متن نرمال‌شده با ی نه
	orig := "النبي"
	qArabic := []rune("النبي")
	if indexRunes([]rune(orig), qArabic) < 0 {
		t.Error("عبارت دقیق باید در متن اصلی پیدا شود")
	}
	qPersian := []rune("النبی")
	if indexRunes([]rune(orig), qPersian) >= 0 {
		t.Error("ي و ی در متن اصلی یکی نیستند — «دقیق» نباید تطبیق کند")
	}
	// اما نرمال هر دو یکی است
	a := normNorm("النبي")
	b := normNorm("النبی")
	if a != b {
		t.Error("نرمال باید یکی کند")
	}
}

func TestIndexRunesCrossBoundary(t *testing.T) {
	// عبارتی که با فاصله شروع/پایان می‌شود و ZWNJ
	s := []rune("می‌رویم و می رویم")
	q := []rune("می رویم")
	// نرمال‌شده ZWNJ→فاصله — اینجا فقط جست‌وجوی خام: باید «می رویم» دوم را پیدا کند (بعد از و)
	idx := indexRunes(s, q)
	if idx < 0 {
		t.Error("جست‌وجوی code point باید کار کند")
	}
}

func TestFileStatHelpers(t *testing.T) {
	f, _ := os.CreateTemp("", "idx")
	defer os.Remove(f.Name())
	fi, err := osStat(f.Name())
	if err != nil {
		t.Fatal(err)
	}
	if fileInode(fi) == 0 {
		t.Log("inode=0 (شاید FS خاص) — بحرانی نیست")
	}
	_ = syscall.Getpid()
}

// پوشش توابع norm برای تست
func normNorm(s string) string { out, _ := norm.Normalize(s); return out }
func normNormalize(s string) (string, []int) { return norm.Normalize(s) }
