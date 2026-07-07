import { describe, it, expect } from "vitest";
import { buildGmailCodeResponse, gmailVerifiedClearFields } from "../lib/gmailVerification";

describe("buildGmailCodeResponse", () => {
  it("surfaces the code and an ISO receivedAt once a code has arrived", () => {
    const receivedAt = new Date("2026-07-07T21:09:00.000Z");
    const result = buildGmailCodeResponse({ gmailVerificationCode: "ABC123", gmailVerificationCodeReceivedAt: receivedAt });
    expect(result).toEqual({ code: "ABC123", receivedAt: receivedAt.toISOString() });
  });

  it("returns nulls when no code has arrived yet", () => {
    const result = buildGmailCodeResponse({ gmailVerificationCode: null, gmailVerificationCodeReceivedAt: null });
    expect(result).toEqual({ code: null, receivedAt: null });
  });
});

describe("gmailVerifiedClearFields", () => {
  it("clears both the code and receivedAt fields", () => {
    expect(gmailVerifiedClearFields()).toEqual({
      gmailVerificationCode: null,
      gmailVerificationCodeReceivedAt: null,
    });
  });
});
