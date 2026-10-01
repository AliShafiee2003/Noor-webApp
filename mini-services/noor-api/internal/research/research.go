// Package research — دادهٔ خصوصی پژوهش (§۱۷): پرونده، فیش، یادداشت، نشانک،
// جست‌وجوی ذخیره، میزکار. قواعد: مالکیت در سرور، optimistic concurrency با 409،
// حذف نرم با سطل بازیافت، تاریخچهٔ نسخه، snapshot کامل نشانی (TECH-08).
package research

import (
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"noor/internal/store"
)

// ErrNotFound شیء متعلق به کاربر نیست یا وجود ندارد (404 — بدون افشا).
var ErrNotFound = errors.New("یافت نشد")

// ErrConflict تعارض نسخه (409).
type ErrConflict struct{ CurrentVersion int }

func (e *ErrConflict) Error() string {
	return "این مورد در جای دیگری ویرایش شده است؛ نسخهٔ فعلی بارگذاری شد"
}

type Service struct{ db *store.DB }

func New(db *store.DB) *Service { return &Service{db: db} }

// ---- Projects ----

type Project struct {
	UID       string `json:"uid"`
	Name      string `json:"name"`
	Archived  bool   `json:"archived"`
	ClipCount int    `json:"clip_count"`
	Version   int    `json:"version"`
	UpdatedAt string `json:"updated_at"`
}

func (s *Service) ListProjects(owner string) ([]Project, error) {
	rows, err := s.db.Query(`SELECT p.uid, p.name, p.archived, p.version, p.updated_at,
                (SELECT COUNT(*) FROM clips c WHERE c.project_uid=p.uid AND c.deleted_at IS NULL)
                FROM projects p WHERE p.owner_user_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Project
	for rows.Next() {
		var p Project
		var arch int
		if err := rows.Scan(&p.UID, &p.Name, &arch, &p.Version, &p.UpdatedAt, &p.ClipCount); err != nil {
			continue
		}
		p.Archived = arch == 1
		out = append(out, p)
	}
	return out, nil
}

func (s *Service) CreateProject(owner, name string) (*Project, error) {
	if name == "" {
		return nil, errors.New("نام پرونده الزامی است")
	}
	uid := uidOf("prj")
	_, err := s.db.Exec(`INSERT INTO projects(uid, owner_user_id, name) VALUES(?,?,?)`, uid, owner, name)
	if err != nil {
		return nil, err
	}
	return &Project{UID: uid, Name: name, Version: 1, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (s *Service) UpdateProject(owner, uid string, name *string, archived *bool, expectedVersion int) (*Project, error) {
	p, err := s.getProject(owner, uid)
	if err != nil {
		return nil, err
	}
	if p.Version != expectedVersion {
		return nil, &ErrConflict{CurrentVersion: p.Version}
	}
	if name != nil {
		p.Name = *name
	}
	if archived != nil {
		p.Archived = *archived
	}
	_, err = s.db.Exec(`UPDATE projects SET name=?, archived=?, version=version+1, updated_at=datetime('now') WHERE uid=? AND owner_user_id=? AND version=?`,
		p.Name, boolInt(p.Archived), uid, owner, expectedVersion)
	if err != nil {
		return nil, err
	}
	return s.getProject(owner, uid)
}

func (s *Service) DeleteProject(owner, uid string) error {
	if _, err := s.getProject(owner, uid); err != nil {
		return err
	}
	// فیش‌های پروژه به سطل می‌روند (حذف نرم — RES-09)
	_, err := s.db.Exec(`UPDATE clips SET deleted_at=datetime('now') WHERE project_uid=? AND deleted_at IS NULL`, uid)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE projects SET deleted_at=datetime('now') WHERE uid=? AND owner_user_id=?`, uid, owner)
	return err
}

