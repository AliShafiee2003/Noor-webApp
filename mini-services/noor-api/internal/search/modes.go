package search

// قرارداد دوحالتهٔ جست‌وجو (text / words).
//
// رابط بیرونی فقط دو حالت دارد و هر حالت فیلدهای کنترلی خودش را:
//
//	text  : flex = exact | written | spelling | similar (پیش‌فرض)،
//	        sort = relevance | similarity | source، diacritics، expand_morphology،
//	        near_spelling، min_score، layers
//	words : words.match = all | any، words.distance (۰ = هرجای قطعه)، words.ordered، diacritics
//
// canonicalize این قرارداد را پیش از هر کار دیگری به ثابت‌های داخلی موجود برمی‌گرداند؛ پس
// موتورها (FTS5، local، OpenSearch)، نشست‌ها، cursorها و golden حالت‌های قدیمی بی‌تغییر
// می‌مانند و دو درخواست هم‌معنا (قدیمی و تازه) یک کلید کش می‌سازند.

import (
	"errors"
	"fmt"
)

// حالت‌های قرارداد بیرونی.
const (
	ModeText  = "text"
	ModeWords = "words"
)

// سطوح انعطاف حالت text.
const (
	FlexExact    = "exact"    // L1: عین نویسه‌ها و اعراب
	FlexWritten  = "written"  // L1–L2 + گونه‌های پیوستگی/یای اضافه
	FlexSpelling = "spelling" // L1–L3: گونه‌های املایی پذیرفته‌شده
	FlexSimilar  = "similar"  // L1–L4: نقل‌قول مشابه
)

// ترتیب «شبیه‌ترین اول» (فقط flex=similar).
const SortSimilarity = "similarity"

// سقف‌های طول پرسش (نویسه) — یک سقف برای هر خانواده، نه هر حالت.
const (
	maxTextQueryRunes  = 8192
	maxWordsQueryRunes = 2048
	// any_words هزینهٔ خطی با شمار واژه دارد (OR روی پرتکرارها)؛ سقف صریح به‌جای کندی بی‌کران.
	maxAnyWords = 32
)

// NearOpts تنظیم نزدیکی حالت داخلی near. نام مستعار (alias) نوع بی‌نام قبلی است تا
// کدهای بیرون از بسته (cmd/scalebench و …) که struct بی‌نام می‌سازند بی‌تغییر کامپایل شوند.
type NearOpts = struct {
	Slop    int  `json:"slop"`
	Ordered bool `json:"ordered"`
}

// WordsOpts تنظیمات حالت words.
type WordsOpts struct {
	Match    string `json:"match,omitempty"`    // all (پیش‌فرض) | any
	Distance int    `json:"distance,omitempty"` // ۰ = هرجای قطعه؛ N = حداکثر N واژه فاصله
	Ordered  bool   `json:"ordered,omitempty"`  // فقط با distance > 0
}

