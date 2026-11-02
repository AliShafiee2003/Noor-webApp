/**
 * آیکون‌های ریدر موبایل — فونت MaterialIcons با کدپوینت‌های فلاتر (عین پروتوتایپ :568)
 */
"use client";

import React from "react";

export const ICONS: Record<string, number> = {
  bookmarks_outlined: 0xeee5,
  camera_alt_outlined: 0xef1e,
  check_rounded: 0xf636,
  dark_mode_outlined: 0xef9f,
  edit_outlined: 0xf00d,
  fit_screen_outlined: 0xf079,
  font_download_outlined: 0xf096,
  light_mode_outlined: 0xf162,
  pin_outlined: 0xf2aa,
  redo_rounded: 0xf00e7,
  settings_outlined: 0xf36e,
  undo_rounded: 0xf0261,
  view_carousel_outlined: 0xf491,
  view_day_outlined: 0xf495,
  wb_sunny_outlined: 0xf4bc,
  add: 0xe047,
  arrow_back: 0xe092,
  auto_awesome: 0xe0b7,
  auto_stories: 0xe0bf,
  bookmark: 0xe0f1,
  bookmark_border: 0xe0f4,
  check: 0xe156,
  chevron_left: 0xe15e,
  chevron_right: 0xe15f,
  close: 0xe16a,
  content_copy: 0xe190,
  crop_landscape: 0xe1aa,
  dashboard_customize: 0xe1b2,
  description: 0xe1bf,
  close_fullscreen: 0xe16b,
  expand_less: 0xe245,
  expand_more: 0xe246,
  find_in_page: 0xe285,
  format_align_center: 0xe2ab,
  format_align_justify: 0xe2ac,
  format_align_left: 0xe2ad,
  format_align_right: 0xe2ae,
  format_list_bulleted: 0xe2b8,
  format_textdirection_r_to_l: 0xe2c1,
  fullscreen: 0xe2cb,
  image: 0xe332,
  keyboard_arrow_down: 0xe353,
  keyboard_arrow_up: 0xe356,
  layers: 0xe36d,
  link: 0xe380,
  lock: 0xe3ae,
  lock_outline: 0xe3b1,
  navigation: 0xe41e,
  palette: 0xe46b,
  remove: 0xe516,
  restore: 0xe534,
  screen_lock_rotation: 0xe55e,
  screen_rotation: 0xe55f,
  search: 0xe567,
  search_off: 0xe568,
  select_all: 0xe56e,
  skip_next: 0xe5bd,
  skip_previous: 0xe5be,
  stay_current_landscape: 0xe601,
  stay_current_portrait: 0xe602,
  swap_vert: 0xe627,
  touch_app: 0xe670,
  vertical_align_bottom: 0xe69b,
  visibility_outlined: 0xf4a1,
  aspect_ratio: 0xe0a3,
  share_outlined: 0xf378,
  save_alt: 0xe551,
  add_photo_alternate_outlined: 0xee48,
  crop: 0xe1a3,
  keyboard_arrow_right: 0xe355,
};

/* آیکون‌هایی که در RTL باید آینه شوند */
export const FLIP: ReadonlySet<string> = new Set([
  "arrow_back",
  "undo_rounded",
  "redo_rounded",
  "format_list_bulleted",
]);

export function Mi({
  name,
  size = 22,
  flip,
  className,
  style,
  title,
}: {
  name: string;
  size?: number;
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const cp = ICONS[name] ?? 0x20;
  return (
    <i
      className={"rm-mi" + (flip || FLIP.has(name) ? " rm-flip" : "") + (className ? " " + className : "")}
      style={{ fontSize: size, ...style }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {String.fromCodePoint(cp)}
    </i>
  );
}
