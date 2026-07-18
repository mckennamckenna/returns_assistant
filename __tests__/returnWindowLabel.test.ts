import { describe, it, expect } from "vitest";
import { returnWindowFromLabel } from "../lib/returnWindowLabel";

describe("returnWindowFromLabel", () => {
  it("reads 'from order date' for a confirmed order_date anchor, unchanged", () => {
    expect(returnWindowFromLabel("order_date")).toBe("from order date");
  });

  it("reads 'from delivery date' for a confirmed delivery_date anchor, unchanged", () => {
    expect(returnWindowFromLabel("delivery_date")).toBe("from delivery date");
  });

  it("hedges with '(est.)' for a null/unknown anchor", () => {
    expect(returnWindowFromLabel(null)).toBe("from purchase (est.)");
  });
});
