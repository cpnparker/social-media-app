import { supabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { ExternalLink, Zap } from "lucide-react";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("slug", slug)
    .single();

  if (!workspace) return { title: "Links" };

  return {
    title: `${workspace.name} — Links`,
    description: `Links from ${workspace.name}`,
  };
}

export default async function PublicLinksPage({ params }: Props) {
  const { slug } = await params;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();

  if (!workspace) notFound();

  const { data: links } = await supabase
    .from("profile_links")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <div className="flex flex-col items-center min-h-screen px-4 py-12">
      {/* Profile header */}
      <div className="text-center mb-8">
        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
          <Zap className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
      </div>

      {/* Links */}
      <div className="w-full max-w-md space-y-3">
        {(links || []).map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 w-full rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all"
          >
            {link.icon && (
              <span className="text-xl shrink-0">{link.icon}</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{link.title}</p>
              {link.description && (
                <p className="text-sm text-muted-foreground truncate">
                  {link.description}
                </p>
              )}
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors shrink-0" />
          </a>
        ))}

        {(!links || links.length === 0) && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No links yet</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-12 pb-4">
        <p className="text-xs text-muted-foreground/50 flex items-center gap-1">
          <Zap className="h-3 w-3" /> Powered by The Content Engine
        </p>
      </div>
    </div>
  );
}