// canonicalize درخواست قرارداد text/words را به حالت داخلی برمی‌گرداند (درجا).
// حالت‌های قدیمی بی‌تغییر پذیرفته می‌شوند (long_quote → tiered، چون فقط سقف طولش فرق داشت).
func canonicalize(req *Request) error {
	switch req.Mode {
	case ModeText:
		if req.Words != nil {
			return errors.New("تنظیمات words فقط در حالت words معتبر است")
		}
		flex := req.Flex
		if flex == "" {
			flex = FlexSimilar
		}
		if flex != FlexSimilar {
			if req.NearSpelling {
				return errors.New("واژهٔ نزدیک (near_spelling) فقط در سطح انعطاف «مشابه» اجرا می‌شود")
			}
			if len(req.Layers) > 0 {
				return errors.New("محدودسازی لایه (layers) فقط در سطح انعطاف «مشابه» معتبر است؛ برای نمایش از result_layers استفاده کنید")
			}
			if req.Sort == SortSimilarity {
				return errors.New("ترتیب «شبیه‌ترین اول» فقط در سطح انعطاف «مشابه» معتبر است")
			}
		}
		if req.ExpandMorphology && (flex == FlexExact || flex == FlexWritten) {
			return errors.New("گسترش صرفی فقط در سطح «املایی» یا «مشابه» اجرا می‌شود")
		}
		switch flex {
		case FlexExact:
			req.Mode = StrictPhrase
		case FlexWritten:
			req.Mode = NormalizedPhrase
		case FlexSpelling:
			req.Mode = Linguistic
		case FlexSimilar:
			req.Mode = Tiered
			if req.Sort == SortSimilarity {
				req.Mode = SimilarQuote
			}
		default:
			return fmt.Errorf("میزان انعطاف %q معتبر نیست (exact، written، spelling یا similar)", req.Flex)
		}
		req.Near = nil
	case ModeWords:
		if req.Flex != "" {
			return errors.New("flex فقط در حالت text معتبر است")
		}
		if req.NearSpelling || req.ExpandMorphology || len(req.Layers) > 0 || req.Sort == SortSimilarity {
			return errors.New("واژهٔ نزدیک، گسترش صرفی، لایه‌ها و ترتیب شباهت فقط در حالت text معتبرند")
		}
		w := WordsOpts{Match: "all"}
		if req.Words != nil {
			w = *req.Words
		}
		if w.Distance < 0 || w.Distance > 50 {
			return errors.New("فاصلهٔ واژه‌ها باید بین ۰ و ۵۰ باشد")
		}
		switch w.Match {
		case "", "all":
			if w.Distance > 0 {
				req.Mode, req.Near = Near, &NearOpts{Slop: w.Distance, Ordered: w.Ordered}
			} else {
				if w.Ordered {
					return errors.New("«با همین ترتیب» فقط همراه با فاصلهٔ مشخص معتبر است")
				}
				req.Mode, req.Near = AllWords, nil
			}
		case "any":
			if w.Distance > 0 || w.Ordered {
				return errors.New("«حداقل یک واژه» با فاصله یا ترتیب ترکیب نمی‌شود")
			}
			req.Mode, req.Near = AnyWords, nil
		default:
			return fmt.Errorf("شرط واژه‌ها %q معتبر نیست (all یا any)", w.Match)
		}
	case LongQuote:
		req.Mode = Tiered
	default:
		if req.Flex != "" || req.Words != nil {
			return errors.New("flex و words فقط با حالت‌های text و words معتبرند")
		}
		if req.Sort == SortSimilarity {
			if req.Mode != SimilarQuote {
				return errors.New("ترتیب «شبیه‌ترین اول» فقط در جست‌وجوی نقل‌قول مشابه معتبر است")
			}
		}
	}
	// کلید کش فقط از حالت داخلی ساخته شود: Flex/Words پاک و Sort به دو مقدار معنادار
	// ("" = relevance/similarity، "source") یکتا می‌شود — موتور جز "source" را متمایز نمی‌کند.
	if req.Sort != "source" {
		req.Sort = ""
	}
	req.Flex, req.Words = "", nil
	return nil
}

// isTextMode آیا حالت داخلی از خانوادهٔ text (عبارت با ترتیب) است؟
func isTextMode(mode string) bool {
	switch mode {
	case StrictPhrase, NormalizedPhrase, Linguistic, Tiered, LongQuote, SimilarQuote:
		return true
	}
	return false
}

// isLayeredMode حالت‌هایی که L4/L5 دارند.
func isLayeredMode(mode string) bool {
	return mode == Tiered || mode == LongQuote || mode == SimilarQuote
}

func isKnownMode(mode string) bool {
	switch mode {
	case StrictPhrase, NormalizedPhrase, AllWords, AnyWords, Near, Linguistic, LongQuote, SimilarQuote, Tiered:
		return true
	}
	return false
}

// effectiveFlex سطح انعطاف معادل حالت داخلی (برای گزارش در پاسخ).
func effectiveFlex(mode string) string {
	switch mode {
	case StrictPhrase:
		return FlexExact
	case NormalizedPhrase:
		return FlexWritten
	case Linguistic:
		return FlexSpelling
	case Tiered, LongQuote, SimilarQuote:
		return FlexSimilar
	}
	return ""
}

// layerSet مجموعهٔ لایه‌های فیلتر نمایش؛ nil = همه.
func layerSet(ls []string) map[string]bool {
	if len(ls) == 0 {
		return nil
	}
	m := make(map[string]bool, len(ls))
	for _, l := range ls {
		m[l] = true
	}
	return m
}
