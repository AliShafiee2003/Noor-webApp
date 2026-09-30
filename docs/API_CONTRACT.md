# قرارداد API v1 — میزکار پژوهشی نور

Base: `/api/v1` (از مرورگر: `/api/v1/...?XTransformPort=8080`). JSON فقط. کوکی نشست: `noor_session` (تولید: `__Host-noor_session`, Secure).
Mutationها باید هدر `X-Noor-CSRF` داشته باشند (token از `GET /auth/session` در حافظهٔ JS). ادمین-sensitive نیاز به هدر `X-Noor-MFA: <totp>` دارند (step-up).

## پاکت خطا (هر خطا ۴ بخش دارد — §۴۸)
```json
{ "error": { "code": "search_expired", "message": "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید.", "trace_id": "...", "retryable": true } }
```
کدها: invalid_credentials(401), unauthenticated(401), mfa_required(403), forbidden(403), not_found(404), conflict_version(409), gone_cursor(410), payload_too_large(413), invalid_query(422), quota(429), rate_limited(429), unavailable(503), internal(500). پیام‌ها فارسی؛ بدون exception انگلیسی/SQL/مسیر دیسک.

## احراز هویت
| مسیر | بدنه/خروجی |
| --- | --- |
| POST /auth/login | `{username,password}` → `{user:{uid,username,display_name,role}}`؛ ادمین بدون TOTP فعال → `{pending_mfa:true,user:{...}}` و نشست «نیمه» است |
| POST /auth/mfa/verify | `{code}` → تکمیل نشست ادمین |
| POST /auth/logout | — |
| GET /auth/session | `{user?, csrf, sessions?}`؛ 401 اگر مهمان |
| GET /auth/sessions | `[{uid,created_at,last_seen,ip,user_agent,current}]` |
| DELETE /auth/sessions/{uid} | لغو |
| POST /auth/accept-invite | `{code,display_name,password}` (نقش از دعوت؛ role در body پذیرفته نمی‌شود) |
| POST /auth/mfa/setup | ادمین → `{secret,otpauth}` |
| POST /auth/mfa/enable | `{code}` |

قواعد: محدودسازی تلاش ورود (بدون افشای وجود حساب)، رمز Argon2id، آخرین ادمین غیرفعال نمی‌شود، هیچ حساب demo وجود ندارد.

## کتابخانه
- `GET /works?q=&language=&author=&sort=title|volumes&page=&page_size=` → `{items:[{uid,title,short_title,author,publisher,year,language,collection_uid,volumes_count,documents_count,cover_uid,topics:[],features:{hadith,quran,footnotes,links,topics,media,searchable_text},published}],total,page,page_size}` — دادهٔ ناموجود `null` است (حدس زده نمی‌شود — LIB-09).
- `GET /works/{uid}` → بالا + `documents:[{uid,label,kind,pages_count,language,coverage:{toc,hadith,quran,footnotes,links,topics,searchable_text}}]` (coverage: supported|partial|absent|failed).
- `GET /works/{uid}/related` → `[{relation_type, target_work_uid?, target_title?, resolved:boolean, note}]`

