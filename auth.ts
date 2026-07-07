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
      // Alpha gate: an email only gets a magic link if it already belongs
      // to an existing User (re-login, always allowed — never lock out
      // someone who already has an account) or is in AllowedSignIn (a
      // manually-curated invite). Anything else is silently skipped — no
      // email sent, no error thrown — so the verify-request page looks
      // identical either way and doesn't leak which emails are approved.
      sendVerificationRequest: async ({ identifier, url }) => {
        const email = identifier.trim().toLowerCase();
        const [existingUser, allowed] = await Promise.all([
          prisma.user.findUnique({ where: { email } }),
          prisma.allowedSignIn.findUnique({ where: { email } }),
        ]);
        if (!existingUser && !allowed) {
          return;
        }
        await sendEmail({
          to: identifier,
          from: (process.env.LOGIN_FROM_EMAIL ?? process.env.REMINDER_FROM_EMAIL)!,
          bcc: process.env.ADMIN_EMAIL,
          subject: "Sign in to Return Window",
          textBody: `Click the link below to sign in to Return Window.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email — no account changes were made.`,
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
