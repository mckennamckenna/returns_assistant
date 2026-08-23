import { describe, it, expect } from "vitest";
import { resolveBodyText, resolveBodyTextWithAlternate } from "../lib/emailBodyText";

const SUBSTANTIAL_TEXT = "a".repeat(50);
const SUBSTANTIAL_HTML = `<p>${"b".repeat(50)}</p>`;

describe("resolveBodyText", () => {
  it("prefers textBody when substantial (unchanged default)", () => {
    expect(resolveBodyText(SUBSTANTIAL_TEXT, SUBSTANTIAL_HTML)).toBe(SUBSTANTIAL_TEXT);
  });

  it("falls back to converted htmlBody when textBody is thin", () => {
    expect(resolveBodyText("  ", SUBSTANTIAL_HTML)).toBe("b".repeat(50));
  });

  it("returns null when neither source has anything usable", () => {
    expect(resolveBodyText(null, null)).toBeNull();
  });
});

describe("resolveBodyTextWithAlternate", () => {
  it("primary matches resolveBodyText's own output in every case (additive, not a behavior change)", () => {
    const cases: [string | null, string | null][] = [
      [SUBSTANTIAL_TEXT, SUBSTANTIAL_HTML],
      ["  ", SUBSTANTIAL_HTML],
      [SUBSTANTIAL_TEXT, null],
      [null, null],
    ];
    for (const [text, html] of cases) {
      expect(resolveBodyTextWithAlternate(text, html).primary).toBe(resolveBodyText(text, html));
    }
  });

  it("H&M shape — textBody substantial and chosen, htmlBody substantial too — offers htmlBody as the alternate", () => {
    const { primary, alternate } = resolveBodyTextWithAlternate(SUBSTANTIAL_TEXT, SUBSTANTIAL_HTML);
    expect(primary).toBe(SUBSTANTIAL_TEXT);
    expect(alternate).toBe("b".repeat(50));
  });

  it("Zara shape — textBody empty, htmlBody becomes primary — offers no alternate (nothing left to retry against)", () => {
    const { primary, alternate } = resolveBodyTextWithAlternate("", SUBSTANTIAL_HTML);
    expect(primary).toBe("b".repeat(50));
    expect(alternate).toBeNull();
  });

  it("offers no alternate when htmlBody converts to something too thin to be worth a retry", () => {
    const { alternate } = resolveBodyTextWithAlternate(SUBSTANTIAL_TEXT, "<p>hi</p>");
    expect(alternate).toBeNull();
  });

  it("offers no alternate when htmlBody is absent entirely", () => {
    const { primary, alternate } = resolveBodyTextWithAlternate(SUBSTANTIAL_TEXT, null);
    expect(primary).toBe(SUBSTANTIAL_TEXT);
    expect(alternate).toBeNull();
  });
});
