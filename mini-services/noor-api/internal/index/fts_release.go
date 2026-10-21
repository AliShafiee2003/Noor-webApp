package index

// مدیریت نسل‌های FTS5 روی دیسک (§۲۴/§۲۶):
//
//	<dataDir>/fts/<rel>/...        پوشهٔ هر نسل (immutable)
//	<dataDir>/fts/<rel>.building/  ساخت در جریان؛ پس از Finalize موفق به <rel>/ تغییر نام می‌یابد
//	<dataDir>/fts/ACTIVE           شناسهٔ نسل فعال (نوشتن اتمیک: tmp + rename)
//	<dataDir>/fts/PREVIOUS         نسل پیشین برای rollback
//
// موتور فقط فایل‌های نسل نام‌برده در ACTIVE را باز می‌کند؛ هیچ glob‌ای روی پوشهٔ داده
// انجام نمی‌شود، پس شاردهای دو نسل هرگز با هم مخلوط نمی‌شوند.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// FTSRoot پوشهٔ ریشهٔ نسل‌های FTS5.
func FTSRoot(dataDir string) string { return filepath.Join(dataDir, "fts") }

// FTSReleaseDir پوشهٔ یک نسل منتشرشده.
func FTSReleaseDir(dataDir, rel string) string { return filepath.Join(FTSRoot(dataDir), rel) }

// FTSBuildingDir پوشهٔ موقت ساخت نسل.
func FTSBuildingDir(dataDir, rel string) string {
	return filepath.Join(FTSRoot(dataDir), rel+".building")
}

// ErrNoActiveFTS هنوز هیچ نسل FTS5 منتشر نشده است.
var ErrNoActiveFTS = errors.New("هیچ نسل FTS5 فعالی منتشر نشده است (fts/ACTIVE وجود ندارد)")

// ActiveFTSRelease شناسهٔ نسل فعال را از fts/ACTIVE می‌خواند.
func ActiveFTSRelease(dataDir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(FTSRoot(dataDir), "ACTIVE"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", ErrNoActiveFTS
		}
		return "", err
	}
	rel := strings.TrimSpace(string(b))
	if rel == "" {
		return "", ErrNoActiveFTS
	}
	return rel, nil
}

func writeAtomic(path, content string) error {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(content + "\n"); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	SyncDir(filepath.Dir(path))
	return nil
}

// SyncDir fsync پوشه تا rename‌ها پس از crash/قطع برق ماندگار باشند (best-effort).
func SyncDir(dir string) {
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

// RevertFTSPublish بازگرداندن انتشارِ شکست‌خوردهٔ failedRel: ACTIVE به prevRel برمی‌گردد
// (یا اگر پیش‌تر نسلی نبود، ACTIVE حذف می‌شود) و PREVIOUS که به نسل شکست‌خورده اشاره
// دارد پاک می‌شود. پوشهٔ failedRel را فراخواننده حذف می‌کند.
func RevertFTSPublish(dataDir, failedRel, prevRel string) error {
	root := FTSRoot(dataDir)
	if prevRel == "" || prevRel == failedRel {
		if err := os.Remove(filepath.Join(root, "ACTIVE")); err != nil && !os.IsNotExist(err) {
			return err
		}
	} else {
		if _, err := VerifyFTSRelease(FTSReleaseDir(dataDir, prevRel), prevRel, false); err != nil {
			return err
		}
		if err := writeAtomic(filepath.Join(root, "ACTIVE"), prevRel); err != nil {
			return err
		}
	}
	pb, err := os.ReadFile(filepath.Join(root, "PREVIOUS"))
	if err == nil && (strings.TrimSpace(string(pb)) == prevRel || strings.TrimSpace(string(pb)) == failedRel) {
		_ = os.Remove(filepath.Join(root, "PREVIOUS"))
	}
	SyncDir(root)
	return nil
}

// CommitFTSBuild پوشهٔ ساخت را پس از Finalize موفق به پوشهٔ نهایی نسل منتقل می‌کند.
func CommitFTSBuild(dataDir, rel string) error {
	from, to := FTSBuildingDir(dataDir, rel), FTSReleaseDir(dataDir, rel)
	if _, err := os.Stat(to); err == nil {
		return fmt.Errorf("نسل %s از پیش منتشر شده است", rel)
	}
	if _, err := VerifyFTSRelease(from, rel, true); err != nil {
		return fmt.Errorf("نسل ساخته‌شده معتبر نیست: %w", err)
	}
	return os.Rename(from, to)
}

// AbortFTSBuild پوشهٔ ساخت نیمه‌کاره را حذف می‌کند (لغو یا شکست).
func AbortFTSBuild(dataDir, rel string) {
	_ = os.RemoveAll(FTSBuildingDir(dataDir, rel))
}

// PublishFTSRelease نسل را فعال می‌کند (اتمیک)، نسل فعال قبلی را PREVIOUS می‌کند و
// نسل‌های قدیمی‌تر از این دو را پاک می‌کند (keep = تعداد نسل‌های نگه‌داشته، حداقل ۲).
func PublishFTSRelease(dataDir, rel string, keep int) error {
	if _, err := VerifyFTSRelease(FTSReleaseDir(dataDir, rel), rel, false); err != nil {
		return err
	}
	root := FTSRoot(dataDir)
	prev, _ := ActiveFTSRelease(dataDir)
	if prev != "" && prev != rel {
		if err := writeAtomic(filepath.Join(root, "PREVIOUS"), prev); err != nil {
			return err
		}
	}
	if err := writeAtomic(filepath.Join(root, "ACTIVE"), rel); err != nil {
		return err
	}
	if keep < 2 {
		keep = 2
	}
	pruneFTSReleases(dataDir, keep, rel, prev)
	return nil
}

// RollbackFTSRelease نسل PREVIOUS را دوباره فعال می‌کند.
func RollbackFTSRelease(dataDir string) (string, error) {
	b, err := os.ReadFile(filepath.Join(FTSRoot(dataDir), "PREVIOUS"))
	if err != nil {
		return "", fmt.Errorf("نسل پیشینی برای بازگشت ثبت نشده است: %w", err)
	}
	prev := strings.TrimSpace(string(b))
	if prev == "" {
		return "", errors.New("نسل پیشین خالی است")
	}
	if err := PublishFTSRelease(dataDir, prev, 3); err != nil {
		return "", err
	}
	return prev, nil
}

func pruneFTSReleases(dataDir string, keep int, protect ...string) {
	root := FTSRoot(dataDir)
	ents, err := os.ReadDir(root)
	if err != nil {
		return
	}
	prot := map[string]bool{}
	for _, p := range protect {
		if p != "" {
			prot[p] = true
		}
	}
	type relDir struct {
		name string
		mod  int64
	}
	var dirs []relDir
	for _, e := range ents {
		if !e.IsDir() || strings.HasSuffix(e.Name(), ".building") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		dirs = append(dirs, relDir{e.Name(), fi.ModTime().UnixNano()})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].mod > dirs[j].mod })
	kept := 0
	for _, d := range dirs {
		if prot[d.name] {
			kept++
			continue
		}
		if kept < keep {
			kept++
			continue
		}
		_ = os.RemoveAll(filepath.Join(root, d.name))
	}
}

