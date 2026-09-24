import { vi, describe, it, expect, beforeEach } from "vitest";

// Tests for the extraction recovery sweep (TASKS.md 2026-09-24 build).
// Zero real API calls: runExtraction is mocked outright, so nothing here
// reaches the Anthropic SDK or a database.

const mockEmailFindMany = vi.hoisted(() => vi.fn());
const mockEmailFindUnique = vi.hoisted(() => vi.fn());
const mockActionLogCreate = vi.hoisted(() => vi.fn());
const mockActionLogUpdate = vi.hoisted(() => vi.fn());
const mockActionLogFindMany = vi.hoisted(() => vi.fn());
const mockRunExtraction = vi.hoisted(() => vi.fn());
const mockNotifyAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    email: { findMany: mockEmailFindMany, findUnique: mockEmailFindUnique },
    actionLog: {
      create: mockActionLogCreate,
      update: mockActionLogUpdate,
      findMany: mockActionLogFindMany,
    },
  },
}));
vi.mock("@/lib/runExtraction", () => ({ runExtraction: mockRunExtraction }));
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: mockNotifyAdmin }));

const {
  runExtractionSweep,
  hasBudgetForAnotherEmail,
  SWEEP_MAX_EMAILS_PER_RUN,
  SWEEP_MIN_AGE_MINUTES,
  SWEEP_COVERAGE_START,
  EXTRACTION_RETRY_ACTION,
  RETRY_OUTCOME_STARTED,
  MAX_DURATION_MS,
} = await import("../lib/extractionSweep");
const { WORST_CASE_EXTRACTION_MS } = await import("../lib/extract");

let logSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  logSeq = 0;
  mockActionLogCreate.mockImplementation(async () => ({ id: `log-${++logSeq}` }));
  mockActionLogUpdate.mockResolvedValue({});
  mockActionLogFindMany.mockResolvedValue([]);
  mockEmailFindMany.mockResolvedValue([]);
  // Default: extraction worked.
  mockEmailFindUnique.mockResolvedValue({ extractedAt: new Date() });
  mockRunExtraction.mockResolvedValue(undefined);
});

describe("eligibility query", () => {
  it("picks up an eligible email and retries it once", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);

    const result = await runExtractionSweep();

    expect(mockRunExtraction).toHaveBeenCalledTimes(1);
    expect(mockRunExtraction).toHaveBeenCalledWith("e1");
    expect(result.succeeded).toEqual(["e1"]);
    expect(result.stillUnextracted).toEqual([]);
  });

  it("filters on junked, age, coverage start, and prior-retry — all four", async () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    await runExtractionSweep(now);

    const where = mockEmailFindMany.mock.calls[0][0].where;
    // never extracted
    expect(where.extractedAt).toBeNull();
    // not junked — junked mail is never meant to be extracted
    expect(where.junkedAt).toBeNull();
    // older than the threshold, so an in-flight extraction is never raced
    expect(where.receivedAt.lt).toEqual(
      new Date(now.getTime() - SWEEP_MIN_AGE_MINUTES * 60 * 1000),
    );
    // and not older than the deploy — the 6 legacy stuck rows stay untouched
    expect(where.receivedAt.gte).toEqual(SWEEP_COVERAGE_START);
    // and has never had an extraction_retry row, whatever its outcome
    expect(where.actionLogs).toEqual({ none: { action: EXTRACTION_RETRY_ACTION } });
  });

  it("caps the database query at the per-run maximum", async () => {
    await runExtractionSweep();
    expect(mockEmailFindMany.mock.calls[0][0].take).toBe(SWEEP_MAX_EMAILS_PER_RUN);
  });
});

describe("no path can retry the same email twice", () => {
  it("writes the ActionLog row BEFORE calling extraction", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);
    const order: string[] = [];
    mockActionLogCreate.mockImplementation(async () => {
      order.push("log");
      return { id: "log-1" };
    });
    mockRunExtraction.mockImplementation(async () => {
      order.push("extract");
    });

    await runExtractionSweep();

    // If this order ever flips, a retry killed mid-flight would leave no
    // record and be picked up again forever.
    expect(order).toEqual(["log", "extract"]);
  });

  it("marks the email ineligible even when the retry throws", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);
    mockRunExtraction.mockRejectedValue(new Error("boom"));
    mockEmailFindUnique.mockResolvedValue({ extractedAt: null });

    const result = await runExtractionSweep();

    // The row was still created, so the eligibility query excludes it next run.
    expect(mockActionLogCreate).toHaveBeenCalledTimes(1);
    expect(mockActionLogCreate.mock.calls[0][0].data.emailId).toBe("e1");
    expect(result.stillUnextracted).toEqual(["e1"]);
  });
});

