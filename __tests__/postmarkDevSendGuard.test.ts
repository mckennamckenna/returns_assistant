import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Dev-send guard (TASKS.md 🔴 Now, 2026-09-02, env-var fix 2026-09-03) —
// sendEmail() used to fire a real Postmark send from any environment,
// including local dev, whenever POSTMARK_SERVER_TOKEN was set. Combined
// with a stale REMINDER_FROM_EMAIL in a developer's .env, that meant local
// dev could silently email real users. Checks VERCEL_ENV, not NODE_ENV —
// Next.js/Vercel run a production build for EVERY deployment including
// previews, so NODE_ENV === "production" is true on preview deploys too and
// the original 75861d5 guard provided zero real protection there (Preview
// env has real POSTMARK_SERVER_TOKEN/REMINDER_FROM_EMAIL/LOGIN_FROM_EMAIL
// values). VERCEL_ENV is undefined locally (correctly falsy) and is
// Vercel's actual production/preview/development signal. Branches under
// test: production (VERCEL_ENV="production") always sends; preview
// (VERCEL_ENV="preview", the case the original guard missed) with no
// override logs-and-skips; local (VERCEL_ENV unset) with
// ALLOW_REAL_EMAIL_IN_DEV=true sends but warns; local default logs the
// intended send and never calls Postmark.

const mockFetch = vi.fn();

describe("sendEmail — dev-send guard", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("production (VERCEL_ENV=production): sends normally, calls Postmark, no dev-guard log", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALLOW_REAL_EMAIL_IN_DEV", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendEmail } = await import("../lib/postmark");
    await sendEmail({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test", textBody: "body" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("[dev-send-guard]"), expect.anything());
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("preview (VERCEL_ENV=preview), no override — the case the original NODE_ENV-based guard missed: does NOT call Postmark, logs the intended send instead", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ALLOW_REAL_EMAIL_IN_DEV", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { sendEmail } = await import("../lib/postmark");
    await sendEmail({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test", textBody: "body" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev-send-guard]"),
      expect.objectContaining({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test" }),
    );

    logSpy.mockRestore();
  });

  it("local (VERCEL_ENV unset) with ALLOW_REAL_EMAIL_IN_DEV=true: sends normally, calls Postmark, AND warns", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_REAL_EMAIL_IN_DEV", "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendEmail } = await import("../lib/postmark");
    await sendEmail({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test", textBody: "body" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev-send-guard]"),
      expect.objectContaining({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test" }),
    );

    warnSpy.mockRestore();
  });

  it("local (VERCEL_ENV unset), no override (the default): does NOT call Postmark, logs the intended send instead", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_REAL_EMAIL_IN_DEV", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { sendEmail } = await import("../lib/postmark");
    await sendEmail({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test", textBody: "body" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev-send-guard]"),
      expect.objectContaining({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test" }),
    );

    logSpy.mockRestore();
  });

  it("local (VERCEL_ENV unset), ALLOW_REAL_EMAIL_IN_DEV set to any non-'true' value: still does NOT send (no accidental truthy-string bypass)", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALLOW_REAL_EMAIL_IN_DEV", "1");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { sendEmail } = await import("../lib/postmark");
    await sendEmail({ to: "user@example.com", from: "reminders@myreturnwindow.com", subject: "Test", textBody: "body" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
