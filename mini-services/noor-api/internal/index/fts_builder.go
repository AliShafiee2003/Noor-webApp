// Package index — سازندهٔ نسل نمایه‌های FTS5 چندستونه، شاردها و واژگان سراسری (§۲۱/§۲۲/§۲۴).
//
// ساختار نسل (یک پوشه برای هر release؛ هیچ فایلی بین دو release مشترک نیست):
//
//	library_index_<rel>.sqlite          پایگاه اصلی: passages کانونی، docs، واژگان، عناوین، manifest
//	library_index_<rel>_shard<i>.sqlite شاردها: fts_phrase (contentless) و reuse_postings
//
// قراردادها:
//   - rowid هر passage در fts_phrase = seq سراسری آن در پایگاه اصلی؛ seq به ترتیب نوشتن
//     اسناد (ترتیب canonical کاتالوگ) تخصیص می‌یابد، پس ORDER BY rowid = ترتیب canonical.
//   - جدول‌های FTS5 contentless‌اند (content=”)؛ متن فقط یک بار در passages نگه داشته می‌شود.
//   - واژه‌بندی منحصراً در Go (norm.TokenizeAligned) و هر واژه با norm.FTSToken امن می‌شود؛
//     پس هر واژهٔ Go دقیقاً یک واژهٔ FTS5 با tokenizer «ascii» است (بررسی در checkFTSTokens).
//   - نمایهٔ بازکاربرد روی «جریان» سند است (بدنهٔ passageها بدون tail هم‌پوشانی)؛ pos موضع
//     واژه در همان جریان است و stream_start/stream_end هر passage در پایگاه اصلی ثبت می‌شود.
//   - DF واژگان فقط از بدنهٔ passage شمرده می‌شود (tail هم‌پوشانی دو بار شمرده نمی‌شود).
package index

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	"noor/internal/norm"
	"noor/internal/xmlparse"
)

// FTSSchemaVersion نسخهٔ شمای نسل FTS5؛ موتور نسل با نسخهٔ دیگر را نمی‌پذیرد.
const FTSSchemaVersion = "fts-2"

// ReuseHashName نام تابع hash نمایهٔ بازکاربرد (جزء manifest — §۲۲).
const ReuseHashName = "fnv1a64-sep1f/reusekey-v1"

// FTSShardOptions تنظیمات سازندهٔ نمایه.
type FTSShardOptions struct {
	ReleaseUID string
	OutputDir  string // پوشهٔ همین release (فایل‌ها مستقیم در آن نوشته می‌شوند)
	NumShards  int    // تعداد شاردها (پیش‌فرض ۴)
}

// FTSIndexWriter مدیر نوشتن نسل نمایه‌های FTS5 و شاردها.
// استفاده: NewFTSIndexWriter → WriteDocument (به ترتیب canonical) → Finalize → Close.
type FTSIndexWriter struct {
	opts       FTSShardOptions
	mainDB     *sql.DB
	mainPath   string
	shards     []*sql.DB
	shardPaths []string
	shardLoads []int64

	vocab   map[string]*vocabN1 // کلید: N1
	vocabN2 map[string]*dfcf    // کلید: N2

	nextSeq   int64
	nextDoc   int64
	passages  int64
	docs      int64
	failures  []string
	finalized bool
}

type vocabN1 struct {
	n2     string
	df, cf int32
}

type dfcf struct{ df, cf int32 }

// VocabEntry ردیف واژگان (برای سازگاری با ابزارها و آزمون‌ها).
type VocabEntry struct {
	N1 string
	N2 string
	DF int
	CF int
}

// MainPath / ShardPaths مسیر فایل‌های نسل.
func (w *FTSIndexWriter) MainPath() string     { return w.mainPath }
func (w *FTSIndexWriter) ShardPaths() []string { return append([]string(nil), w.shardPaths...) }

// FTSMainFile و FTSShardFile نام‌گذاری قطعی فایل‌های یک release.
func FTSMainFile(rel string) string { return fmt.Sprintf("library_index_%s.sqlite", rel) }
func FTSShardFile(rel string, i int) string {
	return fmt.Sprintf("library_index_%s_shard%d.sqlite", rel, i)
}

