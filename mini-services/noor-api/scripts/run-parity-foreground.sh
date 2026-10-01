#!/bin/bash
# run-parity-foreground.sh — اجرای پاریتی دو موتور در «یک نشست پیش‌زمینهٔ یکپارچه»
# (بند ۶ دور ۱۴: OpenSearch در سندباکس به‌صورت daemon ماندگار نیست؛ این اسکریپت
#  چرخهٔ کامل را در یک اجرا بالا می‌آورد، آزمون می‌کند و پایین می‌آورد.)
#
# استفاده از ریشهٔ mini-services/noor-api:
#   ./scripts/run-parity-foreground.sh                 # پاریتی fixture (۱۲۶ پرس‌وجوی طلایی)
#   ./scripts/run-parity-foreground.sh --with-scale    # + پاریتی مقیاس (کورپوس مصنوعی ~۲۰هزار)
#
# متغیرها:
#   NOOR_OS_HOME   مسیر نصب OpenSearch (پیش‌فرض /home/z/os-test)
#   NOOR_OS_INDEX  نام ایندکس (پیش‌فرض noor-passages)
#   GO_BIN         مسیر باینری go (پیش‌فرض /home/z/.local/go-toolchain/bin)
set -u
cd "$(dirname "$0")/.."

OS_HOME="${NOOR_OS_HOME:-/home/z/os-test}"
OS_DIR="$OS_HOME/opensearch-2.17.1"
OS_INDEX="${NOOR_OS_INDEX:-noor-passages}"
export PATH="${GO_BIN:-/home/z/.local/go-toolchain/bin}:$PATH"

fail() { echo "خطا: $*" >&2; exit 1; }

[ -x "$OS_DIR/bin/opensearch" ] || fail "OpenSearch در $OS_DIR یافت نشد (NOOR_OS_HOME را تنظیم کنید)"
command -v go >/dev/null || fail "ابزار go در دسترس نیست"

echo "== ۱/۵ بیلد ابزارها =="
go build -o bin/osindex ./cmd/osindex || fail "بیلد osindex"

echo "== ۲/۵ بالا آوردن OpenSearch (درون همین نشست) =="
OPENSEARCH_JAVA_OPTS="${OPENSEARCH_JAVA_OPTS:--Xms300m -Xmx300m}" \
  "$OS_DIR/bin/opensearch" > /tmp/noor-parity-os.log 2>&1 &
OS_PID=$!
trap 'kill $OS_PID 2>/dev/null; wait $OS_PID 2>/dev/null' EXIT

echo -n "   انتظار برای آماده‌شدن"
ready=""
for i in $(seq 1 90); do
  if curl -s -o /dev/null "http://127.0.0.1:9200"; then ready=1; break; fi
  echo -n "."; sleep 2
done
[ -n "$ready" ] || { tail -20 /tmp/noor-parity-os.log; fail "OpenSearch آماده نشد"; }
echo " ✓ (curl: $(curl -s http://127.0.0.1:9200 | grep -o '"distributionName" : "[^"]*"' | head -1))"

echo "== ۳/۵ نمایه‌سازی تازهٔ fixture (با mapping جدید شامل citation_keys) =="
# حذف ایندکس قدیمی تا mapping تازه (citation_keys) اعمال شود
curl -s -X DELETE "http://127.0.0.1:9200/$OS_INDEX" > /dev/null
go run ./cmd/osindex -index data/index.sqlite -os http://127.0.0.1:9200 -name "$OS_INDEX" || fail "نمایه‌سازی fixture"

echo "== ۳/۵-ب اثر فیلتر استنادی (terms به‌جای match_all — مورد ۳) =="
all=$(curl -s "http://127.0.0.1:9200/$OS_INDEX/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
term=$(curl -s -X POST "http://127.0.0.1:9200/$OS_INDEX/_search?size=0" -H 'Content-Type: application/json' \
  -d '{"query":{"terms":{"citation_keys":["s2:a213"]}},"track_total_hits":true}' | grep -o '"value":[0-9]*' | head -1 | cut -d: -f2)
echo "   سندهای ایندکس‌شده: ${all:-?} | دارای استناد البقرة:۲۱۳ (terms citation_keys): ${term:-?}"
[ "${term:-0}" -gt 0 ] && [ "${term:-0}" -lt "${all:-1}" ] && echo "   ✓ فیلتر استنادی گزینش‌پذیر است (کاندید محدود به‌جای پویش کامل release)"

echo "== ۴/۵ آزمون طلایی: محلی و پاریتی OpenSearch (۱۲۶ پرس‌وجو) =="
NOOR_GOLDEN_OS_URL="http://127.0.0.1:9200" NOOR_OS_INDEX="$OS_INDEX" \
  go test ./internal/search/ -run "TestGoldenSetLocal|TestGoldenSetOpenSearchParity" -v -count=1 2>&1 | grep -E "^(=== RUN|--- PASS|--- FAIL|PASS|FAIL|ok)" || fail "آزمون طلایی"

echo "== ۵/۵ پاریتی مقیاس (اختیاری) =="
if [ "${1:-}" = "--with-scale" ]; then
  NOOR_OS_URL="http://127.0.0.1:9200" ./scripts/scale-test.sh || fail "آزمون مقیاس"
else
  echo "   رد شد (برای اجرا: ./scripts/run-parity-foreground.sh --with-scale)"
fi

echo
echo "نتیجه: پاریتی در همین نشست کامل شد — لاگ OpenSearch: /tmp/noor-parity-os.log"
