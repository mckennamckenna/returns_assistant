import { describe, it, expect } from "vitest";
import { formatSenderEmail, SENDER_DISPLAY_NAME } from "../lib/postmark";

// TASKS.md 2026-08-27 ("Sender display name change") — REMINDER_FROM_EMAIL
// is a bare address with no display name, so Gmail fell back to showing
// the address's local-part ("reminders") as the sender name. This is the
// fix: every outbound send wraps the address with a real display name
// before it reaches Postmark's From field.
describe("formatSenderEmail", () => {
  it("wraps a bare address with the display name in Postmark's expected format", () => {
    expect(formatSenderEmail("reminders@myreturnwindow.com")).toBe(
      "My Return Window <reminders@myreturnwindow.com>",
    );
  });

  it("uses the shared SENDER_DISPLAY_NAME constant, not a hardcoded duplicate", () => {
    expect(formatSenderEmail("hello@myreturnwindow.com")).toBe(`${SENDER_DISPLAY_NAME} <hello@myreturnwindow.com>`);
  });
});
