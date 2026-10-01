// oshttp — کلاینت HTTP با TLS پیکربندی‌شده برای OpenSearch (ممیزی DEP-01).
//
// پیش از این فایل، کلاینت OpenSearch هرگز CA/TLS نمی‌گرفت و با پیکربندی HTTPS
// خود compose (گواهی self-signed) در hand-shake شکست می‌خورد. اکنون:
//   - NOOR_OPENSEARCH_CA_CERT: مسیر فایل PEM گواهی CA سرویس (توصیه‌شده برای تولید).
//   - NOOR_OPENSEARCH_INSECURE=true: پرشِ صریح اعتبارسنجی گواهی — فقط برای آزمون؛
//     با هشدار پررنگ در لاگ. هرگز پیش‌فرض نیست.
package config

import (
	"crypto/tls"
	"crypto/x509"
	"log"
	"net/http"
	"os"
	"time"
)

// OSHTTPClient کلاینت HTTP آماده برای OpenSearch با TLS مطابق پیکربندی.
// nil-safe نیست؛ همیشه کلاینت کامل با Timeout داده‌شده برمی‌گرداند.
func (c *Config) OSHTTPClient(timeout time.Duration) *http.Client {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12} //nolint:gosec // حداقل TLS 1.2 صریح است
	if c.OpenSearchCACert != "" {
		pemBytes, err := os.ReadFile(c.OpenSearchCACert)
		if err != nil {
			log.Printf("noor-config: خواندن NOOR_OPENSEARCH_CA_CERT ناموفق: %v", err)
		} else {
			pool := x509.NewCertPool()
			if pool.AppendCertsFromPEM(pemBytes) {
				tlsCfg.RootCAs = pool
				log.Printf("noor-config: CA سفارشی OpenSearch بارگذاری شد (%s)", c.OpenSearchCACert)
			} else {
				log.Println("noor-config: هیچ گواهی معتبری در NOOR_OPENSEARCH_CA_CERT نبود؛ به pool پیش‌فرض برمی‌گردیم")
			}
		}
	}
	if c.OpenSearchInsecure {
		tlsCfg.InsecureSkipVerify = true //nolint:gosec // صریح و فقط با env آشکار؛ هشدار زیر ثبت می‌شود
		log.Println("noor-config: هشدار — اعتبارسنجی گواهی OpenSearch خاموش است (NOOR_OPENSEARCH_INSECURE=true)؛ فقط برای آزمون!")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = tlsCfg
	return &http.Client{Timeout: timeout, Transport: tr}
}
