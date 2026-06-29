// html-to-text v10 ships no bundled types and DefinitelyTyped's
// @types/html-to-text only covers the pre-v10 option shape (no `selectors`
// API) — this declares just the surface lib/runExtraction.ts actually uses.
declare module "html-to-text" {
  interface HtmlToTextSelector {
    selector: string;
    format?: string;
    options?: Record<string, unknown>;
  }

  interface HtmlToTextOptions {
    selectors?: HtmlToTextSelector[];
  }

  export function convert(html: string, options?: HtmlToTextOptions): string;
}
