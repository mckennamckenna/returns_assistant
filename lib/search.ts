// Thin wrapper around the Serper API (https://serper.dev) — used only by
// the alpha weekly-url-review cron to find return-policy/return-initiation
// candidate URLs. Not related to Anthropic's web_search tool used elsewhere
// (lib/extract.ts's lookupReturnPolicy) — separate provider, separate cost,
// separate call site, deliberately not consolidated in this pass.
const SERPER_URL = "https://google.serper.dev/search";

export interface SerperResult {
  title: string;
  url: string;
  snippet: string;
}

interface SerperApiOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerperApiResponse {
  organic?: SerperApiOrganicResult[];
}

// One retry on 429 with a fixed backoff — this job runs weekly against a
// bounded order backlog, not a high-throughput path, so a simple fixed
// delay is enough; no need for exponential backoff/jitter here.
const RATE_LIMIT_BACKOFF_MS = 2000;

export async function searchWeb(query: string): Promise<SerperResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY not configured");
  }

  const response = await performSearchRequest(query, apiKey);

  if (response.status === 429) {
    console.warn(`Serper rate-limited on query "${query}" — retrying once after backoff`);
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS));
    const retryResponse = await performSearchRequest(query, apiKey);
    return parseSerperResponse(retryResponse, query);
  }

  return parseSerperResponse(response, query);
}

function performSearchRequest(query: string, apiKey: string): Promise<Response> {
  return fetch(SERPER_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query }),
  });
}

async function parseSerperResponse(response: Response, query: string): Promise<SerperResult[]> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Serper request failed (${response.status}) for query "${query}": ${text}`);
  }

  const data = (await response.json()) as SerperApiResponse;
  return (data.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
  }));
}
