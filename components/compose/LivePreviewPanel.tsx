"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PlatformPreview from "@/components/post-detail/PlatformPreview";
import { Eye } from "lucide-react";

interface MediaItem {
  url: string;
  altText?: string;
  contentType?: string;
  filename?: string;
}

interface LivePreviewPanelProps {
  content: string;
  selectedPlatforms: string[];
  mediaItems: MediaItem[];
  accounts: Array<{
    _id: string;
    platform: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }>;
  selectedAccountIds: string[];
  platformMeta: Record<string, { name: string; color: string; bgColor: string; icon: string }>;
}

export default function LivePreviewPanel({
  content,
  selectedPlatforms,
  mediaItems,
  accounts,
  selectedAccountIds,
  platformMeta,
}: LivePreviewPanelProps) {
  if (selectedPlatforms.length === 0 || !content.trim()) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-8 text-center">
          <Eye className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {!content.trim()
              ? "Start typing to see a preview"
              : "Select a platform to see the preview"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const mediaUrls = mediaItems.map((m) => m.url);

  const getAccountForPlatform = (platform: string) => {
    const accountId = selectedAccountIds.find((id) => {
      const acc = accounts.find((a) => a._id === id);
      return acc?.platform?.toLowerCase() === platform;
    });
    return accounts.find((a) => a._id === accountId);
  };

  const renderPreview = (platform: string) => {
    const account = getAccountForPlatform(platform);
    return (
      <PlatformPreview
        content={content}
        platformEntry={{ platform, status: "draft" }}
        media={mediaUrls}
        accountName={account?.displayName || account?.username}
        accountUsername={account?.username}
        accountAvatarUrl={account?.avatarUrl}
        mode="draft"
      />
    );
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          Live Preview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {selectedPlatforms.length === 1 ? (
          renderPreview(selectedPlatforms[0])
        ) : (
          <Tabs defaultValue={selectedPlatforms[0]}>
            <TabsList className="w-full justify-start mb-3">
              {selectedPlatforms.map((platform) => (
                <TabsTrigger key={platform} value={platform} className="text-xs">
                  {platformMeta[platform]?.name || platform}
                </TabsTrigger>
              ))}
            </TabsList>
            {selectedPlatforms.map((platform) => (
              <TabsContent key={platform} value={platform}>
                {renderPreview(platform)}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
