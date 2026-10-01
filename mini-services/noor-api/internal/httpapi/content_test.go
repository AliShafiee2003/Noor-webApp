package httpapi

// content_test.go — GO-07: خطای موتور/زیرساخت جست‌وجو باید 503 قابل‌تلاش
// بدهد، نه 422 «پرس‌وجوی نامعتبر»؛ خطای اعتبارسنجی مثل قبل 422 می‌ماند.

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"

	"noor/internal/search"
)

// stubEngine موتور ساختگی که فقط خطای ازپیش‌تعیین‌شده را برمی‌گرداند.
type stubEngine struct{ err error }

func (e *stubEngine) Search(ctx context.Context, req *search.Request, releaseUID string) (*search.Response, error) {
	if e.err != nil {
		return nil, e.err
	}
	return &search.Response{Results: []search.Result{}}, nil
}

func (e *stubEngine) Continue(ctx context.Context, sessionUID, cursor, releaseUID string) (*search.Response, error) {
	if e.err != nil {
		return nil, e.err
	}
	return &search.Response{Results: []search.Result{}}, nil
}

func (e *stubEngine) BooksGrouped(ctx context.Context, sessionUID string) ([]search.BookGroup, error) {
	if e.err != nil {
		return nil, e.err
	}
	return []search.BookGroup{}, nil
}

func (e *stubEngine) SearchTitles(ctx context.Context, q string, pageSize int) ([]search.TitleHit, error) {
	if e.err != nil {
		return nil, e.err
	}
	return []search.TitleHit{}, nil
}

func TestSearchEngineFailureReturns503(t *testing.T) {
	osDialErr := fmt.Errorf("سرویس OpenSearch در http://127.0.0.1:9200 پاسخ نمی‌دهد: %w",
		&net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")})
	cases := []struct {
		name string
		err  error
		want int    // وضعیت HTTP مورد انتظار
		code string // کد قراردادی مورد انتظار
	}{
		{"مهلت موتور", fmt.Errorf("run: %w", context.DeadlineExceeded), 503, "engine_unavailable"},
		{"اتصال OS برقرار نیست", osDialErr, 503, "engine_unavailable"},
		{"نمایه در دسترس نیست", errors.New("نمایهٔ جست‌وجو در دسترس نیست"), 503, "engine_unavailable"},
		{"پیمایش نمایه شکست خورد", fmt.Errorf("scan candidate: %w", errors.New("SQLITE_BUSY: database is locked")), 503, "engine_unavailable"},
		{"HTTP موتور 5xx", errors.New("opensearch GET /noor-passages/_search → HTTP 503: boom"), 503, "engine_unavailable"},
		{"اعتبارسنجی: عبارت خالی", errors.New("عبارت جست‌وجو خالی است"), 422, "invalid_query"},
		{"اعتبارسنجی: حالت نامعتبر", errors.New("حالت جست‌وجو معتبر نیست"), 422, "invalid_query"},
		{"لغو سمت کلاینت", fmt.Errorf("ctx: %w", context.Canceled), 422, "invalid_query"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, ts := ugcTestServer(t)
			tok := ugcUser(t, s, "searcher", "جست‌وجوگر")
			s.Engine = &stubEngine{err: tc.err}

			resp := ugcDo(t, ts, "POST", "/api/v1/search", tok, map[string]any{
				"query": "الكعبة بيت الله", "mode": "strict_phrase",
			}, nil)
			m := ugcJSON(t, resp)
			if resp.StatusCode != tc.want {
				t.Fatalf("وضعیت = %d، want %d — body: %v", resp.StatusCode, tc.want, m)
			}
			errObj, ok := m["error"].(map[string]any)
			if !ok {
				t.Fatalf("بدنه باید error چهاربخشی داشته باشد: %v", m)
			}
			if errObj["code"] != tc.code {
				t.Fatalf("code = %v، want %v", errObj["code"], tc.code)
			}
			if tc.want == 503 {
				if errObj["retryable"] != true {
					t.Fatalf("خطای موتور باید retryable=true باشد: %v", errObj)
				}
				if msg, _ := errObj["message"].(string); msg != "موتور جست‌وجو موقتاً در دسترس نیست؛ کمی بعد تلاش کنید." {
					t.Fatalf("پیام فارسی نادرست: %q", msg)
				}
			}
		})
	}
}

func TestIsEngineFailure(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"خطای صفر", nil, false},
		{"مهلت", context.DeadlineExceeded, true},
		{"مهلت پیچیده", fmt.Errorf("outer: %w", context.DeadlineExceeded), true},
		{"لغو کلاینت", context.Canceled, false},
		{"خطای شبکه", &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("refused")}, true},
		{"نمایه غایب", errors.New("نمایهٔ جست‌وجو در دسترس نیست"), true},
		{"خطای OS HTTP", errors.New("opensearch POST /_bulk → HTTP 502: bad gateway"), true},
		{"پاسخ OS ناخوانا", errors.New("پاسخ OpenSearch قابل تحلیل نیست: unexpected token"), true},
		{"خطای SQLite پیمایش", fmt.Errorf("scan candidate: %w", errors.New("sql: no rows")), true},
		{"اعتبارسنجی", errors.New("عبارت بیش از حد مجاز است؛ برای نقل‌قول بلند از حالت مخصوص آن استفاده کنید"), false},
		{"اعتبارسنجی حالت", errors.New("حالت جست‌وجو معتبر نیست"), false},
		{"GoneError (410 جدا است)", &search.GoneError{Message: "مهلت این جست‌وجو پایان یافته است"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isEngineFailure(tc.err); got != tc.want {
				t.Fatalf("isEngineFailure(%v) = %v، want %v", tc.err, got, tc.want)
			}
		})
	}
}
