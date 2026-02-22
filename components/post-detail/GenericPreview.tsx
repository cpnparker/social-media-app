"use client";

import { ExternalLink } from "lucide-react";
import {
  platformLabels,
  platformHexColors,
  formatNumber,
} from "@/lib/platform-utils";

interface GenericPreviewProps {
  content: string;
  platform: string;
  publishedAt?: string;
  platformPostUrl?: string;
  accountName?: string;
  accountUsername?: string;
  accountAvatarUrl?: string;
  analytics?: {
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
  };
}

export default function GenericPreview({
  content,
  platform,
  publishedAt,
  platformPostUrl,
  accountName,
  accountAvatarUrl,
  analytics,
}: GenericPreviewProps) {
  const label = platformLabels[platform.toLowerCase()] || platform;
  const color = platformHexColors[platform.toLowerCase()] || "#6b7280";
  const displayName = accountName || "Your Account";
  const initials = displayName.charAt(0).toUpperCase();

  const date = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-950 overflow-hidden max-w-[520px]">
      {/* Platform header */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ borderBottom: `3px solid ${color}` }}
      >
        {accountAvatarUrl ? (
          <img src={accountAvatarUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover shrink-0" />
        ) : (
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: color }}
          >
            {initials}
          </div>
        )}
        <div className="flex-1">
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {displayName}
          </p>
          <p className="text-xs" style={{ color }}>
            {label}
          </p>
        </div>
        {platformPostUrl && (
          <a
            href={platformPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-sm leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
          {content}
        </p>
      </div>

      {/* Date */}
      {date && (
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">{date}</p>
        </div>
      )}

      {/* Stats */}
      {analytics && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2.5 flex gap-4">
          {analytics.impressions ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatNumber(analytics.impressions)} impressions
            </span>
          ) : null}
          {analytics.likes ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatNumber(analytics.likes)} likes
            </span>
          ) : null}
          {analytics.comments ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatNumber(analytics.comments)} comments
            </span>
          ) : null}
          {analytics.shares ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatNumber(analytics.shares)} shares
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
