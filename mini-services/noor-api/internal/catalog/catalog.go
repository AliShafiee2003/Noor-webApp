// Package catalog — هویت مجموعه، بازکردن منابع فقط‌خواندنی با LRU، مدل مشتق سند.
package catalog

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"noor/internal/noordb"
	"noor/internal/xmlparse"
)

// WorkManifest و DocManifest از fixturegen می‌آیند (همان ساختار JSON).

type Work struct {
	UID        string          `json:"uid"`
	Title      string          `json:"title"`
	ShortTitle string          `json:"short_title"`
	Author     string          `json:"author"`
	Publisher  *string         `json:"publisher"`
	Year       *string         `json:"year"`
	Language   string          `json:"language"`
	Topics     []string        `json:"topics"`
	Documents  []DocumentMeta  `json:"documents"`
	Related    []RelatedRecord `json:"related"`
}

type DocumentMeta struct {
	UID      string `json:"uid"`
	File     string `json:"file"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Checksum string `json:"checksum"`
	Size     int64  `json:"size_bytes"`
	Language string `json:"language"`
}

type RelatedRecord struct {
	RelationType string `json:"relation_type"`
	Target       string `json:"target_work_uid"`
	Note         string `json:"note"`
}

// Service کاتالوگ و LRU مدل سند.
type Service struct {
	mu         sync.RWMutex
	works      []Work
	byUID      map[string]*Work
	docByUID   map[string]DocumentMeta
	docWork    map[string]string // docUID ← workUID (رفع N+1 کاتالوگ)
	sourcesDir string
	knownFeats map[string]map[string]bool // از زمان نمایه‌سازی (internal/features)
	modelCache map[string]*cacheEntry
	featCache  map[string]*Features // کش پوشش اثر — کاتالوگ در زمان اجرا تغییرنکردنی است
	modelOrder []string
	modelSem   chan struct{} // §۳۸ decode تعاملی هم‌زمان ≤۲
}

type cacheEntry struct {
	model *xmlparse.DocModel
	at    time.Time
}

const modelCacheMax = 32 // §۳۸

func Load(sourcesDir string) (*Service, error) {
	return LoadFile(sourcesDir, "catalog.json")
}

// LoadFile کاتالوگ را با نام فایل مشخص (مانند catalog.mock.json در تست‌ها) بارگذاری می‌کند.
func LoadFile(sourcesDir, filename string) (*Service, error) {
	data, err := os.ReadFile(filepath.Join(sourcesDir, filename))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filename, err)
	}
	var works []Work
	if err := json.Unmarshal(data, &works); err != nil {
		return nil, err
	}
	s := &Service{
		sourcesDir: sourcesDir,
		byUID:      map[string]*Work{},
		docByUID:   map[string]DocumentMeta{},
		docWork:    map[string]string{},
		modelCache: map[string]*cacheEntry{},
		featCache:  map[string]*Features{},
		modelSem:   make(chan struct{}, 2),
	}
	for i := range works {
		w := &works[i]
		s.byUID[w.UID] = w
		for _, d := range w.Documents {
			s.docByUID[d.UID] = d
			s.docWork[d.UID] = w.UID
		}
	}
	s.works = works
	return s, nil
}

func (s *Service) Works() []Work { return s.works }

func (s *Service) Work(uid string) (*Work, bool) {
	w, ok := s.byUID[uid]
	return w, ok
}

func (s *Service) Document(uid string) (DocumentMeta, bool) {
	d, ok := s.docByUID[uid]
	return d, ok
}

// WorkOfDocument اثرِ سند را برمی‌گرداند (بدون fallback — §۴۲).
// با نقشهٔ docWork برابر O(1) است؛ اسکن خطی works×docs حذف شد (ممیزی: N+1 کاتالوگ).
func (s *Service) WorkOfDocument(docUID string) (*Work, bool) {
	if wu, ok := s.docWork[docUID]; ok {
		return s.byUID[wu], true
	}
	return nil, false
}

// WorkUIDOfDocument شناسهٔ اثرِ سند با جست‌وجوی O(1) (ممیزی: N+1 کاتالوگ).
func (s *Service) WorkUIDOfDocument(docUID string) (string, bool) {
	wu, ok := s.docWork[docUID]
	return wu, ok
}

func (s *Service) docPath(docUID string) (string, error) {
	d, ok := s.docByUID[docUID]
	if !ok {
		return "", errors.New("not_found")
	}
	if filepath.IsAbs(d.File) {
		return d.File, nil
	}
	return filepath.Join(s.sourcesDir, d.File), nil
}

// openDoc سند را فقط‌خواندنی باز، decode و پارس می‌کند (با LRU و سقف هم‌زمانی).
func (s *Service) openDoc(docUID string) (*xmlparse.DocModel, error) {
	s.mu.RLock()
	if e, ok := s.modelCache[docUID]; ok {
		s.mu.RUnlock()
		return e.model, nil
	}
	s.mu.RUnlock()

	model, err := s.decodeDoc(docUID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	if len(s.modelOrder) >= modelCacheMax {
		old := s.modelOrder[0]
		s.modelOrder = s.modelOrder[1:]
		delete(s.modelCache, old)
	}
	s.modelCache[docUID] = &cacheEntry{model: model, at: time.Now()}
	s.modelOrder = append(s.modelOrder, docUID)
	s.mu.Unlock()
	return model, nil
}

// decodeDoc بازکردن، decode و پارس کامل سند بدون دخالت کش (نقطهٔ مشترک openDoc و
// ModelUncached). خطاهای decode/parse اینجا هرگز بی‌صدا حذف نمی‌شوند (DB-03):
// سند جزئی با ParseErrors شمارش‌پذیر برمی‌گردد و هشدار با شمارش خطاها لاگ می‌شود.
func (s *Service) decodeDoc(docUID string) (*xmlparse.DocModel, error) {
	s.modelSem <- struct{}{}
	defer func() { <-s.modelSem }()

	path, err := s.docPath(docUID)
	if err != nil {
		return nil, err
	}
	db, err := noordb.Open(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	profile, err := noordb.DetectSchema(db)
	if err != nil {
		return nil, err
	}
	if profile != "noor-v1" {
		return nil, fmt.Errorf("سند با شِمای شناخته‌شده سازگار نیست (quarantine)")
	}
	dict, err := noordb.LoadDictionary(db)
	if err != nil {
		return nil, err
	}
	var decodeErrs []string // خطاهای decode رکوردهای خطاخورده (DB-03 — شمارش‌پذیر)
	items, err := noordb.ReadDocItems(db, dict)
	if err != nil {
		var de *noordb.DecodeErrors
		if !errors.As(err, &de) {
			// خطای غیر-decode (مثلاً SQL) با رکوردهای ناقص: بلوع ممنوع — سند صادقانه رد می‌شود.
			return nil, fmt.Errorf("خواندن رکوردهای سند ناموفق: %w", err)
		}
		if len(items) == 0 {
			return nil, fmt.Errorf("همهٔ رکوردها خطای بازگشایی: %v", de.Items)
		}
		// رکوردهای خطاخورده میان سالم‌ها: سند جزئی ادامه می‌یابد ولی خطاها به مدل
		// پیوست و شمرده می‌شوند — سند ناقص بی‌صدا «کامل» شمرده نمی‌شود (DB-03/§4.6).
		for _, msg := range de.Items {
			decodeErrs = append(decodeErrs, msg)
		}
	}
	in := make([]xmlparse.ItemInput, 0, len(items))
	for _, it := range items {
		in = append(in, xmlparse.ItemInput{ID: it.Id, XML: it.XML})
	}
	model, err := xmlparse.ParseItems(docUID, in)
	if err != nil {
		return nil, err
	}

	// خواندن پاورقی‌ها از StoryId = 2 (دیتابیس رسمی نور)
	if fns, ferr := noordb.ReadFootnotes(db, dict); ferr == nil && len(fns) > 0 {
		// dedupe با پاورقی‌های XML: همان پاورقی از دو منبع (uid=id در XML، uid=ItemNo در DB)
		// پیش‌تر دوبار نمایه و دوبار شمرده می‌شد.
		seen := make(map[string]bool, len(model.Footnotes))
		for _, f := range model.Footnotes {
			seen[footnoteKey(f.Label, f.Text)] = true
		}
		for _, f := range fns {
			if k := footnoteKey(f.Label, f.Text); seen[k] {
				continue
			} else {
				seen[k] = true
			}
			model.Footnotes = append(model.Footnotes, xmlparse.Footnote{
				UID:   strconv.FormatInt(f.ItemNo, 10),
				Label: f.Label,
				Text:  f.Text,
			})
		}
	}

	// ساخت صفحات: اولویت با شکست صفحات واقعی دیتابیس نور (PageBreak)؛ صادق بودن
	// نگاشت صفحه در PagesApproximate ثبت می‌شود تا ارجاع‌های پژوهشی بدانند کی
	// نگاشت تقریبی است (تقسیم یکنواخت) و کی دقیق.
	pbDetails, pberr := noordb.ReadPageBreakDetails(db)
	if pberr == nil && len(pbDetails) > 0 {
		var approx bool
		model.Pages, approx = buildPagesFromPageBreaks(pbDetails, model.DocItemBlocks, len(model.Blocks))
		model.PagesApproximate = approx
	} else if len(model.Pages) == 0 {
		if pgs, perr := noordb.ReadPages(db); perr == nil && len(pgs) > 0 {
			model.Pages = buildPagesFromDB(pgs, len(model.Blocks))
			model.PagesApproximate = true // تقسیم ریاضیِ بلوک‌ها میان صفحات
		}
	}

	// فهرست درختی: اگر TableOfContent در دیتابیس وجود دارد، اولویت قطعی با آن است
	if tocs, terr := noordb.ReadTableOfContent(db); terr == nil && len(tocs) > 0 {
		model.Sections = buildSectionsFromTOC(db, tocs, model.Pages, model.DocItemBlocks, model.Blocks)
	}

	if len(decodeErrs) > 0 {
		model.ParseErrors = append(model.ParseErrors, decodeErrs...)
	}
	// Length validation گزارشی (DATA-05) — در ParseErrors جمع شده است
	if n := len(model.ParseErrors); n > 0 {
		log.Printf("noor-catalog: سند %s ناقص است: %d خطای decode/parse ثبت شد (مدل جزئی؛ شمارش‌پذیر — DB-03)", docUID, n)
	}
	return model, nil
}

type pageBreakEntry struct {
	pageID    int64
	docItemID int64
}

func readMainPageBreaks(db *sql.DB) []pageBreakEntry {
	rows, err := db.Query(`
		SELECT pb.PageId, pb.DocItemId 
		FROM PageBreak pb 
		JOIN DocItem di ON pb.DocItemId = di.Id 
		WHERE di.StoryId = 1 
		ORDER BY di.ItemNo, di.Id
	`)
	if err != nil {
		rows2, err2 := db.Query(`SELECT PageId, DocItemId FROM PageBreak ORDER BY PageId`)
		if err2 != nil {
			return nil
		}
		defer rows2.Close()
		var out []pageBreakEntry
		for rows2.Next() {
			var e pageBreakEntry
			if err := rows2.Scan(&e.pageID, &e.docItemID); err == nil {
				out = append(out, e)
			}
		}
		return out
	}
	defer rows.Close()
	var out []pageBreakEntry
	for rows.Next() {
		var e pageBreakEntry
		if err := rows.Scan(&e.pageID, &e.docItemID); err == nil {
			out = append(out, e)
		}
	}
	return out
}

func buildSectionsFromTOC(db *sql.DB, nodes []noordb.TOCNode, pages []xmlparse.PageRec, itemBlocks map[int64][2]int, blocks []xmlparse.Block) []*xmlparse.SectionRec {
	pbreaks := readMainPageBreaks(db)
	pageBySerial := make(map[int]xmlparse.PageRec, len(pages))
	for _, p := range pages {
		pageBySerial[p.Serial] = p
	}

	findPage := func(docItemID int64) (pageUID string, pageLabel string, blockID string) {
		if len(pages) == 0 {
			return "", "", ""
		}
		firstP := pages[0]
		targetBlock := fmt.Sprintf("b-%04d", firstP.StartBlock)
		if blks, ok := itemBlocks[docItemID]; ok {
			targetBlock = fmt.Sprintf("b-%04d", blks[0])
		}
		if docItemID <= 0 || len(pbreaks) == 0 {
			return firstP.UID, firstP.Label, targetBlock
		}
		var targetPageID int64 = pbreaks[0].pageID
		for _, pb := range pbreaks {
			if pb.docItemID <= docItemID {
				targetPageID = pb.pageID
			} else {
				break
			}
		}
		if p, ok := pageBySerial[int(targetPageID)]; ok {
			return p.UID, p.Label, targetBlock
		}
		idx := int(targetPageID) - 1
		if idx >= 0 && idx < len(pages) {
			p := pages[idx]
			return p.UID, p.Label, targetBlock
		}
		return firstP.UID, firstP.Label, targetBlock
	}

	byID := make(map[int64]*xmlparse.SectionRec)
	var roots []*xmlparse.SectionRec

	for _, n := range nodes {
		var docID int64
		if n.DocItem.Valid {
			docID = n.DocItem.Int64
			if blks, ok := itemBlocks[docID]; ok && blks[0] >= 0 && blks[0] < len(blocks) {
				blocks[blks[0]].Level = n.Level
			}
		}
		pUID, pLabel, bID := findPage(docID)
		sec := &xmlparse.SectionRec{
			UID:       fmt.Sprintf("sec-%d", n.ID),
			Title:     xmlparse.CleanTitle(n.Title),
			Level:     n.Level,
			BlockID:   bID,
			PageUID:   pUID,
			PageLabel: pLabel,
		}
		byID[n.ID] = sec
	}

	for _, n := range nodes {
		sec := byID[n.ID]
		if n.ParentID.Valid && byID[n.ParentID.Int64] != nil {
			parent := byID[n.ParentID.Int64]
			parent.Children = append(parent.Children, sec)
		} else {
			roots = append(roots, sec)
		}
	}
	return roots
}

// buildPagesFromPageBreaks صفحات را از PageBreak می‌سازد؛ مقدار دوم یعنی نگاشت
// تقریبی است (چند PageBreak درون یک DocItem با تقسیم یکنواخت تخصیص یافته‌اند).
func buildPagesFromPageBreaks(pbreaks []noordb.PageBreakDetail, itemBlocks map[int64][2]int, totalBlocks int) ([]xmlparse.PageRec, bool) {
	approx := false
	if len(pbreaks) == 0 || totalBlocks == 0 {
		return nil, false
	}
	out := make([]xmlparse.PageRec, 0, len(pbreaks))

	// گروهبندی pagebreakها بر اساس DocItemID به ترتیب پیوسته
	type docGroup struct {
		docID   int64
		indices []int
	}
	var groups []docGroup
	for i, pb := range pbreaks {
		if len(groups) == 0 || groups[len(groups)-1].docID != pb.DocItemID {
			groups = append(groups, docGroup{docID: pb.DocItemID, indices: []int{i}})
		} else {
			groups[len(groups)-1].indices = append(groups[len(groups)-1].indices, i)
			if len(groups[len(groups)-1].indices) > 1 {
				approx = true // تقسیم یکنواخت درون DocItem
			}
		}
	}

	allocated := make(map[int][2]int)
	currentBlock := 0
	for gi, g := range groups {
		blks, ok := itemBlocks[g.docID]
		if !ok {
			for _, idx := range g.indices {
				allocated[idx] = [2]int{currentBlock, currentBlock - 1}
			}
			continue
		}
		startB := blks[0]
		if startB < currentBlock {
			startB = currentBlock
		}
		endB := totalBlocks - 1
		if gi+1 < len(groups) {
			nextDocID := groups[gi+1].docID
			if nextBlks, ok2 := itemBlocks[nextDocID]; ok2 {
				if nextBlks[0] > startB {
					endB = nextBlks[0] - 1
				} else {
					endB = startB
				}
			}
		}
		if endB < startB {
			for _, idx := range g.indices {
				allocated[idx] = [2]int{currentBlock, currentBlock - 1}
			}
			continue
		}
		numBlocks := endB - startB + 1
		k := len(g.indices)
		if k == 1 {
			allocated[g.indices[0]] = [2]int{startB, endB}
			currentBlock = endB + 1
		} else if numBlocks < k {
			// اگر تعداد بلوک‌ها کمتر از صفحات این گروه باشد (مانند صفحات تصویری ابتدای فصل)
			// صفحات ابتدایی خالی می‌مانند و بلوک‌ها به صفحات آخر تخصیص می‌یابند
			emptyCount := k - numBlocks
			for j := 0; j < emptyCount; j++ {
				allocated[g.indices[j]] = [2]int{startB, startB - 1}
			}
			cur := startB
			for j := emptyCount; j < k; j++ {
				allocated[g.indices[j]] = [2]int{cur, cur}
				cur++
			}
			currentBlock = endB + 1
		} else {
			// تقسیم یکنواخت و کاملاً مجزا (بدون هیچ‌گونه هم‌پوشانی) میان صفحات
			cur := startB
			for j := 0; j < k; j++ {
				remPages := k - j
				remBlocks := endB - cur + 1
				take := remBlocks / remPages
				if take < 1 {
					take = 1
				}
				pEnd := cur + take - 1
				if j == k-1 || pEnd > endB {
					pEnd = endB
				}
				allocated[g.indices[j]] = [2]int{cur, pEnd}
				cur = pEnd + 1
			}
			currentBlock = endB + 1
		}
	}

	for i, pb := range pbreaks {
		r, ok := allocated[i]
		sBlock := 0
		eBlock := -1
		if ok {
			sBlock = r[0]
			eBlock = r[1]
		}
		out = append(out, xmlparse.PageRec{
			UID:        fmt.Sprintf("p-%03d", pb.SerialNo),
			Label:      pb.Number,
			Num:        pb.Number,
			Serial:     pb.SerialNo,
			StartBlock: sBlock,
			EndBlock:   eBlock,
		})
	}
	return out, approx
}

func buildPagesFromDB(pages []noordb.PageNode, totalBlocks int) []xmlparse.PageRec {
	var out []xmlparse.PageRec
	numPages := len(pages)
	for i, p := range pages {
		start := 0
		end := totalBlocks - 1
		if totalBlocks > 0 && numPages > 0 {
			start = (i * totalBlocks) / numPages
			end = ((i+1)*totalBlocks)/numPages - 1
			if end < start {
				end = start
			}
		}
		out = append(out, xmlparse.PageRec{
			UID:        fmt.Sprintf("p-%03d", p.SerialNo),
			Label:      p.Number,
			Num:        p.Number,
			Serial:     p.SerialNo,
			StartBlock: start,
			EndBlock:   end,
		})
	}
	return out
}

// Reload کاتالوگ را دوباره می‌خواند (بدون ری‌استارت سرویس) — کش مدل/پوشش خالی
// می‌شود تا اسناد تازه سرو شوند. خطا کاتالوگ پیشین را دست‌نخورده نگه می‌دارد.
func (s *Service) Reload() error {
	loaded, err := LoadFile(s.sourcesDir, "catalog.json")
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.works = loaded.works
	s.byUID = loaded.byUID
	s.docByUID = loaded.docByUID
	s.docWork = loaded.docWork
	s.modelCache = map[string]*cacheEntry{}
	s.modelOrder = nil
	s.featCache = map[string]*Features{}
	return nil
}

// Model مدل مشتق سند (برای خواننده و نمایه‌ساز).
func (s *Service) Model(docUID string) (*xmlparse.DocModel, error) {
	return s.openDoc(docUID)
}

// ModelUncached مدل سند را بدون ذخیره در LRU می‌سازد — مسیر reindex جریانی worker
// (DB-01): هر مدل فقط در حین نوشتنِ همان سند زنده است و پس از آن رها می‌شود،
// پس peak حافظه به شمار اسناد کورپوس وابسته نمی‌ماند.
func (s *Service) ModelUncached(docUID string) (*xmlparse.DocModel, error) {
	return s.decodeDoc(docUID)
}

// SetKnownFeatures ویژگی‌های واقعی محاسبه‌شده هنگام نمایه‌سازی را ثبت می‌کند؛
// پس از آن WorkFeatures از دادهٔ واقعی می‌خواند نه ادعای ثابت.
func (s *Service) SetKnownFeatures(f map[string]map[string]bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.knownFeats = f
	s.featCache = map[string]*Features{}
}

// featuresFromKnown نگاشت بولیِ واقعی به قرارداد رشته‌ای supported/absent/unknown.
func featuresFromKnown(k map[string]bool) Features {
	get := func(key string) string {
		if v, ok := k[key]; ok {
			if v {
				return "supported"
			}
			return "absent"
		}
		return "unknown"
	}
	return Features{
		SearchableText: get("searchable"),
		Hadith:         get("hadith"),
		Quran:          get("quran"),
		Footnotes:      get("footnotes"),
		Links:          get("links"),
		Pages:          get("pages"),
		TOC:            get("toc"),
		Media:          "absent",
		Topics:         "unknown",
	}
}

// Features پوشش قابلیت اثر از مدل اسناد (DATA-08).
type Features struct {
	SearchableText string `json:"searchable_text"`
	Hadith         string `json:"hadith"`
	Quran          string `json:"quran"`
	Footnotes      string `json:"footnotes"`
	Links          string `json:"links"`
	Topics         string `json:"topics"`
	Media          string `json:"media"`
	Pages          string `json:"pages"`
	TOC            string `json:"toc"`
}

func statusOf(docs []string) string {
	if len(docs) == 0 {
		return "absent"
	}
	return "supported"
}

// WorkFeatures پوشش در سطح اثر — با کش (کاتالوگ تغییرنکردنی است؛ محاسبهٔ هر اثر
// حداکثر یک‌بار انجام می‌شود و فراخوانی‌های بعدی O(1) هستند — ممیزی: /works کل کتابخانه).
func (s *Service) WorkFeatures(w *Work) Features {
	s.mu.RLock()
	kf := s.knownFeats[w.UID]
	s.mu.RUnlock()
	if kf != nil {
		f := featuresFromKnown(kf)
		if len(w.Topics) > 0 {
			f.Topics = "supported"
		} else {
			f.Topics = "absent"
		}
		return f
	}
	// بدون دادهٔ واقعیِ نمایه‌سازی، پوشش نامعلوم است — «supported» جعلی نمی‌سازیم.
	f := Features{
		SearchableText: "unknown", Hadith: "unknown", Quran: "unknown",
		Footnotes: "unknown", Links: "unknown", Pages: "unknown", TOC: "unknown",
		Media: "absent", Topics: "unknown",
	}
	if len(w.Topics) > 0 {
		f.Topics = "supported"
	}
	return f
}

func (s *Service) computeWorkFeatures(w *Work) Features {
	f := Features{
		SearchableText: "supported",
		Hadith:         "supported",
		Quran:          "supported",
		Footnotes:      "supported",
		Pages:          "supported",
		TOC:            "supported",
		Links:          "supported",
		Media:          "absent",
		Topics:         "absent",
	}
	if len(w.Topics) > 0 {
		f.Topics = "supported"
	}
	return f
}

// footnoteKey کلید هم‌ارزی پاورقی: برچسب + متن با فاصله‌های یکدست.
func footnoteKey(label, text string) string {
	return strings.TrimSpace(label) + "\x00" + strings.Join(strings.Fields(text), " ")
}