func (s *Service) getProject(owner, uid string) (*Project, error) {
	var p Project
	var arch int
	err := s.db.QueryRow(`SELECT uid, name, archived, version, updated_at FROM projects WHERE uid=? AND owner_user_id=? AND deleted_at IS NULL`, uid, owner).
		Scan(&p.UID, &p.Name, &arch, &p.Version, &p.UpdatedAt)
	if err != nil {
		return nil, ErrNotFound
	}
	p.Archived = arch == 1
	return &p, nil
}

// ---- Clips (فیش) ----

type ClipSource struct {
	WorkUID       string `json:"work_uid"`
	DocumentUID   string `json:"document_uid"`
	PageUID       string `json:"page_uid,omitempty"`
	PageLabel     string `json:"page_label,omitempty"`
	SectionUID    string `json:"section_uid,omitempty"`
	Start         int    `json:"start"`
	End           int    `json:"end"`
	OffsetUnit    string `json:"offset_unit"`
	SourceVersion string `json:"source_version_uid,omitempty"`
	ReleaseUID    string `json:"release_uid,omitempty"`
	OverlayRev    string `json:"overlay_revision_uid,omitempty"`
	LocalHadith   string `json:"local_hadith_uid,omitempty"`
}

type Clip struct {
	UID           string     `json:"uid"`
	ProjectUID    string     `json:"project_uid"`
	Kind          string     `json:"kind"`
	QuoteOriginal string     `json:"quote_original"`
	QuoteAsRead   *string    `json:"quote_as_read"`
	PrefixContext *string    `json:"prefix_context"`
	SuffixContext *string    `json:"suffix_context"`
	Note          *string    `json:"note"`
	Tags          []string   `json:"tags"`
	Version       int        `json:"version"`
	Source        ClipSource `json:"source"`
	CreatedAt     string     `json:"created_at"`
	UpdatedAt     string     `json:"updated_at"`
}

type ClipInput struct {
	ProjectUID    string     `json:"project_uid"`
	Kind          string     `json:"kind"`
	QuoteOriginal string     `json:"quote_original"`
	QuoteAsRead   *string    `json:"quote_as_read"`
	PrefixContext *string    `json:"prefix_context"`
	SuffixContext *string    `json:"suffix_context"`
	Note          *string    `json:"note"`
	Tags          []string   `json:"tags"`
	Source        ClipSource `json:"source"`
}

/*
normTags قرارداد «tags همیشه آرایه» را تضمین می‌کند: ردیف‌های قدیمی با
tags='null' (خروجی json.Marshal روی اسلایس nil) و ورودیِ کلاینت بدون tags
نباید در پاسخ به null سری شوند — قرارداد API tags: string[] است و فرانت
روی null می‌شکند («c.tags is not iterable»).
*/
func normTags(t *[]string) {
	if *t == nil {
		*t = []string{}
	}
}

// CreateClip داخل transaction: اول مالکیت project، بعد فیش (§۳۹).
func (s *Service) CreateClip(owner string, in *ClipInput) (*Clip, error) {
	if in.QuoteOriginal == "" {
		return nil, errors.New("متن نقل‌قول خالی است")
	}
	if in.Kind != "original" && in.Kind != "as_read" && in.Kind != "note" {
		in.Kind = "original"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var cnt int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM projects WHERE uid=? AND owner_user_id=? AND deleted_at IS NULL`, in.ProjectUID, owner).Scan(&cnt); err != nil || cnt == 0 {
		return nil, ErrNotFound
	}
	uid := uidOf("clip")
	normTags(&in.Tags) /* ردیف 'null' در DB ذخیره نشود */
	tags, _ := json.Marshal(in.Tags)
	if _, err := tx.Exec(`INSERT INTO clips(uid, owner_user_id, project_uid, kind, quote_original, quote_as_read, prefix_context, suffix_context, note, tags,
                work_uid, document_uid, page_uid, page_label, section_uid, source_offsets_start, source_offsets_end, offset_unit,
                source_version_uid, release_uid, overlay_revision_uid, local_hadith_uid)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		uid, owner, in.ProjectUID, in.Kind, in.QuoteOriginal, in.QuoteAsRead, in.PrefixContext, in.SuffixContext, in.Note, string(tags),
		in.Source.WorkUID, in.Source.DocumentUID, in.Source.PageUID, in.Source.PageLabel, in.Source.SectionUID,
		in.Source.Start, in.Source.End, orStr(in.Source.OffsetUnit, "codepoint"),
		in.Source.SourceVersion, in.Source.ReleaseUID, in.Source.OverlayRev, in.Source.LocalHadith); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetClip(owner, uid)
}