// FTSManifest محتوای manifest یک نسل.
type FTSManifest struct {
	Values     map[string]string
	ShardFiles []ShardFileInfo
	NumShards  int
}

// ReadFTSManifest manifest پایگاه اصلی نسل را می‌خواند.
func ReadFTSManifest(db *sql.DB) (*FTSManifest, error) {
	rows, err := db.Query(`SELECT key, value FROM manifest`)
	if err != nil {
		return nil, fmt.Errorf("manifest خوانده نشد: %w", err)
	}
	defer rows.Close()
	m := &FTSManifest{Values: map[string]string{}}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m.Values[k] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if m.Values["schema_version"] != FTSSchemaVersion {
		return nil, fmt.Errorf("نسخهٔ شمای نسل %q است؛ این موتور %q می‌خواهد — نسل را با buildfts/worker تازه بسازید", m.Values["schema_version"], FTSSchemaVersion)
	}
	n, err := strconv.Atoi(m.Values["num_shards"])
	if err != nil || n <= 0 {
		return nil, fmt.Errorf("num_shards نامعتبر در manifest: %q", m.Values["num_shards"])
	}
	m.NumShards = n
	if err := json.Unmarshal([]byte(m.Values["shard_files"]), &m.ShardFiles); err != nil || len(m.ShardFiles) != n {
		return nil, fmt.Errorf("فهرست شاردهای manifest با num_shards نمی‌خواند")
	}
	return m, nil
}

// VerifyFTSRelease وجود و اندازهٔ همهٔ فایل‌های نسل را با manifest می‌سنجد؛ deep=true
// هش SHA-256 را هم بررسی می‌کند. مسیرهای شاردها را به ترتیب برمی‌گرداند.
func VerifyFTSRelease(dir, rel string, deep bool) ([]string, error) {
	mainPath := filepath.Join(dir, FTSMainFile(rel))
	if _, err := os.Stat(mainPath); err != nil {
		return nil, fmt.Errorf("پایگاه اصلی نسل %s یافت نشد: %w", rel, err)
	}
	db, err := sql.Open("sqlite", "file:"+mainPath+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	man, err := ReadFTSManifest(db)
	if err != nil {
		return nil, err
	}
	if man.Values["release_uid"] != rel {
		return nil, fmt.Errorf("manifest متعلق به نسل %q است نه %q", man.Values["release_uid"], rel)
	}
	var paths []string
	for i, f := range man.ShardFiles {
		if f.File != FTSShardFile(rel, i) {
			return nil, fmt.Errorf("نام شارد %d در manifest نامنتظر است: %s", i, f.File)
		}
		p := filepath.Join(dir, f.File)
		fi, err := os.Stat(p)
		if err != nil {
			return nil, fmt.Errorf("شارد %d نسل %s یافت نشد: %w", i, rel, err)
		}
		if fi.Size() != f.Size {
			return nil, fmt.Errorf("اندازهٔ شارد %d (%d) با manifest (%d) نمی‌خواند — فایل جابه‌جا یا خراب شده است", i, fi.Size(), f.Size)
		}
		if deep {
			cs, err := ComputeChecksum(p)
			if err != nil {
				return nil, err
			}
			if cs != f.SHA256 {
				return nil, fmt.Errorf("checksum شارد %d با manifest نمی‌خواند", i)
			}
		}
		paths = append(paths, p)
	}
	return paths, nil
}
