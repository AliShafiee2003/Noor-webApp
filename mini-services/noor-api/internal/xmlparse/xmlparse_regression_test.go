package xmlparse

// xmlparse_regression_test.go — رگرسیون‌های DB-02 و DB-03 (دور ۱۶-b):
// ۱) پیوستگی و درستی SourceOffsets پس از حذف بازشماری O(n²) متن انباشته —
//    برون‌داد مدل باید بایت‌به‌بایت با الگوریتم قدیمی یکی باشد.
// ۲) خطاهای decoder XML دیگر بی‌صدا EOF پنداشته نمی‌شوند؛ فقط io.EOF پایان موفق است
//    (واژگونی انتظار TestSupplemental_MalformedXMLSilent ممیزی به رفتار مطلوب).

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"
)

// parseBlocks سند چندبلوکی می‌سازد و مدل را برمی‌گرداند.
func parseBlocks(t *testing.T, xmlText string) *DocModel {
	t.Helper()
	m, err := ParseItems("d-reg", []ItemInput{{ID: 1, XML: xmlText}})
	if err != nil {
		t.Fatalf("ParseItems خطا برگرداند: %v", err)
	}
	return m
}

// TestSourceOffsetsContinuityAndKnownValues پیوستگی آفست‌ها در جریان متن نمایشی را
// ثابت می‌کند: آغاز بلوک i+1 باید پایان بلوک i + 1 (جداکنندهٔ \n) باشد و همهٔ
// مقادیر با محاسبهٔ دستیِ مستقل برابر — هر جابه‌جایی highlightها را می‌شکند.
func TestSourceOffsetsContinuityAndKnownValues(t *testing.T) {
	// متن‌ها با طول code point مشخص (بایت‌ها متفاوت‌اند — عمداً فارسی)
	b0 := "سلام دنیا"        // ۹ code point
	b1 := "متن دوم آزمون"    // ۱۳ code point
	b2 := "پاراگراف سوم متن" // ۱۶ code point
	m := parseBlocks(t, "<p>"+b0+"</p><heading>"+b1+"</heading><p>"+b2+"</p>")

	if len(m.Blocks) != 3 {
		t.Fatalf("blocks=%d؛ انتظار ۳", len(m.Blocks))
	}
	// مقادیر معلوم: آفست‌ها تجمعی روی جریان «بلوک‌ها با \n»
	want := [][2]int{{0, 9}, {10, 23}, {24, 40}}
	for i, w := range want {
		if m.Blocks[i].SourceOffsets != w {
			t.Errorf("block %d SourceOffsets=%v؛ انتظار %v", i, m.Blocks[i].SourceOffsets, w)
		}
	}
	// پیوستگی: آغاز بلوک بعدی = پایان قبلی + ۱ (جداکنندهٔ \n)
	for i := 1; i < len(m.Blocks); i++ {
		prevEnd := m.Blocks[i-1].SourceOffsets[1]
		curStart := m.Blocks[i].SourceOffsets[0]
		if curStart != prevEnd+1 {
			t.Errorf("پیوستگی شکست: بلوک %d آغاز=%d، پایان قبلی=%d (+۱ انتظار)", i, curStart, prevEnd)
		}
	}
	// جریان متن باید دقیقاً چسباندن بلوک‌ها با \n باشد
	if m.Text != b0+"\n"+b1+"\n"+b2 {
		t.Errorf("متن جریان ناهمخوان:\n%q", m.Text)
	}
	// هر بازه باید روی متن خودش در جریان منطبق باشد
	for i, b := range m.Blocks {
		s, e := b.SourceOffsets[0], b.SourceOffsets[1]
		if got := string([]rune(m.Text)[s:e]); got != b.Text {
			t.Errorf("بازهٔ بلوک %d روی جریان = %q؛ انتظار %q", i, got, b.Text)
		}
	}
	// بلوک unknown خالی هم نباید آفست‌ها را جابه‌جا کند
	m2 := parseBlocks(t, "<p>"+b0+"</p><custom></custom><p>"+b1+"</p>")
	if len(m2.Blocks) != 3 { // unknown بدون متن با Type=unknown ثبت می‌شود
		t.Fatalf("blocks=%d؛ انتظار ۳", len(m2.Blocks))
	}
	if m2.Blocks[2].SourceOffsets[0] != m2.Blocks[1].SourceOffsets[1]+1 {
		t.Errorf("بلوک unknown آفست‌ها را جابه‌جا کرد: %v", m2.Blocks[2].SourceOffsets)
	}
}