func (s *Service) GetClip(owner, uid string) (*Clip, error) {
	row := s.db.QueryRow(`SELECT uid, project_uid, kind, quote_original, quote_as_read, prefix_context, suffix_context, note, tags, version,
                work_uid, document_uid, page_uid, page_label, section_uid, source_offsets_start, source_offsets_end, offset_unit,
                source_version_uid, release_uid, overlay_revision_uid, local_hadith_uid, created_at, updated_at
                FROM clips WHERE uid=? AND owner_user_id=? AND deleted_at IS NULL`, uid, owner)
	var c Clip
	var tags string
	var src ClipSource
	if err := row.Scan(&c.UID, &c.ProjectUID, &c.Kind, &c.QuoteOriginal, &c.QuoteAsRead, &c.PrefixContext, &c.SuffixContext, &c.Note, &tags, &c.Version,
		&src.WorkUID, &src.DocumentUID, &src.PageUID, &src.PageLabel, &src.SectionUID, &src.Start, &src.End, &src.OffsetUnit,
		&src.SourceVersion, &src.ReleaseUID, &src.OverlayRev, &src.LocalHadith, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, ErrNotFound
	}
	c.Source = src
	_ = json.Unmarshal([]byte(tags), &c.Tags)
	normTags(&c.Tags) /* ردیف قدیمی با 'null' همیشه به [] برگردد */
	return &c, nil
}

