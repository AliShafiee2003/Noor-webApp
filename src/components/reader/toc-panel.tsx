"use client";

/**
 * پنل فهرست (READ-02): فهرست درختی بخش‌ها + فهرست نشانک‌ها.
 * - کلیک هر بخش → پرش به بلوک آن بخش (block_id) با highlight ظریف.
 * - بخش فعال برجسته می‌شود.
 */
import { useState } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { Bookmark as BookmarkIcon, ChevronDown, ChevronLeft, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { faNum, faDateTime, normalizePersian } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Bookmark, TocSection } from "@/lib/types";

function SectionNode({
  section,
  depth,
  activeSectionUid,
  onJump,
}: {
  section: TocSection;
  depth: number;
  activeSectionUid: string | null;
  onJump: (s: TocSection) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = (section.children?.length ?? 0) > 0;
  const active = activeSectionUid === section.uid;
  const displayTitle = normalizePersian(section.title) || "بدون عنوان";
  const tooltipText = section.page_label
    ? `${displayTitle}، صفحه ${faNum(section.page_label)}`
    : displayTitle;

  return (
    <li>
      <div
        className={cn(
          "group relative flex items-center gap-1 rounded-lg pe-1 transition-colors",
          !active && "hover:bg-accent/60",
        )}
        style={{ paddingInlineStart: `${depth * 12}px` }}
      >
        {active ? (
          <motion.div
            layoutId="activeTocHighlight"
            layout="position"
            className="absolute inset-0 rounded-lg bg-primary/15 border border-primary/25 pointer-events-none"
            transition={{
              type: "spring",
              stiffness: 160,
              damping: 20,
              mass: 0.8,
            }}
          />
        ) : null}

        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "بستن زیرشاخه‌ها" : "بازکردن زیرشاخه‌ها"}
            className={cn(
              "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                !open && "-rotate-90",
                active && "text-primary stroke-[2.5]",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="relative z-10 inline-flex size-8 shrink-0 items-center justify-center">
            <span
              className={cn(
                "inline-block rounded-full transition-all duration-300",
                active
                  ? "size-2 bg-primary shadow-xs ring-2 ring-primary/35 dark:bg-primary dark:ring-primary/45"
                  : "size-1.5 bg-border group-hover:bg-muted-foreground/60",
              )}
              aria-hidden="true"
            />
          </span>
        )}

        <button
          type="button"
          onClick={() => onJump(section)}
          aria-current={active ? "true" : undefined}
          title={tooltipText}
          className={cn(
            "relative z-10 min-h-11 flex-1 font-sans rounded-md py-1.5 text-start text-[13px] leading-6 md:min-h-0 transition-colors",
            active
              ? "font-semibold text-primary"
              : "text-foreground group-hover:text-foreground",
          )}
          style={{ fontFamily: "var(--font-ui)" }}
        >
          <span>{displayTitle}</span>
        </button>
      </div>
      {hasChildren && open ? (
        <ul>
          {(section.children ?? []).map((child) => (
            <SectionNode
              key={child.uid}
              section={child}
              depth={depth + 1}
              activeSectionUid={activeSectionUid}
              onJump={onJump}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export interface TocPanelProps {
  sections: TocSection[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  activeSectionUid: string | null;
  onJumpSection: (s: TocSection) => void;
  bookmarks: Bookmark[];
  bookmarksLoading: boolean;
  onJumpBookmark: (b: Bookmark) => void;
  onDeleteBookmark: (b: Bookmark) => void;
}

export function TocPanel({
  sections,
  isLoading,
  error,
  onRetry,
  activeSectionUid,
  onJumpSection,
  bookmarks,
  bookmarksLoading,
  onJumpBookmark,
  onDeleteBookmark,
}: TocPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col font-sans" style={{ fontFamily: "var(--font-ui)" }}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <ListTree className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">فهرست</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="space-y-2 px-1" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" style={{ opacity: 1 - i * 0.08 }} />
              ))}
              <span className="sr-only">در حال بارگیری فهرست…</span>
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : sections.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs leading-6 text-muted-foreground">
              برای این سند فهرستی ثبت نشده است.
            </p>
          ) : (
            <LayoutGroup id="toc-panel-active-indicator">
              <ul aria-label="فهرست بخش‌ها">
                {sections.map((s) => (
                  <SectionNode
                    key={s.uid}
                    section={s}
                    depth={0}
                    activeSectionUid={activeSectionUid}
                    onJump={onJumpSection}
                  />
                ))}
              </ul>
            </LayoutGroup>
          )}
        </div>

      {/* نشانک‌ها — در همین پنل فهرست (READ-12) */}
      <div className="border-t border-border">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <BookmarkIcon className="size-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">نشانک‌ها</h2>
          {bookmarks.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {faNum(bookmarks.length)}
            </span>
          ) : null}
        </div>
        <div className="max-h-44 overflow-y-auto px-2 pb-2">
          {bookmarksLoading ? (
            <div className="space-y-2 px-1">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : bookmarks.length === 0 ? (
            <p className="px-3 py-3 text-center text-[11px] leading-5 text-muted-foreground">
              هنوز نشانکی ثبت نکرده‌اید؛ با دکمهٔ نشانک در نوار بالا، صفحهٔ فعلی را نگه دارید.
            </p>
          ) : (
            <ul aria-label="فهرست نشانک‌ها">
              {bookmarks.map((b) => (
                <li
                  key={b.uid}
                  className="group flex items-center gap-1 rounded-lg px-1 hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => onJumpBookmark(b)}
                    className="min-h-11 flex-1 truncate py-1.5 text-start text-[13px] md:min-h-0"
                    title={b.label ?? undefined}
                  >
                    <ChevronLeft
                      className="me-1 inline size-3 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>{b.label || "نشانک"}</span>{" "}
                    {b.created_at ? (
                      <span className="ms-1.5 inline-block text-[10px] text-muted-foreground">
                        {faDateTime(b.created_at)}
                      </span>
                    ) : null}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive md:min-h-8"
                    onClick={() => onDeleteBookmark(b)}
                    aria-label={`حذف نشانک ${b.label ?? ""}`}
                  >
                    حذف
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
