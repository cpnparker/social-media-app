"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Image as ImageIcon, Film, Search } from "lucide-react";
import type { DesignAsset } from "./AssetTile";

export type DesignMessage =
  | { role: "user"; content: string; id: string }
  | { role: "assistant"; content: string; id: string; assets?: DesignAsset[]; artlistResults?: ArtlistResult[] };

interface ArtlistResult {
  query: string;
  items: Array<{ id: string; title: string; thumbnailUrl: string; previewUrl: string; durationSec: number }>;
}

interface DesignChatProps {
  conversationId: string;
  messages: DesignMessage[];
  setMessages: React.Dispatch<React.SetStateAction<DesignMessage[]>>;
  onAssetReady?: (asset: DesignAsset) => void;
  onAssetProgress?: (id: string, progress: number) => void;
  onAssetPending?: (placeholder: DesignAsset) => void;
  /** Pre-fill the input box (used by "Animate" affordance from Canvas). */
  initialInput?: string;
  className?: string;
}

export function DesignChat({
  conversationId,
  messages,
  setMessages,
  onAssetReady,
  onAssetProgress,
  onAssetPending,
  initialInput,
  className,
}: DesignChatProps) {
  const [input, setInput] = useState(initialInput || "");
  const [streaming, setStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streaming]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const userMsg: DesignMessage = { role: "user", content: text, id: crypto.randomUUID() };
    const assistantMsg: DesignMessage = { role: "assistant", content: "", id: crypto.randomUUID(), assets: [], artlistResults: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setStreaming(true);
    setStatusLabel(null);

    abortRef.current = new AbortController();
    const pendingPlaceholderIds = new Map<string, string>(); // event signature → placeholder asset id

    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const data = JSON.parse(payload);
              handleEvent(data);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantMsg.id ? { ...msg, content: `⚠️ ${err?.message || "Stream failed"}` } : msg
          )
        );
      }
    } finally {
      setStreaming(false);
      setStatusLabel(null);
    }

    // Local event handler — uses closure over assistantMsg.id, pendingPlaceholderIds, callbacks.
    function handleEvent(data: any) {
      if (typeof data.token === "string") {
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantMsg.id && msg.role === "assistant" ? { ...msg, content: msg.content + data.token } : msg))
        );
      } else if (data.generating_image) {
        setStatusLabel("Generating image");
        const placeholder: DesignAsset = {
          id_asset: `pending-${crypto.randomUUID()}`,
          type_asset: "image", source: "dalle", blob_url: "",
          flag_pinned: 0, date_created: new Date().toISOString(), pending: true,
        };
        pendingPlaceholderIds.set("image", placeholder.id_asset);
        onAssetPending?.(placeholder);
      } else if (data.generating_video) {
        setStatusLabel("Generating video");
        const placeholder: DesignAsset = {
          id_asset: `pending-${crypto.randomUUID()}`,
          type_asset: "video", source: "runway", blob_url: "",
          flag_pinned: 0, date_created: new Date().toISOString(), pending: true, progress: 0,
        };
        pendingPlaceholderIds.set("video", placeholder.id_asset);
        onAssetPending?.(placeholder);
      } else if (data.video_progress) {
        const id = pendingPlaceholderIds.get("video");
        if (id) onAssetProgress?.(id, data.video_progress.percent || 0);
      } else if (data.image_ready) {
        const ready: DesignAsset = {
          id_asset: data.image_ready.asset_id || `local-${crypto.randomUUID()}`,
          type_asset: "image", source: "dalle", blob_url: data.image_ready.url,
          prompt: data.image_ready.prompt, flag_pinned: 0,
          date_created: new Date().toISOString(),
        };
        onAssetReady?.(ready);
        pendingPlaceholderIds.delete("image");
        setStatusLabel(null);
      } else if (data.video_ready) {
        const ready: DesignAsset = {
          id_asset: data.video_ready.asset_id || `local-${crypto.randomUUID()}`,
          type_asset: data.video_ready.source === "artlist" ? "artlist_video" : "video",
          source: data.video_ready.source || "runway",
          blob_url: data.video_ready.url,
          prompt: data.video_ready.prompt,
          metadata: { duration_sec: data.video_ready.duration, license_terms: data.video_ready.license_terms },
          flag_pinned: 0, date_created: new Date().toISOString(),
        };
        onAssetReady?.(ready);
        pendingPlaceholderIds.delete("video");
        setStatusLabel(null);
      } else if (data.artlist_results) {
        setStatusLabel(null);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantMsg.id && msg.role === "assistant"
              ? { ...msg, artlistResults: [...(msg.artlistResults || []), data.artlist_results] }
              : msg
          )
        );
      } else if (data.artlist_licensing) {
        setStatusLabel("Licensing Artlist clip");
      } else if (data.artlist_error || data.image_error || data.video_error) {
        const err = data.artlist_error || data.image_error || data.video_error;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantMsg.id && msg.role === "assistant"
              ? { ...msg, content: (msg.content || "") + `\n\n⚠️ ${err}` }
              : msg
          )
        );
        setStatusLabel(null);
      }
    }
  }, [input, streaming, conversationId, setMessages, onAssetReady, onAssetProgress, onAssetPending]);

  return (
    <div className={`flex h-full flex-col ${className || ""}`}>
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Sparkles className="h-7 w-7" />
            <div className="font-medium">Design mode</div>
            <div className="max-w-xs text-xs">
              Describe what you want to create. I&apos;ll propose directions, then generate images and videos that match your client&apos;s brand.
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              <Hint icon={<ImageIcon className="h-3 w-3" />}>Generate hero images</Hint>
              <Hint icon={<Film className="h-3 w-3" />}>Animate stills</Hint>
              <Hint icon={<Search className="h-3 w-3" />}>Search Artlist b-roll</Hint>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                msg.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "max-w-[95%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
              }
            >
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content || (streaming ? "…" : "")}</div>
              {msg.role === "assistant" && msg.artlistResults?.map((res, i) => (
                <ArtlistResultStrip key={i} result={res} />
              ))}
            </div>
          </div>
        ))}
        {streaming && statusLabel && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {statusLabel}…
          </div>
        )}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Describe the visual or video you want…"
            rows={2}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="self-end rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}

function Hint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      {icon} {children}
    </span>
  );
}

function ArtlistResultStrip({ result }: { result: ArtlistResult }) {
  return (
    <div className="rounded border bg-background p-2">
      <div className="mb-1.5 text-[11px] text-muted-foreground">
        Artlist results for <span className="font-medium">&ldquo;{result.query}&rdquo;</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {result.items.map((it) => (
          <div key={it.id} className="w-28 flex-shrink-0 space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.thumbnailUrl} alt={it.title} className="h-16 w-28 rounded object-cover" loading="lazy" />
            <div className="truncate text-[11px]" title={it.title}>{it.title}</div>
            <div className="text-[10px] text-muted-foreground">{it.durationSec}s</div>
          </div>
        ))}
      </div>
    </div>
  );
}
