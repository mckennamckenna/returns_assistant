import { vi, describe, it, expect, beforeEach } from "vitest";

// TASKS.md 🔴 Now (2026-09-17, "Order-delete ghost emails fix") — the
// nightly cron's hard-delete step, app/api/cron/route.ts's
// hardDeleteSoftDeletedOrders. Uses the REAL junkLinkedEmailsForDeletedOrder
// (lib/orderReview.ts) against a mocked transaction client, so the
// junk-before-delete ordering is exercised end to end, not stubbed. Real
// rollback is a database property the mocks can't show; what's asserted
// here is that every write for an order goes through that order's own
// $transaction callback, so Postgres rolls them back together.

const TEST_SECRET = "a".repeat(64);
vi.stubEnv("TOKEN_SIGNING_SECRET", TEST_SECRET);

// Every write, in call order, across all transactions — lets a test assert
// the junk happened before the Order delete.
const writeLog: string[] = [];

function makeTx(opts: { linkedEmails?: { id: string; userId: string }[]; stillExpired?: boolean; deleteThrows?: boolean } = {}) {
  const { linkedEmails = [], stillExpired = true, deleteThrows = false } = opts;
  return {
    order: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(stillExpired ? { id: where.id } : null)),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        if (deleteThrows) return Promise.reject(new Error("simulated delete failure"));
        writeLog.push(`order.delete:${where.id}`);
        return Promise.resolve({});
      }),
    },
    email: {
      findMany: vi.fn().mockResolvedValue(linkedEmails),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })),
      update: vi.fn(({ where }: { where: { id: string } }) => {
        writeLog.push(`email.junk:${where.id}`);
        return Promise.resolve({});
      }),
    },
    reminder: {
      deleteMany: vi.fn(({ where }: { where: { orderId: string } }) => {
        writeLog.push(`reminder.deleteMany:${where.orderId}`);
        return Promise.resolve({ count: 0 });
      }),
    },
    actionLog: {
      create: vi.fn(({ data }: { data: { action: string } }) => {
        writeLog.push(`actionLog:${data.action}`);
        return Promise.resolve({});
      }),
    },
  };
}

type Tx = ReturnType<typeof makeTx>;
// One tx per order id, handed out by the $transaction mock below.
let txByOrder: Record<string, Tx> = {};
let currentOrderIds: string[] = [];

const mockPrisma = {
  order: { findMany: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/postmark", () => ({ sendEmail: vi.fn(), formatSenderEmail: (email: string) => email }));
const mockNotifyAdmin = vi.fn();
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: mockNotifyAdmin }));
vi.mock("@/lib/refundCheckin", () => ({ runRefundCheckinReminders: vi.fn() }));

const { hardDeleteSoftDeletedOrders } = await import("../app/api/cron/route");
const { HARD_DELETE_DAYS } = await import("../lib/orderFilters");

const NOW = new Date("2026-09-18T14:00:00.000Z");

function setup(orders: Record<string, Parameters<typeof makeTx>[0]>) {
  currentOrderIds = Object.keys(orders);
  txByOrder = Object.fromEntries(currentOrderIds.map((id) => [id, makeTx(orders[id])]));
  mockPrisma.order.findMany.mockResolvedValue(currentOrderIds.map((id) => ({ id })));
  // Transactions run in loop order — hand each callback its order's tx.
  let call = 0;
  mockPrisma.$transaction.mockImplementation((fn: (tx: Tx) => Promise<unknown>) => fn(txByOrder[currentOrderIds[call++]]));
}

