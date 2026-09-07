// Read-only classification of a 20-message sample of self_outbound_loop
// DiscardLog rows (2026-09-04 through 2026-09-06), matched to Postmark
// inbound messages by closest timestamp (<=15s). Replays the real
// classifyForwardType()/detectSelfOutboundLoop() functions against each
// message's actual headers to see which detection branch fired, and
// classifies each as a genuine self-outbound loop vs. a legitimate
// Gmail-forwarded commerce email caught by the over-broad fallback.
// No DB writes, no model calls. Part of the 2026-09-07 guard-tradeoff
// diagnostic (TASKS.md 🔴 Now).
import fs from "fs";
import { classifyForwardType } from "../../lib/forwardResolver";
import { detectSelfOutboundLoop, isOwnDomain } from "../../lib/selfOutboundGuard";
import { extractDomain } from "../../lib/foodGroceryExclusion";

const dir = "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/sample20";
const sample = JSON.parse(
  fs.readFileSync(
    "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/sample20.json",
    "utf8",
  ),
);

let genuineLoop = 0;
let misfire = 0;
let ambiguous = 0;

for (const entry of sample) {
  const payload = JSON.parse(fs.readFileSync(`${dir}/${entry.messageId}.json`, "utf8"));
  const forwardType = classifyForwardType(payload.Headers);
  const detection = detectSelfOutboundLoop({
    fromEmail: payload.FromFull?.Email,
    headers: payload.Headers,
    forwardType,
  });
  const fromDomain = extractDomain(payload.FromFull?.Email ?? "");
  const fromIsOwn = isOwnDomain(fromDomain);

  let classification: string;
  if (fromIsOwn) {
    classification = "GENUINE_LOOP";
    genuineLoop++;
  } else if (detection.reason === "header_chain_auto_forward") {
    classification = "MISFIRE";
    misfire++;
  } else {
    classification = "AMBIGUOUS";
    ambiguous++;
  }

  console.log(
    `[${classification}] discardAt=${entry.discardAt} diff=${entry.diff.toFixed(1)}s from=${payload.FromFull?.Email} subject="${payload.Subject}" reason=${detection.reason} forwardType=${forwardType}`,
  );
}

console.log("\n=== Totals (n=20 sample) ===");
console.log({ genuineLoop, misfire, ambiguous });
