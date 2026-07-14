import { describe, it, expect } from "vitest";
import { initialsFor } from "../app/RetailerAvatar";

describe("initialsFor", () => {
  it("skips a leading non-alphanumeric character in a parenthetical second word", () => {
    expect(initialsFor("On (On-Running)")).toBe("OO");
  });

  it("handles a hyphenated all-caps brand name", () => {
    expect(initialsFor("NET-A-PORTER")).toBe("NE");
  });

  it("handles a two-word name with a capitalized surname-style second word", () => {
    expect(initialsFor("Chan Luu")).toBe("CL");
  });

  it("handles a single-word name", () => {
    expect(initialsFor("Nordstrom")).toBe("NO");
  });

  it("handles an all-lowercase name", () => {
    expect(initialsFor("mango")).toBe("MA");
  });

  it("handles an all-lowercase two-word name", () => {
    expect(initialsFor("tea collection")).toBe("TC");
  });

  it("falls back to ? for an empty or whitespace-only name", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });

  it("still produces a two-letter initial for the standard two-word case", () => {
    expect(initialsFor("Old Navy")).toBe("ON");
  });
});