## مطالعه
- `GET /documents/{uid}/toc` → `{sections:[{uid,title,kind,page_label,children:[...]}]}` (کلیک → anchor همان گره)
- `GET /documents/{uid}/pages?label=...` → `[{page_uid,label,serial,ambiguous:false}]` (تفکیک هم‌نام — READ-04)
- `GET /documents/{uid}/pages/{page_uid}` → صفحه با بلوک‌های ساخت‌یافته:
```json
{ "page_uid":"p-0042","label":"۴۲","serial":42,"release_uid":"rel-...","overlay_revision_uid":"ovl-...|null",
  "overlay_applied":false,"offset_unit":"codepoint",
  "blocks":[{"id":"b-12","type":"p|heading|hadith|ayah_quote|b_note",
    "text":"متن نمایشی","source_offsets":{"start":1234,"end":1400},
    "spans":[{"role":"sanad|G|K|maasoom|ayah_text|B|sharh|lfootnote_ref","start":0,"end":40,
              "G":"أبيه","masum_no":"7","ref":"fn-3","hadith_uid":"h-9","revayat_index":"112"}],
    "links":[{"kind":"link","start":0,"end":30,"original_address":"ج۲ ص۱۱۵","resolved":null,
              "target":{"book_code":"b","volume":"2","page":"115"}}],
    "footnote_refs":[{"ref":"fn-3","start":10,"end":12}] }],
  "footnotes":[{"uid":"fn-3","label":"۱","text":"...","source_offsets":{"start":9000,"end":9300}}] }
```
قواعد: مرز بلوک = مرز صفحه/DocItem حفظ می‌شود؛ عبارت هرگز از چسباندن دو طرف span حذف‌شده ساخته نمی‌شود؛ HAD-09 بخش بی‌نشانه برچسب می‌گیرد (`untagged:true`).
- `GET /anchors/{uid}` → حل anchor پاورقی/روایت/آیه/ارجاع؛ ارجاع حل‌نشده → 404 با `original_address` (بدون هدایت حدسی — REL-10).

## جست‌وجو (§۴۴–۴۷)
- `POST /search`
```json
{ "query":"ما الرسول وما النبي", "mode":"strict_phrase|normalized_phrase|all_words|any_words|near|linguistic|long_quote",
  "scope":{"target":"library|collection|work|document|section","collection_uids":[],"work_uid":null,"document_uids":[],"roles":["body|sanad|b|footnote|maasoom"],"language":null},
  "near":{"slop":3,"ordered":true}, "sort":"relevance|source", "page_size":20 }
```
→
```json
{ "session_uid":"s-...","release_uid":"rel-...","completion_state":"complete|in_progress|cancelled|failed",
  "verified_occurrences":12,"verified_books":3,"count_relation":"lower_bound|exact",
  "continuation_available":true,"next_cursor":"<opaque-signed>","count_job_uid":null,
  "results":[{"passage_uid":"...","match_type":"exact|normalized|linguistic|fuzzy",
    "work":{"uid":"w-...","title":"..."},"document":{"uid":"d-...","label":"ج ۲"},
    "page":{"uid":"p-42","label":"۴۲"},"section":{"uid":"sec-7","title":"..."},
    "snippet":"متن ... با ... متن","highlight":[{"start":40,"end":52,"unit":"codepoint"}],
    "roles":["body"],"local_hadith_uid":"h-9","fingerprint":"fp-...","source_offsets":{"start":1200,"end":1600}}] }
```
- `POST /search/{session_uid}/continue` `{cursor}` → همان شکل؛ 410 `gone_cursor` پس از TTL (۵ دقیقه) با پیام قابل تلاش مجدد.
- `POST /search/{session_uid}/books` → گروه‌بندی کتاب‌های دارای تطبیق تأییدشده: `[{work,documents:[{document,verified_occurrences,evidence:[...]}]}]`
- «این روایت در چه کتاب‌هایی آمده؟» = normalized_phrase + view books؛ UI صریح می‌گوید «منابع دارای این عبارت» و ادعای یکسانی حدیث نمی‌کند (§۴۷).
- سقف: ۳ نشست فعال جست‌وجو برای هر کاربر، page_size 20–50، طول query ۲۰۴۸ codepoint (بیشتر → long_quote تا ۸۱۹۲).

## موضوعات
- `GET /topics?q=&parent=` → `[{"uid","title","count","children":[...]}]` + نکتهٔ پوشش (`coverage_note`).
- `GET /topics/{uid}/occurrences?page=&page_size=` → مواضع با شاهد و anchor (فقط منابع پوشش‌داده — TOP-06)
- `GET /keywords/{uid}` → کلیدواژه + روابط با نوع معلوم + مواضع.

