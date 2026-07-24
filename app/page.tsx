import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Root page — subdomain-aware routing.
 *
 * Uses `headers()` to force dynamic rendering (cannot be statically
 * pre-rendered), so the middleware rewrite always runs first.
 *
 * If the middleware rewrite somehow misses, this page acts as a
 * safety net by checking the hostname and redirecting appropriately.
 */
export default async function RootPage() {
  const headersList = await headers();
  const host = headersList.get("host") || "";

  // AI subdomain → EngineGPT
  if (
    host === "ai.thecontentengine.com" ||
    host.startsWith("ai.thecontentengine.com:")
  ) {
    redirect("/engineai");
  }

  // Operations subdomain → Operations landing
  if (
    host === "operations.thecontentengine.com" ||
    host.startsWith("operations.thecontentengine.com:")
  ) {
    redirect("/operations/commissioned-cus");
  }

  // Engine subdomain / localhost / preview → Dashboard
  redirect("/dashboard");
}
