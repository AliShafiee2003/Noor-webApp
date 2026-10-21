# Noor Figma migration — 2026-10-17

Latest handoff (2026-10-20): `docs/HANDOFF_FIGMA_TO_CODE_2026-10-20_FA.md` contains the complete continuation prompt, source locations, approved decisions and verification limits.

## Session setup (2026-10-20, continuation state)

- OpenCode runs as the desktop app; config lives at `C:/Users/alish/.config/opencode/opencode.json`. Added MCP entries: `figma` (remote `https://mcp.figma.com/mcp`, OAuth — account must be `cypress.dlxxx@gmail.com`, owner of the Noor file) and `figma-desktop` (`http://127.0.0.1:3845/mcp`). OAuth completes when a new session starts; tools then appear as `figma_*`.
- MCP probe (2026-10-20 later session): the docker-MCP catalog is empty (0 matches), so `figma` cannot be attached from inside a running session; `figma_*` tools were absent. Port 3845 (desktop MCP) is closed even though the Figma desktop app is running. User decision: **restart the OpenCode session** so the remote `figma` MCP attaches (OAuth completes at session start). First action of the next session: verify `figma_get_metadata`/`figma_get_design_context` are callable before any Figma-derived edits.
- Dev-server port constraint (new): Windows reserves TCP range 2958–3057 (`netsh int ipv4 show excludedportrange protocol=tcp`), so `next dev -p 3000` fails with EACCES on 0.0.0.0:3000. Dev server was launched in the background on **port 3200** (`npm run dev -- -p 3200 -H 127.0.0.1`, hidden cmd, log at `D:/Noor/.dev-server.log`). The `/dev/design-system` and `/dev/design-system/mobile` fixtures both returned HTTP 200 on `http://127.0.0.1:3200`. Re-check listener state next session; do not treat 3000-based review URLs as reachable unless the reserved range is freed (admin action, not attempted).
- Verification recorded 2026-10-20 (auth edit set only): `npx tsc --noEmit` exit 0; targeted eslint on `src/views/login-view.tsx`, `src/views/recovery-view.tsx`, `src/components/app-shell.tsx`, `src/components/design-system/field.tsx`, `src/components/design-system/feedback-message.tsx` exit 0. No visual/browser review of login/recovery yet — blocked on Figma MCP context for nodes `2270:2988` and `2177:5693`.
- Chrome debugging: installed Chrome 155 blocks `--remote-debugging-port` on the default profile. A dedicated persistent profile runs at `D:/Noor/.chrome-debug` with port 9222 (`chrome.exe --remote-debugging-port=9222 --user-data-dir=D:\Noor\.chrome-debug`). Playwright MCP is configured with `--cdp-endpoint=http://127.0.0.1:9222`. The user logs into the Noor app inside that Chrome window once; credentials never pass through the agent.
- `figma-desktop` port 3845 was still closed at setup time; Dev Mode → "Enable desktop MCP server" must be clicked in the Figma desktop app if the remote server fails.
- Next steps unchanged: finish login/recovery review (nodes `2270:2988`, `2177:5693` via MCP, desktop + mobile, including the real password-visibility behavior, back path and pending-destination preservation), bring up frontend (now on port 3200) and Go API (port 8080, run from `mini-services/noor-api` so `./data` resolves; config via env in `internal/config/config.go`, default engine fts5), then continue page-by-page migration.

## Figma MCP connectivity fix (2026-10-20)

- Root cause chain: no OAuth credentials were stored by OpenCode (`~/.local/share/opencode/auth.json` absent), and OpenCode's default MCP OAuth callback path `http://127.0.0.1:19876/mcp/oauth/callback` is rejected by Figma's dynamic registration endpoint (`400 invalid_redirect_uri` — Figma only accepts loopback redirects ending in `/callback`).

### Reconnect playbook (figma remote MCP)

1. Config check — `C:/Users/alish/.config/opencode/opencode.json` must keep the `figma` entry exactly:
   `"type": "remote", "url": "https://mcp.figma.com/mcp", "oauth": {"redirectUri": "http://127.0.0.1:19876/callback"}`.
   The `oauth.redirectUri` ending in `/callback` is what Figma accepts; removing it silently breaks the OAuth flow (`400 invalid_redirect_uri` at registration).
