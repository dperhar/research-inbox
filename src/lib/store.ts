import { create } from "zustand";
import type { CaptureItem, ContextPack, Tag, View, AppSettings } from "../types";
import { api } from "./ipc";

interface AppState {
  // View
  view: View;
  setView: (view: View) => void;

  // Items
  items: CaptureItem[];
  selectedIds: Set<string>;
  expandedId: string | null;
  loading: boolean;

  loadItems: (archived?: boolean) => Promise<void>;
  searchItems: (query: string) => Promise<void>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setExpanded: (id: string | null) => void;
  archiveSelected: () => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  updateItemTags: (id: string, tags: string[]) => Promise<void>;

  // Packs
  packs: ContextPack[];
  editingPack: ContextPack | null;

  loadPacks: () => Promise<void>;
  setEditingPack: (pack: ContextPack | null) => void;
  deletePack: (id: string) => Promise<void>;

  // Tags
  tags: Tag[];
  loadTags: (prefix?: string) => Promise<void>;

  // Toast
  toast: { message: string; visible: boolean };
  showToast: (message: string) => void;

  // Settings
  settings: AppSettings | null;
  loadSettings: () => Promise<void>;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Filter
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  view: "inbox",
  setView: (view) => set({ view }),

  items: [],
  selectedIds: new Set(),
  expandedId: null,
  loading: false,

  loadItems: async (archived = false) => {
    set({ loading: true });
    try {
      const items = await api.listItems(0, 50, archived, null, null);
      set({ items, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  searchItems: async (query: string) => {
    set({ loading: true });
    try {
      const items = await api.searchItems(query, 50);
      set({ items, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  toggleSelect: (id) => {
    const selected = new Set(get().selectedIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    set({ selectedIds: selected });
  },

  selectAll: () => {
    set({ selectedIds: new Set(get().items.map((i) => i.id)) });
  },

  clearSelection: () => set({ selectedIds: new Set() }),

  setExpanded: (id) => set({ expandedId: id }),

  archiveSelected: async () => {
    const { selectedIds, loadItems, showArchived } = get();
    for (const id of selectedIds) {
      await api.updateItem(id, null, null, true);
    }
    set({ selectedIds: new Set() });
    await loadItems(showArchived);
  },

  deleteItem: async (id) => {
    await api.deleteItem(id);
    const { loadItems, showArchived } = get();
    await loadItems(showArchived);
  },

  updateItemTags: async (id, tags) => {
    await api.updateItem(id, null, tags, null);
    const { loadItems, showArchived } = get();
    await loadItems(showArchived);
  },

  packs: [],
  editingPack: null,

  loadPacks: async () => {
    const packs = await api.listPacks(50);
    set({ packs });
  },

  setEditingPack: (pack) => set({ editingPack: pack, view: pack ? "pack-editor" : "inbox" }),

  deletePack: async (id) => {
    await api.deletePack(id);
    await get().loadPacks();
  },

  tags: [],
  loadTags: async (prefix) => {
    const tags = await api.listTags(prefix ?? null, 20);
    set({ tags });
  },

  toast: { message: "", visible: false },
  showToast: (message) => {
    set({ toast: { message, visible: true } });
    setTimeout(() => set({ toast: { message: "", visible: false } }), 2000);
  },

  settings: null,
  loadSettings: async () => {
    const settings = await api.getSettings();
    set({ settings });
  },

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),

  showArchived: false,
  setShowArchived: (v) => set({ showArchived: v }),
}));
