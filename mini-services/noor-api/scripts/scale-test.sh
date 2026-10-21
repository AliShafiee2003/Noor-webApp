#!/usr/bin/env bash
# scale-test.sh — آزمون مقیاس مصنوعی (بند ۲ باقی‌ماندهٔ ممیزی، round14-B).
# همهٔ آزمون‌ها تا امروز روی fixture ۶ اثر/۷۱ passage بود؛ این اسکریپت همان fixture
# را factor بار تکرار می‌کند (≈۲۰هزار passage) و باتری پرس‌وجو را روی موتور محلی
# (و در صورت دسترس‌بودن، روی OpenSearch) می‌سنجد و پاریتی شمارش‌ها را گزارش می‌کند.
#
# صداقت: کورپوس واقعی در سندباکس موجود نیست — این آزمون «اثر مقیاس» را با تکرار
# fixture می‌سنجد، نه تنوع محتوای واقعی. OpenSearch نصب/اجرا نمی‌شود؛ فقط اگر
# NOOR_OS_URL از بیرون تنظیم شده و reachable باشد وارد بخش OS می‌شویم.
#
# کاربرد (از هر جا):
#   mini-services/noor-api/scripts/scale-test.sh
# متغیرها: NOOR_SCALE_FACTOR (پیش‌فرض ۲۸۰)، NOOR_SCALE_ROUNDS (۳)،
#          NOOR_SCALE_MAX_RESULTS (۱۰۰۰۰)، NOOR_SCALE_UNCAPPED (۱)، NOOR_OS_URL
set -euo pipefail
cd "$(dirname "$0")/.."   # ریشهٔ mini-services/noor-api

export PATH="/home/z/.local/go-toolchain/bin:$PATH"

FACTOR="${NOOR_SCALE_FACTOR:-280}"
ROUNDS="${NOOR_SCALE_ROUNDS:-3}"
MAXRES="${NOOR_SCALE_MAX_RESULTS:-10000}"
UNCAPPED="${NOOR_SCALE_UNCAPPED:-1}"
OS_URL="${NOOR_OS_URL:-}"
DB="data/index-scale.sqlite"
TMP="$(mktemp -d /tmp/noor-scale.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

echo "==> ۱) ساخت باینری‌ها"
go build -o bin/scalefixture ./cmd/scalefixture
go build -o bin/scalebench ./cmd/scalebench
go build -o bin/osindex ./cmd/osindex

echo "==> ۲) ساخت کورپوس مقیاس (factor=${FACTOR}) — فایل تازه، idempotent"
rm -f "$DB" "$DB-wal" "$DB-shm"
./bin/scalefixture -src data/index.sqlite -out "$DB" -factor "$FACTOR"

echo "==> ۳) بنچمارک موتور محلی (سقف نتایج=${MAXRES} مطابق تولید)"
./bin/scalebench -db "$DB" -rounds "$ROUNDS" -engine local \
        -max-results "$MAXRES" -release rel-scale \
        -json-out "$TMP/local.json" | tee "$TMP/local.txt"

if [[ "$UNCAPPED" == "1" ]]; then
        echo "==> ۳-ب) گذر دوم محلی بدون سقف عملی (max_results=1000000) — سنجش هزینهٔ کامل تأیید"
        ./bin/scalebench -db "$DB" -rounds "$ROUNDS" -engine local \
                -max-results 1000000 -release rel-scale \
                -json-out "$TMP/local-uncapped.json" | tee "$TMP/local-uncapped.txt"
fi

if [[ -n "$OS_URL" ]] && curl -fsS --max-time 5 "$OS_URL/" >/dev/null 2>&1; then
        echo "==> ۴) OpenSearch در ${OS_URL} reachable است — نمایه‌سازی کورپوس مقیاس (index: noor-scale)"
        # idempotent: index قبلی حذف و از نو ساخته می‌شود
        curl -fsS -X DELETE "$OS_URL/noor-scale" >/dev/null 2>&1 || true
        ./bin/osindex -index "$DB" -os "$OS_URL" -name noor-scale
        echo "==> ۵) بنچمارک OpenSearch"
        ./bin/scalebench -db "$DB" -rounds "$ROUNDS" -engine opensearch \
                -os-url "$OS_URL" -os-index noor-scale \
                -max-results "$MAXRES" -release rel-scale \
                -json-out "$TMP/os.json" | tee "$TMP/os.txt"
        echo "==> ۶) پاریتی شمارش‌های تأییدشدهٔ محلی ↔ OpenSearch (به‌تفکیک پرس‌وجو)"
        python3 - "$TMP/local.json" "$TMP/os.json" <<'PY'
import json, sys
local = {r["id"]: r for r in json.load(open(sys.argv[1]))["results"]}
osdb  = {r["id"]: r for r in json.load(open(sys.argv[2]))["results"]}
bad = 0
for qid in sorted(local):
    l, o = local[qid], osdb.get(qid)
    if o is None:
        print(f"پاریتی {qid}: در خروجی OpenSearch نیست ✗"); bad += 1; continue
    ok = (l["verified_occurrences"] == o["verified_occurrences"]
          and l["verified_books"] == o["verified_books"]
          and l["count_relation"] == o["count_relation"])
    mark = "✓" if ok else "✗"
    print(f"پاریتی {qid} [{l['mode']}]: محلی={l['verified_occurrences']}/{l['verified_books']} "
          f"OS={o['verified_occurrences']}/{o['verified_books']} rel={l['count_relation']}↔{o['count_relation']} {mark}")
    bad += 0 if ok else 1
print("نتیجه: " + ("پاریتی کامل — همهٔ پرس‌وجوها یکسان" if bad == 0 else f"{bad} پرس‌وجوی ناهم‌سان"))
sys.exit(1 if bad else 0)
PY
else
        echo "==> ۴) OpenSearch در دسترس نیست (NOOR_OS_URL تنظیم نشده یا سرویس پاسخ نمی‌دهد)."
        echo "    بخش پاریتی OS صادقانه حذف شد — OpenSearch نصب/اجرا نمی‌شود (قاعدهٔ این تسک)."
        echo "    برای اجرای کامل: سرویس OpenSearch را بیاورید و NOOR_OS_URL=http://127.0.0.1:9200 بگذارید."
fi

echo "==> تمام شد. نمایهٔ مقیاس در ${DB} باقی می‌ماند (برای اجرای دوباره حذفش کنید؛ اسکریپت خودش از نو می‌سازد)."
