import type { Metadata } from "next";
import EngineAIShell from "./EngineAIShell";

export const metadata: Metadata = {
  title: "EngineAI — AI Content Assistant | The Content Engine",
  description:
    "Your AI-powered content assistant. Brainstorm ideas, draft content, refine messaging, and manage social media — all with deep context about your clients and workflows.",
  icons: {
    icon: "/assets/favicon.png",
    apple: "/assets/apple-touch-icon.png",
  },
  openGraph: {
    title: "EngineAI — AI Content Assistant",
    description:
      "AI-powered content assistant with deep client context. Brainstorm, draft, and refine content for social media management.",
    siteName: "The Content Engine",
    type: "website",
    images: [
      {
        url: "/logo_engine_text_blue.png",
        width: 512,
        height: 128,
        alt: "The Content Engine",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "EngineAI — AI Content Assistant",
    description:
      "AI-powered content assistant with deep client context. Part of The Content Engine platform.",
  },
};

export default function EngineAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <EngineAIShell>{children}</EngineAIShell>;
}