// NewFTSIndexWriter یک نویسندهٔ نمایهٔ جدید ایجاد می‌کند. پوشهٔ خروجی نباید فایل‌های
// همان release را از پیش داشته باشد (نسل immutable است؛ بازنویسی نیمه‌کاره ممنوع).
func NewFTSIndexWriter(opts FTSShardOptions) (*FTSIndexWriter, error) {
	if opts.NumShards <= 0 {
		opts.NumShards = 4
	}
	if opts.ReleaseUID == "" || strings.ContainsAny(opts.ReleaseUID, "/\\ \t\n") {
		return nil, fmt.Errorf("شناسهٔ release نامعتبر است: %q", opts.ReleaseUID)
	}
	if err := os.MkdirAll(opts.OutputDir, 0o755); err != nil {
		return nil, err
	}
	mainPath := filepath.Join(opts.OutputDir, FTSMainFile(opts.ReleaseUID))
	if _, err := os.Stat(mainPath); err == nil {
		return nil, fmt.Errorf("نسل %s از پیش در %s وجود دارد؛ نسل‌ها immutable‌اند", opts.ReleaseUID, opts.OutputDir)
	}
	mainDB, err := sql.Open("sqlite", mainPath)
	if err != nil {
		return nil, fmt.Errorf("open main release db: %w", err)
	}
	mainDB.SetMaxOpenConns(1)
	w := &FTSIndexWriter{
		opts:     opts,
		mainDB:   mainDB,
		mainPath: mainPath,
		vocab:    make(map[string]*vocabN1),
		vocabN2:  make(map[string]*dfcf),
		nextSeq:  1,
		nextDoc:  1,
	}
	for i := 0; i < opts.NumShards; i++ {
		sPath := filepath.Join(opts.OutputDir, FTSShardFile(opts.ReleaseUID, i))
		_ = os.Remove(sPath)
		sDB, err := sql.Open("sqlite", sPath)
		if err != nil {
			w.Close()
			return nil, fmt.Errorf("open shard db %d: %w", i, err)
		}
		sDB.SetMaxOpenConns(1)
		w.shards = append(w.shards, sDB)
		w.shardPaths = append(w.shardPaths, sPath)
	}
	w.shardLoads = make([]int64, opts.NumShards)
	if err := w.initSchemas(); err != nil {
		w.Close()
		return nil, err
	}
	return w, nil
}

// Close تمام اتصالات دیتابیس را می‌بندد.
func (w *FTSIndexWriter) Close() {
	if w.mainDB != nil {
		w.mainDB.Close()
		w.mainDB = nil
	}
	for i, s := range w.shards {
		if s != nil {
			s.Close()
			w.shards[i] = nil
		}
	}
}

func (w *FTSIndexWriter) initSchemas() error {
	mainDDL := `
	PRAGMA journal_mode=MEMORY;
	PRAGMA synchronous=OFF;
	CREATE TABLE passages (
		seq INTEGER PRIMARY KEY,           -- = rowid در fts_phrase شارد؛ ترتیب canonical
		passage_uid TEXT NOT NULL UNIQUE,
		release_uid TEXT, collection_uid TEXT, work_uid TEXT, document_uid TEXT,
		doc_ord INTEGER, shard_id INTEGER,
		section_uid TEXT, page_uid TEXT, page_label TEXT, language TEXT,
		local_hadith_uid TEXT, revayat_index TEXT,
		text_original TEXT, text_n1 TEXT, n1_map TEXT,
		source_start INTEGER, source_end INTEGER,
		role_ranges TEXT, citations TEXT, fingerprint TEXT,
		block_start INTEGER, block_end INTEGER, overlap_runes INTEGER,
		body_start INTEGER,                -- آفست محلی نخستین نویسهٔ بدنه (پس از tail)
		stream_start INTEGER, stream_end INTEGER  -- بازهٔ واژه‌های بدنه در جریان سند
	);
	CREATE INDEX idx_passages_doc_stream ON passages(doc_ord, stream_start);
	CREATE TABLE docs (
		doc_ord INTEGER PRIMARY KEY,       -- ترتیب canonical سند
		document_uid TEXT NOT NULL UNIQUE,
		work_uid TEXT, collection_uid TEXT, language TEXT, shard_id INTEGER,
		seq_lo INTEGER, seq_hi INTEGER, stream_len INTEGER, words INTEGER
	);
	CREATE INDEX idx_docs_work ON docs(work_uid);
	-- rev: n1 وارونه برای یافتن «واژهٔ نزدیک» با پسوند مشترک (L5)
	CREATE TABLE vocabulary (n1 TEXT PRIMARY KEY, n2 TEXT, df INTEGER, cf INTEGER, rev TEXT) WITHOUT ROWID;
	CREATE INDEX idx_vocab_n2 ON vocabulary(n2);
	CREATE INDEX idx_vocab_rev ON vocabulary(rev);
	CREATE TABLE vocab_n2 (n2 TEXT PRIMARY KEY, df INTEGER, cf INTEGER) WITHOUT ROWID;
	CREATE TABLE titles (
		work_uid TEXT PRIMARY KEY, title TEXT, title_n1 TEXT, short_title TEXT,
		author TEXT, publisher TEXT, language TEXT, topics TEXT
	);
	CREATE TABLE manifest (key TEXT PRIMARY KEY, value TEXT);
	`
	if _, err := w.mainDB.Exec(mainDDL); err != nil {
		return fmt.Errorf("init main schema: %w", err)
	}
	shardDDL := `
	PRAGMA journal_mode=MEMORY;
	PRAGMA synchronous=OFF;
	-- نمایهٔ عبارت (§۲۱): سه ستون هم‌تراز از یک واژه‌بندی Go؛ contentless، rowid = seq
	-- n1: واژه‌های N1 | n1_bi: دوواژه‌ای N1 | n2k: کلید هم‌ارزی آزاد (N2 + پیشوندهای چسبان، norm.ReuseKey)
	CREATE VIRTUAL TABLE fts_phrase USING fts5(n1, n1_bi, n2k, content='', tokenize='ascii');
	-- نمایهٔ بازکاربرد متن (§۲۲): (hash, سند، موضع واژه در جریان سند)
	CREATE TABLE reuse_postings (
		hash INTEGER NOT NULL, doc_ord INTEGER NOT NULL, pos INTEGER NOT NULL,
		PRIMARY KEY (hash, doc_ord, pos)
	) WITHOUT ROWID;
	`
	for i, sDB := range w.shards {
		if _, err := sDB.Exec(shardDDL); err != nil {
			return fmt.Errorf("init shard %d schema: %w", i, err)
		}
	}
	return nil
}

