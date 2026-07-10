"use client";

/**
 * EngineAI Live launcher — floating pill in the main EngineAI tab.
 *
 * Opens the companion window (/meeting) as a named popup: re-clicks focus the
 * existing window instead of spawning a second capture session. Listens on
 * BroadcastChannel("engineai-meeting") to show an "In meeting" state while a
 * session is live in the companion.
 */

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LiveLauncher({ clientId, threadId }: { clientId?: string; threadId?: string }) {
  const [inMeeting, setInMeeting] = useState(false);
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      const bc = new BroadcastChannel("engineai-meeting");
      bcRef.current = bc;
      bc.onmessage = (e) => {
        if (e.data?.type === "session-started") setInMeeting(true);
        if (e.data?.type === "session-ended") setInMeeting(false);
      };
      return () => bc.close();
    } catch {
      /* BroadcastChannel unsupported — launcher still works */
    }
  }, []);

  const open = () => {
    const params = new URLSearchParams();
    if (clientId) params.set("client", clientId);
    if (threadId) params.set("thread", threadId); // load this chat as meeting context
    const qs = params.toString();
    window.open(`/meeting${qs ? `?${qs}` : ""}`, "engineai-meeting", "popup,width=440,height=880");
  };

  return (
    <div className="fixed bottom-16 right-5 z-30">
      <button
        onClick={open}
        title={inMeeting ? "EngineAI Live — session in progress (click to focus)" : "EngineAI Live — open the meeting companion"}
        className={cn(
          "h-8 rounded-full border shadow-lg backdrop-blur flex items-center gap-1.5 px-3 text-xs font-medium transition-colors",
          inMeeting
            ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400"
            : "bg-background/80 text-muted-foreground hover:text-foreground"
        )}
      >
        <Radio className={cn("h-3.5 w-3.5", inMeeting && "animate-pulse")} />
        {inMeeting ? "In meeting" : "Live"}
      </button>
    </div>
  );
}
