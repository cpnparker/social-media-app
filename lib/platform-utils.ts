// Tailwind class-based platform colors (for badges, dots, etc.)
export const platformColors: Record<string, string> = {
  twitter: "bg-sky-500",
  instagram: "bg-gradient-to-br from-purple-500 to-pink-500",
  facebook: "bg-blue-600",
  linkedin: "bg-blue-700",
  tiktok: "bg-gray-900",
  youtube: "bg-red-500",
  pinterest: "bg-red-600",
  reddit: "bg-orange-500",
  bluesky: "bg-blue-500",
  threads: "bg-gray-800",
  googlebusiness: "bg-blue-500",
  telegram: "bg-cyan-500",
  snapchat: "bg-yellow-400",
};

// Hex colors (for charts, calendar, inline styles)
export const platformHexColors: Record<string, string> = {
  twitter: "#1DA1F2",
  instagram: "#E4405F",
  facebook: "#1877F2",
  linkedin: "#0A66C2",
  tiktok: "#010101",
  youtube: "#FF0000",
  pinterest: "#BD081C",
  reddit: "#FF4500",
  bluesky: "#0085FF",
  threads: "#333333",
  googlebusiness: "#4285F4",
  telegram: "#26A5E4",
  snapchat: "#FFFC00",
};

// Display names
export const platformLabels: Record<string, string> = {
  twitter: "Twitter / X",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  reddit: "Reddit",
  bluesky: "Bluesky",
  threads: "Threads",
  googlebusiness: "Google Business",
  telegram: "Telegram",
  snapchat: "Snapchat",
};

// Status badge styles
export const statusStyles: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-600",
  scheduled: "bg-blue-500/10 text-blue-600",
  draft: "bg-gray-500/10 text-gray-500",
  failed: "bg-red-500/10 text-red-600",
  cancelled: "bg-gray-500/10 text-gray-400",
};

// Status hex colors (for calendar)
export const statusHexColors: Record<string, string> = {
  published: "#10b981",
  scheduled: "#3b82f6",
  draft: "#9ca3af",
  failed: "#ef4444",
};

// Format large numbers compactly
export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Relative or absolute date formatting
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 0) {
    // Future date
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Full date formatting for detail views
export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