2. If credentials are lost: run `opencode mcp auth figma`. When it asks "already has valid credentials. Re-authenticate?" answer **Yes** for a fresh flow. It registers the client, then opens the Figma authorize screen — approve on the owner account **cypress.dlxxx@gmail.com** (if the screen shows another account, use "Switch accounts"; passwords are entered by the user only). Tokens are stored by the core in `~/.local/share/opencode/` (auth store), shared by CLI and desktop app.
3. CLI availability: `npm i -g opencode-ai` (installed 2026-10-20, v1.19.3). It shares `~/.config/opencode` config and the core data dir with the desktop app.
4. Verify: `opencode mcp list` — expect `figma connected (OAuth)`; `opencode mcp debug figma` — expect `Auth status: authenticated`. These run a fresh attach and don't need the session.
5. Tools availability: `figma_*` tools bind only at OpenCode session start. After any auth/config change, **restart the OpenCode session**; first action of the new session is a probe (`figma_get_metadata` on node `2270:2988` or `2270:2987`) to confirm the right account and access.
6. Docker-MCP catalog has no figma entry (0 matches) — this is expected; `figma` is an OpenCode-native remote server, not a docker gateway server, and cannot be attached via `docker_mcp`.
7. `figma-desktop` fallback (port 3845) only works after Dev Mode → "Enable desktop MCP server" is clicked in the Figma desktop app; we do not depend on it.

## Fix applied and verification (2026-10-20)

- Fix applied: added `oauth.redirectUri: http://127.0.0.1:19876/callback` to the `figma` entry in `C:/Users/alish/.config/opencode/opencode.json`, installed the standalone CLI (`npm i -g opencode-ai`) and ran `opencode mcp auth figma`.
- Result: `opencode mcp list` shows `figma connected (OAuth)`; `opencode mcp auth` reports `authenticated`. The desktop app shares the same core data dir, so a **session restart** is required for `figma_*` tools to attach.
- Account caveat: the authorize page first showed a different Figma account (`asad@buylandingpage.xyz`) than the required owner account (`cypress.dlxxx@gmail.com`). After the session restart, first test `figma_get_metadata` on node `2270:2988`; on permission errors re-run `opencode mcp auth figma`, answer Yes to re-authenticate, and approve on the authorize screen while switched to the owner account.
- `figma-desktop` (port 3845) remains failed — Dev Mode MCP is not enabled in the Figma desktop app; only useful as a fallback.

## Verified 2026-10-20 (login/recovery functional review, port 3200)

- Figma MCP: still not attached this session (`figma_*` tools absent, docker-MCP catalog 0 matches; both `figma` and `figma-desktop` entries remain enabled in `opencode.json`). Visual parity vs nodes `2270:2988` / `2177:5693` is still blocked until OAuth completes or the desktop MCP on port 3845 is enabled.
- Chrome/Playwright caveat: the cdp-attached Chrome throttles rAF while backgrounded, so real `browser_click` can stall forever on the "stable" check; call `bringToFront()` before click-based actions after periods of inactivity.
- Browser-verified on `http://127.0.0.1:3200` (desktop 1536px + mobile 390px screenshots archived in `figma-export/code-migration-2026-10-17/` as `login-mobile-390.png`, `recovery-mobile-390.png`):
  - Password visibility: real pointer click toggles both ways — input `password`⇄`text`, `aria-pressed`, label «نمایش/پنهان‌کردن گذرواژه», and the typed value is retained across toggling.
  - Submit stays disabled until both fields are non-empty.
  - «بازیابی با کمک مدیر سامانه» → `/#/recovery`; its «بازگشت به ورود» returns to `/#/login`; a direct guest visit to `/#/recovery` renders the guide (public route), and recovery is excluded from `setPendingDestination` (`src/components/app-shell.tsx:183`).
  - Guest at `/#/search` renders `LoginView` while the URL hash stays `/#/search`; `setPendingDestination` stores the original hash (memory-only) for post-login restore — final restore step requires backend, untested.
  - Backend still down from the browser side: dev BFF returns 503 for `/api/v1/auth/session`; the connected `sessionError` alert with «تلاش دوباره» renders and wraps (cramped at 390px — compare against Figma `2270:2988` before styling changes).
  - MFA code entry: Persian/Arabic digit→ASCII conversion reviewed in code only; the full MFA flow needs the Go API/admin creds and remains untested.
