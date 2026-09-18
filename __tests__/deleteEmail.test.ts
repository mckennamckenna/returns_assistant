import { vi, describe, it, expect, beforeEach } from "vitest";

// TASKS.md 🔴 Now (2026-09-17, "Order-delete ghost emails fix") —
// deleteEmail's last-email branch soft-deletes the Order instead of
// hard-deleting it, converging onto the dashboard Delete button's model so
// every Order hard-delete (and its linked-email junk cascade) runs through
// the nightly cron. Same mocking shape as
// __tests__/unlinkEmailFromOrderAction.test.ts.
const mockPrisma = {
  email: {
    findUnique: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  order: {
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  reminder: {
    deleteMany: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: mockAuth, signOut: vi.fn() }));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("@/lib/orderReview", () => ({
  linkEmailToExistingOrder: vi.fn(),
  createOrderFromOrphanedEmail: vi.fn(),
  archiveOrphanedEmail: vi.fn(),
  approveOrder: vi.fn(),
}));
vi.mock("@/lib/junk", () => ({ rescueEmail: vi.fn() }));
vi.mock("@/lib/displayStatus", () => ({ DISPLAY_STATUS_RANK: {}, buildStatusTransitionData: vi.fn() }));

const { deleteEmail } = await import("../app/actions");

describe("deleteEmail", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockRevalidatePath.mockReset();
    for (const model of Object.values(mockPrisma)) {
      for (const fn of Object.values(model)) fn.mockReset();
    }
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("soft-deletes the Order when its last email is deleted — never hard-deletes it or its reminders here", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: "order-1" });
    mockPrisma.email.count.mockResolvedValue(0);

    await deleteEmail("email-1");

    expect(mockPrisma.email.delete).toHaveBeenCalledWith({ where: { id: "email-1" } });
    expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockPrisma.order.delete).not.toHaveBeenCalled();
    expect(mockPrisma.reminder.deleteMany).not.toHaveBeenCalled();
  });

  it("guards on deletedAt: null so an already-soft-deleted order keeps its original 30-day clock", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: "order-1" });
    mockPrisma.email.count.mockResolvedValue(0);

    await deleteEmail("email-1");

    expect(mockPrisma.order.updateMany.mock.calls[0][0].where).toEqual({ id: "order-1", deletedAt: null });
  });

  it("leaves the Order alone when other emails are still linked to it", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: "order-1" });
    mockPrisma.email.count.mockResolvedValue(2);

    await deleteEmail("email-1");

    expect(mockPrisma.email.delete).toHaveBeenCalled();
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.order.delete).not.toHaveBeenCalled();
    expect(mockPrisma.reminder.deleteMany).not.toHaveBeenCalled();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/orders/order-1");
  });

  it("deletes an orphan email without touching any Order", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: null });

    await deleteEmail("email-1");

    expect(mockPrisma.email.delete).toHaveBeenCalled();
    expect(mockPrisma.email.count).not.toHaveBeenCalled();
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a user deleting an email they don't own", async () => {
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-2", orderId: "order-1" });

    await deleteEmail("email-1");

    expect(mockPrisma.email.delete).not.toHaveBeenCalled();
    expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing without a session", async () => {
    mockAuth.mockResolvedValue(null);

    await deleteEmail("email-1");

    expect(mockPrisma.email.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.email.delete).not.toHaveBeenCalled();
  });
});
