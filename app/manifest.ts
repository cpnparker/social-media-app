import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EngineAI",
    short_name: "EngineAI",
    description:
      "Your AI-powered content assistant. Brainstorm ideas, draft content, and manage social media with deep client context.",
    start_url: "/",
    scope: "/",
    id: "/engineai",
    display: "standalone",
    background_color: "#023250",
    theme_color: "#023250",
    icons: [
      {
        src: "/assets/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