- `npx tsc --noEmit` re-confirmed exit 0 on the current tree (2026-10-20 later session).

## Reference

- File: `ScYzQ9qGgou6YcnQrQtfgB`.
- Approved desktop palette preview page: `2270:2987`; continuous reader reference: `2281:3899`.
- Figma MCP design context was used for the reader, controls, topics and appearance compositions.
- `src/design-system/figma-component-map.json` inventories 42 component families and their code locations. This is a local inventory, not official Code Connect configuration. Code Connect was unavailable for the connected plan.

## Theme architecture

`src/design-system/skins/emerald-night.json` is the initial approved dark skin. Run `npm run design:tokens` after changing it; commit the generated `src/design-system/tokens.css` alongside the source. Components consume semantic roles such as canvas, chrome, surface, elevated, input-surface, text, border and ring. Avoid literal skin colors inside components.

The generated skin applies to the default dark palette. Explicitly saved light/system preferences and the existing alternate palette choices remain supported. A future skin needs the same complete semantic role map, a generated selector and a palette registry entry. It should not require duplicating components. New dark visitors start with Emerald Night.

Exact Book and Previous SVGs were downloaded from MCP exports into `public/icons/noor/`. Their masks use the current text color; temporary Figma URLs are not runtime dependencies.

## Figma design delta survey (2026-10-20, `figma_*` tools unbound; direct MCP JSON-RPC via `D:/Noor/.figma-mcp.py`)

- Account resolved definitively: token belongs to `asad@buylandingpage.xyz` (handle "Ali Shafiee"); `whoami` + successful `get_metadata` on the Noor file prove access, so requiring owner `cypress.dlxxx@gmail.com` is moot. Stored tokens live in `~/.local/share/opencode/mcp-auth.json` (never print). REST `/v1/me` is out of scope (`mcp:connect` only).
- Warning: the MCP "list top-level pages" hint is unreliable - it returned only 3 of 10 pages. Enumeration was done by probing candidate node ids (helpers: `D:/Noor/.figma-depth1.py`, `.figma-probe.py`, `.figma-sweep2.py`, `.figma-cmp2.py`).
- Live page inventory (all probe-verified canvases): `0:1` 00 Foundations (single doc frame "Noor • Layout standard" `2038:2`), `2:2` 01 Desktop, `2:3` 02 Mobile, `2235:86` 03 Library/Start, `2235:87` 04 Library/Controls, `2235:88` 05 Library/Patterns, `2235:89` 06 Library/Themes, `2260:88` 07 Library/Color palette, `2270:2987` 08 Desktop/Palette preview, `2235:90` 98 Library/Legacy.
- Page `08` (2270:2987) holds 33 "Preview / *-1440" screens (`2270:2988`..`2270:12726`) plus 11 allottered reader code-parity states (`2281:3899` continuous, `2281:4359`, `4825`, `5279`, `5763`, `6232`, `19798`, `21920`, `22372`, `22824`, `2283:3184` fiche).
- Page `01` (2:2) keeps ALL original desktop screens with ancient ids (7:2..2006:7737) plus ~180 state variants (login/invite filled-visible-error, compare 4, archive/delete flows, fiche-note 5, reader-note 5, note-history, pdf 9 + share 5 + exports 4, admin-invite 10, admin job/correction/rollback/audit 20, security 8, new-research 4, saved-search 3, settings reset 2) and its own 11 parity states (`2281:16986`+).
- Page `02` (2:3) keeps all 34 mobile base screens (`13:2037`..`2006:11442`, including `reader-pdf-390` `2006:9280`) plus state variants and 11 parity states (`2281:14850`+).
- Libraries 03-07/98 intact at family level: all 42 mapped families (`src/design-system/figma-component-map.json`) still live on `2235:87/88` with the same node ids; depth-1 listings written to `D:/Noor/.figma-p-controls.txt` / `.figma-p-patterns.txt`.
- Structural comparison of all 44 desktop pairs (01-copy vs 08-Preview): 43/44 identical subtree shape (tag/name/width/height rows, root name normalized). ONLY delta found: `Preview / search-1440` (`2270:4612`) - one card block grew `92px -> 116px` (rows @114-116: `card-content` 92->116). Verdict: page 08 is a faithful copy of current 01 state, not a redesign.
- Desktop-only gap: no `reader-pdf` desktop frame exists on `2:2` or `08` (mobile `reader-pdf-390` survives on `2:3`); continuous/paged parity states carry the desktop reader reference. Stored `reader-pdf-1440.json` in `figma-export` root is a code-render capture, not a Figma node.
- Coverage limits: comparisons match node structure, not variable-bound visuals (fills/fonts differ only if variables diverge). Mobile page unverified against stored renders; recovery frame `2177:5693` still live with original id (in-place screen on its flow page). Foundations page 00 rebuilt as one doc frame - no older snapshot exists to diff.
- Working files (delete freely once done): `D:/Noor/.figma-mcp.py` (rpc caller: `rpc`, `call_tool name key=value`, writes `.figma-last.txt`), `.figma-parse.py`, `.figma-depth1.py`, `.figma-probe.py`, `.figma-sweep2.py`, `.figma-cmp*.py`, `.figma-p-*.txt` pages, `.figma-struct*.txt` reports, `.figma-pagetrees.txt`.

