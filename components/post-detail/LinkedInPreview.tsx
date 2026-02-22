"use client";

import { ThumbsUp, MessageCircle, Repeat2, Send } from "lucide-react";
import { formatNumber } from "@/lib/platform-utils";

interface LinkedInPreviewProps {
  content: string;
  publishedAt?: string;
  platformPostUrl?: string;
  media?: string[];
  accountName?: string;
  accountUsername?: string;
  accountAvatarUrl?: string;
  analytics?: {
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
  };
}

export default function LinkedInPreview({
  content,
  publishedAt,
  platformPostUrl,
  media,
  accountName,
  accountUsername,
  accountAvatarUrl,
  analytics,
}: LinkedInPreviewProps) {
  // Fix LinkedIn "Organization XXXXX" display names — Late API stores org IDs for company pages
  const orgPattern = /^Organization \d+$/;
  let displayName = accountName || "Your Account";
  if (orgPattern.test(displayName)) {
    displayName = (accountUsername && !orgPattern.test(accountUsername)) ? accountUsername : "LinkedIn Page";
  }
  let subtitle = accountUsername;
  if (subtitle && orgPattern.test(subtitle)) {
    subtitle = undefined; // Don't show org ID as subtitle
  }
  const initials = displayName.charAt(0).toUpperCase();

  const timeAgo = publishedAt
    ? (() => {
        const diff = Date.now() - new Date(publishedAt).getTime();
        const days = Math.floor(diff / 86400000);
        if (days > 30) return `${Math.floor(days / 30)}mo`;
        if (days > 0) return `${days}d`;
        const hours = Math.floor(diff / 3600000);
        if (hours > 0) return `${hours}h`;
        return "now";
      })()
    : "";

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-950 overflow-hidden max-w-[520px]">
      {/* Header */}
      <div className="px-4 pt-3 flex gap-2">
        {accountAvatarUrl ? (
          <img src={accountAvatarUrl} alt={displayName} className="h-12 w-12 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold text-lg shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {displayName}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {subtitle || "Social Media Manager"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {timeAgo && `${timeAgo} \u00B7 `}
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3 inline-block"
              fill="currentColor"
            >
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
            </svg>
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-sm leading-[1.4] text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
          {content}
        </p>
      </div>

      {/* Media */}
      {media && media.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          <img
            src={media[0]}
            alt="Post media"
            className="w-full max-h-[300px] object-cover"
          />
        </div>
      )}

      {/* Reactions summary */}
      {(analytics?.likes || analytics?.comments) && (
        <div className="px-4 pb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <div className="flex -space-x-0.5">
              <span className="inline-flex h-4 w-4 rounded-full bg-blue-600 items-center justify-center">
                <ThumbsUp className="h-2.5 w-2.5 text-white" />
              </span>
              <span className="inline-flex h-4 w-4 rounded-full bg-red-500 items-center justify-center text-white text-[8px]">
                &#10084;
              </span>
            </div>
            <span>{analytics.likes ? formatNumber(analytics.likes) : ""}</span>
          </div>
          <div className="flex gap-2">
            {analytics.comments ? (
              <span>
                {formatNumber(analytics.comments)} comment
                {analytics.comments !== 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100 dark:border-gray-800 mx-4" />

      {/* Interaction bar */}
      <div className="px-2 py-1 flex justify-between">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageCircle, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            <Icon className="h-4 w-4" />
            <span className="text-xs font-medium">{label}</span>
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
            View on LinkedIn &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