// SelectShard سند را به خلوت‌ترین شارد بر پایهٔ شمار واژه‌ها تخصیص می‌دهد (§۲۴).
func (w *FTSIndexWriter) SelectShard(estimatedWords int64) int {
	minIdx := 0
	for i := 1; i < len(w.shardLoads); i++ {
		if w.shardLoads[i] < w.shardLoads[minIdx] {
			minIdx = i
		}
	}
	w.shardLoads[minIdx] += estimatedWords
	return minIdx
}

// RecordFailure سندی که استخراج/نوشتنش شکست خورد ثبت می‌شود تا در manifest بیاید
// (هیچ سندی بی‌صدا کنار گذاشته نمی‌شود).
func (w *FTSIndexWriter) RecordFailure(documentUID string, err error) {
	w.failures = append(w.failures, fmt.Sprintf("%s: %v", documentUID, err))
}

// Failures فهرست شکست‌های ثبت‌شده.
func (w *FTSIndexWriter) Failures() []string { return append([]string(nil), w.failures...) }

// checkFTSToken اطمینان از این‌که واژه برای tokenizer ascii دقیقاً یک واژه است.
func checkFTSToken(s string) error {
	if s == "" {
		return errors.New("واژهٔ تهی")
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x80 && !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') {
			return fmt.Errorf("واژهٔ %q نویسهٔ جداکنندهٔ ASCII دارد", s)
		}
	}
	return nil
}

type passageTokens struct {
	n1, n1bi, n2k []string
	bodyKeys      []string // کلیدهای بازکاربرد واژه‌های بدنه
	bodyStart     int      // آفست محلی آغاز بدنه
	bodyN1        []string
	bodyN2        []string
}

func tokenizePassage(p *Passage) passageTokens {
	toks := norm.TokenizeAligned(p.TextOriginal)
	pt := passageTokens{bodyStart: 0}
	if p.OverlapRunes > 0 {
		pt.bodyStart = p.OverlapRunes + 1
	}
	pt.n1 = make([]string, len(toks))
	pt.n2k = make([]string, len(toks))
	for i, tk := range toks {
		pt.n1[i] = norm.FTSToken(tk.N1)
		key := norm.ReuseKey(tk.N2)
		pt.n2k[i] = norm.FTSToken(key)
		if tk.Start >= pt.bodyStart {
			pt.bodyN1 = append(pt.bodyN1, tk.N1)
			pt.bodyN2 = append(pt.bodyN2, tk.N2)
			pt.bodyKeys = append(pt.bodyKeys, key)
		}
	}
	pt.n1bi = norm.BuildBigrams(pt.n1)
	return pt
}

