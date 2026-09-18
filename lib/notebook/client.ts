"use client";

/**
 * Client-side notebook helpers.
 *
 * Capture happens far from the panel (a selection popover inside a message
 * bubble, a button in the message action row), so rather than thread state
 * through half the tree, savers just POST and announce. The panel listens and
 * refetches. Same decoupling the wake/meeting features use, minus the
 * cross-tab part — a notebook change only needs to reach this document.
 */

import { toast } from "sonner";

export const NOTEBOOK_CHANGED = "engine-notebook-changed";
export const OPEN_KEY = "engineai-notebook-open";
export const ACTIVE_KEY = "engineai-notebook-active";

export interface NotebookEntry {
  id: string;
  notebookId: string;
  type: "highlight" | "answer" | "prompt" | "note";
  quote: string;
  note: string | null;
  conversationId: string | null;
  messageId: string | null;
  sourceTitle: string | null;
  tags: string[];
  order: number;
  isMemory: boolean;
  memoryId: string | null;
  userId: number;
  createdAt: string;
}

export interface Notebook {
  id: string;
  title: string;
  description: string | null;
  visibility: "private" | "team";
  userId: number;
  createdAt: string;
}

export function notifyNotebookChanged() {
  window.dispatchEvent(new Event(NOTEBOOK_CHANGED));
}

/** Open the panel (and expand it if collapsed). */
export function openNotebookPanel() {
  try { localStorage.setItem(OPEN_KEY, "1"); } catch { /* private mode */ }
  window.dispatchEvent(new Event("engine-notebook-open"));
}

export interface SaveArgs {
  workspaceId: string;
  quote: string;
  type?: NotebookEntry["type"];
  note?: string;
  notebookId?: string;
  conversationId?: string | null;
  messageId?: string | null;
  clientId?: number | null;
}

/**
 * Save a capture. Returns the created entry, or null on failure — the toast is
 * raised here so every call site behaves the same.
 */
export async function saveToNotebook(args: SaveArgs): Promise<NotebookEntry | null> {
  try {
    const res = await fetch("/api/ai/notebook/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Could not save to the notebook");
      return null;
    }
    notifyNotebookChanged();
    openNotebookPanel();
    return data.entry as NotebookEntry;
  } catch {
    toast.error("Could not save to the notebook");
    return null;
  }
}

/** Trim a selection to something worth storing, and reject noise. */
export function normaliseSelection(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3) return null;
  return text.slice(0, 8000);
}