func (s *Service) ListClips(owner, projectUID, state, q, tag string) ([]Clip, error) {
	where := `c.owner_user_id=?`
	args := []any{owner}
	if projectUID != "" {
		where += ` AND c.project_uid=?`
		args = append(args, projectUID)
	}
	if state == "trashed" {
		where += ` AND c.deleted_at IS NOT NULL`
	} else {
		where += ` AND c.deleted_at IS NULL`
	}
	if q != "" {
		where += ` AND (c.quote_original LIKE '%'||?||'%' OR c.note LIKE '%'||?||'%')`
		args = append(args, q, q)
	}
	if tag != "" {
		where += ` AND c.tags LIKE '%'||?||'%'`
		args = append(args, tag)
	}
	rows, err := s.db.Query(`SELECT uid, project_uid, kind, quote_original, quote_as_read, prefix_context, suffix_context, note, tags, version,
                work_uid, document_uid, page_uid, page_label, section_uid, source_offsets_start, source_offsets_end, offset_unit,
                source_version_uid, release_uid, overlay_revision_uid, local_hadith_uid, created_at, updated_at
                FROM clips c WHERE `+where+` ORDER BY c.updated_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Clip
	for rows.Next() {
		var c Clip
		var tags string
		var src ClipSource
		if err := rows.Scan(&c.UID, &c.ProjectUID, &c.Kind, &c.QuoteOriginal, &c.QuoteAsRead, &c.PrefixContext, &c.SuffixContext, &c.Note, &tags, &c.Version,
			&src.WorkUID, &src.DocumentUID, &src.PageUID, &src.PageLabel, &src.SectionUID, &src.Start, &src.End, &src.OffsetUnit,
			&src.SourceVersion, &src.ReleaseUID, &src.OverlayRev, &src.LocalHadith, &c.CreatedAt, &c.UpdatedAt); err != nil {
			continue
		}
		c.Source = src
		_ = json.Unmarshal([]byte(tags), &c.Tags)
		normTags(&c.Tags)
		out = append(out, c)
	}
	/* §۳۹: پایان اسکن هم باید صریح کنترل شود — خطای اسکن خاموش نمی‌ماند */
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ---- فیش‌های یک روایت (نمای پنل روایت) ----

/*
HadithClip خلاصهٔ فیش برای «فیش‌های این روایت» در پنل روایت است؛

	مالکیت سرور کنترل می‌شود و نام پرونده برای جهت‌گیری می‌آید.
*/
type HadithClip struct {
	UID           string   `json:"uid"`
	ProjectUID    string   `json:"project_uid"`
	ProjectName   string   `json:"project_name"`
	Kind          string   `json:"kind"`
	QuoteOriginal string   `json:"quote_original"`
	Note          *string  `json:"note"`
	Tags          []string `json:"tags"`
	PageUID       string   `json:"page_uid,omitempty"`
	PageLabel     string   `json:"page_label,omitempty"`
	UpdatedAt     string   `json:"updated_at"`
}

/*
ListHadithClips فیش‌های فعالِ همین کاربر را که به یک روایت مشخص

	(جفت document_uid + local_hadith_uid؛ شناسهٔ محلی جهانی نیست) متصل‌اند،
	از همهٔ پرونده‌های او برمی‌گرداند.
*/
func (s *Service) ListHadithClips(owner, documentUID, localHadithUID string) ([]HadithClip, error) {
	rows, err := s.db.Query(`SELECT c.uid, c.project_uid, p.name, c.kind, c.quote_original, c.note, c.tags,
                c.page_uid, c.page_label, c.updated_at
                FROM clips c JOIN projects p ON p.uid = c.project_uid
                WHERE c.owner_user_id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL
                  AND c.document_uid=? AND c.local_hadith_uid=?
                ORDER BY c.updated_at DESC LIMIT 50`, owner, documentUID, localHadithUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HadithClip
	for rows.Next() {
		var h HadithClip
		var tags string
		if err := rows.Scan(&h.UID, &h.ProjectUID, &h.ProjectName, &h.Kind, &h.QuoteOriginal, &h.Note, &tags,
			&h.PageUID, &h.PageLabel, &h.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(tags), &h.Tags)
		normTags(&h.Tags)
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ---- همهٔ فیش‌های من (نمای میزکار) ----

/*
MyClip خلاصهٔ فیش برای نمای «همهٔ فیش‌های من» در میزکار؛

	نام پرونده و عنوان اثر برای جهت‌گیری می‌آید (عنوان اثر در handler
	از کاتالوگ پر می‌شود — کاتالوگ در سرویس پژوهش در دسترس نیست).
*/
type MyClip struct {
	UID           string   `json:"uid"`
	ProjectUID    string   `json:"project_uid"`
	ProjectName   string   `json:"project_name"`
	Kind          string   `json:"kind"`
	QuoteOriginal string   `json:"quote_original"`
	Note          *string  `json:"note"`
	Tags          []string `json:"tags"`
	WorkUID       string   `json:"work_uid,omitempty"`
	WorkTitle     string   `json:"work_title,omitempty"`
	DocumentUID   string   `json:"document_uid,omitempty"`
	PageUID       string   `json:"page_uid,omitempty"`
	PageLabel     string   `json:"page_label,omitempty"`
	UpdatedAt     string   `json:"updated_at"`
}

/*
ListMyClips فیش‌های فعالِ کاربر از همهٔ پرونده‌ها با پالایش اختیاری

	kind (original|as_read|note)، q (در نقل/یادداشت) و tag برمی‌گرداند.
	شمارش کل صادقانه با COUNT جداگانه است؛ فهرست سقف ۱۰۰ دارد.
*/
func (s *Service) ListMyClips(owner, kind, q, tag string) ([]MyClip, int, error) {
	where := `c.owner_user_id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL`
	args := []any{owner}
	switch kind {
	case "original", "as_read", "note":
		where += ` AND c.kind=?`
		args = append(args, kind)
	case "":
		/* بدون پالایش نوع */
	default:
		return nil, 0, errors.New("نوع فیش نامعتبر است")
	}
	if q != "" {
		where += ` AND (c.quote_original LIKE '%'||?||'%' OR c.note LIKE '%'||?||'%')`
		args = append(args, q, q)
	}
	if tag != "" {
		where += ` AND c.tags LIKE '%'||?||'%'`
		args = append(args, tag)
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM clips c JOIN projects p ON p.uid=c.project_uid WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(`SELECT c.uid, c.project_uid, p.name, c.kind, c.quote_original, c.note, c.tags,
                c.work_uid, c.document_uid, c.page_uid, c.page_label, c.updated_at
                FROM clips c JOIN projects p ON p.uid = c.project_uid
                WHERE `+where+` ORDER BY c.updated_at DESC LIMIT 100`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []MyClip
	for rows.Next() {
		var m MyClip
		var tags string
		if err := rows.Scan(&m.UID, &m.ProjectUID, &m.ProjectName, &m.Kind, &m.QuoteOriginal, &m.Note, &tags,
			&m.WorkUID, &m.DocumentUID, &m.PageUID, &m.PageLabel, &m.UpdatedAt); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal([]byte(tags), &m.Tags)
		normTags(&m.Tags)
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

/*
ClipTag توزیع برچسب‌های کاربر: شناسه + شمار فیش‌های فعالِ دارای آن برچسب.

	مبنای چیپ‌های پالایش برچسب در نمای «همهٔ فیش‌های من» — شمارش صادقانه
	از کل فیش‌های فعال (نه فقط ۱۰۰ مورد نمایان) با COUNT گروهی.
*/
type ClipTag struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

/*
ListMyClipTags برچسب‌های متمایز فیش‌های فعال کاربر با شمار.

	تجزیهٔ JSON در Go انجام می‌شود نه در SQL: برنامه‌ریز کوئری SQLite
	جدول‌مجازی json_each را پیش از پالایش WHERE ارزیابی می‌کند و ردیف
	خراب (مثلاً tags='null' قدیمی) کل کوئری را با «malformed JSON» می‌شکند.
	ردیف خراب = بدون برچسب، نه خطا (صداقت داده: مقادیر نامعتبر نادیده
	گرفته می‌شوند، پنهان نمی‌شوند). شمار صادقانه از کل فیش‌های فعال با
	COUNT در Go؛ سقف ۵۰ برچسب پرکاربردتر — نمای پالایش است، نه آرشیو.
*/
func (s *Service) ListMyClipTags(owner string) ([]ClipTag, error) {
	rows, err := s.db.Query(`SELECT c.tags FROM clips c
                JOIN projects p ON p.uid = c.project_uid
                WHERE c.owner_user_id=? AND c.deleted_at IS NULL AND p.deleted_at IS NULL`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var tags string
		if err := rows.Scan(&tags); err != nil {
			return nil, err
		}
		var arr []string
		if json.Unmarshal([]byte(tags), &arr) != nil {
			continue // مقدار نامعتبر برچسبی ندارد
		}
		for _, t := range arr {
			if t = strings.TrimSpace(t); t != "" {
				counts[t]++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ClipTag, 0, len(counts))
	for tag, n := range counts {
		out = append(out, ClipTag{Tag: tag, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Tag < out[j].Tag
	})
	if len(out) > 50 {
		out = out[:50]
	}
	return out, nil
}

/*
CountMyClipsForHadith شمار فیش‌های فعالِ کاربر برای یک روایت محلی،

	گروه‌شده بر document_uid — برای «فیش‌های من» در گروه‌های دیالوگ §۴۷.
	کلید گم ErrorCode نیست؛ سند بدون فیش اصلاً کلید ندارد.
*/
func (s *Service) CountMyClipsForHadith(owner, localHadithUID string) (map[string]int, error) {
	if localHadithUID == "" {
		return map[string]int{}, nil
	}
	rows, err := s.db.Query(`SELECT document_uid, COUNT(*) FROM clips
                WHERE owner_user_id=? AND local_hadith_uid=? AND deleted_at IS NULL AND document_uid<>''
                GROUP BY document_uid`, owner, localHadithUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var doc string
		var n int
		if err := rows.Scan(&doc, &n); err != nil {
			return nil, err
		}
		out[doc] = n
	}
	return out, rows.Err()
}

// UpdateClip تعارض: شناسه + مالک + نسخه هر سه باید تطابق کنند (§۳۹).
func (s *Service) UpdateClip(owner, uid string, expectedVersion int, note, quoteAsRead *string, tags *[]string, projectUID *string) (*Clip, error) {
	c, err := s.GetClip(owner, uid)
	if err != nil {
		return nil, err
	}
	if c.Version != expectedVersion {
		return nil, &ErrConflict{CurrentVersion: c.Version}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// نسخهٔ قبلی در تاریخچه
	hist, _ := json.Marshal(c)
	if _, err := tx.Exec(`INSERT INTO clip_revisions(clip_uid, owner_user_id, body, version) VALUES(?,?,?,?)`, uid, owner, string(hist), c.Version); err != nil {
		return nil, err
	}
	if note != nil {
		c.Note = note
	}
	if quoteAsRead != nil {
		c.QuoteAsRead = quoteAsRead
	}
	if tags != nil {
		b, _ := json.Marshal(*tags)
		if _, err := tx.Exec(`UPDATE clips SET tags=? WHERE uid=?`, string(b), uid); err != nil {
			return nil, err
		}
	}
	if projectUID != nil {
		var cnt int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM projects WHERE uid=? AND owner_user_id=?`, *projectUID, owner).Scan(&cnt); err != nil || cnt == 0 {
			return nil, ErrNotFound
		}
		if _, err := tx.Exec(`UPDATE clips SET project_uid=? WHERE uid=?`, *projectUID, uid); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(`UPDATE clips SET note=?, quote_as_read=?, version=version+1, updated_at=datetime('now') WHERE uid=? AND owner_user_id=? AND version=?`,
		c.Note, c.QuoteAsRead, uid, owner, expectedVersion); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetClip(owner, uid)
}

