import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EngineAI",
    short_name: "EngineAI",
    description:
      "Your AI-powered content assistant. Brainstorm ideas, draft content, and manage social media with deep client context.",
    start_url: "/",
    scope: "/",
    // id must be resolvable within scope and stable forever — it's the app's
    // identity. It pointed at /engineai while start_url was "/", which makes
    // the installed app and the manifest disagree about what was installed.
    id: "/",
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
      // Android crops the home-screen icon to a circle/squircle. Without a
      // maskable variant it letterboxes the square icon inside a white tile;
      // these keep the logo inside the 80% safe zone on the brand background.
      {
        src: "/assets/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/assets/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
