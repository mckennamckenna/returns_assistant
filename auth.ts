import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Nodemailer({
      // Required by the provider factory's own validation, but never
      // actually used — sendVerificationRequest below replaces the
      // function that would otherwise read this and open an SMTP
      // connection. We send via Postmark's HTTP API instead, same as
      // the rest of the app.
      server: { host: "smtp.postmarkapp.com", port: 587, auth: { user: "unused", pass: "unused" } },
      from: process.env.REMINDER_FROM_EMAIL,
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendEmail({
          to: identifier,
          from: process.env.REMINDER_FROM_EMAIL!,
          subject: "Sign in to Returns Assistant",
          textBody: `Click the link below to sign in to Returns Assistant.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email — no account changes were made.`,
        });
      },
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
});
