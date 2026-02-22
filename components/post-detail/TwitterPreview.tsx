"use client";

import { Heart, MessageCircle, Repeat2, Share, BarChart2 } from "lucide-react";
import { formatNumber } from "@/lib/platform-utils";

interface TwitterPreviewProps {
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
    views?: number;
  };
}

export default function TwitterPreview({
  content,
  publishedAt,
  platformPostUrl,
  media,
  accountName,
  accountUsername,
  accountAvatarUrl,
  analytics,
}: TwitterPreviewProps) {
  const displayName = accountName || "Your Account";
  const handle = accountUsername ? `@${accountUsername}` : "@youraccount";
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
    <div className="border rounded-2xl bg-white dark:bg-gray-950 overflow-hidden max-w-[520px]">
      {/* Header */}
      <div className="px-4 pt-3 pb-0 flex gap-3">
        {accountAvatarUrl ? (
          <img src={accountAvatarUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-sky-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-bold text-[15px] text-gray-900 dark:text-gray-100 truncate">
              {displayName}
            </span>
            <svg
              viewBox="0 0 22 22"
              className="h-[18px] w-[18px] text-sky-500 fill-current shrink-0"
            >
              <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.143.271.586.702 1.084 1.24 1.438.54.354 1.167.551 1.813.568.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.225 1.261.272 1.893.143.636-.13 1.222-.434 1.69-.88.445-.47.75-1.055.88-1.69.131-.634.084-1.292-.139-1.9.585-.273 1.084-.704 1.438-1.244.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
            </svg>
          </div>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 -mt-0.5">
            {handle}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-gray-900 dark:text-gray-100 fill-current shrink-0 mt-1"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-[15px] leading-[20px] text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
          {content}
        </p>
      </div>

      {/* Media */}
      {media && media.length > 0 && (
        <div className="px-4 pb-3">
          <div className={`rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 ${media.length > 1 ? "grid grid-cols-2 gap-0.5" : ""}`}>
            {media.slice(0, 4).map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Media ${i + 1}`}
                className={`w-full object-cover ${media.length === 1 ? "max-h-[280px]" : "aspect-square"}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Date */}
      {date && (
        <div className="px-4 pb-3">
          <p className="text-[13px] text-gray-500 dark:text-gray-400">
            {date}
          </p>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-gray-100 dark:border-gray-800" />

      {/* Interaction bar */}
      <div className="px-4 py-2 flex justify-between max-w-[400px]">
        <button className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-sky-500 transition-colors group">
          <MessageCircle className="h-[18px] w-[18px]" />
          <span className="text-[13px]">
            {analytics?.comments ? formatNumber(analytics.comments) : ""}
          </span>
        </button>
        <button className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors group">
          <Repeat2 className="h-[18px] w-[18px]" />
          <span className="text-[13px]">
            {analytics?.shares ? formatNumber(analytics.shares) : ""}
          </span>
        </button>
        <button className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-pink-500 transition-colors group">
          <Heart className="h-[18px] w-[18px]" />
          <span className="text-[13px]">
            {analytics?.likes ? formatNumber(analytics.likes) : ""}
          </span>
        </button>
        <button className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-sky-500 transition-colors group">
          <BarChart2 className="h-[18px] w-[18px]" />
          <span className="text-[13px]">
            {analytics?.views || analytics?.impressions
              ? formatNumber(analytics.views || analytics.impressions || 0)
              : ""}
          </span>
        </button>
        <button className="text-gray-500 dark:text-gray-400 hover:text-sky-500 transition-colors">
          <Share className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* External link */}
      {platformPostUrl && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-2">
          <a
            href={platformPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-sky-500 hover:underline"
          >
            View on Twitter / X &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
