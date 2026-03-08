import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Content Engine",
    short_name: "TCE",
    description:
      "Compose, schedule, publish, and analyse content across all your social platforms.",
    start_url: "/",
    display: "standalone",
    background_color: "#023250",
    theme_color: "#023250",
    icons: [
      {
        src: "/assets/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/assets/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
