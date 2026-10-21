/**
 * تایپ‌های قرارداد API v1 — میزکار پژوهشی نور
 * منبع حقیقت: docs/API_CONTRACT.md
 * توجه: بلوک‌های متن ساخت‌یافته‌اند؛ هرگز innerHTML استفاده نشود.
 */

/* ---------- خطا ---------- */

export type ApiErrorCode =
  | "invalid_credentials"
  | "unauthenticated"
  | "mfa_required"
  | "forbidden"
  | "not_found"
  | "conflict_version"
  | "gone_cursor"
  | "payload_too_large"
  | "invalid_query"
  | "quota"
  | "rate_limited"
  | "csrf"
  | "timeout"
  | "mfa_invalid"
  | "mfa_enabled"
  | "unavailable"
  | "internal";

export interface ApiErrorPayload {
  code: ApiErrorCode | string;
  message: string;
  trace_id: string | null;
  retryable: boolean;
}

/* ---------- احراز هویت ---------- */

export type UserRole = "admin" | "reader";

export interface User {
  uid: string;
  username: string;
  display_name: string;
  role: UserRole;
}

export interface SessionInfo {
  uid: string;
  created_at: string;
  last_seen: string;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

export interface SessionResponse {
  user?: User | null;
  csrf?: string;
  sessions?: SessionInfo[];
}

export interface LoginResponse {
  pending_mfa?: boolean;
  user: User;
  csrf?: string;
}

export interface MfaVerifyResponse {
  user: User;
  csrf?: string;
}

/* ---------- کتابخانه ---------- */

export interface WorkFeatures {
  hadith: boolean;
  quran: boolean;
  footnotes: boolean;
  links: boolean;
  topics: boolean;
  media: boolean;
  searchable_text: boolean;
}

export interface Work {
  uid: string;
  title: string;
  short_title: string | null;
  author: string | null;
  publisher: string | null;
  year: string | null;
  language: string | null;
  collection_uid: string | null;
  volumes_count: number | null;
  documents_count: number | null;
  cover_uid: string | null;
  topics: string[];
  features: WorkFeatures;
  published: boolean;
}

export interface WorkListResponse {
  items: Work[];
  total: number;
  page: number;
  page_size: number;
}

// "unknown": هنوز نمایه نشده/تشخیص داده نشده — هرگز «supported» جعلی گزارش نمی‌شود.
export type CoverageState = "supported" | "partial" | "absent" | "failed" | "unknown";

export interface DocumentCoverage {
  toc: CoverageState;
  hadith: CoverageState;
  quran: CoverageState;
  footnotes: CoverageState;
  links: CoverageState;
  topics: CoverageState;
  searchable_text: CoverageState;
}

export interface DocumentInfo {
  uid: string;
  label: string;
  kind: string;
  pages_count: number | null;
  language: string | null;
  coverage: DocumentCoverage;
}

export interface WorkDetail extends Work {
  documents: DocumentInfo[];
}

export interface RelatedWork {
  relation_type: string;
  target_work_uid?: string | null;
  target_title?: string | null;
  resolved: boolean;
  note?: string | null;
}

/* ---------- مطالعه ---------- */

/**
 * فهرست درختی سند.
 * - قرارداد: uid/title/kind/page_label/children
 * - پیاده‌سازی فعلی سرور: uid/title/level/block_id/children (block_id = مقصد پرش)
 */
export interface TocSection {
  uid: string;
  title: string;
  kind?: string;
  page_label?: string | null;
  page_uid?: string | null;
  level?: number;
  block_id?: string | null;
  children: TocSection[];
}

export interface PageRef {
  page_uid: string;
  label: string;
  serial: number | null;
  ambiguous: boolean;
  /** شمارهٔ چاپی خام (در صورت ارسال سرور) */
  num?: string | null;
}

export type BlockType =
  | "p"
  | "heading"
  | "sanad"
  | "hadith_body"
  | "ayah_quote"
  | "b_note"
  | "sharh"
  | "maasoom"
  /** سازگاری با قرارداد قدیمی */
  | "hadith"
  /** بلوک از تگ ناشناخته — هرگز تفسیر نمی‌شود */
  | "unknown";

export type SpanRole =
  | "sanad"
  | "G"
  | "K"
  | "maasoom"
  | "ayah_text"
  | /** واژهٔ آیه (QUR-05 — قرارداد بازهٔ واژگان حفظ شده) */ "ayahWord"
  | "B"
  | "sharh"
  | "lfootnote_ref"
  | "unknown";

/** استناد آیه (§۱۴) — ayah و ayahAddress مستقل پردازش می‌شوند. */
export interface AyahCitation {
  sure?: string | null;
  aya?: string | null;
  aya_from?: string | null;
  aya_to?: string | null;
  address?: string | null;
  block_id?: string | null;
  in_hadith?: string | null;
  has_parent?: boolean;
}

export interface BlockSpan {
  role: SpanRole;
  start: number;
  end: number;
  /** متن عربی داخل سند روایت */
  G?: string | null;
  masum_no?: string | null;
  ref?: string | null;
  hadith_uid?: string | null;
  revayat_index?: string | null;
  untagged?: boolean;
}

export interface LinkTarget {
  book_code?: string | null;
  volume?: string | null;
  page?: string | null;
  [key: string]: unknown;
}

export interface BlockLink {
  kind: string;
  start: number;
  end: number;
  original_address: string;
  resolved: unknown | null;
  target?: LinkTarget | null;
}

export interface FootnoteRef {
  ref: string;
  start: number;
  end: number;
}

export interface SourceOffsets {
  start: number;
  end: number;
  unit?: string;
}

/**
 * نرمال‌سازی source_offsets بلوک: قرارداد {start,end} یا آرایهٔ [start,end] سرور.
 * در نبود بازهٔ معتبر null برمی‌گردد (حدس زده نمی‌شود).
 */
export function blockOffsets(
  block: Pick<PageBlock, "source_offsets">,
): { start: number; end: number } | null {
  const raw = block.source_offsets;
  if (Array.isArray(raw)) {
    return typeof raw[0] === "number" && typeof raw[1] === "number"
      ? { start: raw[0], end: raw[1] }
      : null;
  }
  return raw && typeof raw.start === "number" && typeof raw.end === "number"
    ? { start: raw.start, end: raw.end }
    : null;
}

export interface PageBlock {
  id: string;
  type: BlockType;
  level?: number;
  text: string;
  /**
   * بازهٔ بلوک در جریان متن نمایشی سند.
   * قرارداد: {start,end}؛ پیاده‌سازی فعلی سرور: آرایهٔ [start,end] — هر دو پذیرفته می‌شود.
   */
  source_offsets: SourceOffsets | [number, number];
  spans?: BlockSpan[];
  links?: BlockLink[];
  footnote_refs?: FootnoteRef[];
  /** استناد آیه برای بلوک‌های ayah_quote/ayahAddress */
  citations?: AyahCitation[];
  /** شناسهٔ محلی روایت (در صورت تعلق بلوک به روایت) — HAD-08 */
  hadith_uid?: string | null;
  revayat_index?: string | null;
  /** بخش بی‌نشانهٔ حدیث (HAD-09) */
  untagged?: boolean;
}

export interface Footnote {
  uid: string;
  label: string;
  text: string;
  source_offsets?: SourceOffsets | null;
}

export interface PagePayload {
  page_uid: string;
  label: string;
  serial: number | null;
  release_uid: string | null;
  overlay_revision_uid: string | null;
  overlay_applied: boolean;
  offset_unit: string;
  blocks: PageBlock[];
  footnotes: Footnote[];
  /** "approximate" یعنی مرز صفحهٔ چاپی از منبع نیامده و تخمینی است؛ ارجاع صفحه را با احتیاط نقل کنید. */
  page_mapping?: "exact" | "approximate";
}

/* ---------- جست‌وجو ---------- */

export type SearchMode =
  | "text"
  | "words"
  | "strict_phrase"
  | "normalized_phrase"
  | "all_words"
  | "any_words"
  | "near"
  | "linguistic"
  | "long_quote"
  | "similar_quote"
  | "tiered";

export type TextFlex = "exact" | "written" | "spelling" | "similar";

export interface WordsOpts {
  match?: "all" | "any";
  distance?: number;
  ordered?: boolean;
}

export type SearchScopeTarget =
  | "library"
  | "collection"
  | "work"
  | "document"
  | "section"
  /** «نام کتاب» در سطح رابط؛ در hash استفاده می‌شود */
  | "titles"
  /** جست‌وجوی پدیدآور / مؤلف */
  | "authors"
  /** جست‌وجوی استناد قرآنی (QUR-03) */
  | "citations";

export interface SearchScope {
  target: SearchScopeTarget;
  collection_uids?: string[];
  work_uid?: string | null;
  author?: string | null;
  document_uids?: string[];
  roles?: string[];
  language?: string | null;
  /** استناد قرآنی: سوره الزامی، آیه اختیاری (بازه پشتیبانی می‌شود) */
  quran?: { sure: string; aya?: string };
}

export interface SearchNear {
  slop: number;
  ordered: boolean;
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  scope: SearchScope;
  /** قرارداد دوحالته جدید: میزان انعطاف در حالت text */
  flex?: TextFlex;
  /** قرارداد دوحالته جدید: تنظیمات حالت words */
  words?: WordsOpts;
  /** فیلتر نمایش لایه‌ها (FTS5) */
  result_layers?: string[];
  near?: SearchNear;
  sort?: "relevance" | "similarity" | "source";
  page_size?: number;
  /** موتور FTS5: «respect» = هر اعرابی که کاربر نوشته باید روی همان حرف در متن باشد */
  diacritics?: "ignore" | "respect" | "respect_strict";
  /** موتور FTS5: محدودسازی لایه‌ها در tiered/similar/long (خالی = L1 تا L4) */
  layers?: SearchLayer[];
  /** موتور FTS5: آستانهٔ شباهت L4 در بازهٔ ۰٫۵ تا ۱ (پیش‌فرض ۰٫۷۰) */
  min_score?: number;
  /** موتور FTS5: L5 — واژهٔ نزدیک با یک ویرایش حرفی (فقط با انتخاب صریح) */
  near_spelling?: boolean;
  /** موتور FTS5: گسترش صرفی L3 (مفرد ↔ جمع با «ها») — فقط با انتخاب صریح */
  expand_morphology?: boolean;
}

/** لایه‌های تطبیق: L1 عین متن، L2 نرمال‌شده، L3 هم‌ارزی املایی، L4 مشابه، L5 واژهٔ نزدیک */
export type SearchLayer = "L1" | "L2" | "L3" | "L4" | "L5";

export interface SimilarityCounts {
  exact: number;
  orthographic: number;
  near_spelling: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  transpositions: number;
  block_moves: number;
  /** افزوده/حذفِ واژه‌های عبارت دعایی شناخته‌شده (جدا از افزوده/حذف عادی) */
  honorific?: number;
}

/** جزئیات امتیاز شباهت لفظی (هرگز «درصد اطمینان علمی» نیست) */
export interface SearchSimilarity {
  score: number;
  coverage: number;
  counts: SimilarityCounts;
  diffs?: string[];
  algorithm: string;
  version: string;
}

export type MatchType = "exact" | "normalized" | "linguistic" | "fuzzy" | (string & {});

export type CompletionState = "complete" | "in_progress" | "cancelled" | "failed";

export interface SearchHighlight {
  start: number;
  end: number;
  unit: string;
}

export interface SearchResultItem {
  passage_uid: string;
  match_type: MatchType;
  work: { uid: string; title: string; label?: string };
  document: { uid: string; label: string };
  page: { uid: string; label: string };
  section: { uid: string; title: string; label?: string } | null;
  snippet: string;
  highlight: SearchHighlight[];
  roles: string[];
  local_hadith_uid: string | null;
  /** شمارهٔ درون‌منبع روایت (HAD-08) — شناسهٔ محلی است و تعمیم نمی‌یابد */
  revayat_index?: string | null;
  fingerprint: string | null;
  source_offsets: SourceOffsets | null;
  /** بازهٔ دقیق تطبیق در مختصات سند — برای هایلایت کتاب‌خوان */
  match_offsets?: [number, number] | null;
  /** لایهٔ تطبیق (فقط موتور FTS5) */
  layer?: SearchLayer;
  /** تفاوت‌های L3/L5 با پرسش (مثلاً «پیشوند و»، «همزه/الف») */
  diffs?: string[];
  /** هم‌ترازی L4 (و امتیاز لایه‌های دیگر در similar_quote) */
  similarity?: SearchSimilarity | null;
  /** متن کامل قطعه در صورت روایت یا استخراج */
  full_text?: string;
}

export interface SearchResponse {
  session_uid: string;
  release_uid: string | null;
  completion_state: CompletionState;
  verified_occurrences: number | null;
  verified_books: number | null;
  /** TECH-11: شمارش جداگانهٔ قطعه‌ها و روایت‌های متمایز */
  verified_passages?: number | null;
  verified_hadiths?: number | null;
  count_relation: "lower_bound" | "exact";
  continuation_available: boolean;
  next_cursor: string | null;
  count_job_uid: string | null;
  notice?: string | null;
  results: SearchResultItem[];
  /** شمار اختصاصی هر لایه (FTS5، حالت‌های لایه‌ای) */
  layer_counts?: Partial<Record<SearchLayer, number>> | null;
  /** شمار نتایج L4/L5 — جدا از verified_occurrences (شمار قطعی) */
  similar_occurrences?: number | null;
  /** کل نتایج قابل‌پیمایش (قطعی + مشابه) */
  total_results?: number | null;
  /** پوشش L4: complete | partial | not_run (سقف‌های تعاملی) */
  similar_coverage?: "complete" | "partial" | "not_run" | null;
  /** حالت و انعطاف مؤثر اعمال‌شده توسط سرور */
  effective_mode?: string | null;
  effective_flex?: string | null;
  result_layers?: string[] | null;
  /** نام موتور و نسخهٔ قواعد پاسخ‌دهنده */
  engine?: string | null;
}

export interface SearchBooksEvidence {
  snippet?: string;
  highlight?: SearchHighlight[];
  page?: { uid: string; label: string };
  document?: { uid: string; label: string };
}

export interface SearchBooksGroup {
  work: { uid: string; title: string };
  documents: Array<{
    document: { uid: string; label: string };
    verified_occurrences: number | null;
    evidence: SearchBooksEvidence[];
  }>;
}

/**
 * گروه دیالوگ §۴۷ با «فیش‌های من» — سرور شمار فیش‌های فعالِ کاربرِ همین
 * روایت را برای هر سند (my_clips) اضافه می‌کند؛ سند بدون فیش مقدار 0 دارد.
 */
export interface HadithLocationsGroup {
  work: { uid: string; title: string };
  documents: Array<{
    document: { uid: string; label: string };
    verified_occurrences: number | null;
    evidence: SearchBooksEvidence[];
    my_clips?: number;
  }>;
}

/* ---------- «این روایت در چه کتاب‌هایی آمده؟» (§۴۷) ---------- */

export interface HadithLocationsInfo {
  document_uid: string;
  local_uid: string;
  piece_index: number;
  revayat_index?: string | null;
  body_excerpt?: string | null;
  body_length?: number | null;
  body_blocks?: number;
  sanad_blocks?: number;
}

export interface HadithLocationsPass {
  note: string;
  query_excerpt: string;
  works_found: number;
  works_added: number;
}

export interface HadithLocationsResponse {
  hadith: HadithLocationsInfo;
  query_truncated?: boolean;
  query_excerpt?: string;
  pass_note?: string;
  passes?: HadithLocationsPass[];
  verified_occurrences: number;
  verified_books: number;
  groups: HadithLocationsGroup[];
  note?: string | null;
  disclaimer: string;
}

/* ---------- موضوعات ---------- */

export interface Topic {
  uid: string;
  title: string;
  count: number | null;
  children: Topic[];
  coverage_note?: string | null;
}

/* ---------- پژوهش ---------- */

export interface Project {
  uid: string;
  name: string;
  archived: boolean;
  clip_count: number | null;
  updated_at: string | null;
  version: number;
}

export type ClipKind = "original" | "as_read" | "note";

export interface ClipSource {
  work_uid: string;
  document_uid: string;
  page_uid?: string | null;
  page_label?: string | null;
  section_uid?: string | null;
  source_offsets: SourceOffsets;
  /**
   * بازهٔ تخت هم‌ارز source_offsets — پیاده‌سازی فعلی سرور این شکل را می‌خواند.
   * هر دو شکل برای سازگاری با قرارداد ارسال می‌شود.
   */
  start?: number;
  end?: number;
  offset_unit?: string;
  source_version_uid?: string | null;
  release_uid?: string | null;
  overlay_revision_uid?: string | null;
  local_hadith_uid?: string | null;
}

export type ClipSaveState = "saving" | "saved" | "failed";

export interface Clip {
  uid: string;
  project_uid: string;
  kind: ClipKind;
  quote_original: string;
  quote_as_read?: string | null;
  prefix_context?: string | null;
  suffix_context?: string | null;
  note?: string | null;
  tags: string[];
  source: ClipSource;
  created_at?: string | null;
  updated_at?: string | null;
  version: number;
  /** وضعیت ذخیره در سمت رابط */
  save_state?: ClipSaveState;
  trashed?: boolean;
}

/**
 * یادداشت شخصی روی سند/صفحه (RES) — شکل تختِ هم‌نام با سرور:
 * GET /notes → {items:[Note]}؛ POST /notes → Note؛ PATCH /notes/{uid} {version,body}
 * هیچ توکن/شناسهٔ خصوصی دیگری جابه‌جا نمی‌شود.
 */
export interface Note {
  uid: string;
  document_uid: string;
  page_uid?: string | null;
  /** برچسب چاپی صفحهٔ مقصد — از مدل سند در سرور پر می‌شود (نمایشی) */
  page_label?: string | null;
  section_uid?: string | null;
  local_hadith_uid?: string | null;
  body: string;
  version: number;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * خلاصهٔ فیش متصل به یک روایت — GET /my/clips?document_uid=&local_hadith_uid=
 * فقط فیش‌های فعالِ خود کاربر از همهٔ پرونده‌هایش (نمای «فیش‌های این روایت»).
 */
export interface HadithClipSummary {
  uid: string;
  project_uid: string;
  project_name: string;
  kind: ClipKind;
  quote_original: string;
  note?: string | null;
  tags: string[];
  page_uid?: string | null;
  page_label?: string | null;
  updated_at?: string | null;
}

/**
 * خلاصهٔ فیش برای نمای «همهٔ فیش‌های من» در میزکار —
 * GET /my/clips/all?kind=&q=&tag= → {items:[MyClip], total}
 * عنوان اثر از کاتالوگ سرور می‌آید و در نبود آن خالی است (نه حدس).
 */
export interface MyClipSummary {
  uid: string;
  project_uid: string;
  project_name: string;
  kind: ClipKind;
  quote_original: string;
  note?: string | null;
  tags: string[];
  work_uid?: string;
  work_title?: string;
  document_uid?: string;
  page_uid?: string | null;
  page_label?: string | null;
  updated_at?: string | null;
}

/** توزیع برچسب‌های فیش‌های من — GET /my/clips/tags (چیپ‌های پالایش) */
export interface ClipTagSummary {
  tag: string;
  count: number;
}

export interface Bookmark {
  uid: string;
  document_uid: string;
  page_uid: string;
  label: string | null;
  created_at?: string | null;
}

export interface SavedSearch {
  uid: string;
  name: string;
  payload: Record<string, unknown>;
  created_at?: string | null;
}

/* ---------- میزکار (workspace) ---------- */

export type ReaderDisplay = "paged" | "continuous";

/** عرض ستون متن مطالعه — «متوسط» مطابق DESIGN حدود ۷۶۰px است. */
export type ReaderTextWidth = "narrow" | "medium" | "wide";

export interface ReaderPrefs {
  /** اندازهٔ قلم متن مطالعه (px) — بازهٔ ۱۶ تا ۳۲ */
  font_size: number;
  /** قلم نثر عربی: "amiri" | "scheherazade" | "vazirmatn" (src/lib/fonts.ts) */
  font_family: string;
  /** قلم متن قرآنی (تگ ayah): "amiri-quran" | "scheherazade-new" — پیش‌فرض amiri-quran */
  font_quran?: string;
  /** قلم متون لاتین شناسایی‌شده: "source-serif" | "inter" — پیش‌فرض source-serif */
  font_latin?: string;
  /** اندازهٔ متن قرآنی (px) — پیش‌فرض ۲۴ */
  quran_font_size?: number;
  /** فاصلهٔ سطر متن قرآنی — پیش‌فرض ۲٫۰ */
  quran_line_height?: number;
  /** فاصلهٔ سطرها — بازهٔ ۱.۴ تا ۲.۴ */
  line_height: number;
  display: ReaderDisplay;
  /** عرض متن مطالعه (اختیاری؛ پیش‌فرض medium) */
  text_width?: ReaderTextWidth;
  /** READ-13: رنگ‌بندی و نشانه‌گذاری نقش‌های معنایی (اختیاری؛ پیش‌فرض خاموش) */
  semantic_colors?: boolean;
}

export interface WorkspacePrefs {
  reader: ReaderPrefs;
  theme?: string | null;
}

export interface RecentItem {
  document_uid: string;
  page_uid: string;
  label: string | null;
  work_title: string | null;
  updated_at: string | null;
  /** اگر سرور ارسال کند؛ در غیر این صورت نوار پیشرفت نمایش داده نمی‌شود */
  progress?: number | null;
}

export interface WorkspaceState {
  recent: RecentItem[];
  prefs: WorkspacePrefs;
}

/** موضع مطالعهٔ یک سند (READ-12) */
export interface ReaderPosition {
  page_uid?: string | null;
  progress?: number | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

/**
 * پاسخ واقعی GET /workspace:
 * {positions: {document_uid: ReaderPosition}, prefs, bookmarks?}
 * (قرارداد قدیمی {recent,prefs} نیز ممکن است؛ هر دو پشتیبانی می‌شود.)
 */
export interface WorkspacePositionsResponse {
  positions?: Record<string, ReaderPosition>;
  prefs?: WorkspacePrefs;
  bookmarks?: Bookmark[];
  recent?: RecentItem[];
}

/* ---------- مدیریت ---------- */

export interface AdminOverview {
  corpus?: {
    works?: number | null;
    documents?: number | null;
    pages?: number | null;
  } | null;
  processing?: {
    queued?: number | null;
    running?: number | null;
    failed?: number | null;
  } | null;
  active_release?: string | null;
  errors?: {
    extraction?: number | null;
    parsing?: number | null;
    indexing?: number | null;
  } | null;
  disk?: {
    used_bytes?: number | null;
    free_bytes?: number | null;
  } | null;
  last_backup?: string | null;
}

export interface AdminJob {
  uid: string;
  kind: string;
  status: string;
  progress?: number | null;
  created_at?: string | null;
}

export interface AdminUserRow {
  uid: string;
  username: string;
  display_name: string;
  role: UserRole;
  disabled?: boolean;
  created_at?: string | null;
}

export interface AdminAuditRow {
  uid: string;
  actor_uid?: string | null;
  action: string;
  detail?: string | null;
  created_at?: string | null;
}

/* ---------- §۷-الف: هایلایت، اشتراک و خروجی‌ها ---------- */

/** رنگ‌های مجاز هایلایت — مقدار ذخیره‌شده و کلاس CSS آن در highlight-color.ts */
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";

/** هایلایت شخصی — لنگر: block_id + بازهٔ code point درون بلوک (§۷-الف-۳) */
export interface Highlight {
  uid: string;
  document_uid: string;
  page_uid: string;
  block_id: string;
  start: number;
  end: number;
  text: string;
  color: HighlightColor;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** خلاصهٔ اشتراک فعال (فهرست تنظیمات) */
export interface ShareLinkInfo {
  uid: string;
  kind: "note" | "highlight";
  document_uid: string;
  page_uid?: string | null;
  page_label?: string | null;
  work_title?: string | null;
  /** پیش‌نمایش محتوای اشتراک‌شده */
  excerpt: string;
  created_at?: string | null;
  expires_at?: string | null;
  url_path: string;
}

/** پاسخ ساخت اشتراک */
export interface ShareCreateResponse {
  uid: string;
  url_path: string;
}

/** محتوای حل‌شدهٔ یک اشتراک برای کاربر واردشده */
export interface SharedItem {
  kind: "note" | "highlight";
  owner_name: string;
  document_uid: string;
  page_uid?: string | null;
  page_label?: string | null;
  work_title?: string | null;
  /** برای note: متن یادداشت؛ برای highlight: متن هایلایت */
  payload: string;
  meta?: { color?: HighlightColor; start?: number; end?: number; block_id?: string; revayat_index?: string | null } | null;
  created_at?: string | null;
}

/** کار تولید PDF (§۷-الف-۲) */
export interface PdfJob {
  uid: string;
  document_uid: string;
  document_label: string;
  work_title?: string | null;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  status_note?: string | null;
  file_bytes?: number | null;
  created_at?: string | null;
  finished_at?: string | null;
  /** مسیر نسبی دانلود خصوصی (با توکن منقضی‌شدنی) — فقط برای کار done */
  download_url?: string | null;
  token_expires_at?: string | null;
  params?: { from?: string | null; to?: string | null; whole: boolean; include_notes: boolean };
}

/** نتیجهٔ خروجی جست‌وجو (پاسخ POST /export/search به‌صورت فایل؛ این متادیتا از هدرها می‌آید) */
export interface SearchExportMeta {
  partial: boolean;
  rows: number;
  total_verified: number | null;
  offset_next: number | null;
  format: "csv" | "xlsx" | "markdown";
}
