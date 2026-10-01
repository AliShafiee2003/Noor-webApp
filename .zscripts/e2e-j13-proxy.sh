#!/bin/bash
# E2E پروکسی Next (:3000) — دوکاربهٔ هایلایت/اشتراک/PDF در یک اجرا (sandbox زودترین فرصت را برای کشتن dev دارد)
set -u
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null; sleep 1
setsid nohup ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 < /dev/null &
echo "next pid=$!"
up=0
for i in $(seq 1 60); do
  code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then up=1; echo "next ready after ~$((i*2))s"; break; fi
  sleep 2
done
[ "$up" = "1" ] || { echo "NEXT DID NOT START"; tail -20 dev.log; exit 1; }

rm -f /tmp/pA.txt /tmp/pB.txt
st() { printf '%s\n' "$1"; }

echo "== 1) A login via :3000"
st "$(curl -s -c /tmp/pA.txt -X POST http://127.0.0.1:3000/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"zaB3v-XPngB-fXcYw"}' -o /dev/null -w '%{http_code}')"

echo "== 2) anon GET annotations via :3000 (expect 401 + پیام فارسی)"
st "$(curl -s -w '|%{http_code}' 'http://127.0.0.1:3000/api/v1/annotations?document_uid=doc-bahar-2')"

echo "== 3) invite + accept user B via :3000"
CODE=$(cd mini-services/noor-api && NOOR_DATA_DIR=./data ./bin/adminctl -cmd invite -role reader | awk -F': ' '{print $2}')
st "invite_code=$CODE"
st "$(curl -s -c /tmp/pB.txt -X POST http://127.0.0.1:3000/api/v1/auth/accept-invite -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"username\":\"j13reader3\",\"display_name\":\"پژوهشگر دوم پروکسی\",\"password\":\"J13-reader-pass\"}" -o /dev/null -w '%{http_code}')"