// TestSourceOffsetsContinuityLargeMultiBlock روی سند بزرگ‌تر (بلوک‌های بلند فارسی
// و چند صفحه) پیوستگی و منطبق‌بودن بازه‌ها را بازمی‌آزماید — پوششِ مسیر قطعه‌بندی
// متن که در سند کوچک فعال نمی‌شود.
func TestSourceOffsetsContinuityLargeMultiBlock(t *testing.T) {
	var sb strings.Builder
	sb.WriteString("<page label=\"1\"/>")
	for i := 0; i < 40; i++ {
		sb.WriteString(fmt.Sprintf("<p>پاراگراف شمارهٔ %d با متنی نسبتاً بلند برای عبور از آستانهٔ قطعه‌بندی شش‌هزار نویسه‌ای نمایه‌ساز.</p>", i))
	}
	sb.WriteString("<page label=\"2\"/>")
	for i := 0; i < 10; i++ {
		sb.WriteString(fmt.Sprintf("<p>صفحهٔ دوم، پاراگراف %d — یگانهٔ متن آزمونی %d.</p>", i, i))
	}
	m := parseBlocks(t, sb.String())
	if len(m.Blocks) != 50 {
		t.Fatalf("blocks=%d؛ انتظار ۵۰", len(m.Blocks))
	}
	runes := []rune(m.Text)
	for i := 1; i < len(m.Blocks); i++ {
		prevEnd := m.Blocks[i-1].SourceOffsets[1]
		curStart := m.Blocks[i].SourceOffsets[0]
		if curStart != prevEnd+1 {
			t.Fatalf("پیوستگی در بلوک %d شکست: %d در برابر %d", i, curStart, prevEnd)
		}
		s, e := m.Blocks[i].SourceOffsets[0], m.Blocks[i].SourceOffsets[1]
		if string(runes[s:e]) != m.Blocks[i].Text {
			t.Fatalf("متن بازهٔ بلوک %d ناهمخوان", i)
		}
	}
	if m.Blocks[0].SourceOffsets[0] != 0 {
		t.Errorf("نخستین بلوک باید از صفر آغاز شود؛ %d", m.Blocks[0].SourceOffsets[0])
	}
	if e := m.Blocks[len(m.Blocks)-1].SourceOffsets[1]; e != len(runes) {
		t.Errorf("پایان آخرین بلوک=%d؛ طول جریان=%d", e, len(runes))
	}
}

// TestMalformedXMLNowRecorded — واژگونی انتظار TestSupplemental_MalformedXMLSilent:
// XML ناقص («متن ناقص» با تگ بسته‌نشده) باید ParseErrors غیرخالی بدهد؛ مدل جزئی اما
// قابل مشاهده می‌ماند (بلوک‌های پیش از خطا + بلوک ناقصِ همان عنصر).
func TestMalformedXMLNowRecorded(t *testing.T) {
	m, err := ParseItems("d-bad", []ItemInput{{ID: 1, XML: "<p>متن سالم</p><p>متن ناقص"}})
	if err != nil {
		t.Fatalf("مدل جزئی باید با ParseErrors برگردد نه خطای کامل: %v", err)
	}
	if len(m.ParseErrors) == 0 {
		t.Fatal("خطای XML ناقص ثبت نشد — بازگشت به بلع خاموش (DB-03)")
	}
	if !strings.Contains(m.ParseErrors[0], "DocItem 1") {
		t.Errorf("شناسهٔ آیتم در خطا نیست: %v", m.ParseErrors)
	}
	if len(m.Blocks) != 2 {
		t.Fatalf("blocks=%d؛ مدل جزئی باید هر دو بلوک (شامل ناقص) را نگه دارد", len(m.Blocks))
	}
	if m.Blocks[0].Text != "متن سالم" || m.Blocks[1].Text != "متن ناقص" {
		t.Errorf("متن بلوک‌های جزئی ناهمخوان: %q / %q", m.Blocks[0].Text, m.Blocks[1].Text)
	}
	// آفست‌های بلوک ناقص هم باید پیوسته باشند
	if m.Blocks[1].SourceOffsets[0] != m.Blocks[0].SourceOffsets[1]+1 {
		t.Errorf("آفست بلوک ناقص پیوسته نیست: %v", m.Blocks[1].SourceOffsets)
	}
}

