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
          // Primary lookup: by email
          const { data: existingUser, error } = await supabase
            .from("users")
            .select("id_user, email_user")
            .eq("email_user", user.email)
            .is("date_deleted", null)
            .single();

          if (error && error.code !== "PGRST116") {
            // PGRST116 = no rows found (expected for new users)
            console.error("signIn DB lookup error:", error.message);
          }

          let userId: number | null = existingUser?.id_user ?? null;

          // Fallback: if email not found, try matching by name + same domain
          // This handles cases where user's email was changed in DB
          if (!existingUser && user.name && user.email) {
            const emailDomain = user.email.split("@")[1];
            console.log(`[Auth signIn] Email ${user.email} not found, trying name match: "${user.name}" + domain "${emailDomain}"`);
            const { data: nameMatches } = await supabase
              .from("users")
              .select("id_user, email_user, name_user")
              .eq("name_user", user.name)
              .is("date_deleted", null);

            if (nameMatches && nameMatches.length === 1) {
              // Unique name match — likely the same person with a changed email
              const match = nameMatches[0];
              console.log(`[Auth signIn] Found unique name match: ${match.email_user} (id=${match.id_user}). Updating email to ${user.email}`);
              userId = match.id_user;
              // Update their email to the current Google email
              await supabase
                .from("users")
                .update({ email_user: user.email })
                .eq("id_user", match.id_user);
            } else if (nameMatches && nameMatches.length > 1) {
              // Multiple name matches — try to narrow by same org domain
              const sameDomain = nameMatches.filter(m => m.email_user?.endsWith("@" + emailDomain));
              if (sameDomain.length === 1) {
                const match = sameDomain[0];
                console.log(`[Auth signIn] Found domain-scoped name match: ${match.email_user} (id=${match.id_user}). Updating email to ${user.email}`);
                userId = match.id_user;
                await supabase
                  .from("users")
                  .update({ email_user: user.email })
                  .eq("id_user", match.id_user);
              }
            }
          }

          // Auto-create user record if they don't exist and no match found
          if (!userId) {
            console.log(`[Auth signIn] Creating new user for ${user.email}`);
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
        // Store email and name in token for self-healing lookups
        token.email = user.email;
        token.name = token.name || user.name;
        try {
          const { data: dbUser, error } = await supabase
            .from("users")
            .select("id_user, name_user, role_user")
            .eq("email_user", user.email)
            .is("date_deleted", null)
            .single();
          if (error && error.code !== "PGRST116") {
            console.error("jwt DB lookup error:", error.message);
          }
          if (dbUser) {
            console.log(`[Auth JWT] Resolved ${user.email} → userId=${dbUser.id_user}`);
            token.sub = String(dbUser.id_user);
            token.name = dbUser.name_user;
            token.picture = user.image || null;
            token.role = dbUser.role_user || "none";
          } else {
            console.warn(`[Auth JWT] No user found for email ${user.email}, token.sub remains: ${token.sub}`);
          }
        } catch (err) {
          console.error("jwt callback error:", err);
        }
      }
      // Carry role from user object on initial sign-in
      if (user) {
        token.role = (user as any).role || token.role || "none";
      }
      // Self-healing: if token.sub is not a valid DB integer (e.g. Google ID
      // from a failed initial lookup), re-try by email on every refresh.
      // This fixes broken JWTs from transient DB errors during sign-in.
      const subAsInt = parseInt(token.sub || "", 10);
      const isValidDbId = !isNaN(subAsInt) && Number.isSafeInteger(subAsInt) && subAsInt > 0 && subAsInt < 10000000;
      if (!isValidDbId && token.email && !user) {
        try {
          const { data: dbUser } = await supabase
            .from("users")
            .select("id_user, name_user, role_user")
            .eq("email_user", token.email as string)
            .is("date_deleted", null)
            .single();
          if (dbUser) {
            console.log(`[Auth] Self-healed JWT: ${token.sub} → ${dbUser.id_user} for ${token.email}`);
            token.sub = String(dbUser.id_user);
            token.name = dbUser.name_user;
            token.role = dbUser.role_user || "none";
          }
        } catch {
          // Will retry on next request
        }
      }
      // Always refresh role from DB to keep JWT in sync with DB changes
      if (token.sub && !user && isValidDbId) {
        try {
          const { data: freshUser } = await supabase
            .from("users")
            .select("role_user")
            .eq("id_user", subAsInt)
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
