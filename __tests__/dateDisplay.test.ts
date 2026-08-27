import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatCalendarDate, formatCalendarDateShort } from "../lib/dateDisplay";

// TASKS.md 2026-08-27 — the dashboard/detail date-drift bug (and two
// earlier, independently-logged "off by one day" entries, 2026-08-21 and
// 2026-08-25) all came down to the same mistake: a calendar-date field
// stored as DateTime-at-UTC-midnight was formatted with
// `toLocaleDateString(undefined, ...)`, which renders in whatever timezone
// the CALLING CODE happens to run in (browser-local on a "use client"
// component, server-process-local everywhere else) instead of reading the
// date's own stored calendar components. This is the test that would have
// caught it: the same input must produce the same output no matter what
// timezone the reading environment is in.
describe("formatCalendarDate / formatCalendarDateShort — timezone independence", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  // The exact shape of the reported bug: a UTC-midnight instant intended to
  // represent "Aug 22" must render as Aug 22, never Aug 21 — genuine
  // conversion to any negative-UTC-offset zone (Pacific, US Eastern) rolls
  // a UTC-midnight value back to the previous day, which is the bug, not a
  // fix for it (see lib/dateDisplay.ts's comment on the rejected
  // America/Los_Angeles approach).
  it("a UTC-midnight date renders as its own calendar date, not the day before", () => {
    const utcMidnight = new Date("2026-08-22T00:00:00Z");
    expect(formatCalendarDate(utcMidnight)).toBe("Aug 22, 2026");
    expect(formatCalendarDateShort(utcMidnight)).toBe("Aug 22");
  });

  // The real production fixture from this bug's report: Zara #54421192781.
  it("the Zara #54421192781 shape: deliveredAt backfilled to a non-midnight UTC instant still reads its correct UTC calendar day", () => {
    const anchorDate = new Date("2026-08-22T20:41:07.000Z");
    expect(formatCalendarDate(anchorDate)).toBe("Aug 22, 2026");
  });

  it("returns the placeholder for null", () => {
    expect(formatCalendarDate(null)).toBe("—");
    expect(formatCalendarDateShort(null)).toBe("—");
  });

  describe("process.env.TZ invariance", () => {
    // Node's Intl/Date formatting consults process.env.TZ when no explicit
    // timeZone is given — this is the exact mechanism that made the
    // server-rendered detail page and the client-rendered dashboard card
    // disagree (server process: UTC on Vercel; browser: the user's real
    // zone). Pinning `timeZone: "UTC"` explicitly (lib/dateDisplay.ts)
    // means the output must NOT move even when the ambient TZ does.
    const utcMidnight = new Date("2026-08-22T00:00:00Z");
    const realTz = ["America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati"];

    it.each(realTz)("output is identical under TZ=%s", (tz) => {
      process.env.TZ = tz;
      expect(formatCalendarDate(utcMidnight)).toBe("Aug 22, 2026");
      expect(formatCalendarDateShort(utcMidnight)).toBe("Aug 22");
    });

    it("output is identical whether TZ is unset or explicitly UTC", () => {
      delete process.env.TZ;
      const unset = formatCalendarDate(utcMidnight);
      process.env.TZ = "UTC";
      const explicit = formatCalendarDate(utcMidnight);
      expect(unset).toBe(explicit);
      expect(unset).toBe("Aug 22, 2026");
    });
  });

  // Client/server parity — the literal shape of the reported bug: the same
  // Date object formatted from what would be a "use client" component vs.
  // a server component (simulated here via TZ, since that's the actual
  // mechanism that differed between them) must agree.
  describe("client vs. server parity", () => {
    beforeEach(() => {
      process.env.TZ = "UTC"; // simulates the Vercel server process
    });

    it("a client-side render (simulated: Pacific-zoned process) matches a server-side render (UTC-zoned process) for the same instant", () => {
      const value = new Date("2026-08-24T00:00:00.000Z"); // the Zara order's estimatedDeliveryDate at the time of the original report

      process.env.TZ = "UTC";
      const serverRendered = formatCalendarDateShort(value);

      process.env.TZ = "America/Los_Angeles";
      const clientRendered = formatCalendarDateShort(value);

      expect(clientRendered).toBe(serverRendered);
      expect(clientRendered).toBe("Aug 24");
    });
  });
});