## Implemented scope (existing content continues)

- Shared buttons, inputs, selects, textareas, cards, badges, tabs, tables, menus and modal surfaces now use the semantic palette and consistent spacing.
- Reader toolbar and settings share the paged/continuous control. Existing reader rendering, state and API callbacks remain in place.
- Font choices use a dropdown. Page navigation has a labeled popover and preserves manual Persian/Arabic number entry.
- Topic rows have bounded RTL text and optional real count metadata; no empty decorative badge is created.
- Appearance cards, saved-search empty state and search chips have bounded layout and padding.
- Highlight foreground colors are paired with the highlight background role.
- The production SearchForm now follows the MCP Search/Mobile-words progressive layout: a visible query summary, one bounded advanced-options scroll region, and search/simple-mode actions outside it. Existing query defaults and request serialization are preserved. Five choice controls compose the shared ChoiceButton rather than carrying fixed light colors.
- Reader mobile controls retain a visible study-mode toggle. The floating tool strip is bounded to the viewport; selected bookmark/note controls retain the correct primary foreground/background pair.

## Review surfaces and verification

- Development only: `/dev/design-system` and `/dev/design-system/mobile` (390px iframe viewport). These are component review fixtures, not backend integration demos; production access returns not found.
- `/dev/search` and `/dev/search/mobile` render the production search form with local fixture state. The 390px words/advanced view was visually reviewed. The actual `/#/search` route was reached but showed the sign-in screen and a service-unavailable message; authenticated production route review remains blocked by service/session availability.
- TypeScript passed after reader toolbar changes. Desktop controls/dialog and mobile component layout were visually inspected in the browser.
- A broader lint attempt found an existing hooks error in `src/components/ui/carousel.tsx:98`; that unrelated file was not changed.

## Remaining migration work

Latest code written, awaiting final review: `src/views/login-view.tsx` now composes shared Fields, password visibility, loading and administrator-assisted recovery entry. `src/views/recovery-view.tsx` implements the Figma recovery guide; `src/components/app-shell.tsx` exposes public `/#/recovery` and excludes it from the post-login pending destination. No reset-request endpoint was added. These latest auth UI edits have not yet received a recorded visual/compiler check.

## Figma vs code page-by-page parity (2026-10-20)

Full text-level comparison of every live Figma screen against `src/**` was finished; write-up: `docs/FIGMA_CODE_PARITY_2026-10-20.md`. Method: Figma XML text extraction (`.figma-desktop-sum.json`, `.figma-mobile-sum.json`, 162/164 frames) -> substring match against collected code strings (`.code-strings.json`) -> manual verification of every flagged string in source (`.parity3.txt`, `.verify.txt`).

