import { describe, it, expect } from "vitest";
import { escapeHtml, htmlLink, wrapEmailHtml } from "../lib/emailHtml";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("H&M")).toBe("H&amp;M");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes double and single quotes", () => {
    expect(escapeHtml(`say "hi" it's fine`)).toBe("say &quot;hi&quot; it&#39;s fine");
  });

  it("leaves an already-safe string unchanged", () => {
    expect(escapeHtml("Proenza Schouler")).toBe("Proenza Schouler");
  });

  it("escapes ampersand before other entities (no double-escaping)", () => {
    // If '&' were escaped after '<', "&lt;" would itself get re-escaped into
    // "&amp;lt;" — this guards the replace order.
    expect(escapeHtml("<")).toBe("&lt;");
  });
});

describe("htmlLink", () => {
  it("renders an anchor with the given href and escaped text", () => {
    const link = htmlLink("https://app.myreturnwindow.com/orders/order_1", "View order details");
    expect(link).toBe(
      '<a href="https://app.myreturnwindow.com/orders/order_1" style="color:#1d4ed8;text-decoration:underline;">View order details</a>',
    );
  });

  it("escapes HTML-unsafe characters in the link text, not the href", () => {
    const link = htmlLink("https://app.myreturnwindow.com/orders/order_1", "H&M's order");
    expect(link).toContain("H&amp;M&#39;s order");
    expect(link).toContain('href="https://app.myreturnwindow.com/orders/order_1"');
  });

  it("never renders the raw href as visible text — only the short copy is visible", () => {
    const link = htmlLink("https://app.myreturnwindow.com/action/archive?token=abc.def", "Archive this order");
    // The URL only ever appears inside href="...", never as the element's text content.
    const visibleText = link.replace(/<a[^>]*>/, "").replace("</a>", "");
    expect(visibleText).toBe("Archive this order");
  });
});

describe("wrapEmailHtml", () => {
  it("wraps the given body HTML in a full HTML document with the Return Window header", () => {
    const html = wrapEmailHtml("<p>hello</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Return Window");
    expect(html).toContain("<p>hello</p>");
  });
});
