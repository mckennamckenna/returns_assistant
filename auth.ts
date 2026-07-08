import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/postmark";
import { notifyAdmin, hasRecentNotification, recordDedupedNotification } from "@/lib/adminNotify";

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
          // Visibility, not auth — the gate itself is correct; not knowing
          // when it fires is the bug. Deduped per email per 24h so a
          // bot/scanner hammering the same address repeatedly can't spam
          // the owner's inbox; the row is still written either way (with
          // deliveryStatus: "deduped" when suppressed), so a pattern of
          // many deduped rows for one email is visible evidence of
          // scanning even though only the first one actually emailed.
          const subject = "Login attempt from unallowlisted email";
          const body = `${email} tried to sign in but isn't on the allowlist yet.\n\nIf this should be allowed, run:\nnpx tsx scripts/addAllowedSignIn.ts ${email}`;

          if (await hasRecentNotification("allowlist_rejection", email)) {
            await recordDedupedNotification("allowlist_rejection", subject, body, email);
          } else {
            await notifyAdmin(subject, body, "allowlist_rejection", email);
          }
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