Verdict: no functional break - every designed screen/view pairs 1:1 with an implementation. Findings are: (a) 11 wording variances listed as items 1a-1k (login recovery link, work meta labels `سال/مجلدات/اسناد`, admin publish chip, reader toolbar labels `حالت مطالعهٔ خلوت/خروجی PDF/سنجاق`, compare `ستون اول/دوم`, project history `تاریخچهٔ فیش`, search match-reason box `تفاوت‌ها با پرسش:`, topic section headings); (b) 4 missing caption texts (library badge legend, settings auto-save note [equivalent exists in reader `settings-popover.tsx:340`], reader settings scroll hint, admin stats section titles); (c) exactly one real data/contract delta: invite code TTL - design says ۷ روز, code+API enforce 24h (`noor-api/internal/httpapi/admin.go:346`, `cmd/adminctl:43`); design value is stale, needs a product decision. Limitations: text/structure only, no screenshot rendering; browser visual pass still pending API availability (8080 down).

The inventory records mappings, not completed pixel parity. Review every production desktop/mobile route against its corresponding Figma frame, including loading, empty, error, long-content and modal states. Inspect real backend data in reader, search and admin flows. Complete any composition-specific differences and verify keyboard/focus behavior. No full production build or backend end-to-end verification is recorded for this migration yet.

## Parity fixes applied (2026-10-20, same day as the audit)

