import { create } from "zustand";
import type { MemoryBookDoc, Layer } from "@/lib/memory/types";

export type Side = "left" | "right";
export type Selection = { side: Side; id: string } | null;

const clone = (d: MemoryBookDoc): MemoryBookDoc => JSON.parse(JSON.stringify(d));
const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

type EditorState = {
  doc: MemoryBookDoc;
  activeSpread: number;
  selected: Selection;
  past: MemoryBookDoc[];
  future: MemoryBookDoc[];
  dirty: boolean;

  setDoc: (doc: MemoryBookDoc) => void;
  setActiveSpread: (i: number) => void;
  select: (sel: Selection) => void;
  updateLayer: (side: Side, id: string, patch: Partial<Layer>) => void;
  addLayer: (side: Side, layer: Layer) => void;
  deleteSelected: () => void;
  bringForward: () => void;
  addSpread: () => void;
  deleteSpread: (i: number) => void;
  setTheme: (theme: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  newLayerId: () => string;
};

/** Editor doc store — every mutating action pushes a history snapshot (undo/redo on doc clones). */
export const useEditor = create<EditorState>((set, get) => ({
  doc: { spreads: [] },
  activeSpread: 0,
  selected: null,
  past: [],
  future: [],
  dirty: false,

  newLayerId: uuid,
  setDoc: (doc) => set({ doc, past: [], future: [], selected: null, activeSpread: 0, dirty: false }),
  setActiveSpread: (i) => set({ activeSpread: i, selected: null }),
  select: (selected) => set({ selected }),

  updateLayer: (side, id, patch) => set((s) => {
    const doc = clone(s.doc);
    const sp = doc.spreads[s.activeSpread];
    if (!sp) return {};
    const layer = (side === "left" ? sp.leftPage : sp.rightPage).layers.find((l) => l.id === id);
    if (!layer) return {};
    Object.assign(layer, patch);
    return { past: [...s.past, s.doc], future: [], doc, dirty: true };
  }),

  addLayer: (side, layer) => set((s) => {
    const doc = clone(s.doc);
    const sp = doc.spreads[s.activeSpread];
    if (!sp) return {};
    (side === "left" ? sp.leftPage : sp.rightPage).layers.push(layer);
    return { past: [...s.past, s.doc], future: [], doc, dirty: true, selected: { side, id: layer.id } };
  }),

  deleteSelected: () => set((s) => {
    if (!s.selected) return {};
    const doc = clone(s.doc);
    const sp = doc.spreads[s.activeSpread];
    if (!sp) return {};
    const page = s.selected.side === "left" ? sp.leftPage : sp.rightPage;
    page.layers = page.layers.filter((l) => l.id !== s.selected!.id);
    return { past: [...s.past, s.doc], future: [], doc, dirty: true, selected: null };
  }),

  bringForward: () => set((s) => {
    if (!s.selected) return {};
    const doc = clone(s.doc);
    const sp = doc.spreads[s.activeSpread];
    if (!sp) return {};
    const page = s.selected.side === "left" ? sp.leftPage : sp.rightPage;
    const idx = page.layers.findIndex((l) => l.id === s.selected!.id);
    if (idx < 0 || idx === page.layers.length - 1) return {};
    [page.layers[idx], page.layers[idx + 1]] = [page.layers[idx + 1], page.layers[idx]];
    return { past: [...s.past, s.doc], future: [], doc, dirty: true };
  }),

  addSpread: () => set((s) => {
    const doc = clone(s.doc);
    doc.spreads.push({ id: uuid(), layout: "journal-2col", theme: doc.theme, leftPage: { layers: [] }, rightPage: { layers: [] } });
    return { past: [...s.past, s.doc], future: [], doc, dirty: true, activeSpread: doc.spreads.length - 1, selected: null };
  }),

  deleteSpread: (i) => set((s) => {
    if (s.doc.spreads.length <= 1) return {};
    const doc = clone(s.doc);
    doc.spreads.splice(i, 1);
    return { past: [...s.past, s.doc], future: [], doc, dirty: true, activeSpread: Math.max(0, Math.min(s.activeSpread, doc.spreads.length - 1)), selected: null };
  }),

  setTheme: (theme) => set((s) => {
    const doc = clone(s.doc);
    doc.theme = theme;
    doc.spreads.forEach((sp) => { sp.theme = theme; });
    return { past: [...s.past, s.doc], future: [], doc, dirty: true };
  }),

  undo: () => set((s) => {
    if (!s.past.length) return {};
    const prev = s.past[s.past.length - 1];
    return { doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], dirty: true, selected: null };
  }),

  redo: () => set((s) => {
    if (!s.future.length) return {};
    const next = s.future[0];
    return { doc: next, past: [...s.past, s.doc], future: s.future.slice(1), dirty: true, selected: null };
  }),

  markSaved: () => set({ dirty: false })
}));
