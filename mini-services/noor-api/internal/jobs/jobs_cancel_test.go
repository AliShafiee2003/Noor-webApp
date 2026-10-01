package jobs

// رگرسیون round-17 (ممیزی: «لغو job بی‌اثر است») — لغو باید لغو بماند:
// Complete/Fail دیگر کارِ لغوشده را به done/failed بازنمی‌گردانند.

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"noor/internal/store"
)

func newTestJobs(t *testing.T) (*Service, func()) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	return New(db), func() { _ = db.Close() }
}

func TestCancelIsStickyAgainstCompleteAndFail(t *testing.T) {
	svc, cleanup := newTestJobs(t)
	defer cleanup()

	job, err := svc.Enqueue("index_rebuild", json.RawMessage(`{"reason":"test"}`), "tester")
	if err != nil {
		t.Fatal(err)
	}

	// لغو وقتی در صف است
	if err := svc.Cancel(job.UID); err != nil {
		t.Fatal(err)
	}
	if got := svc.StatusOf(job.UID); got != "cancelled" {
		t.Fatalf("پس از Cancel انتظار cancelled؛ گرفت %q", got)
	}

	// پایان موفقِ دیرهنگام worker نباید وضعیت را «done» کند
	if err := svc.Complete(job.UID, json.RawMessage(`{"passages":1}`)); err != nil {
		t.Fatal(err)
	}
	if got := svc.StatusOf(job.UID); got != "cancelled" {
		t.Fatalf("Complete نباید کارِ لغوشده را done کند؛ گرفت %q", got)
	}

	// شکستِ دیرهنگام هم نباید
	if err := svc.Fail(job.UID, "late failure"); err != nil {
		t.Fatal(err)
	}
	if got := svc.StatusOf(job.UID); got != "cancelled" {
		t.Fatalf("Fail نباید کارِ لغوشده را failed کند؛ گرفت %q", got)
	}

	// پس از لغو، Enqueue تازهٔ همان kind مجاز است (کارِ لغوشده دیگر «فعال» نیست)
	if _, err := svc.Enqueue("index_rebuild", json.RawMessage(`{"reason":"after-cancel"}`), "tester"); err != nil {
		t.Fatalf("پس از لغو، enqueue تازه باید مجاز باشد: %v", err)
	}
}

func TestCompleteFailsOnlyForActiveJobs(t *testing.T) {
	svc, cleanup := newTestJobs(t)
	defer cleanup()

	job, err := svc.Enqueue("index_rebuild", json.RawMessage(`{}`), "tester")
	if err != nil {
		t.Fatal(err)
	}
	// روی queued هم Complete معتبر است (مسیر نادر ولی مجاز)
	if err := svc.Complete(job.UID, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if got := svc.StatusOf(job.UID); got != "done" {
		t.Fatalf("کار فعال باید done شود؛ گرفت %q", got)
	}
	// Complete دوم روی done نباید وضعیت را برگرداند/عوض کند — و Fail آن را failed نکند
	_ = svc.Fail(job.UID, "after done")
	if got := svc.StatusOf(job.UID); got != "done" {
		t.Fatalf("کارِ done باید done بماند؛ گرفت %q", got)
	}
}
