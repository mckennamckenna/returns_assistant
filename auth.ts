import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/adminNotify";
import { sendVerificationRequest } from "@/lib/magicLinkRateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login/verify",
    error: "/login",
  },
  providers: [
    Nodemailer({
      // Required by the provider factory's own validation, but never
      // actually used — sendVerificationRequest below replaces the
      // function that would otherwise read this and open an SMTP
      // connection. We send via Postmark's HTTP API instead, same as
      // the rest of the app.
      server: { host: "smtp.postmarkapp.com", port: 587, auth: { user: "unused", pass: "unused" } },
      from: process.env.LOGIN_FROM_EMAIL ?? process.env.REMINDER_FROM_EMAIL,
      // Rate limiting (SECURITY_AUDIT.md H1) and the allowlist gate both
      // live in lib/magicLinkRateLimit.ts — extracted from this file so
      // it's unit-testable without pulling in NextAuth(...)'s module graph.
      sendVerificationRequest,
    }),
  ],
  callbacks: {
    // The database session strategy already has the real adapter User
    // (with its `id`) available here — copy it onto session.user so
    // every page/action can scope queries by session.user.id without an
    // extra lookup. The default Session type doesn't include `id`; see
    // types/next-auth.d.ts for the augmentation that makes this typed.
    session: ({ session, user }) => {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // Fires exactly once, precisely when the Prisma adapter creates a new
    // User row — unlike sendVerificationRequest (which fires before the
    // user has actually completed anything), this is the real "a new
    // person just joined" signal. New users signing themselves up is the
    // entire point of the marketing page; the owner needs to know when it
    // happens the same way beta signups already notify.
    createUser: async ({ user }) => {
      await notifyAdmin(
        "New user via login",
        `New user signed up via login: ${user.email ?? "(no email)"}`,
        "new_user_login",
        user.email ?? null,
      );
    },
  },
});
