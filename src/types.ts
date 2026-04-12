export interface CaptureItem {
  id: string;
  content: string;
  content_type: "text" | "image";
  source_app: string;
  source_url?: string;
  source_title?: string;
  tags: string[];
  char_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  name: string;
  use_count: number;
  last_used_at: string;
  color_index: number;
}

export interface ContextPack {
  id: string;
  title: string;
  description?: string;
  constraints?: string;
  questions?: string;
  item_ids: string[];
  export_format: ExportFormat;
  created_at: string;
  updated_at: string;
}

export type ExportFormat = "markdown" | "claude" | "chatgpt" | "cursor";

export interface AppSettings {
  capture_hotkey: string;
  panel_hotkey: string;
  quick_tag_on_capture: boolean;
  default_export_format: ExportFormat;
  max_capture_size_kb: number;
  launch_at_login: boolean;
  theme: "light" | "dark" | "system";
  language: "en" | "ru";
  data_location: string;
}

export interface AppInfo {
  app_name: string;
  window_title: string;
  url_from_title?: string;
}

export type View = "inbox" | "packs" | "settings" | "pack-editor";

export const TAG_COLORS = [
  { bg: "var(--tag-blue-bg)", text: "var(--tag-blue-text)" },
  { bg: "var(--tag-emerald-bg)", text: "var(--tag-emerald-text)" },
  { bg: "var(--tag-violet-bg)", text: "var(--tag-violet-text)" },
  { bg: "var(--tag-amber-bg)", text: "var(--tag-amber-text)" },
  { bg: "var(--tag-rose-bg)", text: "var(--tag-rose-text)" },
  { bg: "var(--tag-cyan-bg)", text: "var(--tag-cyan-text)" },
  { bg: "var(--tag-orange-bg)", text: "var(--tag-orange-text)" },
  { bg: "var(--tag-pink-bg)", text: "var(--tag-pink-text)" },
] as const;
