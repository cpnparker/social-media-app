import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { supabase } from "./supabase";
import { intelligenceDb } from "./supabase-intelligence";

// Share auth cookies across all *.thecontentengine.com subdomains
const isProduction = process.env.NODE_ENV === "production";
const cookieDomain = isProduction ? ".thecontentengine.com" : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  cookies: {
    sessionToken: {
      name: isProduction ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        domain: cookieDomain,
      },
    },
    callbackUrl: {
      name: isProduction ? "__Secure-authjs.callback-url" : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        domain: cookieDomain,
      },
    },
    csrfToken: {
      name: isProduction ? "__Host-authjs.csrf-token" : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  callbacks: {
    // Ensure post-login redirects stay on the correct subdomain
    async redirect({ url, baseUrl }) {
      // Relative URLs — keep as-is (browser resolves against current origin)
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow any *.thecontentengine.com subdomain
      try {
        const parsed = new URL(url);
        if (parsed.hostname.endsWith("thecontentengine.com")) return url;
      } catch {}
      // Same-origin fallback
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        try {
          const { data: existingUser, error } = await supabase
            .from("users")
            .select("id_user")
            .eq("email_user", user.email)
            .is("date_deleted", null)
            .single();

          if (error) {
            // Log the error but don't block sign-in on DB issues
            console.error("signIn DB lookup error:", error.message);
          }

          // Auto-create user record if they don't exist yet
          let userId: number | null = existingUser?.id_user ?? null;
          if (!existingUser && !error) {
            const { data: newUser, error: insertErr } = await supabase
              .from("users")
              .insert({
                email_user: user.email,
                name_user: user.name || user.email.split("@")[0],
                date_created: new Date().toISOString(),
                role_user: "none",
              })
              .select("id_user")
              .single();
            if (insertErr) {
              console.error("signIn auto-create error:", insertErr.message);
            } else if (newUser) {
              userId = newUser.id_user;
            }
          }

          // Auto-add to workspace if not already a member
          if (userId) {
            try {
              const { data: ws } = await intelligenceDb
                .from("workspaces")
                .select("id")
                .limit(1)
                .single();

              if (ws) {
                const { data: existingMember } = await intelligenceDb
                  .from("workspace_members")
                  .select("id, role")
                  .eq("workspace_id", ws.id)
                  .eq("user_id", userId)
                  .limit(1)
                  .single();

                if (!existingMember) {
                  // New user — add as viewer with no access
                  await intelligenceDb.from("workspace_members").insert({
                    workspace_id: ws.id,
                    user_id: userId,
                    role: "viewer",
                    joined_at: new Date().toISOString(),
                  });
                  await intelligenceDb.from("users_access").insert({
                    id_workspace: ws.id,
                    user_target: userId,
                    flag_access_engine: 0,
                    flag_access_enginegpt: 0,
                    flag_access_operations: 0,
                    flag_access_admin: 0,
                    flag_access_meetingbrain: 0,
                  });
                } else {
                  // Existing member — ensure users_access row exists
                  const { data: existingAccess } = await intelligenceDb
                    .from("users_access")
                    .select("id_access")
                    .eq("id_workspace", ws.id)
                    .eq("user_target", userId)
                    .limit(1)
                    .single();

                  if (!existingAccess) {
                    // Back-fill: admins/owners get full access, others get none
                    const isPrivileged =
                      existingMember.role === "owner" ||
                      existingMember.role === "admin";
                    const flag = isPrivileged ? 1 : 0;
                    await intelligenceDb.from("users_access").insert({
                      id_workspace: ws.id,
                      user_target: userId,
                      flag_access_engine: flag,
                      flag_access_enginegpt: flag,
                      flag_access_operations: flag,
                      flag_access_admin: flag,
                      flag_access_meetingbrain: flag,
                    });
                  }
                }
              }
            } catch (wsErr) {
              console.error("signIn workspace auto-add error:", wsErr);
            }
          }
        } catch (err) {
          // Never block sign-in due to DB connectivity issues
          console.error("signIn callback error:", err);
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        try {
          const { data: dbUser, error } = await supabase
            .from("users")
            .select("id_user, name_user, role_user")
            .eq("email_user", user.email)
            .is("date_deleted", null)
            .single();
          if (error) {
            console.error("jwt DB lookup error:", error.message);
          }
          if (dbUser) {
            token.sub = String(dbUser.id_user);
            token.name = dbUser.name_user;
            token.picture = user.image || null;
            token.role = dbUser.role_user || "none";
          }
        } catch (err) {
          console.error("jwt callback error:", err);
        }
      }
      // Carry role from user object on initial sign-in
      if (user) {
        token.role = (user as any).role || token.role || "none";
      }
      // Always refresh role from DB to keep JWT in sync with DB changes
      // (handles stale tokens from before role was added to JWT)
      if (token.sub && !user) {
        try {
          const { data: freshUser } = await supabase
            .from("users")
            .select("role_user")
            .eq("id_user", parseInt(token.sub, 10))
            .is("date_deleted", null)
            .single();
          if (freshUser?.role_user) {
            token.role = freshUser.role_user;
          }
        } catch {
          // Keep existing role on error
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as string) || "none";
      }
      return session;
    },
  },
});
