import { describe, it, expect } from "vitest";
import { truncateOrderNumber } from "../lib/orderNumberDisplay";

describe("truncateOrderNumber", () => {
  it("leaves short order numbers untouched", () => {
    expect(truncateOrderNumber("F4VLSF")).toBe("F4VLSF");
    expect(truncateOrderNumber("86864")).toBe("86864");
    expect(truncateOrderNumber("142770152")).toBe("142770152");
  });

  it("leaves a 16-char order number untouched (at the threshold)", () => {
    const sixteen = "1234567890123456";
    expect(sixteen.length).toBe(16);
    expect(truncateOrderNumber(sixteen)).toBe(sixteen);
  });

  it("middle-truncates a long order number (17+ chars) to first 6 + ellipsis + last 4", () => {
    // The real Poshmark order number that prompted this change.
    expect(truncateOrderNumber("6a4d94320430dfcddda3748a")).toBe("6a4d94…748a");
  });

  it("never alters the underlying value it's given, only what's returned for display", () => {
    const original = "6a4d94320430dfcddda3748a";
    truncateOrderNumber(original);
    expect(original).toBe("6a4d94320430dfcddda3748a");
  });
});
