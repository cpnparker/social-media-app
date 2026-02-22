"use client";

import { ThumbsUp, MessageCircle, Share2 } from "lucide-react";
import { formatNumber } from "@/lib/platform-utils";

interface FacebookPreviewProps {
  content: string;
  publishedAt?: string;
  platformPostUrl?: string;
  analytics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    reach?: number;
  };
}

export default function FacebookPreview({
  content,
  publishedAt,
  platformPostUrl,
  analytics,
}: FacebookPreviewProps) {
  const timeAgo = publishedAt
    ? (() => {
        const diff = Date.now() - new Date(publishedAt).getTime();
        const days = Math.floor(diff / 86400000);
        if (days > 30) return `${Math.floor(days / 30)} mo`;
        if (days > 7) return `${Math.floor(days / 7)}w`;
        if (days > 0) return `${days}d`;
        const hours = Math.floor(diff / 3600000);
        if (hours > 0) return `${hours}h`;
        const mins = Math.floor(diff / 60000);
        return mins > 0 ? `${mins}m` : "now";
      })()
    : "";

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-950 overflow-hidden max-w-[520px]">
      {/* Header */}
      <div className="px-4 pt-3 flex gap-2.5">
        <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
          U
        </div>
        <div className="flex-1">
          <p className="font-semibold text-[15px] text-gray-900 dark:text-gray-100">
            Your Account
          </p>
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            {timeAgo && <span>{timeAgo}</span>}
            {timeAgo && <span>&middot;</span>}
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-[15px] leading-[1.4] text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
          {content}
        </p>
      </div>

      {/* Reactions summary */}
      {(analytics?.likes || analytics?.comments || analytics?.shares) && (
        <>
          <div className="px-4 pb-2 flex items-center justify-between text-[13px] text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              {analytics.likes ? (
                <>
                  <div className="flex -space-x-0.5">
                    <span className="inline-flex h-[18px] w-[18px] rounded-full bg-blue-500 items-center justify-center">
                      <ThumbsUp className="h-2.5 w-2.5 text-white" />
                    </span>
                    <span className="inline-flex h-[18px] w-[18px] rounded-full bg-red-500 items-center justify-center text-white text-[9px]">
                      &#10084;
                    </span>
                  </div>
                  <span>{formatNumber(analytics.likes)}</span>
                </>
              ) : null}
            </div>
            <div className="flex gap-3">
              {analytics.comments ? (
                <span>{formatNumber(analytics.comments)} comments</span>
              ) : null}
              {analytics.shares ? (
                <span>{formatNumber(analytics.shares)} shares</span>
              ) : null}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100 dark:border-gray-800 mx-4" />
        </>
      )}

      {/* Action bar */}
      <div className="px-2 py-1 flex justify-between">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageCircle, label: "Comment" },
          { icon: Share2, label: "Share" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            <Icon className="h-5 w-5" />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* External link */}
      {platformPostUrl && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
          <a
            href={platformPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            View on Facebook &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