describe("hardDeleteSoftDeletedOrders", () => {
  beforeEach(() => {
    writeLog.length = 0;
    mockPrisma.order.findMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockNotifyAdmin.mockReset();
  });

  it("selects only orders soft-deleted at least HARD_DELETE_DAYS ago", async () => {
    setup({});

    await hardDeleteSoftDeletedOrders(NOW);

    const cutoff = new Date(NOW.getTime() - HARD_DELETE_DAYS * 24 * 60 * 60 * 1000);
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith({ where: { deletedAt: { lte: cutoff } }, select: { id: true } });
  });

  it("junks the order's linked emails, then deletes it — all in that order's transaction", async () => {
    setup({
      "order-1": {
        linkedEmails: [
          { id: "email-1", userId: "user-1" },
          { id: "email-2", userId: "user-1" },
        ],
      },
    });

    const result = await hardDeleteSoftDeletedOrders(NOW);

    expect(result).toEqual({ hardDeleted: 1, hardDeleteFailed: [] });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(writeLog).toEqual([
      "email.junk:email-1",
      "email.junk:email-2",
      "actionLog:order_deleted_junk_cascade:orderId=order-1:count=2",
      "order.delete:order-1",
    ]);
  });

  it("keeps the order's Reminder rows — never deletes them (FK is ON DELETE SET NULL; /admin's recent-sends audit trail survives order deletion)", async () => {
    setup({ "order-1": { linkedEmails: [{ id: "email-1", userId: "user-1" }] } });

    await hardDeleteSoftDeletedOrders(NOW);

    expect(txByOrder["order-1"].reminder.deleteMany).not.toHaveBeenCalled();
    expect(writeLog.some((w) => w.startsWith("reminder."))).toBe(false);
  });

  it("deletes an order with no linked emails without writing a junk ActionLog row", async () => {
    setup({ "order-1": { linkedEmails: [] } });

    const result = await hardDeleteSoftDeletedOrders(NOW);

    expect(result.hardDeleted).toBe(1);
    expect(writeLog).toEqual(["order.delete:order-1"]);
  });

  it("skips an order no longer past the cutoff by the time its transaction runs — no junk, no delete, not counted", async () => {
    setup({ "order-1": { linkedEmails: [{ id: "email-1", userId: "user-1" }], stillExpired: false } });

    const result = await hardDeleteSoftDeletedOrders(NOW);

    expect(result).toEqual({ hardDeleted: 0, hardDeleteFailed: [] });
    expect(writeLog).toEqual([]);
  });

  it("a failing order is reported and skipped (its transaction throws, so its junk rolls back) without blocking the next order", async () => {
    setup({
      "order-bad": { linkedEmails: [{ id: "email-a", userId: "user-1" }], deleteThrows: true },
      "order-good": { linkedEmails: [{ id: "email-b", userId: "user-1" }] },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await hardDeleteSoftDeletedOrders(NOW);

    expect(result).toEqual({ hardDeleted: 1, hardDeleteFailed: [{ orderId: "order-bad", error: "simulated delete failure" }] });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    // The failing order's junk ran inside its own transaction callback —
    // the one that rejected — so Postgres discards it with the failed delete.
    expect(txByOrder["order-bad"].email.update).toHaveBeenCalledTimes(1);
    await expect(mockPrisma.$transaction.mock.results[0].value).rejects.toThrow("simulated delete failure");
    expect(writeLog).toContain("order.delete:order-good");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("emails the admin the failed order IDs and errors when any hard-delete fails", async () => {
    setup({
      "order-bad": { linkedEmails: [], deleteThrows: true },
      "order-good": { linkedEmails: [] },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await hardDeleteSoftDeletedOrders(NOW);

    expect(mockNotifyAdmin).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = mockNotifyAdmin.mock.calls[0];
    expect(subject).toBe("Return Window: order hard-delete failures");
    expect(kind).toBe("hard_delete_failures");
    expect(body).toContain("1 order hard-delete(s) failed; 1 succeeded.");
    expect(body).toContain("- order-bad: simulated delete failure");
    consoleError.mockRestore();
  });

  it("sends no admin email when every hard-delete succeeds", async () => {
    setup({ "order-1": { linkedEmails: [{ id: "email-1", userId: "user-1" }] } });

    await hardDeleteSoftDeletedOrders(NOW);

    expect(mockNotifyAdmin).not.toHaveBeenCalled();
  });

  it("does nothing when no orders are past the cutoff", async () => {
    setup({});

    expect(await hardDeleteSoftDeletedOrders(NOW)).toEqual({ hardDeleted: 0, hardDeleteFailed: [] });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
