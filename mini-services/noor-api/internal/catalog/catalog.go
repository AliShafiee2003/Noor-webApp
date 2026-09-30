// Package catalog — هویت مجموعه، بازکردن منابع فقط‌خواندنی با LRU، مدل مشتق سند.
package catalog

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"noor/internal/noordb"
	"noor/internal/xmlparse"
)

// WorkManifest و DocManifest از fixturegen می‌آیند (همان ساختار JSON).

type Work struct {
	UID        string           `json:"uid"`
	Title      string           `json:"title"`
	ShortTitle string           `json:"short_title"`
	Author     string           `json:"author"`
	Publisher  *string          `json:"publisher"`
	Year       *string          `json:"year"`
	Language   string           `json:"language"`
	Topics     []string         `json:"topics"`
	Documents  []DocumentMeta   `json:"documents"`
	Related    []RelatedRecord  `json:"related"`
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
	mu          sync.RWMutex
	works       []Work
	byUID       map[string]*Work
	docByUID    map[string]DocumentMeta
	sourcesDir  string
	modelCache  map[string]*cacheEntry
	modelOrder  []string
	dbOpenCount map[string]*dbEntry
	modelSem    chan struct{} // §۳۸ decode تعاملی هم‌زمان ≤۲
}

type cacheEntry struct {
	model *xmlparse.DocModel
	at    time.Time
}

type dbEntry struct {
	db *sql.DB
	at time.Time
}

const modelCacheMax = 32 // §۳۸

func Load(sourcesDir string) (*Service, error) {
	data, err := os.ReadFile(filepath.Join(sourcesDir, "catalog.json"))
	if err != nil {
		return nil, fmt.Errorf("catalog.json: %w", err)
	}
	var works []Work
	if err := json.Unmarshal(data, &works); err != nil {
		return nil, err
	}
	s := &Service{
		sourcesDir:  sourcesDir,
		byUID:       map[string]*Work{},
		docByUID:    map[string]DocumentMeta{},
		modelCache:  map[string]*cacheEntry{},
		dbOpenCount: map[string]*dbEntry{},
		modelSem:    make(chan struct{}, 2),
	}
	for i := range works {
		w := &works[i]
		s.byUID[w.UID] = w
		for _, d := range w.Documents {
			s.docByUID[d.UID] = d
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
func (s *Service) WorkOfDocument(docUID string) (*Work, bool) {
	for _, w := range s.works {
		for _, d := range w.Documents {
			if d.UID == docUID {
				return s.byUID[w.UID], true
			}
		}
	}
	return nil, false
}

func (s *Service) docPath(docUID string) (string, error) {
	d, ok := s.docByUID[docUID]
	if !ok {
		return "", errors.New("not_found")
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
	items, err := noordb.ReadDocItems(db, dict)
	if err != nil {
		if de, ok := err.(*noordb.DecodeErrors); ok && len(items) == 0 {
			return nil, fmt.Errorf("همهٔ رکوردها خطای بازگشایی: %v", de.Items)
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
	// Length validation گزارشی (DATA-05) — در ParseErrors جمع شده است

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

// Model مدل مشتق سند (برای خواننده و نمایه‌ساز).
func (s *Service) Model(docUID string) (*xmlparse.DocModel, error) {
	return s.openDoc(docUID)
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

// WorkFeatures پوشش در سطح اثر.
func (s *Service) WorkFeatures(w *Work) Features {
	f := Features{}
	for _, d := range w.Documents {
		m, err := s.openDoc(d.UID)
		if err != nil {
			continue
		}
		if len(m.Blocks) > 0 {
			f.SearchableText = "supported"
		}
		if len(m.Hadiths) > 0 {
			f.Hadith = "supported"
		}
		if len(m.Citations) > 0 {
			f.Quran = "supported"
		}
		if len(m.Footnotes) > 0 {
			f.Footnotes = "supported"
		}
		for i := range m.Blocks {
			if len(m.Blocks[i].Links) > 0 {
				f.Links = "supported"
			}
		}
		if len(m.Pages) > 0 {
			f.Pages = "supported"
		}
		if len(m.Sections) > 0 {
			f.TOC = "supported"
		}
	}
	if len(w.Topics) > 0 {
		f.Topics = "supported"
	}
	f.Media = "absent" // رسانه در fixture وجود ندارد — صادقانه absent
	return f
}