echo "== 4) A creates highlight via :3000"
HL=$(curl -s -b /tmp/pA.txt -X POST http://127.0.0.1:3000/api/v1/annotations -H 'content-type: application/json' -H 'X-Noor-CSRF: t' -d '{"document_uid":"doc-bahar-2","page_uid":"p-001","block_id":"b-0012","start":2,"end":25,"text":"علم خيرٌ من المال","color":"pink"}')
st "$HL"
HLUID=$(echo "$HL" | python3 -c "import sys,json;print(json.load(sys.stdin).get('uid',''))")

echo "== 5) B list annotations (expect items:[])"
st "$(curl -s -b /tmp/pB.txt 'http://127.0.0.1:3000/api/v1/annotations?document_uid=doc-bahar-2')"

echo "== 6) B PATCH A highlight (expect 404 هایلایت مورد نظر یافت نشد.)"
st "$(curl -s -b /tmp/pB.txt -X PATCH http://127.0.0.1:3000/api/v1/annotations/$HLUID -H 'content-type: application/json' -H 'X-Noor-CSRF: t' -d '{"color":"green"}' -w '|%{http_code}')"

echo "== 7) A PATCH invalid color (expect 422 رنگ انتخابی مجاز نیست.)"
st "$(curl -s -b /tmp/pA.txt -X PATCH http://127.0.0.1:3000/api/v1/annotations/$HLUID -H 'content-type: application/json' -H 'X-Noor-CSRF: t' -d '{"color":"purple"}' -w '|%{http_code}')"

echo "== 8) A creates share via :3000"
SH=$(curl -s -b /tmp/pA.txt -X POST http://127.0.0.1:3000/api/v1/shares -H 'content-type: application/json' -H 'X-Noor-CSRF: t' -d '{"kind":"highlight","item_id":"'"$HLUID"'","document_uid":"doc-bahar-2","page_uid":"p-001","page_label":"۱۱۵","work_title":"بحار الأنوار","payload":"علم خيرٌ من المال","meta":{"color":"pink","start":2,"end":25,"block_id":"b-0012"}}')
st "$SH"
SHUID=$(echo "$SH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('uid',''))")

echo "== 9) B resolves share (expect 200 + owner_name مدیر سامانه)"
st "$(curl -s -b /tmp/pB.txt http://127.0.0.1:3000/api/v1/shares/$SHUID -w '|%{http_code}')"

echo "== 10) B deletes share (expect 404 اشتراک مورد نظر یافت نشد.)"
st "$(curl -s -b /tmp/pB.txt -X DELETE http://127.0.0.1:3000/api/v1/shares/$SHUID -H 'X-Noor-CSRF: t' -w '|%{http_code}')"

echo "== 11) A revokes (expect 204) then B resolve (expect 410)"
st "$(curl -s -b /tmp/pA.txt -X DELETE http://127.0.0.1:3000/api/v1/shares/$SHUID -H 'X-Noor-CSRF: t' -o /dev/null -w '%{http_code}')"
st "$(curl -s -b /tmp/pB.txt http://127.0.0.1:3000/api/v1/shares/$SHUID -w '|%{http_code}')"

echo "== 12) A POST pdf-jobs via :3000"
PJ=$(curl -s -b /tmp/pA.txt -X POST http://127.0.0.1:3000/api/v1/pdf-jobs -H 'content-type: application/json' -H 'X-Noor-CSRF: t' -d '{"document_uid":"doc-bahar-2","from":"۱۱۵","to":"۱۱۶","include_notes":true,"document_label":"ج ۲","work_title":"بحار الأنوار"}')
st "$PJ"
PJUID=$(echo "$PJ" | python3 -c "import sys,json;print(json.load(sys.stdin).get('uid',''))")

echo "== 13) poll job until done (via proxy)"
TOK=""
for i in $(seq 1 40); do
  ROW=$(curl -s -b /tmp/pA.txt http://127.0.0.1:3000/api/v1/pdf-jobs/$PJUID)
  STATUS=$(echo "$ROW" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'),'|',d.get('progress'),'|',d.get('status_note'))")
  echo "  poll$i: $STATUS"
  if echo "$ROW" | grep -q '"status":"done"'; then
    TOK=$(echo "$ROW" | python3 -c "import sys,json;print(json.load(sys.stdin)['download_token'])")
    break
  fi
  if echo "$ROW" | grep -q '"status":"failed"'; then break; fi
  sleep 3
done

echo "== 14) B GET A's job (expect 404 کار خروجی یافت نشد.)"
st "$(curl -s -b /tmp/pB.txt http://127.0.0.1:3000/api/v1/pdf-jobs/$PJUID -w '|%{http_code}')"

echo "== 15) download via :3000 (wrong token → 403، درست → 200 %PDF)"
st "$(curl -s -b /tmp/pA.txt "http://127.0.0.1:3000/api/v1/pdf-jobs/$PJUID/download?token=WRONG" -w '|%{http_code}')"
DL=$(curl -s -b /tmp/pA.txt -D /tmp/dl-headers.txt "http://127.0.0.1:3000/api/v1/pdf-jobs/$PJUID/download?token=$TOK" -o /tmp/dl.pdf -w '%{http_code}|%{size_download}')
st "download=$DL"
st "magic=$(head -c 5 /tmp/dl.pdf 2>/dev/null)"
st "disposition=$(grep -i 'content-disposition' /tmp/dl-headers.txt | head -1)"

echo "== 16) anon download (expect 401)"
st "$(curl -s "http://127.0.0.1:3000/api/v1/pdf-jobs/$PJUID/download?token=$TOK" -w '|%{http_code}')"

echo "== cleanup: remove e2e rows"
python3 - <<'EOF'
import sqlite3
con = sqlite3.connect('/home/z/my-project/mini-services/noor-api/data/app.sqlite')
cur = con.cursor()
cur.execute("DELETE FROM pdf_jobs WHERE uid LIKE 'pj-%'")
cur.execute("DELETE FROM highlights WHERE uid LIKE 'hl-%'")
cur.execute("DELETE FROM share_links WHERE uid LIKE 'sh-%'")
con.commit()
con.close()
print("cleaned")
EOF
rm -f /home/z/my-project/data/pdf-exports/$PJUID.pdf 2>/dev/null
echo "DONE"
