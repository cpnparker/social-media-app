"use client";

import TwitterPreview from "./TwitterPreview";
import LinkedInPreview from "./LinkedInPreview";
import InstagramPreview from "./InstagramPreview";
import FacebookPreview from "./FacebookPreview";
import GenericPreview from "./GenericPreview";
import { platformLabels } from "@/lib/platform-utils";

interface PlatformEntry {
  platform: string;
  accountId?: string;
  status?: string;
  publishedAt?: string;
  platformPostUrl?: string;
  analytics?: {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    clicks?: number;
    views?: number;
    engagementRate?: number;
  };
}

interface PlatformPreviewProps {
  content: string;
  platformEntry: PlatformEntry;
  media?: string[];
}

export default function PlatformPreview({
  content,
  platformEntry,
  media,
}: PlatformPreviewProps) {
  const platform = platformEntry.platform?.toLowerCase() || "";
  const label =
    platformLabels[platform] || platformEntry.platform || "Unknown";

  const commonProps = {
    content,
    publishedAt: platformEntry.publishedAt,
    platformPostUrl: platformEntry.platformPostUrl,
    analytics: platformEntry.analytics,
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">
        {label} Preview
      </h3>
      {platform === "twitter" ? (
        <TwitterPreview {...commonProps} />
      ) : platform === "linkedin" ? (
        <LinkedInPreview {...commonProps} />
      ) : platform === "instagram" ? (
        <InstagramPreview {...commonProps} media={media} />
      ) : platform === "facebook" ? (
        <FacebookPreview {...commonProps} />
      ) : (
        <GenericPreview {...commonProps} platform={platform} />
      )}
    </div>
  );
}
