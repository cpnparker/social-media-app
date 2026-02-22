"use client";

import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import { formatNumber } from "@/lib/platform-utils";

interface InstagramPreviewProps {
  content: string;
  publishedAt?: string;
  platformPostUrl?: string;
  media?: string[];
  accountName?: string;
  accountUsername?: string;
  accountAvatarUrl?: string;
  analytics?: {
    likes?: number;
    comments?: number;
    saves?: number;
    reach?: number;
  };
}

export default function InstagramPreview({
  content,
  publishedAt,
  platformPostUrl,
  media,
  accountName,
  accountUsername,
  accountAvatarUrl,
  analytics,
}: InstagramPreviewProps) {
  const handle = accountUsername || accountName || "youraccount";
  const initials = (accountName || handle).charAt(0).toUpperCase();

  const timeAgo = publishedAt
    ? (() => {
        const diff = Date.now() - new Date(publishedAt).getTime();
        const days = Math.floor(diff / 86400000);
        if (days > 7) return `${Math.floor(days / 7)}w`;
        if (days > 0) return `${days}d`;
        const hours = Math.floor(diff / 3600000);
        if (hours > 0) return `${hours}h`;
        return "now";
      })()
    : "";

  return (
    <div className="border rounded-lg bg-white dark:bg-gray-950 overflow-hidden max-w-[470px]">
      {/* Header */}
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 p-[2px]">
          <div className="h-full w-full rounded-full bg-white dark:bg-gray-950 flex items-center justify-center overflow-hidden">
            {accountAvatarUrl ? (
              <img src={accountAvatarUrl} alt={handle} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                {initials}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {handle}
          </p>
        </div>
        <MoreHorizontal className="h-5 w-5 text-gray-900 dark:text-gray-100" />
      </div>

      {/* Image area */}
      <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
        {media && media.length > 0 ? (
          <img
            src={media[0]}
            alt="Post media"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center px-8">
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Image preview
            </p>
          </div>
        )}
      </div>

      {/* Interaction bar */}
      <div className="px-3 pt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Heart className="h-6 w-6 text-gray-900 dark:text-gray-100 cursor-pointer" />
          <MessageCircle className="h-6 w-6 text-gray-900 dark:text-gray-100 cursor-pointer" />
          <Send className="h-6 w-6 text-gray-900 dark:text-gray-100 cursor-pointer" />
        </div>
        <Bookmark className="h-6 w-6 text-gray-900 dark:text-gray-100 cursor-pointer" />
      </div>

      {/* Likes count */}
      {analytics?.likes ? (
        <div className="px-3 pt-1.5">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {formatNumber(analytics.likes)} likes
          </p>
        </div>
      ) : null}

      {/* Content */}
      <div className="px-3 pt-1 pb-2">
        <p className="text-sm text-gray-900 dark:text-gray-100">
          <span className="font-semibold mr-1">{handle}</span>
          {content}
        </p>
      </div>

      {/* Comments count */}
      {analytics?.comments ? (
        <div className="px-3 pb-1">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            View all {formatNumber(analytics.comments)} comments
          </p>
        </div>
      ) : null}

      {/* Time */}
      {timeAgo && (
        <div className="px-3 pb-3">
          <p className="text-[10px] uppercase text-gray-400 dark:text-gray-500 tracking-wide">
            {timeAgo} ago
          </p>
        </div>
      )}

      {/* External link */}
      {platformPostUrl && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2">
          <a
            href={platformPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-pink-500 hover:underline"
          >
            View on Instagram &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