## پژوهش (همه owner-bound؛ دست‌کاری UID کاربر دیگر → 404)
- `GET /projects` → `[{"uid","name","archived","clip_count","updated_at","version"}]`
- `POST /projects {name}` / `PATCH /projects/{uid} {name?,archived?,version}` (409 conflict) / `DELETE /projects/{uid}` (soft)
- `GET /projects/{uid}/clips?state=active|trashed&q=&tag=&page=`
- `POST /clips {project_uid,kind:"original|as_read|note",quote_original,quote_as_read?,prefix_context?,suffix_context?,note?,tags?[],source:{work_uid,document_uid,page_uid?,page_label?,section_uid?,source_offsets:{start,end,unit:"codepoint"},source_version_uid,release_uid,overlay_revision_uid?,local_hadith_uid?}}` → snapshot کامل ذخیره می‌شود (TECH-08)
- `GET /clips/{uid}` / `PATCH /clips/{uid} {version,...}` (409 + مسیر حل تعارض) / `DELETE /clips/{uid}` → سطل / `POST /clips/{uid}/restore` / `GET /clips/{uid}/revisions`
- `GET /notes?document_uid=&page_uid=` / `POST /notes {target:{document_uid,page_uid?,section_uid?,local_hadith_uid?},body}` / PATCH با version
- `GET /bookmarks` / `POST /bookmarks {document_uid,page_uid,label}` / `DELETE /bookmarks/{uid}`
- `GET /saved-searches` / `POST /saved-searches {name,payload}` / `DELETE /saved-searches/{uid}`
- `GET /workspace` → `{recent:[{document_uid,page_uid,label,work_title,updated_at}],prefs:{reader:{font_size,font_family,line_height,display:"paged|continuous"},theme}}`
- `PUT /workspace/position {document_uid,page_uid,progress}` / `PUT /workspace/prefs {...}`

## خروجی
- `POST /exports {project_uid,format:"md|json|csv|print"}` → 202 `{export_uid}` (job کم‌اولویت)
- `GET /exports/{uid}` → `{status:queued|running|done|failed,download_ready}`
- `GET /exports/{uid}/download` → فقط owner؛ retention ۷ روز؛ CSV ایمن‌شده در برابر formula injection.

## مدیریت (فقط admin + در موارد حساس X-Noor-MFA)
- `GET /admin/overview` → موجودی، وضعیت پردازش، release فعال، خطاهای بازگشایی/پارس/نمایه، فضای دیسک، آخرین backup. (دادهٔ پژوهشی کاربران نمایش داده نمی‌شود — ADMIN-10)
- `GET /admin/jobs` / `POST /admin/jobs/{uid}/cancel`
- `GET /admin/sources` → registry (uid، checksum، size، وضعیت، خطاها)
- `POST /admin/index/rebuild` → job ساخت نسل جدید نمایه
- `GET /admin/overlays?status=` / `POST /admin/overlays {document_uid,change_type:"text_replace|metadata",target:{block_id,source_offsets},reason,base_hash,new_text}` (پیش‌نویس)
- `POST /admin/overlays/{uid}/validate` → اعتبارسنجی (hash مبنا، offsets، citation)
- `GET /admin/overlays/{uid}/preview` → `{before,after,affected_anchors[]}`
- `POST /admin/overlays/{uid}/publish` (X-Noor-MFA) → job ساخت نسل → pointer active_release اتمیک + outbox + audit
- `GET /admin/releases` / `POST /admin/releases/{uid}/rollback` (X-Noor-MFA)
- `GET /admin/users` / `POST /admin/invitations {role:admin|reader}` → `{code}` / `POST /admin/users/{uid}/disable|enable` / `POST /admin/users/{uid}/role {role}` (MFA؛ آخرین ادمین محافظت می‌شود)
- `GET /admin/audit?page=` — عملیات حساس

## داخلی (بدون proxy عمومی؛ service token)
- `POST /internal/jobs/claim` / `POST /internal/jobs/{uid}/progress|complete|fail` / `POST /internal/audit`