describe("per-run cap", () => {
  it("never attempts more than the cap even if more rows come back", async () => {
    mockEmailFindMany.mockResolvedValue([
      { id: "e1", userId: "u1" },
      { id: "e2", userId: "u1" },
      { id: "e3", userId: "u1" },
      { id: "e4", userId: "u1" },
      { id: "e5", userId: "u1" },
    ]);

    const result = await runExtractionSweep();

    expect(result.attempted).toBeLessThanOrEqual(SWEEP_MAX_EMAILS_PER_RUN);
    expect(mockRunExtraction.mock.calls.length).toBeLessThanOrEqual(SWEEP_MAX_EMAILS_PER_RUN);
  });
});

describe("time-budget guard", () => {
  it("allows a first email at the start of a run", () => {
    expect(hasBudgetForAnotherEmail(0)).toBe(true);
  });

  it("refuses to start an email whose worst case would not fit", () => {
    // The flaw this replaced: a flat 120s guard would return true here,
    // start an email with a ~240s worst case, and get killed mid-retry.
    expect(hasBudgetForAnotherEmail(MAX_DURATION_MS - 120_000)).toBe(false);
  });

  it("is derived from the extraction timeouts, not hardcoded", () => {
    // Exactly at the boundary: worst case plus wrap-up reserve still fits.
    const latestSafeStart = MAX_DURATION_MS - WORST_CASE_EXTRACTION_MS - 15_000;
    expect(hasBudgetForAnotherEmail(latestSafeStart)).toBe(true);
    expect(hasBudgetForAnotherEmail(latestSafeStart + 1)).toBe(false);
  });
});

describe("admin notification", () => {
  it("notifies when a retry ran and the email is still unextracted", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);
    mockEmailFindUnique.mockResolvedValue({ extractedAt: null });

    await runExtractionSweep();

    expect(mockNotifyAdmin).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = mockNotifyAdmin.mock.calls[0];
    expect(kind).toBe("extraction_retry_failed");
    expect(subject).toContain("1");
    expect(body).toContain("e1");
  });

  it("stays silent when every retry succeeded", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);

    await runExtractionSweep();

    expect(mockNotifyAdmin).not.toHaveBeenCalled();
  });

  it("stays silent on a healthy day with no candidates at all", async () => {
    const result = await runExtractionSweep();
    expect(result.candidatesFound).toBe(0);
    expect(mockRunExtraction).not.toHaveBeenCalled();
    expect(mockNotifyAdmin).not.toHaveBeenCalled();
  });
});

describe("interrupted retries from earlier runs", () => {
  it("reports rows stranded at 'started' by a killed run", async () => {
    mockActionLogFindMany.mockResolvedValue([{ emailId: "old-1" }, { emailId: "old-2" }]);

    await runExtractionSweep();

    expect(mockActionLogFindMany.mock.calls[0][0].where).toMatchObject({
      action: EXTRACTION_RETRY_ACTION,
      outcome: RETRY_OUTCOME_STARTED,
    });
    expect(mockNotifyAdmin).toHaveBeenCalledTimes(1);
    const body = mockNotifyAdmin.mock.calls[0][1];
    expect(body).toContain("Retry interrupted");
    expect(body).toContain("old-1");
    expect(body).toContain("old-2");
  });

  it("does not double-report an email retried in THIS run", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);
    mockEmailFindUnique.mockResolvedValue({ extractedAt: null });
    // Its own in-flight row is still at "started" when the query runs.
    mockActionLogFindMany.mockResolvedValue([{ emailId: "e1" }]);

    const result = await runExtractionSweep();

    expect(result.stillUnextracted).toEqual(["e1"]);
    expect(result.interrupted).toEqual([]);
  });
});

describe("retry record contents", () => {
  it("records duration and success in the outcome", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);

    await runExtractionSweep();

    const update = mockActionLogUpdate.mock.calls[0][0];
    expect(update.data.outcome).toMatch(/^success:\d+ms$/);
  });

  it("records still_unextracted with a duration on failure", async () => {
    mockEmailFindMany.mockResolvedValue([{ id: "e1", userId: "u1" }]);
    mockEmailFindUnique.mockResolvedValue({ extractedAt: null });

    await runExtractionSweep();

    expect(mockActionLogUpdate.mock.calls[0][0].data.outcome).toMatch(
      /^still_unextracted:\d+ms$/,
    );
  });
});
