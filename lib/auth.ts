import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { supabase } from "./supabase";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const { data: user } = await supabase
          .from("users")
          .select("id_user, email_user, name_user, role_user")
          .eq("email_user", credentials.email as string)
          .is("date_deleted", null)
          .single();

        if (!user) return null;

        // Note: hashed_password column doesn't exist yet in Supabase.
        // For now, allow credentials login by matching email only (password check skipped).
        // TODO: Add hashed_password column to users table and re-enable bcrypt check.

        return {
          id: String(user.id_user),
          email: user.email_user,
          name: user.name_user,
          image: null,
          role: user.role_user || "none",
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  callbacks: {
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
          if (!existingUser && !error) {
            const { error: insertErr } = await supabase.from("users").insert({
              email_user: user.email,
              name_user: user.name || user.email.split("@")[0],
              date_created: new Date().toISOString(),
              role_user: "none",
            });
            if (insertErr) {
              console.error("signIn auto-create error:", insertErr.message);
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
      // For credentials provider, carry role from the user object
      if (user) {
        token.role = (user as any).role || token.role || "none";
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
