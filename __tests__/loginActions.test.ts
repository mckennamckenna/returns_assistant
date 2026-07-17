import { vi, describe, it, expect } from "vitest";

// Both @/auth and "next-auth" itself are mocked here — importing the real
// "next-auth" package fails under plain Node/vitest (it transitively pulls
// in next/server via next-auth/lib/env.js, which only resolves inside
// Next.js's own bundler; confirmed while building
// lib/magicLinkRateLimit.ts, which is why AuthError is sourced from
// @auth/core/errors there instead). Re-exporting the real AuthError class
// here (not a fake one) keeps `error instanceof AuthError` in
// app/login/actions.ts working exactly as it does in production.
vi.mock("next-auth", async () => {
  const core = await import("@auth/core/errors");
  return { AuthError: core.AuthError };
});

const mockSignIn = vi.fn();
vi.mock("@/auth", () => ({ signIn: mockSignIn }));

const { AuthError } = await import("@auth/core/errors");
const { MagicLinkRateLimitError } = await import("../lib/magicLinkRateLimit");
const { sendMagicLink } = await import("../app/login/actions");

describe("sendMagicLink", () => {
  it("returns the rate-limit-specific message when signIn throws MagicLinkRateLimitError", async () => {
    mockSignIn.mockRejectedValueOnce(new MagicLinkRateLimitError());

    const result = await sendMagicLink(new FormData());

    expect(result).toEqual({
      error: "You've requested several sign-in links recently. Please wait a few minutes and try again.",
    });
  });

  it("returns the generic message for any other AuthError", async () => {
    mockSignIn.mockRejectedValueOnce(new AuthError("Some other failure"));

    const result = await sendMagicLink(new FormData());

    expect(result).toEqual({ error: "Couldn't send the link. Check the email address and try again." });
  });

  it("rethrows non-AuthError values (Next.js's internal redirect signal on success)", async () => {
    const redirectSignal = { digest: "NEXT_REDIRECT" };
    mockSignIn.mockRejectedValueOnce(redirectSignal);

    await expect(sendMagicLink(new FormData())).rejects.toBe(redirectSignal);
  });

  it("returns no error on success", async () => {
    mockSignIn.mockResolvedValueOnce(undefined);

    const result = await sendMagicLink(new FormData());

    expect(result).toEqual({});
  });
});
