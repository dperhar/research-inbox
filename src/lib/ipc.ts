import { invoke } from "@tauri-apps/api/core";
import type { CaptureItem, Tag, ContextPack, AppSettings, AppInfo, ExportFormat } from "../types";

export const api = {
  // Items
  capture: (content: string, sourceApp: string, sourceUrl: string | null, sourceTitle: string | null, tags: string[]) =>
    invoke<CaptureItem>("capture_item", { content, sourceApp, sourceUrl, sourceTitle, tags }),

  listItems: (offset: number, limit: number, archived: boolean, tagFilter: string | null, sourceFilter: string | null) =>
    invoke<CaptureItem[]>("list_items", { offset, limit, archived, tagFilter, sourceFilter }),

  searchItems: (query: string, limit: number = 50) =>
    invoke<CaptureItem[]>("search_items", { query, limit }),

  updateItem: (id: string, content: string | null, tags: string[] | null, isArchived: boolean | null) =>
    invoke<CaptureItem>("update_item", { id, content, tags, isArchived }),

  deleteItem: (id: string) =>
    invoke<void>("delete_item", { id }),

  // Tags
  listTags: (prefix: string | null, limit: number = 10) =>
    invoke<Tag[]>("list_tags", { prefix, limit }),

  // Packs
  createPack: (title: string, description: string | null, constraints: string | null, questions: string | null, itemIds: string[], exportFormat: string) =>
    invoke<ContextPack>("create_pack", { title, description, constraints, questions, itemIds, exportFormat }),

  updatePack: (id: string, title: string | null, description: string | null, constraints: string | null, questions: string | null, itemIds: string[] | null, exportFormat: string | null) =>
    invoke<ContextPack>("update_pack", { id, title, description, constraints, questions, itemIds, exportFormat }),

  listPacks: (limit: number = 20) =>
    invoke<ContextPack[]>("list_packs", { limit }),

  exportPack: (id: string, format: string) =>
    invoke<string>("export_pack", { id, format }),

  deletePack: (id: string) =>
    invoke<void>("delete_pack", { id }),

  // Settings
  getSettings: () =>
    invoke<AppSettings>("get_settings"),

  updateSettings: (settings: AppSettings) =>
    invoke<void>("update_settings", { settings }),

  // System
  getForegroundApp: () =>
    invoke<AppInfo>("get_foreground_app_cmd"),

  // Model / Hardware
  checkModelStatus: () =>
    invoke<{ downloaded: boolean; path: string }>("check_model_status"),
  checkHardware: () =>
    invoke<{ ram_gb: number; meets_minimum: boolean }>("check_hardware"),
  downloadModel: () =>
    invoke<string>("download_model"),

  // AI Enrichment
  enrichItem: (id: string) =>
    invoke<any>("enrich_item", { id }),

  // Semantic Search
  semanticSearch: (query: string, limit: number = 10) =>
    invoke<CaptureItem[]>("semantic_search", { query, limit }),
};
