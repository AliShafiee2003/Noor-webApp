/**
 * وضعیت میزکار — zustand
 * - ترجیحات خواننده در حافظه + PUT /workspace/prefs (با تاخیر برای جلوگیری از درخواست پیاپی).
 * - عبارت و فیلترهای جست‌وجو در hash نگه داشته می‌شوند (نه localStorage) — router.
 * - دادهٔ خصوصی هرگز در hash یا localStorage نمی‌رود.
 */
import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
import type { ReaderPrefs, WorkspaceState } from "@/lib/types";

export const defaultReaderPrefs: ReaderPrefs = {
  font_size: 22,
  font_family: "amiri",
  font_quran: "amiri-quran",
  font_latin: "source-serif",
  quran_font_size: 24,
  quran_line_height: 2.0,
  line_height: 1.9,
  display: "paged",
};

export type PrefsSaveState = "idle" | "saving" | "saved" | "error";

export interface WorkspaceStoreState {
  prefs: ReaderPrefs;
  prefsLoaded: boolean;
  prefsSaveState: PrefsSaveState;
  recent: WorkspaceState["recent"];
  workspaceLoading: boolean;
  workspaceError: string | null;

  fetchWorkspace: () => Promise<void>;
  updatePrefs: (partial: Partial<ReaderPrefs>, opts?: { persist?: boolean }) => void;
}

let putTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(getState: () => WorkspaceStoreState, set: (partial: Partial<WorkspaceStoreState>) => void) {
  if (putTimer) clearTimeout(putTimer);
  putTimer = setTimeout(async () => {
    set({ prefsSaveState: "saving" });
    try {
      await api.put("/workspace/prefs", { reader: getState().prefs });
      set({ prefsSaveState: "saved" });
    } catch (err) {
      set({ prefsSaveState: "error" });
      void err;
    }
  }, 500);
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  prefs: { ...defaultReaderPrefs },
  prefsLoaded: false,
  prefsSaveState: "idle",
  recent: [],
  workspaceLoading: false,
  workspaceError: null,

  fetchWorkspace: async () => {
    if (get().workspaceLoading) return;
    set({ workspaceLoading: true, workspaceError: null });
    try {
      const ws = await api.get<WorkspaceState>("/workspace");
      const reader = ws.prefs?.reader;
      set({
        recent: Array.isArray(ws.recent) ? ws.recent : [],
        prefs: reader ? { ...get().prefs, ...reader } : get().prefs,
        prefsLoaded: true,
        workspaceLoading: false,
      });
    } catch (err) {
      set({
        workspaceLoading: false,
        workspaceError:
          err instanceof ApiError
            ? err.message
            : "ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.",
      });
    }
  },

  updatePrefs: (partial, opts) => {
    set({ prefs: { ...get().prefs, ...partial } });
    if (opts?.persist === false) return;
    schedulePersist(get, set);
  },
}));