// WriteDocument یک سند را پردازش، واژه‌بندی و به شارد مربوطه و پایگاه اصلی منتقل می‌کند.
// اسناد باید به ترتیب canonical (ترتیب کاتالوگ: اثر، جلد) نوشته شوند.
func (w *FTSIndexWriter) WriteDocument(releaseUID, collectionUID, workUID, documentUID, language string, model *xmlparse.DocModel) (int, error) {
	if w.finalized {
		return 0, errors.New("نسل نهایی شده است")
	}
	if releaseUID != w.opts.ReleaseUID {
		return 0, fmt.Errorf("release ناهمخوان: %s ≠ %s", releaseUID, w.opts.ReleaseUID)
	}
	builder := &Builder{}
	passages := builder.BuildDoc(releaseUID, collectionUID, workUID, documentUID, language, model)
	if len(passages) == 0 {
		return 0, nil
	}
	ptoks := make([]passageTokens, len(passages))
	totalWords := int64(0)
	for i := range passages {
		ptoks[i] = tokenizePassage(&passages[i])
		totalWords += int64(len(ptoks[i].bodyN1))
	}
	shardID := w.SelectShard(totalWords)
	shardDB := w.shards[shardID]
	docOrd := w.nextDoc

	sTx, err := shardDB.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin shard %d tx: %w", shardID, err)
	}
	defer sTx.Rollback()
	mTx, err := w.mainDB.Begin()
	if err != nil {
		return 0, fmt.Errorf("begin main tx: %w", err)
	}
	defer mTx.Rollback()

	insFTS, err := sTx.Prepare(`INSERT INTO fts_phrase(rowid, n1, n1_bi, n2k) VALUES(?, ?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer insFTS.Close()
	insPass, err := mTx.Prepare(`INSERT INTO passages(
		seq, passage_uid, release_uid, collection_uid, work_uid, document_uid, doc_ord, shard_id,
		section_uid, page_uid, page_label, language, local_hadith_uid, revayat_index,
		text_original, text_n1, n1_map, source_start, source_end,
		role_ranges, citations, fingerprint, block_start, block_end, overlap_runes,
		body_start, stream_start, stream_end
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return 0, err
	}
	defer insPass.Close()

	seqLo := w.nextSeq
	streamPos := 0
	// قطعه‌های پیوستهٔ جریان: passage بدون tail (به‌جز نخستین) یعنی ناپیوستگی → مرز سخت
	type segment struct{ start, end int }
	var segs []segment
	var streamKeys []string
	for i := range passages {
		p := &passages[i]
		pt := &ptoks[i]
		for _, col := range [][]string{pt.n1, pt.n1bi, pt.n2k} {
			for _, tok := range col {
				if err := checkFTSToken(tok); err != nil {
					return 0, fmt.Errorf("passage %s: %w", p.PassageUID, err)
				}
			}
		}
		if len(pt.n1) != len(pt.n1bi) || len(pt.n1) != len(pt.n2k) {
			return 0, fmt.Errorf("passage %s: ستون‌های هم‌تراز طول برابر ندارند", p.PassageUID)
		}
		seq := w.nextSeq
		w.nextSeq++
		if len(pt.n1) > 0 {
			if _, err := insFTS.Exec(seq, strings.Join(pt.n1, " "), strings.Join(pt.n1bi, " "), strings.Join(pt.n2k, " ")); err != nil {
				return 0, fmt.Errorf("insert fts_phrase: %w", err)
			}
		}
		if i == 0 || p.OverlapRunes == 0 {
			segs = append(segs, segment{start: streamPos, end: streamPos})
		}
		sStart := streamPos
		streamPos += len(pt.bodyKeys)
		streamKeys = append(streamKeys, pt.bodyKeys...)
		segs[len(segs)-1].end = streamPos

		nm, _ := json.Marshal(p.N1Map)
		if _, err := insPass.Exec(seq, p.PassageUID, p.ReleaseUID, p.CollectionUID, p.WorkUID, p.DocumentUID, docOrd, shardID,
			p.SectionUID, p.PageUID, p.PageLabel, p.Language, p.LocalHadith, p.RevayatIndex,
			p.TextOriginal, p.TextN1, string(nm), p.SourceStart, p.SourceEnd,
			string(p.RoleRanges), string(p.Citations), p.Fingerprint, p.BlockStart, p.BlockEnd, p.OverlapRunes,
			pt.bodyStart, sStart, streamPos); err != nil {
			return 0, fmt.Errorf("insert main passage: %w", err)
		}
		// واژگان: فقط بدنه
		seen1 := make(map[string]bool, len(pt.bodyN1))
		seen2 := make(map[string]bool, len(pt.bodyN2))
		for j, t1 := range pt.bodyN1 {
			t2 := pt.bodyN2[j]
			v := w.vocab[t1]
			if v == nil {
				v = &vocabN1{n2: t2}
				w.vocab[t1] = v
			}
			v.cf++
			if !seen1[t1] {
				seen1[t1] = true
				v.df++
			}
			v2 := w.vocabN2[t2]
			if v2 == nil {
				v2 = &dfcf{}
				w.vocabN2[t2] = v2
			}
			v2.cf++
			if !seen2[t2] {
				seen2[t2] = true
				v2.df++
			}
		}
	}

	// نمایهٔ بازکاربرد (§۲۲): winnowing روی هر قطعهٔ پیوسته؛ shingle از مرز سخت عبور نمی‌کند
	insReuse, err := sTx.Prepare(`INSERT OR IGNORE INTO reuse_postings(hash, doc_ord, pos) VALUES(?, ?, ?)`)
	if err != nil {
		return 0, err
	}
	defer insReuse.Close()
	for _, sg := range segs {
		if sg.end-sg.start < DefaultWinnowingK {
			continue
		}
		for _, fp := range ComputeFingerprints(streamKeys[sg.start:sg.end], DefaultWinnowingK, DefaultWinnowingW) {
			if _, err := insReuse.Exec(int64(fp.Hash), docOrd, sg.start+fp.Pos); err != nil {
				return 0, fmt.Errorf("insert reuse_posting: %w", err)
			}
		}
	}
	if _, err := mTx.Exec(`INSERT INTO docs(doc_ord, document_uid, work_uid, collection_uid, language, shard_id, seq_lo, seq_hi, stream_len, words)
		VALUES (?,?,?,?,?,?,?,?,?,?)`, docOrd, documentUID, workUID, collectionUID, language, shardID, seqLo, w.nextSeq-1, streamPos, totalWords); err != nil {
		return 0, fmt.Errorf("insert doc: %w", err)
	}
	if err := sTx.Commit(); err != nil {
		return 0, fmt.Errorf("commit shard tx: %w", err)
	}
	if err := mTx.Commit(); err != nil {
		return 0, fmt.Errorf("commit main tx: %w", err)
	}
	w.nextDoc++
	w.docs++
	w.passages += int64(len(passages))
	return len(passages), nil
}

