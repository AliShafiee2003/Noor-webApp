package search

import "testing"

func TestBetweenAyaRange(t *testing.T) {
	if !between("33", "41", "35") {
		t.Error("آیهٔ ۳۵ باید در بازهٔ ۳۳–۴۱ باشد")
	}
	if between("33", "41", "42") {
		t.Error("آیهٔ ۴۲ نباید در بازهٔ ۳۳–۴۱ باشد")
	}
	if !between("٣٣", "٤١", "۳۵") {
		t.Error("ارقام عربی/فارسی باید نرمال شوند")
	}
}

func TestNumNorm(t *testing.T) {
	if numNorm("٢١٣") != "213" || numNorm("۲۱۳") != "213" || numNorm("213") != "213" {
		t.Error("numNorm باید ارقام را یکسان کند")
	}
}
