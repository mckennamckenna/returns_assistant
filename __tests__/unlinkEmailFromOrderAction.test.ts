import { vi, describe, it, expect, beforeEach } from "vitest";

// carrier-row-disposition Phase 3 (2026-08-28) — same mocking shape as
// __tests__/linkOrder.test.ts: prevent module-level Prisma client
// construction (no real DATABASE_URL in a test environment), and stub out
// app/actions.ts's other dependencies so importing it doesn't pull in the
// real lib/orderReview.ts -> lib/linkOrder.ts -> lib/db.ts chain.
const mockPrisma = {
  email: {
    findUnique: vi.fn(),
    update: vi.fn(),
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

const { unlinkEmailFromOrderAction } = await import("../app/actions");

describe("unlinkEmailFromOrderAction", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockPrisma.email.findUnique.mockReset();
    mockPrisma.email.update.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("does nothing when there's no session", async () => {
    mockAuth.mockResolvedValue(null);

    await unlinkEmailFromOrderAction("email-1");

    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("rejects a user attempting to unlink an email they don't own", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-2", orderId: "order-1" });

    await unlinkEmailFromOrderAction("email-1");

    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("does nothing when the email doesn't exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.email.findUnique.mockResolvedValue(null);

    await unlinkEmailFromOrderAction("email-1");

    expect(mockPrisma.email.update).not.toHaveBeenCalled();
  });

  it("sets orderId to null and needsReview to true for a successful unlink, owned by the requesting user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: "order-1" });

    await unlinkEmailFromOrderAction("email-1");

    expect(mockPrisma.email.update).toHaveBeenCalledWith({
      where: { id: "email-1" },
      data: { orderId: null, needsReview: true },
    });
  });

  it("revalidates both the order detail page and the dashboard on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockPrisma.email.findUnique.mockResolvedValue({ userId: "user-1", orderId: "order-1" });

    await unlinkEmailFromOrderAction("email-1");

    expect(mockRevalidatePath).toHaveBeenCalledWith("/orders/order-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
  });
});
