// Package config — تنظیمات از env؛ بدون secret در source.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config پیکربندی سرویس.
type Config struct {
	HTTPPort       string
	DataDir        string // app.sqlite، index.sqlite
	SourcesDir     string // منابع نور فقط‌خواندنی
	CookieSecure   bool
	CookieDomain   string
	ServiceToken   string // worker ↔ api داخلی
	MaxVerifyCPU   int
	SearchTimeout  time.Duration
	SessionMaxAge  time.Duration
	SessionIdle    time.Duration
	IndexVersion   string
	Engine         string // local | fts5 | opensearch
	OpenSearchURL  string
	OpenSearchUser string
	OpenSearchPass string
	// TLS سمت کلاینت OpenSearch (ممیزی DEP-01): سازگاری با compose مبتنی بر HTTPS.
	// CA سفارشی با NOOR_OPENSEARCH_CA_CERT (مسیر PEM)؛ پرشِ صریح اعتبارسنجی فقط
	// با NOOR_OPENSEARCH_INSECURE=true (فقط آزمون؛ با هشدار پررنگ در لاگ).
	OpenSearchCACert   string
	OpenSearchInsecure bool
	// سقف کل نتایج تأییدشدهٔ هر پرس‌وجو و TTL نشست جست‌وجو (ب-۵)
	MaxResults       int
	SearchSessionTTL time.Duration
	// محدودساز تلاش ورود (SEC-09) — پیش‌فرض تولید ۵ در دقیقه؛ فقط محیط توسعه/E2E بیشتر می‌کند
	LoginRateMax    int
	LoginRateWindow time.Duration
	// TrustProxy اگر true باشد X-Real-IP/X-Forwarded-For برای clientIP پذیرفته می‌شود؛
	// در تولید فقط وقتی فعال شود که API دقیقاً پشت یک reverse-proxy معتمد است.
	TrustProxy bool
	// سقف نرخ هر کاربر (در دقیقه): جست‌وجو (پرهزینه‌ترین مسیر CPU) و نوشتن‌های UGC.
	// صفر = خاموش. پیش‌فرض‌ها برای کار پژوهشی عادی گشاده‌اند و فقط سیل را می‌بندند.
	SearchRatePerMin int
	WriteRatePerMin  int
}

// FromEnv خواندن با پیش‌فرض‌های سندباکس.
func FromEnv() *Config {
	c := &Config{
		HTTPPort:           env("NOOR_HTTP_PORT", "8080"),
		DataDir:            env("NOOR_DATA_DIR", "./data"),
		SourcesDir:         env("NOOR_SOURCES_DIR", "./data/sources"),
		CookieSecure:       env("NOOR_COOKIE_SECURE", "false") == "true",
		ServiceToken:       env("NOOR_SERVICE_TOKEN", ""),
		MaxVerifyCPU:       intEnv("NOOR_MAX_VERIFY", 4),
		SearchTimeout:      durEnv("NOOR_SEARCH_TIMEOUT", 15*time.Second),
		SessionMaxAge:      durEnv("NOOR_SESSION_MAX_AGE", 7*24*time.Hour),
		SessionIdle:        durEnv("NOOR_SESSION_IDLE", 24*time.Hour),
		IndexVersion:       env("NOOR_INDEX_VERSION", "idx-1"),
		OpenSearchURL:      env("NOOR_OPENSEARCH_URL", "http://opensearch:9200"),
		OpenSearchUser:     env("NOOR_OPENSEARCH_USER", ""),
		OpenSearchPass:     env("NOOR_OPENSEARCH_PASSWORD", ""),
		OpenSearchCACert:   env("NOOR_OPENSEARCH_CA_CERT", ""),
		OpenSearchInsecure: env("NOOR_OPENSEARCH_INSECURE", "false") == "true",
		MaxResults:         intEnv("NOOR_MAX_RESULTS", 10000),
		SearchSessionTTL:   durEnv("NOOR_SEARCH_SESSION_TTL", 30*time.Minute),
		LoginRateMax:       intEnv("NOOR_LOGIN_RATE_MAX", 5),
		LoginRateWindow:    durEnv("NOOR_LOGIN_RATE_WINDOW", time.Minute),
		TrustProxy:         env("NOOR_TRUSTED_PROXY", "false") == "true",
		SearchRatePerMin:   intEnv("NOOR_SEARCH_RATE_PER_MIN", 120),
		WriteRatePerMin:    intEnv("NOOR_WRITE_RATE_PER_MIN", 300),
		// پیش‌فرض موتور fts5 است (الف-۲): موتور قدیمی local فقط با انتخاب صریح.
		Engine: env("NOOR_ENGINE", "fts5"),
	}
	return c
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func intEnv(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

func durEnv(k string, d time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if t, err := time.ParseDuration(v); err == nil {
			return t
		}
	}
	return d
}
