import { expect, test, type Page } from "@playwright/test";
import type { Highlight, Note } from "../../src/lib/types";
import { LIGHT_PALETTES, DARK_PALETTES } from "../../src/lib/palette";
import { readFile } from "node:fs/promises";
import { displayBookText } from "../../src/lib/reader/display-text";

const doc = "d-reader-fixture";
const sentence = "این متن آزمایشی برای مطالعه و انتخاب متن است. ";
const text = sentence.repeat(120);

async function fixture(page: Page, options: { shared?: "highlight" | "note" | "expired"; bookmarks?: boolean; corrected?: boolean; multipleDocs?: boolean; pdf?: boolean; citation?: "empty" | "address"; mapping?: "approximate"; pageNotes?: Note[]; plainHighlight?: boolean; paged?: boolean; web?: boolean; twoBlocks?: boolean; grouped?: boolean } = {}) {
  const bookText = options.citation ? "ج\u200d 90: قوله تعالى: إِلَيْهِ يَصْعَدُ الْكَلِمُ الطَّيِّبُ [فاطر: 10]" : text;
  const groupedFull = sentence.repeat(2) + "پاراگراف دوم";
  let items: Highlight[] = options.grouped
    ? [
        { uid: "hl-g1", document_uid: doc, page_uid: "p-001", block_id: "b1", start: 0, end: 3, text: groupedFull, color: "pink", note: "یادداشت گروهی", group_uid: "grp-fixture" },
        { uid: "hl-g2", document_uid: doc, page_uid: "p-001", block_id: "b1", start: Array.from(sentence).length * 4, end: Array.from(sentence).length * 4 + 3, text: "پاراگراف دوم", color: "pink", note: null, group_uid: "grp-fixture" },
      ]
    : [{ uid: "hl-fixture", document_uid: doc, page_uid: "p-001", block_id: "b1", start: Array.from(sentence).length * 4, end: Array.from(sentence).length * 4 + 3, text: "این", color: "pink", note: options.plainHighlight ? null : "یادداشت قبلی" }];
  let readerPrefs: Record<string, unknown> = { display: options.paged ? "paged" : "continuous", font_family: "vazirmatn", font_size: 20 };
  const positions: Record<string, Record<string, unknown>> = {};
  let failPatch = false;
  let failBookmark = false;
  let bookmarks = options.bookmarks ? [{ uid: "bm-fixture", document_uid: doc, page_uid: "p-002", label: "دوم" }] : [];
  let notes = [...(options.pageNotes ?? [])];
  const searches: Array<{ scope: { target: string }; ignore_spacing?: boolean }> = [];
  const annotationPosts: Array<{ block_id: string; text: string; group_uid?: string | null }> = [];
  const deletes: string[] = [];
  const pageBlocks = (pageNo: string) => {
    if (pageNo === "1" && options.twoBlocks) {
      const first = sentence.repeat(6);
      const second = "پاراگراف دوم " + sentence.repeat(5);
      return [
        { id: "b1", type: "p", text: first, source_offsets: [0, Array.from(first).length] },
        { id: "b1b", type: "p", text: second, source_offsets: [0, Array.from(second).length] },
      ];
    }
    return [{ id: pageNo === "1" ? "b1" : "b2", type: "p", text: bookText, source_offsets: [0, Array.from(bookText).length], ...(options.citation ? { citations: options.citation === "address" ? [{ sure: "35", aya: "10", address: "فاطر: 10" }] : [{}] } : {}) }];
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();
    if (options.pdf && path.endsWith("/file")) return route.fulfill({ contentType: "application/pdf", body: await readFile("tests/e2e/fixtures/sample.pdf") });
    let body: unknown = { items: [] };
    if (path === "/auth/session") body = { user: { uid: "test", username: "reader", display_name: "آزمایش", role: "reader" }, csrf: "fixture" };
    else if (path === "/workspace") body = { prefs: { reader: readerPrefs }, positions, recent: [] };
    else if (path === "/workspace/position" && method === "PUT") { const input = route.request().postDataJSON(); positions[input.document_uid] = input.position; body = { ok: true }; }
    else if (path === "/workspace/prefs" && method === "PUT") { readerPrefs = { ...readerPrefs, ...route.request().postDataJSON().reader }; body = { ok: true }; }
    else if (path.endsWith("/work")) body = { uid: "w-fixture", title: "کتاب آزمایشی", authors: [], documents: [{ uid: doc, label: "جلد یک", format: options.pdf ? "pdf" : "text", pages_count: 2 }, ...(options.multipleDocs ? [{ uid: "d-volume2", label: "جلد دوم", format: "text", pages_count: 2 }] : [])] };
    else if (path.endsWith("/toc")) body = { sections: [], release_uid: "test" };
    else if (path.endsWith("/pages")) body = { items: [1, 2].map((n) => ({ page_uid: `p-00${n}`, label: `${n}`, serial: n })) };
    else if (/\/pages\/p-00[12]$/.test(path)) body = { page_mapping: options.mapping ?? "exact", overlay_applied: !!options.corrected, overlay_revision_uid: options.corrected ? "revision-fixture" : null, page_uid: path.split("/").pop(), label: path.endsWith("1") ? "1" : "2", serial: path.endsWith("1") ? 1 : 2, blocks: pageBlocks(path.endsWith("1") ? "1" : "2"), footnotes: [] };
    else if (path === "/bookmarks" && method === "GET") body = { items: bookmarks };
    else if (path.startsWith("/bookmarks/") && method === "DELETE") {
      if (failBookmark) return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "حذف آزمایشی ناموفق", retryable: true } } });
      deletes.push(path);
      bookmarks = bookmarks.filter((b) => b.uid !== path.split("/").pop());
      return route.fulfill({ status: 204 });
    }
    else if (path === "/notes" && method === "GET") body = { items: notes };
    else if (path === "/notes" && method === "POST") {
      const input = route.request().postDataJSON();
      const created: Note = { uid: `n-${notes.length + 1}`, document_uid: doc, body: input.body, version: 1, page_uid: input.page_uid ?? null, page_label: input.page_uid === "p-001" ? "1" : input.page_uid === "p-002" ? "2" : null, local_hadith_uid: input.local_hadith_uid ?? null, updated_at: "2026-11-02T00:00:00Z" };
      notes = [created, ...notes];
      body = created;
    }
    else if (path.startsWith("/notes/") && method === "PATCH") {
      const uid = path.split("/").pop();
      const input = route.request().postDataJSON();
      notes = notes.map((n) => n.uid === uid ? { ...n, body: input.body, version: input.version + 1 } : n);
      body = notes.find((n) => n.uid === uid);
    }
    else if (path.startsWith("/notes/") && method === "DELETE") {
      deletes.push(path);
      notes = notes.filter((n) => n.uid !== path.split("/").pop());
      return route.fulfill({ status: 204 });
    }
    else if (path.startsWith("/shares/")) {
      if (options.shared === "expired") return route.fulfill({ status: 410, json: { error: { code: "gone", message: "این اشتراک منقضی شده است", retryable: false } } });
      body = { uid: "shared-fixture", kind: options.shared ?? "highlight", owner_name: "صاحب اشتراک", document_uid: doc, page_uid: "p-001", payload: "یادداشت اشتراکی آزمایشی", meta: { block_id: "b1", start: Array.from(sentence).length * 7, end: Array.from(sentence).length * 7 + 3, color: "green" } };
    }
    else if (path === "/search" && method === "POST") {
      searches.push(route.request().postDataJSON());
      body = { results: [{ passage_uid: "result-1", snippet: "این متن آزمایشی", match_type: "normalized", work: { uid: "w-fixture", title: "کتاب آزمایشی" }, document: { uid: doc, label: "جلد یک" }, page: { uid: "p-002", label: "2" }, match_offsets: { start: 0, end: 3, unit: "codepoint" }, highlight: [] }], completion_state: "complete", count_relation: "exact", verified_occurrences: 1 };
    }
    else if (path === "/annotations" && method === "GET") body = { items };
    else if (path === "/annotations" && method === "POST") {
      const input = route.request().postDataJSON();
      annotationPosts.push({ block_id: input.block_id, text: input.text, group_uid: input.group_uid ?? null });
      const created = { ...input, uid: items.some((h) => h.uid === "hl-created") ? `hl-created-${items.length}` : "hl-created", note: null } as Highlight;
      items.push(created);
      body = created;
    } else if (path.startsWith("/annotations/")) {
      const uid = path.split("/").pop();
      if (method === "PATCH") {
        if (failPatch) return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "خطای آزمایشی", retryable: true } } });
        items = items.map((h) => h.uid === uid ? { ...h, ...route.request().postDataJSON() } : h);
        body = items.find((h) => h.uid === uid);
      } else if (method === "DELETE") {
        deletes.push(path);
        /* سرور گروه را یک‌جا حذف می‌کند؛ شبیه‌سازی همان رفتار */
        const target = items.find((h) => h.uid === uid);
        items = target?.group_uid
          ? items.filter((h) => h.group_uid !== target.group_uid)
          : items.filter((h) => h.uid !== uid);
        return route.fulfill({ status: 204 });
      }
    }
    return route.fulfill({ json: body });
  });
  await page.goto(`/library/book/read?pg=1&d=${doc}${options.shared ? "&shared=shared-fixture" : ""}`);
  if (!options.web) await expect(page.locator(".rm-root")).toHaveAttribute("data-mode", options.paged ? "pages" : "scroll");
  if (!options.pdf && !options.citation && !options.grouped) await expect(page.locator('mark[data-hl-uid="hl-fixture"]')).toBeVisible();
  return { fail: (value: boolean) => { failPatch = value; }, failBookmark: (value: boolean) => { failBookmark = value; }, searches, positions, deletes, annotationPosts };
}

