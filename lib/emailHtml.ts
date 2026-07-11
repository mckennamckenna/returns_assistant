// Shared helpers for building the HTML half of an email. Every outbound
// email sends both TextBody and HtmlBody (lib/postmark.ts) — HTML never
// replaces the plain-text version, it's additive, for clients that render it.
//
// Any dynamic string that reaches these helpers may originate from a
// retailer's email (AI-extracted retailer name, order number, item name) —
// not attacker-controlled in the traditional sense, but not ours either.
// escapeHtml() must wrap every such value before it's interpolated into
// markup, or a stray "&"/"<" silently breaks the rendered email. Links built
// from buildActionLink()/APP_URL are exempt — they're constructed entirely
// from our own code (a cuid orderId, a base64url token), never from
// retailer-supplied text, so there's nothing there that needs escaping.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A short, readable anchor — text is escaped, href is trusted (see module
// comment above).
export function htmlLink(href: string, text: string): string {
  return `<a href="${href}" style="color:#1d4ed8;text-decoration:underline;">${escapeHtml(text)}</a>`;
}

// Minimal inline-styled wrapper. Email clients don't reliably support
// external or even <head>-embedded <style> blocks, so every style here is
// inline on the element itself. Deliberately plain — this is a transactional
// email, not a marketing one, so it borrows the dashboard's stone/blue
// palette loosely rather than fully reproducing the app's design system.
export function wrapEmailHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#44403c;">
    <div style="max-width:480px;margin:0 auto;">
      <div style="font-size:18px;font-weight:600;color:#292524;margin-bottom:16px;">Return Window</div>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}