// ShardFileInfo مشخصات هر فایل نسل در manifest.
type ShardFileInfo struct {
	File   string `json:"file"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// Finalize واژگان، عناوین، بهینه‌سازی FTS5 و manifest را می‌نویسد. پس از Finalize
// فایل‌ها فقط‌خواندنی‌اند.
func (w *FTSIndexWriter) Finalize(titles []TitleRow) error {
	if w.finalized {
		return errors.New("Finalize دو بار فراخوانده شد")
	}
	if err := w.writeTitles(titles); err != nil {
		return fmt.Errorf("write titles: %w", err)
	}
	mTx, err := w.mainDB.Begin()
	if err != nil {
		return err
	}
	defer mTx.Rollback()
	st1, err := mTx.Prepare(`INSERT INTO vocabulary(n1, n2, df, cf, rev) VALUES(?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	// ترتیب قطعی درج (مستقل از ترتیب تصادفی map) → ساخت تکرارپذیر
	keys1 := make([]string, 0, len(w.vocab))
	for k := range w.vocab {
		keys1 = append(keys1, k)
	}
	sort.Strings(keys1)
	for _, k := range keys1 {
		v := w.vocab[k]
		if _, err := st1.Exec(k, v.n2, v.df, v.cf, reverseString(k)); err != nil {
			return fmt.Errorf("insert vocab: %w", err)
		}
	}
	st1.Close()
	st2, err := mTx.Prepare(`INSERT INTO vocab_n2(n2, df, cf) VALUES(?, ?, ?)`)
	if err != nil {
		return err
	}
	keys2 := make([]string, 0, len(w.vocabN2))
	for k := range w.vocabN2 {
		keys2 = append(keys2, k)
	}
	sort.Strings(keys2)
	for _, k := range keys2 {
		v := w.vocabN2[k]
		if _, err := st2.Exec(k, v.df, v.cf); err != nil {
			return fmt.Errorf("insert vocab_n2: %w", err)
		}
	}
	st2.Close()
	if err := mTx.Commit(); err != nil {
		return err
	}

	for i, sDB := range w.shards {
		for _, q := range []string{
			`INSERT INTO fts_phrase(fts_phrase) VALUES('optimize')`,
			`INSERT INTO fts_phrase(fts_phrase) VALUES('integrity-check')`,
			`ANALYZE`,
			`VACUUM`,
		} {
			if _, err := sDB.Exec(q); err != nil {
				return fmt.Errorf("shard %d: %s: %w", i, q, err)
			}
		}
	}
	if _, err := w.mainDB.Exec(`ANALYZE`); err != nil {
		return fmt.Errorf("analyze main db: %w", err)
	}

	// manifest — پیش از VACUUM نهایی پایگاه اصلی (هش شاردها؛ پایگاه اصلی خودش manifest دارد)
	for _, s := range w.shards {
		s.Close()
	}
	w.shards = nil
	var files []ShardFileInfo
	for _, sp := range w.shardPaths {
		fi, err := os.Stat(sp)
		if err != nil {
			return err
		}
		cs, err := ComputeChecksum(sp)
		if err != nil {
			return err
		}
		files = append(files, ShardFileInfo{File: filepath.Base(sp), Size: fi.Size(), SHA256: cs})
	}
	filesJSON, _ := json.Marshal(files)
	// پرتکرارترین واژه‌ها برای warm-up موتور
	type tf struct {
		w  string
		df int32
	}
	var tops []tf
	for k, v := range w.vocab {
		tops = append(tops, tf{k, v.df})
	}
	sort.Slice(tops, func(i, j int) bool {
		if tops[i].df != tops[j].df {
			return tops[i].df > tops[j].df
		}
		return tops[i].w < tops[j].w
	})
	var topWords []string
	for i := 0; i < len(tops) && i < 32; i++ {
		topWords = append(topWords, tops[i].w)
	}
	topJSON, _ := json.Marshal(topWords)
	sort.Strings(w.failures)
	failJSON, _ := json.Marshal(w.failures)
	meta := map[string]string{
		"schema_version": FTSSchemaVersion,
		"release_uid":    w.opts.ReleaseUID,
		"num_shards":     fmt.Sprintf("%d", w.opts.NumShards),
		"shard_files":    string(filesJSON),
		"shard_loads":    fmt.Sprintf("%v", w.shardLoads),
		"passages":       fmt.Sprintf("%d", w.passages),
		"docs":           fmt.Sprintf("%d", w.docs),
		"docs_failed":    fmt.Sprintf("%d", len(w.failures)),
		"failures":       string(failJSON),
		"vocab_n1":       fmt.Sprintf("%d", len(w.vocab)),
		"vocab_n2":       fmt.Sprintf("%d", len(w.vocabN2)),
		"norm_version":   norm.Version,
		"winnowing_k":    fmt.Sprintf("%d", DefaultWinnowingK),
		"winnowing_w":    fmt.Sprintf("%d", DefaultWinnowingW),
		"guaranteed_t":   fmt.Sprintf("%d", GuaranteedT),
		"reuse_hash":     ReuseHashName,
		"fts_tokenizer":  "ascii+FTSToken",
		"built_at":       time.Now().UTC().Format(time.RFC3339),
		"top_terms":      string(topJSON),
	}
	keys := make([]string, 0, len(meta))
	for k := range meta {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if _, err := w.mainDB.Exec(`INSERT OR REPLACE INTO manifest(key, value) VALUES(?, ?)`, k, meta[k]); err != nil {
			return fmt.Errorf("record manifest %s: %w", k, err)
		}
	}
	if _, err := w.mainDB.Exec(`VACUUM`); err != nil {
		return fmt.Errorf("vacuum main db: %w", err)
	}
	w.finalized = true
	return nil
}

func (w *FTSIndexWriter) writeTitles(titles []TitleRow) error {
	for _, t := range titles {
		topics, _ := json.Marshal(t.Topics)
		if _, err := w.mainDB.Exec(`INSERT INTO titles(work_uid,title,title_n1,short_title,author,publisher,language,topics)
			VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(work_uid) DO UPDATE SET title=excluded.title`,
			t.WorkUID, t.Title, norm.Fold(t.Title), t.ShortTitle, t.Author, t.Publisher, t.Language, string(topics)); err != nil {
			return err
		}
	}
	return nil
}

// ComputeChecksum محاسبه هش SHA-256 یک فایل برای manifest.
func ComputeChecksum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func reverseString(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}