func (s *Service) TrashClip(owner, uid string) error {
	res, err := s.db.Exec(`UPDATE clips SET deleted_at=datetime('now') WHERE uid=? AND owner_user_id=? AND deleted_at IS NULL`, uid, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) RestoreClip(owner, uid string) error {
	res, err := s.db.Exec(`UPDATE clips SET deleted_at=NULL WHERE uid=? AND owner_user_id=?`, uid, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) ClipRevisions(owner, uid string) ([]json.RawMessage, error) {
	if _, err := s.GetClip(owner, uid); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT body FROM clip_revisions WHERE clip_uid=? AND owner_user_id=? ORDER BY id DESC LIMIT 50`, uid, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []json.RawMessage
	for rows.Next() {
		var b string
		if rows.Scan(&b) == nil {
			out = append(out, json.RawMessage(b))
		}
	}
	return out, nil
}

// ---- Notes ----

type Note struct {
	UID         string `json:"uid"`
	DocumentUID string `json:"document_uid"`
	PageUID     string `json:"page_uid,omitempty"`
	/* PageLabel در handler از مدل سند پر می‌شود (برچسب چاپی صفحهٔ مقصد
	   برای «پرش به صفحهٔ …» در نشانی عمیق یادداشت‌ها). برچسب دادهٔ
	   نمایشی است، نه دادهٔ ذخیره‌شدهٔ یادداشت. */
	PageLabel   string `json:"page_label,omitempty"`
	SectionUID  string `json:"section_uid,omitempty"`
	LocalHadith string `json:"local_hadith_uid,omitempty"`
	Body        string `json:"body"`
	Version     int    `json:"version"`
	UpdatedAt   string `json:"updated_at"`
}

func (s *Service) CreateNote(owner string, n *Note) (*Note, error) {
	if n.Body == "" || n.DocumentUID == "" {
		return nil, errors.New("بدنهٔ یادداشت و سند الزامی است")
	}
	uid := uidOf("note")
	_, err := s.db.Exec(`INSERT INTO notes(uid, owner_user_id, document_uid, page_uid, section_uid, local_hadith_uid, body)
                VALUES(?,?,?,?,?,?,?)`, uid, owner, n.DocumentUID, n.PageUID, n.SectionUID, n.LocalHadith, n.Body)
	if err != nil {
		return nil, err
	}
	return s.GetNote(owner, uid)
}

func (s *Service) GetNote(owner, uid string) (*Note, error) {
	var n Note
	err := s.db.QueryRow(`SELECT uid, document_uid, page_uid, section_uid, local_hadith_uid, body, version, updated_at
                FROM notes WHERE uid=? AND owner_user_id=? AND deleted_at IS NULL`, uid, owner).
		Scan(&n.UID, &n.DocumentUID, &n.PageUID, &n.SectionUID, &n.LocalHadith, &n.Body, &n.Version, &n.UpdatedAt)
	if err != nil {
		return nil, ErrNotFound
	}
	return &n, nil
}

func (s *Service) ListNotes(owner, documentUID, pageUID string) ([]Note, error) {
	q := `SELECT uid, document_uid, page_uid, section_uid, local_hadith_uid, body, version, updated_at
                FROM notes WHERE owner_user_id=? AND deleted_at IS NULL`
	args := []any{owner}
	if documentUID != "" {
		q += ` AND document_uid=?`
		args = append(args, documentUID)
	}
	if pageUID != "" {
		q += ` AND page_uid=?`
		args = append(args, pageUID)
	}
	q += ` ORDER BY updated_at DESC LIMIT 200`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.UID, &n.DocumentUID, &n.PageUID, &n.SectionUID, &n.LocalHadith, &n.Body, &n.Version, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) UpdateNote(owner, uid string, expectedVersion int, body string) (*Note, error) {
	n, err := s.GetNote(owner, uid)
	if err != nil {
		return nil, err
	}
	if n.Version != expectedVersion {
		return nil, &ErrConflict{CurrentVersion: n.Version}
	}
	res, err := s.db.Exec(`UPDATE notes SET body=?, version=version+1, updated_at=datetime('now') WHERE uid=? AND owner_user_id=? AND version=?`, body, uid, owner, expectedVersion)
	if err != nil {
		return nil, err
	}
	if r, _ := res.RowsAffected(); r == 0 {
		return nil, &ErrConflict{CurrentVersion: n.Version}
	}
	return s.GetNote(owner, uid)
}

func (s *Service) DeleteNote(owner, uid string) error {
	res, err := s.db.Exec(`UPDATE notes SET deleted_at=datetime('now') WHERE uid=? AND owner_user_id=?`, uid, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- Bookmarks ----

type Bookmark struct {
	UID         string `json:"uid"`
	DocumentUID string `json:"document_uid"`
	PageUID     string `json:"page_uid"`
	Label       string `json:"label"`
	CreatedAt   string `json:"created_at"`
}

func (s *Service) AddBookmark(owner, documentUID, pageUID, label string) (*Bookmark, error) {
	uid := uidOf("bm")
	_, err := s.db.Exec(`INSERT INTO bookmarks(uid, owner_user_id, document_uid, page_uid, label) VALUES(?,?,?,?,?)`, uid, owner, documentUID, pageUID, label)
	if err != nil {
		return nil, err
	}
	return &Bookmark{UID: uid, DocumentUID: documentUID, PageUID: pageUID, Label: label, CreatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (s *Service) ListBookmarks(owner string) ([]Bookmark, error) {
	rows, err := s.db.Query(`SELECT uid, document_uid, page_uid, label, created_at FROM bookmarks WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 100`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Bookmark
	for rows.Next() {
		var b Bookmark
		if err := rows.Scan(&b.UID, &b.DocumentUID, &b.PageUID, &b.Label, &b.CreatedAt); err != nil {
			continue
		}
		out = append(out, b)
	}
	return out, nil
}

func (s *Service) DeleteBookmark(owner, uid string) error {
	res, err := s.db.Exec(`DELETE FROM bookmarks WHERE uid=? AND owner_user_id=?`, uid, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- Saved searches ----

type SavedSearch struct {
	UID       string          `json:"uid"`
	Name      string          `json:"name"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt string          `json:"created_at"`
}

func (s *Service) SaveSearch(owner, name string, payload []byte) (*SavedSearch, error) {
	uid := uidOf("svs")
	if _, err := s.db.Exec(`INSERT INTO saved_searches(uid, owner_user_id, name, payload) VALUES(?,?,?,?)`, uid, owner, name, string(payload)); err != nil {
		return nil, err
	}
	return &SavedSearch{UID: uid, Name: name, Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (s *Service) ListSavedSearches(owner string) ([]SavedSearch, error) {
	rows, err := s.db.Query(`SELECT uid, name, payload, created_at FROM saved_searches WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 50`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SavedSearch
	for rows.Next() {
		var sv SavedSearch
		var p string
		if err := rows.Scan(&sv.UID, &sv.Name, &p, &sv.CreatedAt); err != nil {
			continue
		}
		sv.Payload = json.RawMessage(p)
		out = append(out, sv)
	}
	return out, nil
}

func (s *Service) DeleteSavedSearch(owner, uid string) error {
	res, err := s.db.Exec(`DELETE FROM saved_searches WHERE uid=? AND owner_user_id=?`, uid, owner)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- Workspace ----

type WorkspaceState struct {
	Positions map[string]any `json:"positions"` // document_uid → {page_uid, progress, updated_at}
	Prefs     map[string]any `json:"prefs"`
}

func (s *Service) GetWorkspace(owner string) (*WorkspaceState, error) {
	var pos, prefs string
	err := s.db.QueryRow(`SELECT positions, prefs FROM workspace_states WHERE owner_user_id=?`, owner).Scan(&pos, &prefs)
	if err != nil {
		return &WorkspaceState{Positions: map[string]any{}, Prefs: defaultPrefs()}, nil
	}
	ws := &WorkspaceState{Positions: map[string]any{}, Prefs: defaultPrefs()}
	_ = json.Unmarshal([]byte(pos), &ws.Positions)
	_ = json.Unmarshal([]byte(prefs), &ws.Prefs)
	return ws, nil
}

func defaultPrefs() map[string]any {
	return map[string]any{
		"reader": map[string]any{
			"font_size":   22,
			"line_height": 1.9,
			"font_family": "amiri",
			"display":     "paged",
		},
	}
}

func (s *Service) PutPosition(owner, documentUID string, pos map[string]any) error {
	ws, err := s.GetWorkspace(owner)
	if err != nil {
		return err
	}
	pos["updated_at"] = time.Now().UTC().Format(time.RFC3339)
	ws.Positions[documentUID] = pos
	b, _ := json.Marshal(ws.Positions)
	_, err = s.db.Exec(`INSERT INTO workspace_states(owner_user_id, positions, prefs) VALUES(?,?,?)
                ON CONFLICT(owner_user_id) DO UPDATE SET positions=excluded.positions, updated_at=datetime('now')`, owner, string(b), "{}")
	return err
}

func (s *Service) PutPrefs(owner string, prefs map[string]any) error {
	ws, err := s.GetWorkspace(owner)
	if err != nil {
		return err
	}
	for k, v := range prefs {
		ws.Prefs[k] = v
	}
	b, _ := json.Marshal(ws.Prefs)
	_, err = s.db.Exec(`INSERT INTO workspace_states(owner_user_id, positions, prefs) VALUES(?,?,?)
                ON CONFLICT(owner_user_id) DO UPDATE SET prefs=excluded.prefs, updated_at=datetime('now')`, owner, "{}", string(b))
	return err
}

// ---- کمکی‌ها ----

func uidOf(prefix string) string {
	return prefix + "-" + randHex(6)
}

func randHex(n int) string {
	const chars = "0123456789abcdef"
	b := make([]byte, n)
	_, _ = cryptoRead(b)
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}

func orStr(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

var _ = sql.ErrNoRows