All wording variances 1a-1k and all 4 missing captions were applied to `src/**` on product owner approval ("از فیگما کد رو تبدیل کن. روی تم‌ها و نسخهٔ موبایل و وب پیاده کن"), including: login recovery link text; invite description sentence; work meta labels `سال چاپ/مجلدات اثر/اسناد موجود` + `پوشش ثبت‌شده برای این سند` heading; reader-toolbar + mobile float labels `ثابت کردن نوار/دریافت PDF/مطالعهٔ متمرکز` (aria+title on both desktop toolbar and `reader-view.tsx` float); settings reading tab caption; `settings-popover.tsx` scroll hint; compare pane labels `موضع اول/موضع دوم` + mobile sub-note; project history `تاریخچهٔ یادداشت` + `فعلی` badge on the current revision; `result-card.tsx` `علت تطبیق:` box heading; admin overview grouped sections `موجودی و حساب‌ها`/`نسخه‌ها و منابع` + `وضعیت کارهای سامانه` strip; library badge legend. All strings ride on shared components and semantic tokens, so they cover desktop, mobile and every theme in one place (no hardcoded colors were introduced). `npx tsc --noEmit` passes. NOT changed: invite TTL stays 24h (design's ۷ روز is stale; backend contract untouched per migration rule) - revisit only after a product decision. Pixel/visual verification against Figma screenshots is still pending the local API.

## Reader desktop redesign applied (2026-10-20, node 2270:10337)

Per product owner instruction («این صفحه نیاز به باز طراحی داره» — the reading page design has completely changed and needs remaking), the reader was rebuilt against the new Figma frame `2270:10337` (Reader-1440, `Noor/Pattern/ReaderTools/Desktop`, `Noor/Control/ReaderSearch`, `Noor/Pattern/ReaderPageNavigation/Desktop`). Applied in `src/components/reader/reader-toolbar.tsx` + `src/views/reader-view.tsx`:

- Desktop toolbar is now two-tier (≈129px band): [right] back-to-library + plain-text breadcrumb `اثر / جلد / ۱۲ ص` (the pill chip was replaced by the design's `N ص` indicator); [center] compact display-mode group (`rounded-[10px] border p-[3px]`, two 42×32 buttons `ScrollText=continuous` / `BookOpenText=paged`, active filled with `bg-primary`), `ReaderPageControl`-style jump trigger 216×44 (`رفتن به صفحهٔ ۱۴`, chevron leading), and 44×44 outlined prev/next; [left] six **labeled** tools (settings opens the popover; study / receive PDF / bookmarks / copy reference / pin toolbar) as 80px units with 42×36 rounded icon buttons and 14px captions, plus the in-book search field 180×44 beneath with end-side search/X icons.
- Bottom pagination (paged mode) now matches the design: single `صفحهٔ بعد (Number)` outline CTA end-side plus `N صفحه` count (faNum applied); continuous mode keeps its `پایین این جلد — N صفحه` notice.
- Left context aside tabs switched from underline style to filled tabs (active `bg-primary text-primary-foreground`, count badge adapts), labels `زمینه`/`یادداشت‌ها` with the search tab appearing dynamically on an active in-book query — as in the frame (`Legacy/Desktop/tab/yauohu|1l6mazz`).
- Right TOC aside was already structurally identical to the frame (`فهرست و نشانک‌ها`, `ListTree`/`Bookmark` section headers, leaf dots, same empty-state copy) — unchanged.
- Reading preferences popover already implements every control the frame shows (display mode, size/line sliders with value readouts, semantic-roles switch, prose/Quran font selects, width and appearance segments, both hint copies) — unchanged beyond earlier parity wording.

Verified live on `#/read/d-00166-01314-01314_001` at 1440×900 (admin session): labeled tool units 42×36, search 180×44, mode group primary fill `#8ed3bd`, jump 216×44, nav 44×44 bordered, breadcrumb `آثار آقا محمد رضا قمشه‌ای / جلد 1 / ۱۴ ص`, filled tab `زمینه` with primary bg, paged bottom row `صفحهٔ بعد (۱۵)` + `۴۷۹ صفحه`, in-book search submit switches to the search tab. `npx tsc --noEmit` passes; ESLint clean on the toolbar (reader-view keeps 10 pre-existing diagnostics verified identical to HEAD's rule findings). Mobile keeps the previous single-row compact toolbar (the frame defines desktop only).

## Preservation

The repository already contained substantial uncommitted work. A copy of the source at migration start is at `D:/Noor/figma-export/code-migration-2026-10-17/baseline/src`. Backend services, credentials and API contracts were not edited as part of this migration.

## Stabilization program (2026-10-21) - phase 0 baseline

The app is functionally rich but not in its most stable state (product-owner decision, 2026-10-21: structural and large fixes approved; goal is maximum runtime stability). Confirmed evidence at program start: 26 eslint errors across 5 files (reader-view 10, use-mobile 2, carousel 1, notes-panel, book-search-panel), zero ErrorBoundary anywhere (render exceptions = white screen), continuous reading mode dispatching ALL page queries at once (the comment claims limited parallelism but the enabled flag never limits - ~470 concurrent fetches observed live), 64 scattered per-view React-Query overrides over a single retry:false default, no request timeout in src/lib/api.ts, no tests.

User decisions: order = fix failures and data flow (phases 0-2) before design-token/responsive work (3-5); commit at the end of each phase; NO new test infra (playwright test stays an unused devDependency - verification is manual browser review by the agent session plus a user checklist).

### Gates and scripts

- npm run check = tsc --noEmit && next build (green required before every phase commit)
- npm run check:lint = eslint .
- npm run check:all = all three (becomes the gate from phase 3 onward)
- Build note: stop the dev server (port 3200) before next build - dev and build share .next.

### Phase plan

| Phase | Scope | Key files |
|---|---|---|
| 0 baseline | clean commit of all open work; check scripts; this ledger | package.json, .gitignore, docs |
| 1 failure barriers | per-route ErrorBoundary in app-shell.tsx CurrentView switch; unified retry policy (2x, only ApiError.retryable); staleTime table per resource; 15s fetch timeout in api.ts | app-shell.tsx, providers.tsx, lib/api.ts |
| 2 reader data flow | windowed continuous render (IntersectionObserver, about 2 pages visible in DOM), bounded prefetch, scroll-spy and position-save rework, placeholders with measured heights | reader-view.tsx (92-174, 427-510, 1370-1420), page-renderer.tsx |
| 3 React correctness | zero eslint errors (real fixes; disable only with written justification); split reader-view.tsx (1949 lines) into reader/ hooks and components | views, components/reader, hooks, ui/carousel |
| 4 token discipline | typography scale replacing 137 arbitrary text-[Npx] and a 12px floor for 339 micro-text sites; merge 43 one-off tokens; Panel primitive vs 471 border sites; visual QC before/after | globals.css and about 100 files |
| 5 middle lane 768-1280 | tablet reader (asides become Sheet, condensed toolbar), admin and library tables in scroll-x frames, manual 390/768/1024/1440 review | reader toolbar, admin, library, settings |

Rules: frontend src/** only; Go API and contracts untouched; commit messages in Persian; runtime commands: next dev on port 3200 via npx next dev -p 3200 (package.json dev script says 3000 - do not use), API on 8080 plus worker via bin/api.exe and bin/worker.exe started detached with env NOOR_HTTP_PORT=8080 NOOR_DATA_DIR=./data NOOR_SOURCES_DIR=./data/sources NOOR_SERVICE_TOKEN=dev-internal-token NOOR_COOKIE_SECURE=false.

### Manual review checklist (per phase, reused)

1. Home loads; library list; open a work.
2. Reader opens any document: paged and continuous; prev/next; TOC jump; bookmark; note; font and size change persists after reload.
3. In-document search; fiche/study retrieval; citation chip behavior.
4. Settings; theme switch; logout/login; invited session path.
5. Admin: overview, jobs, users, audit tabs load without a white screen.
6. Console: no NEW errors (filter out known pre-existing diagnostics recorded above).
7. After any build: npm run check green; dev relaunched with npx next dev -p 3200.

### Baseline hygiene notes (phase 0)

- Newly ignored: log files, exe files, patches, /fonts/ staging cache, /data/ scratch, .codebase-memory/, tool-results/, __pycache__/.
- Accidental duplicate directory copies from an earlier copy/restore anomaly are ignored and untracked: app_development/, docs/docs/, mini-services/mini-services/, public/public/ (all remain on disk). Pending user decision: they look safe to delete; NOT deleted during phase 0 without approval.
- .env is historically tracked; current diff is mode-only (100755 to 100644), no content change. Committed as-is.
- Tracked data binaries under mini-services/noor-api/data/ mutate at runtime; expect them dirty in later status output - ignore that churn (later phases stage source files explicitly instead of git add -A).
- playwright stays an unused devDependency per the no-test-infra decision.

## Stabilization / phase 1 (2026-10-21): failure barriers

- NEW route-level error boundary `src/components/route-error-boundary.tsx`, wrapped around EVERY view render in `app-shell.tsx` (authed main + full-screen reader, recovery, guest login/invite, pending_mfa). On a render exception it shows a Persian Card fallback (تلاش دوباره / بازگشت به خانه) with a collapsed technical-details block, logs `[noor] رندر مسیر با خطا متوقف شد` to the console with the component stack, and auto-resets when the route changes (routeKey = route.fullHash). The rest of the shell (header/nav) keeps working.
- `src/lib/api.ts`: every request now carries a default 15s timeout (AbortSignal.timeout composed with the caller signal via AbortSignal.any). Caller-initiated aborts still surface as AbortError; timeout maps to ApiError code "timeout" (retryable:true, Persian message). File downloads bypass this client (href/window.open) and stay unaffected.
- `src/components/providers.tsx` QueryClient: unified retry policy - at most 2 attempts and only when `ApiError.retryable` is true; logical/validation errors fail fast so their Persian messages render. refetchOnWindowFocus stays false, default staleTime 30s unchanged. The 60+ per-site `retry:false`/`staleTime` overrides are intentionally left as-is for a later consolidation pass (recorded under phase 3/4 sweeps).
- DISCOVERED AND FIXED a long-running invisible dev blocker: browsing via `127.0.0.1` without `allowedDevOrigins` makes Next 16/Turbopack block the `/_next/hmr` websocket, and after that React NEVER hydrates - the page stays on the SSR loading skeleton forever (React devtools hook shows zero renderers, no fetches fire, no console error besides the WS retries). Fix: `allowedDevOrigins: ["127.0.0.1"]` added to `next.config.ts` (dev-restart required; the server advertises hostname localhost only by default).
- Verified live (admin, ~3s per route after handling the bringToFront rAF-throttle caveat): home, library, work detail, reader continuous + paged, settings, admin all render; the only console error is the expected 401 from the login probe; the boundary fallback never triggered; `npx tsc --noEmit` + eslint on touched files clean; `npm run check` (tsc + next build) green twice this phase.