// TestSyntaxErrorMidDocumentRecorded خطای واقعی decoder (نه EOF) — تگ بستهٔ
// اضافی — باید ثبت شود؛ الگوی قدیمی هر خطایی را EOF می‌پنداشت و nil برمی‌گرداند.
func TestSyntaxErrorMidDocumentRecorded(t *testing.T) {
	m, err := ParseItems("d-syn", []ItemInput{{ID: 7, XML: "<p>اول سالم</p><p>دوم سالم</p></p>"}})
	if err != nil {
		t.Fatalf("مدل جزئی باید برگردد: %v", err)
	}
	if len(m.ParseErrors) == 0 {
		t.Fatal("خطای syntax decoder ثبت نشد (DB-03)")
	}
	if !strings.Contains(m.ParseErrors[0], "DocItem 7") {
		t.Errorf("شناسهٔ آیتم در خطا نیست: %v", m.ParseErrors)
	}
	if len(m.Blocks) != 2 {
		t.Errorf("بلوک‌های سالم پیش از خطا باید باقی بمانند؛ blocks=%d", len(m.Blocks))
	}
}

// TestItemAfterErrorStillParsed خطا در یک آیتم نباید آیتم‌های بعدی را ساکت حذف کند.
func TestItemAfterErrorStillParsed(t *testing.T) {
	m, err := ParseItems("d-multi", []ItemInput{
		{ID: 1, XML: "<p>آیتم خراب"},
		{ID: 2, XML: "<p>آیتم سالم بعدی</p>"},
	})
	if err != nil {
		t.Fatalf("مدل جزئی باید برگردد: %v", err)
	}
	if len(m.ParseErrors) == 0 {
		t.Fatal("خطای آیتم ۱ ثبت نشد")
	}
	found := false
	for _, b := range m.Blocks {
		if b.Text == "آیتم سالم بعدی" {
			found = true
		}
	}
	if !found {
		t.Fatal("آیتم سالمِ پس از آیتم خطاخورده پارس نشد")
	}
	if !strings.Contains(m.ParseErrors[0], "DocItem 1") {
		t.Errorf("خطای آیتم ۱ بدون شناسه: %v", m.ParseErrors)
	}
}

// TestDTDRejectionStillRecorded رفتار پیشین (رد DTD) حفظ شده باشد.
func TestDTDRejectionStillRecorded(t *testing.T) {
	m, err := ParseItems("d-dtd", []ItemInput{{ID: 3, XML: "<!DOCTYPE p SYSTEM \"x.dtd\"><p>متن</p>"}})
	if err != nil {
		t.Fatalf("رد DTD خطای کامل نمی‌دهد: %v", err)
	}
	if len(m.ParseErrors) != 1 {
		t.Fatalf("ParseErrors=%v؛ انتظار یک ردیف DTD", m.ParseErrors)
	}
	if len(m.Blocks) != 0 {
		t.Errorf("سند ردشده نباید بلوک داشته باشد؛ blocks=%d", len(m.Blocks))
	}
}

// ——— بنچمارک DB-02: رشد خطی به‌جای درجه‌۲ ———

// benchXML سند n بلوکی با متن ثابت هر بلوک می‌سازد (شکل همان P2 ممیزی).
func benchXML(n int) []ItemInput {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		sb.WriteString("<p>بلوک شمارهٔ ")
		sb.WriteString(fmt.Sprint(i))
		sb.WriteString(" با متن ثابت برای سنجش هزینهٔ ساخت مدل سند پژوهش نور</p>")
	}
	return []ItemInput{{ID: 1, XML: sb.String()}}
}

// BenchmarkAddBlockRunning مسیر فعلی (شمار rune جاری — DB-02 اصلاح‌شده).
func BenchmarkAddBlockRunning(b *testing.B) {
	for _, n := range []int{500, 1000, 2000} {
		b.Run(fmt.Sprintf("blocks=%d", n), func(b *testing.B) {
			items := benchXML(n)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := ParseItems("bench", items); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkAddBlockRescan الگوی قدیمیِ حذف‌شده (RuneCountInString روی کل متن
// انباشته برای هر بلوک = O(n²)) را بازتولید می‌کند تا بهبود با همان مقیاس
// قابل مقایسه باشد (شاهد P2 ممیزی: ۵۰۰/۱۰۰۰/۲۰۰۰ = ~۴۰/۱۱۵/۴۵۰ms).
func BenchmarkAddBlockRescan(b *testing.B) {
	for _, n := range []int{500, 1000, 2000} {
		b.Run(fmt.Sprintf("blocks=%d", n), func(b *testing.B) {
			segs := make([]string, n)
			for i := 0; i < n; i++ {
				segs[i] = fmt.Sprintf("بلوک شمارهٔ %d با متن ثابت برای سنجش هزینهٔ ساخت مدل سند پژوهش نور", i)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				var sb strings.Builder
				for _, s := range segs {
					_ = utf8.RuneCountInString(sb.String()) // هزینهٔ الگوی قدیمی
					if sb.Len() > 0 {
						sb.WriteString("\n")
					}
					sb.WriteString(s)
				}
			}
		})
	}
}