test.describe("mobile reader interactions", () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true });

  test("highlight editing survives failure, reload, and confirmed deletion", async ({ page }) => {
    const api = await fixture(page);
    const mark = page.locator('mark[data-hl-uid="hl-fixture"]');
    await mark.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت قبلی");
    await page.getByRole("button", { name: "سبز", exact: true }).click();
    await page.getByLabel("یادداشت این هایلایت").fill("یادداشت تازه");
    api.fail(true);
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت تازه");
    api.fail(false);
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    await page.reload();
    await mark.click();
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت تازه");
    await expect(page.getByRole("button", { name: "سبز", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "حذف هایلایت", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("هایلایت و یادداشت آن حذف شوند؟");
    await page.getByRole("button", { name: "انصراف", exact: true }).click();
    await page.getByLabel("یادداشت این هایلایت").fill("");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    await page.getByRole("button", { name: "حذف هایلایت", exact: true }).click();
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await expect(mark).toHaveCount(0);
  });

  test("selection creates an editable persistent highlight; lock has no utility ring", async ({ page }) => {
    await fixture(page);
    /* لمس طولانی (نه ماوس) انتخاب کلمه و دستگیره‌ها را می‌سازد؛ ماوس در حالت متمرکز انتخاب بومی دارد. */
    const book = page.locator(".rm-book").first();
    await book.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: 180, clientY: 220, bubbles: true });
    await expect(page.locator("#rm-hStart")).toBeVisible();
    await book.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, clientX: 180, clientY: 220, bubbles: true });
    const handle = page.locator("#rm-hStart");
    await expect(handle).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const mode of ["light", "dark"] as const) {
      for (const palette of mode === "light" ? LIGHT_PALETTES : DARK_PALETTES) {
        const colors = await page.evaluate(({ mode, palette }) => {
          document.documentElement.classList.toggle("dark", mode === "dark");
          document.documentElement.classList.toggle("light", mode === "light");
          document.documentElement.dataset.palette = palette;
          const handle = getComputedStyle(document.querySelector("#rm-hStart")!);
          const page = getComputedStyle(document.querySelector(".rm-root")!);
          return { handle: handle.backgroundColor, border: handle.borderTopColor, page: page.backgroundColor };
        }, { mode, palette: palette.id });
        expect(colors.handle, `${mode}/${palette.id}`).not.toBe("rgba(0, 0, 0, 0)");
        expect(colors.handle, `${mode}/${palette.id}`).not.toBe(colors.page);
        expect(colors.border, `${mode}/${palette.id}`).not.toBe(colors.handle);
      }
    }
    for (const id of ["#rm-hStart", "#rm-hEnd"]) {
      const box = await page.locator(id).boundingBox();
      await page.mouse.move(box!.x + 11, box!.y + 11);
      await page.mouse.down();
      await page.mouse.move(box!.x + 35, box!.y - 5, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator("#rm-selBubble")).toBeVisible();
    }
    await page.getByRole("button", { name: "یادداشت روی متن انتخاب‌شده", exact: true }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("یادداشت این هایلایت").fill("یادداشت انتخاب");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    await page.locator('mark[data-hl-uid="hl-created"]').click();
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت انتخاب");
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    await page.getByRole("button", { name: "قفل صفحهٔ مطالعه" }).click();
    await expect(page.locator("#rm-lockRing .rm-lock-ring")).toBeVisible();
    await expect(page.locator("#rm-lockRing .ring")).toHaveCount(0);
    const ring = await page.locator("#rm-lockRing").boundingBox();
    await page.mouse.move(ring!.x + 22, ring!.y + 22);
    await page.mouse.down();
    await expect(page.locator(".rm-root")).not.toHaveClass(/locked/, { timeout: 4000 });
    await page.mouse.up();
  });

  test("scroll updates the controls without rendering book pages on every frame", async ({ page }, info) => {
    await page.addInitScript(() => {
      type Fiber = { flags: number; actualDuration: number; actualStartTime: number; type?: { name?: string }; child?: Fiber; sibling?: Fiber };
      const scope = window as unknown as { readerRenders: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
      scope.readerRenders = 0;
      const renderStarts = new Set<number>();
      scope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true, renderers: new Map(), inject: () => 1,
        onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
          const visit = (fiber?: Fiber) => {
            if (!fiber) return;
            if (fiber.type?.name === "PageRenderer" && (fiber.flags & 1) && fiber.actualDuration > 0 && !renderStarts.has(fiber.actualStartTime)) {
              renderStarts.add(fiber.actualStartTime);
              scope.readerRenders++;
            }
            visit(fiber.child); visit(fiber.sibling);
          };
          visit(root.current);
        },
        onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {},
      };
    });
    await fixture(page);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(async () => {
      const scope = window as unknown as { readerRenders: number };
      const host = document.querySelector<HTMLElement>("#rm-scroll")!;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const before = scope.readerRenders;
      const frames: number[] = [];
      let last = performance.now();
      const start = host.scrollTop;
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - last); last = now;
        host.scrollTop = start + i * 8;
      }
      return { initialPageRenders: before, scrollPageRenders: scope.readerRenders - before,
        averageFrameMs: frames.reduce((a, b) => a + b, 0) / frames.length,
        framesOver50Ms: frames.filter((n) => n > 50).length, moved: host.scrollTop > start };
    });
    await info.attach("scroll-profile", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
    console.log("reader scroll profile", metrics);
    if (!process.env.E2E_PRODUCTION_PROFILE) expect(metrics.initialPageRenders).toBeGreaterThan(0);
    expect(metrics.moved).toBe(true);
    expect(metrics.scrollPageRenders).toBe(0);
    // Verify a native touch swipe neither starts selection nor triggers a page-turn gesture.
    const cdp = await page.context().newCDPSession(page);
    const before = await page.locator("#rm-scroll").evaluate((el) => el.scrollTop);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 600 }] });
    for (let y = 560; y >= 240; y -= 40) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.locator("#rm-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(page.locator("#rm-selBubble")).toHaveCount(0);
  });

  test("touch-area defaults and transparent adjustment; orientation is absent", async ({ page }, info) => {
    await fixture(page);
    await page.getByRole("button", { name: "تنظیمات مطالعه", exact: true }).click();
    await page.locator(".rm-tab").filter({ hasText: /^مطالعه$/ }).click();
    const row = page.locator(".rm-tap-area-control");
    await expect(row).toContainText("۴۵٪");
    await expect(page.locator(".rm-pane.on .seg button.on").filter({ hasText: "مرکز صفحه" })).toHaveCount(1);
    const settings = page.locator("#rm-settings");
    const original = await settings.evaluate((el) => getComputedStyle(el).backgroundColor);
    const slider = await row.locator(".sl").boundingBox();
    await page.mouse.move(slider!.x + slider!.width * 0.6, slider!.y + slider!.height / 2);
    await page.mouse.down();
    await expect(settings).toHaveClass(/tap-previewing/);
    await expect(page.locator("#rm-tapZonePreview")).toHaveClass(/show/);
    expect(await settings.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(original);
    // The preview must remain visible during a stationary hold beyond its normal dismiss delay.
    await page.waitForTimeout(1400);
    await expect(page.locator("#rm-tapZonePreview")).toHaveClass(/show/);
    await page.screenshot({ path: info.outputPath("touch-area-preview.png") });
    await page.mouse.move(slider!.x + slider!.width * 0.4, slider!.y + slider!.height / 2);
    await page.mouse.up();
    await expect(settings).not.toHaveClass(/tap-previewing/);
    await page.locator(".rm-tab").filter({ hasText: /^صفحه$/ }).click();
    await expect(settings).not.toContainText("جهت‌گیری صفحه");
    await expect(settings).toContainText("نمایش تمام‌صفحه");
  });

  test("local reading fonts load on the desktop home page", async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const loaded = await page.evaluate(async () => {
      const families = ["RM BYekan", "RM FarBadr", "RM Greta", "RM Vazir", "RM BTraffic", "RM BYagut", "RM AdobeNaskh"];
      return Promise.all(families.map(async (family) => ({ family, count: (await document.fonts.load(`400 20px "${family}"`, "متن کتاب")).length })));
    });
    for (const font of loaded) expect(font.count, font.family).toBeGreaterThan(0);
  });
  test("desktop inspector and unsaved note survive every responsive breakpoint", async ({ page }, info) => {
    await fixture(page);
    await page.locator('mark[data-hl-uid="hl-fixture"]').click();
    await page.getByLabel("یادداشت این هایلایت").fill("پیش‌نویس مشترک");
    for (const width of [1440, 1024, 768, 412]) {
      await page.setViewportSize({ width, height: 900 });
      const editor = page.getByLabel("یادداشت این هایلایت");
      await expect(editor).toBeVisible();
      await expect(editor).toHaveValue("پیش‌نویس مشترک");
      if (width === 1440) {
        await expect(page.locator('aside section[aria-label="هایلایت و یادداشت"]')).toBeVisible();
        await page.screenshot({ path: info.outputPath("desktop-highlight-inspector.png"), scale: "css" });
      }
    }
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    await page.reload();
    await page.locator('mark[data-hl-uid="hl-fixture"]').click();
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("پیش‌نویس مشترک");
  });

  test("shared content is read-only and corrected pages are identified in both shells", async ({ page }) => {
    await fixture(page, { shared: "highlight", corrected: true });
    for (const width of [412, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("region", { name: "محتوای اشتراکی" })).toContainText("صاحب اشتراک");
      await expect(page.getByText("این صفحه شامل اصلاح سامانه است.", { exact: false }).first()).toBeVisible();
      await page.locator('mark[data-hl-uid="shared-shared-fixture"]').click();
      await expect(page.getByLabel("یادداشت این هایلایت")).toHaveCount(0);
      await expect(page.locator("[data-hl-menu]")).toHaveCount(0);
    }
  });

  test("expired shares and bookmark deletion failures remain recoverable", async ({ page }) => {
    const api = await fixture(page, { shared: "expired", bookmarks: true });
    await expect(page.getByRole("region", { name: "محتوای اشتراکی" })).toContainText("منقضی");
    await page.getByRole("button", { name: "بستن اشتراک" }).click();
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const row = page.locator('[data-bm-uid="bm-fixture"]');
    await expect(row).toBeVisible();
    api.failBookmark(true);
    await row.getByRole("button", { name: "حذف نشانک صفحه", exact: true }).click();
    await expect(page.getByText("حذف آزمایشی ناموفق", { exact: true }).first()).toBeVisible();
    await expect(row).toBeVisible();
    expect(api.deletes).not.toContain("/bookmarks/bm-fixture");
    api.failBookmark(false);
    await row.getByRole("button", { name: "حذف نشانک صفحه", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => api.deletes.includes("/bookmarks/bm-fixture")).toBe(true);
    await expect(page).toHaveURL(/pg=1(?:&|$)/);
  });

  test("bookmarks and notes share one page-ordered marks list", async ({ page }) => {
    await fixture(page, { bookmarks: true });
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const rows = page.locator("[data-mark-page]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-mark-page", "p-001");
    await expect(rows.nth(0)).toContainText("یادداشت قبلی");
    await expect(rows.nth(1)).toHaveAttribute("data-mark-page", "p-002");
    await expect(rows.nth(1)).toHaveAttribute("data-bm-uid", "bm-fixture");
    await expect(rows.nth(1)).toContainText("نشانک صفحه");
  });

  test("deleting a text note releases the page bookmark", async ({ page }) => {
    const api = await fixture(page);
    await expect(page.getByRole("button", { name: "حذف نشانک این صفحه", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const row = page.locator('[data-mark-page="p-001"]');
    await expect(row).toContainText("یادداشت قبلی");
    await row.getByRole("button", { name: "حذف یادداشت", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("هایلایت و یادداشت آن حذف شوند؟");
    await page.getByRole("button", { name: "حذف هایلایت", exact: true }).click();
    await expect(page.getByText("هنوز نشانکی ثبت نشده است")).toBeVisible();
    expect(api.deletes).toContain("/annotations/hl-fixture");
    await page.getByRole("dialog").getByRole("button", { name: "بستن", exact: true }).click();
    await expect(page.getByRole("button", { name: "افزودن نشانک این صفحه", exact: true })).toBeVisible();
  });

  test("a page with two notes requires confirmation and deletes all marks", async ({ page }) => {
    const api = await fixture(page, {
      pageNotes: [{ uid: "n-fixture", document_uid: doc, page_uid: "p-001", page_label: "1", body: "یادداشت صفحهٔ یک", version: 1, updated_at: "2026-11-01T00:00:00Z" }],
    });
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const row = page.locator('[data-mark-page="p-001"]');
    await expect(row).toContainText("۲ یادداشت");
    await row.getByRole("button", { name: "حذف نشانک صفحه", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("۲ یادداشت دارد");
    await expect(dialog).toContainText("این کار بازگشت‌پذیر نیست");
    await dialog.getByRole("button", { name: "حذف همه", exact: true }).click();
    await expect(page.getByText("هنوز نشانکی ثبت نشده است")).toBeVisible();
    expect(api.deletes).toEqual(expect.arrayContaining(["/notes/n-fixture", "/annotations/hl-fixture"]));
  });

  test("a multi-paragraph highlight stays one group with full text and group deletion", async ({ page }) => {
    const api = await fixture(page, { grouped: true });
    /* کلیک روی هر پاراگراف از گروه، متن کامل انتخاب را نشان می‌دهد. */
    await page.locator('mark[data-hl-uid="hl-g2"]').click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.locator("blockquote")).toContainText("پاراگراف دوم");
    await expect(sheet.locator("blockquote")).toContainText("این متن آزمایشی");
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت گروهی");
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    /* در فهرست نشانه‌ها یک ردیف با هر دو پاراگراف در باکس اسکرول‌پذیر. */
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const row = page.locator('[data-mark-page="p-001"]');
    const quote = row.locator('[data-hl-quote="hl-g1"]');
    await expect(quote).toContainText("پاراگراف دوم");
    await expect(quote).toContainText("این متن آزمایشی");
    expect(await quote.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    await expect(row).toContainText("۲ پاراگراف");
    /* حذف از هر نقطه = حذف کل گروه، نه یک پاراگراف. */
    await row.getByRole("button", { name: "حذف یادداشت", exact: true }).click();
    await page.getByRole("button", { name: "حذف هایلایت", exact: true }).click();
    await expect(page.getByText("هنوز نشانکی ثبت نشده است")).toBeVisible();
    await expect(page.locator('mark[data-hl-uid="hl-g1"]')).toHaveCount(0);
    await expect(page.locator('mark[data-hl-uid="hl-g2"]')).toHaveCount(0);
    expect(api.deletes).toContain("/annotations/hl-g1");
  });

  test("a plain highlight is not a bookmark", async ({ page }) => {
    await fixture(page, { plainHighlight: true });
    await expect(page.locator('mark[data-hl-uid="hl-fixture"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "افزودن نشانک این صفحه", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    await expect(page.getByText("هنوز نشانکی ثبت نشده است")).toBeVisible();
    await page.getByRole("tab", { name: /هایلایت‌ها/ }).click();
    await expect(page.locator('[aria-label="یادداشت‌های شخصی این سند"] p[title="این"]')).toBeVisible();
  });

  test("approximate page notice is dismissed per book", async ({ page }) => {
    await fixture(page, { mapping: "approximate", paged: true, multipleDocs: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const notice = page.getByText("مرز صفحه‌های چاپی این سند در منبع ثبت نشده", { exact: false });
    await expect(notice).toBeVisible();
    await page.getByRole("button", { name: "بستن هشدار شمارهٔ صفحهٔ تخمینی", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(notice).toHaveCount(0);
    await page.goto("/library/book/read?pg=1&d=d-volume2");
    await expect(notice).toBeVisible();
  });

  test("scope and ignore-spacing are shared server search options", async ({ page }) => {
    const api = await fixture(page, { multipleDocs: true });
    await page.getByRole("button", { name: "جست‌وجو در کتاب", exact: true }).click();
    await page.getByLabel("عبارت جست‌وجو", { exact: true }).fill("میرویم");
    await page.getByLabel("عبارت جست‌وجو", { exact: true }).press("Enter");
    await expect.poll(() => api.searches.length).toBeGreaterThan(0);
    await page.locator("#rm-searchPanel").getByRole("button", { name: "کل اثر", exact: true }).click();
    await page.getByRole("switch", { name: "نادیده گرفتن فاصله و نیم‌فاصله" }).click();
    await expect.poll(() => api.searches.at(-1)?.ignore_spacing).toBe(true);
    expect(api.searches.at(-1)?.scope.target).toBe("work");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByLabel("نادیده گرفتن فاصله و نیم‌فاصله")).toBeChecked();
    await page.getByRole("button", { name: "فقط جلد یک", exact: true }).click();
    await expect.poll(() => api.searches.at(-1)?.scope.target).toBe("document");
  });

  test("pending saves block duplicates and dirty close requires confirmation", async ({ page }) => {
    await fixture(page);
    await page.locator('mark[data-hl-uid="hl-fixture"]').click();
    await page.getByLabel("یادداشت این هایلایت").fill("پیش‌نویس در انتظار");
    await page.getByRole("button", { name: "بستن", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("تغییرات ذخیره‌نشده");
    await page.getByRole("button", { name: "انصراف", exact: true }).click();
    let writes = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/annotations/hl-fixture", async (route) => { writes++; await waiting; await route.fallback(); });
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "در حال ذخیره…", exact: true })).toBeDisabled();
    await expect(page.getByLabel("یادداشت این هایلایت")).toBeDisabled();
    expect(writes).toBe(1);
    release();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    expect(writes).toBe(1);
  });

  test("desktop selection creates a yellow highlight with its own note", async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.mouse.move(1000, 350);
    await page.mouse.down();
    await page.mouse.move(700, 380, { steps: 10 });
    await page.mouse.up();
    await page.getByRole("button", { name: "یادداشت", exact: true }).click();
    await expect(page.getByRole("button", { name: "زرد", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("یادداشت این هایلایت").fill("یادداشت ساخته‌شده در دسکتاپ");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await expect(page.getByRole("button", { name: "ذخیره تغییرات" })).toBeDisabled();
    await page.setViewportSize({ width: 412, height: 860 });
    await expect(page.getByLabel("یادداشت این هایلایت")).toHaveValue("یادداشت ساخته‌شده در دسکتاپ");
  });

  test("PDF renders across breakpoints while unavailable text tools stay disabled", async ({ page }) => {
    await fixture(page, { pdf: true });
    for (const width of [412, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("canvas").first()).toBeVisible();
      if (width === 412) {
        await expect(page.getByRole("button", { name: "جست‌وجو در کتاب", exact: true })).toBeDisabled();
        await expect(page.getByRole("button", { name: "یادداشت‌های این سند", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "نشانک‌ها", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "نشانک‌ها", exact: true }).click();
        await expect(page.getByText("هنوز نشانکی ثبت نشده است")).toBeVisible();
        await expect(page.getByLabel("متن یادداشت تازه")).toHaveCount(0);
        await page.keyboard.press("Escape");
      } else {
        await expect(page.getByRole("button", { name: "جست‌وجو در این کتاب", exact: true })).toHaveCount(0);
      }
      await expect(page.locator('[data-block-id]')).toHaveCount(0);
    }
  });

  test("Quran panel has readable contrast in every palette and no empty metadata card", async ({ page }, info) => {
    await fixture(page, { citation: "empty" });
    // Measure settled palette colors, rather than an intermediate color transition.
    await page.addStyleTag({ content: "#rm-foot *, #rm-scroll button { transition: none !important; }" });
    const citation = page.getByRole("button", { name: "نمایش جزئیات نشانی آیه در پنل زمینه", exact: true }).last();
    await citation.click();
    const panel = page.locator("#rm-foot .reader-verse-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("dl")).toHaveCount(0);
    await expect(panel.locator("blockquote")).toHaveCSS("direction", "rtl");
    await expect(panel.locator("blockquote")).toHaveCSS("text-align", "right");
    await expect(panel.locator("blockquote")).toContainText("ج\u200c 90:");
    await expect(panel.getByText(/این نقلِ کتاب است/)).toBeVisible();
    for (const mode of ["light", "dark"] as const) {
      for (const palette of mode === "light" ? LIGHT_PALETTES : DARK_PALETTES) {
        const contrasts = await page.evaluate(({ mode, palette }) => {
          document.documentElement.classList.toggle("dark", mode === "dark");
          document.documentElement.classList.toggle("light", mode === "light");
          document.documentElement.dataset.palette = palette;
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data); };
          const background = (el: Element | null): number[] => {
            if (!el) return [255, 255, 255];
            const parent = background(el.parentElement), color = rgba(getComputedStyle(el).backgroundColor), alpha = color[3] / 255;
            return parent.map((v, i) => color[i] * alpha + v * (1 - alpha));
          };
          const luma = (color: number[]) => color.slice(0, 3).map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          return ['#rm-foot button[aria-label="بازگشت به متن"]', "#rm-foot figcaption", "#rm-foot blockquote", "#rm-foot .reader-verse-panel > div:last-child p", '#rm-scroll button[aria-label="نمایش جزئیات نشانی آیه در پنل زمینه"] svg', "#rm-foot h2 svg"].map((selector) => {
            const el = document.querySelector(selector)!;
            const fg = luma(rgba(getComputedStyle(el).color)), bg = luma(background(el));
            return { selector, color: getComputedStyle(el).color, textToken: getComputedStyle(el).getPropertyValue("--text"), ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) };
          });
        }, { mode, palette: palette.id });
        for (const contrast of contrasts) expect(contrast.ratio, `${mode}/${palette.id}/${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(contrast.selector.endsWith("svg") ? 3 : 4.5);
        if (mode === "light" && palette.id === "default") await page.screenshot({ path: info.outputPath("quran-panel-light.png"), scale: "css" });
      }
    }
    await page.screenshot({ path: info.outputPath("quran-panel-dark.png"), scale: "css" });
    await page.getByRole("button", { name: "بستن پاورقی", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "نمایش جزئیات نشانی آیه در پنل زمینه", exact: true }).last().click();
    await expect(page.locator(".reader-verse-panel").filter({ visible: true }).locator("blockquote")).toHaveCSS("text-align", "right");
  });

  test("Quran metadata appears when available and isolated markers keep code-point offsets", async ({ page }) => {
    const source = "ج\u200d 90: نص ج\u200dميل";
    const rendered = displayBookText(source);
    expect(Array.from(rendered)).toHaveLength(Array.from(source).length);
    expect(rendered).toBe("ج\u200c 90: نص ج\u200dميل");
    await fixture(page, { citation: "address" });
    await page.getByRole("button", { name: "نمایش جزئیات نشانی آیه در پنل زمینه", exact: true }).last().click();
    const metadata = page.locator('dl[aria-label="اطلاعات استناد قرآنی"]');
    await expect(metadata).toContainText("سورهٔ ۳۵، آیهٔ ۱۰");
    await expect(metadata).toContainText("شمارهٔ سوره:");
    await expect(metadata).toContainText("شمارهٔ آیه:");
  });

  test("logical offsets persist across layout and typography changes", async ({ page }) => {
    const api = await fixture(page);
    await page.locator("#rm-scroll").evaluate((el) => { el.scrollTop = 600; });
    await expect.poll(() => Number(api.positions[doc]?.offset_cp ?? 0)).toBeGreaterThan(100);
    const before = Number(api.positions[doc].offset_cp);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".rm-root")).toHaveCount(0);
    await expect.poll(async () => page.locator('main[aria-label="متن کتاب"]').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => Math.abs(Number(api.positions[doc]?.offset_cp ?? 0) - before)).toBeLessThan(100);
    await page.getByRole("button", { name: "تنظیمات خواندن", exact: true }).first().click();
    await page.getByLabel("تراز متن", { exact: true }).selectOption("justify");
    await page.getByLabel("جهت متن", { exact: true }).selectOption("rtl");
    await expect(page.locator('[data-block-id="b1"] p').first()).toHaveCSS("text-align", "justify");
    await page.setViewportSize({ width: 412, height: 900 });
    await expect(page.locator('[data-block-id="b1"] p').first()).toHaveCSS("text-align", "justify");
  });

});

test.describe("focus mode mouse selection", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

  test("desktop focus mode selects text with the mouse and shows the selection panel", async ({ page }) => {
    await fixture(page, { web: true, twoBlocks: true });
    await page.getByRole("button", { name: "مطالعهٔ متمرکز", exact: true }).click();
    const shell = page.locator(".rm-root");
    await expect(shell).toBeVisible();
    const block = shell.locator('[data-block-id="b1"]').first();
    const next = shell.locator('[data-block-id="b1b"]').first();
    await expect(block).toBeVisible();
    await next.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const first = (await block.boundingBox())!;
    const second = (await next.boundingBox())!;
    /* دو پاراگراف کوتاه؛ انتخاب از خط پایانی اول تا خط پایانی دوم. */
    await page.mouse.move(first.x + first.width * 0.7, first.y + first.height - 8);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width * 0.3, second.y + second.height - 8, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(0);
    await expect(page.locator("#rm-selBubble")).toBeVisible();
    await expect(page.getByRole("button", { name: "یادداشت روی متن انتخاب‌شده", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true })).toBeVisible();
    /* فیش و یادداشت یکی شده‌اند و انتخاب کامل کتاب حذف شده است. */
    const bubble = page.locator("#rm-selBubble");
    await expect(bubble.getByText("فیش", { exact: true })).toHaveCount(0);
    await expect(bubble.getByText("همه", { exact: true })).toHaveCount(0);
  });

  test("mouse selection spanning two paragraphs creates one highlight per block", async ({ page }) => {
    const api = await fixture(page, { web: true, twoBlocks: true });
    await page.getByRole("button", { name: "مطالعهٔ متمرکز", exact: true }).click();
    const shell = page.locator(".rm-root");
    await expect(shell).toBeVisible();
    await shell.locator('[data-block-id="b1b"]').first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    const first = (await shell.locator('[data-block-id="b1"]').first().boundingBox())!;
    const second = (await shell.locator('[data-block-id="b1b"]').first().boundingBox())!;
    /* سرصفحهٔ شناور بالای صفحه را رد می‌کنیم: نقطهٔ آغاز روی خط پایانی پاراگراف اول. */
    const startY = first.y + first.height - 8;
    const endY = second.y + second.height - 8;
    await page.mouse.move(1000, startY);
    await page.mouse.down();
    await page.mouse.move(600, endY, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator("#rm-selBubble")).toBeVisible();
    await page.getByRole("button", { name: "هایلایت متن انتخاب‌شده", exact: true }).click();
    await page.getByRole("button", { name: "هایلایت صورتی", exact: true }).click();
    await expect.poll(() => api.annotationPosts.length).toBe(2);
    expect(api.annotationPosts.map((p) => p.block_id)).toEqual(["b1", "b1b"]);
    /* هر دو پاراگراف یک گروه مشترک دارند تا حذف/ویرایش یک‌جا باشد. */
    expect(api.annotationPosts[0].group_uid).toBeTruthy();
    expect(api.annotationPosts[1].group_uid).toBe(api.annotationPosts[0].group_uid);
    /* در تب هایلایت‌ها یک ردیف گروهی (نه دو ردیف) دیده می‌شود. */
    await page.getByRole("button", { name: "نشانک‌ها و یادداشت‌ها", exact: true }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("tab", { name: /هایلایت‌ها/ }).click();
    await expect(panel.locator("[data-hl-quote]")).toHaveCount(1);
    await expect(panel.locator("[data-hl-quote]")).toContainText("پاراگراف دوم");
  });

  test("deleting one segment of a multi-paragraph highlight removes the whole group", async ({ page }) => {
    const api = await fixture(page, { web: true, twoBlocks: true });
    await page.getByRole("button", { name: "مطالعهٔ متمرکز", exact: true }).click();
    const shell = page.locator(".rm-root");
    await expect(shell).toBeVisible();
    await shell.locator('[data-block-id="b1b"]').first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    const first = (await shell.locator('[data-block-id="b1"]').first().boundingBox())!;
    const second = (await shell.locator('[data-block-id="b1b"]').first().boundingBox())!;
    await page.mouse.move(first.x + first.width - 40, first.y + first.height - 8);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width * 0.3, second.y + second.height - 8, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator("#rm-selBubble")).toBeVisible();
    await page.getByRole("button", { name: "هایلایت متن انتخاب‌شده", exact: true }).click();
    await page.getByRole("button", { name: "هایلایت زرد", exact: true }).click();
    await expect.poll(() => api.annotationPosts.length).toBe(2);
    const groupMarks = shell.locator('mark[data-hl-uid^="hl-created"]');
    const groupUids = () => groupMarks.evaluateAll((els) =>
      [...new Set(els.map((el) => el.getAttribute("data-hl-uid")))]);
    await expect.poll(async () => (await groupUids()).length).toBe(2);
    /* کلیک روی قطعهٔ دوم، ویرایشگر متن کامل گروه را باز می‌کند. */
    const secondUid = (await groupUids()).find((uid) => uid && uid !== "hl-created");
    await shell.locator(`mark[data-hl-uid="${secondUid}"]`).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(api.annotationPosts[1].text);
    await dialog.getByRole("button", { name: "حذف هایلایت" }).click();
    await dialog.getByRole("button", { name: "حذف", exact: true }).click();
    /* یک DELETE برای کل گروه؛ هر دو هایلایت بی‌درنگ از متن و کش حذف می‌شوند. */
    expect(api.deletes).toEqual(["/annotations/hl-created"]);
    await expect(groupMarks).toHaveCount(0);
  });
});
