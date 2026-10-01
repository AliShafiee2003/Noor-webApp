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
        Engine         string // local | opensearch
        OpenSearchURL  string
        OpenSearchUser string
        OpenSearchPass string
        // سقف کل نتایج تأییدشدهٔ هر پرس‌وجو و TTL نشست جست‌وجو (ب-۵)
        MaxResults       int
        SearchSessionTTL time.Duration
        // محدودساز تلاش ورود (SEC-09) — پیش‌فرض تولید ۵ در دقیقه؛ فقط محیط توسعه/E2E بیشتر می‌کند
        LoginRateMax    int
        LoginRateWindow time.Duration
}

// FromEnv خواندن با پیش‌فرض‌های سندباکس.
func FromEnv() *Config {
        c := &Config{
                HTTPPort:         env("NOOR_HTTP_PORT", "8080"),
                DataDir:          env("NOOR_DATA_DIR", "./data"),
                SourcesDir:       env("NOOR_SOURCES_DIR", "./data/sources"),
                CookieSecure:     env("NOOR_COOKIE_SECURE", "false") == "true",
                ServiceToken:     env("NOOR_SERVICE_TOKEN", ""),
                MaxVerifyCPU:     intEnv("NOOR_MAX_VERIFY", 4),
                SearchTimeout:    durEnv("NOOR_SEARCH_TIMEOUT", 15*time.Second),
                SessionMaxAge:    durEnv("NOOR_SESSION_MAX_AGE", 7*24*time.Hour),
                SessionIdle:      durEnv("NOOR_SESSION_IDLE", 24*time.Hour),
                IndexVersion:     env("NOOR_INDEX_VERSION", "idx-1"),
                Engine:           env("NOOR_ENGINE", "local"),
                OpenSearchURL:    env("NOOR_OPENSEARCH_URL", "http://opensearch:9200"),
                OpenSearchUser:   env("NOOR_OPENSEARCH_USER", ""),
                OpenSearchPass:   env("NOOR_OPENSEARCH_PASSWORD", ""),
                MaxResults:       intEnv("NOOR_MAX_RESULTS", 10000),
                SearchSessionTTL: durEnv("NOOR_SEARCH_SESSION_TTL", 30*time.Minute),
                LoginRateMax:     intEnv("NOOR_LOGIN_RATE_MAX", 5),
                LoginRateWindow:  durEnv("NOOR_LOGIN_RATE_WINDOW", time.Minute),
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
