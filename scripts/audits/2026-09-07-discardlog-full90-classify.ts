// Read-only classification of the full pool of self_outbound_loop DiscardLog
// rows (2026-09-04–09-06) matched to a Postmark inbound message within 15s.
// Same method as 2026-09-07-discardlog-sample-classify.ts, run against the
// full matched pool (90 discard rows -> 87 unique messages) instead of a
// 20-item sample, since the sample came back 20/20 misfire and a fuller
// number was worth the extra (free) API reads. No DB writes, no model calls.
import fs from "fs";
import { classifyForwardType } from "../../lib/forwardResolver";
import { detectSelfOutboundLoop, isOwnDomain } from "../../lib/selfOutboundGuard";
import { extractDomain } from "../../lib/foodGroceryExclusion";

const dir = "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/full90";
const pool = JSON.parse(
  fs.readFileSync(
    "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/full90.json",
    "utf8",
  ),
);

const seen = new Set<string>();
let genuineLoop = 0;
let misfire = 0;
let ambiguous = 0;
let missing = 0;
const misfireSenders: Record<string, number> = {};

for (const entry of pool) {
  if (seen.has(entry.messageId)) continue;
  seen.add(entry.messageId);
  const file = `${dir}/${entry.messageId}.json`;
  if (!fs.existsSync(file)) {
    missing++;
    continue;
  }
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const forwardType = classifyForwardType(payload.Headers);
  const detection = detectSelfOutboundLoop({
    fromEmail: payload.FromFull?.Email,
    headers: payload.Headers,
    forwardType,
  });
  const fromDomain = extractDomain(payload.FromFull?.Email ?? "");
  const fromIsOwn = isOwnDomain(fromDomain);

  if (fromIsOwn) {
    genuineLoop++;
  } else if (detection.reason === "header_chain_auto_forward") {
    misfire++;
    misfireSenders[fromDomain] = (misfireSenders[fromDomain] ?? 0) + 1;
  } else {
    ambiguous++;
    console.log("AMBIGUOUS:", payload.FromFull?.Email, payload.Subject, detection);
  }
}

console.log("=== Unique messages classified:", seen.size, "(missing files:", missing, ") ===");
console.log({ genuineLoop, misfire, ambiguous });
console.log("\nMisfire sender domain distribution:");
console.log(
  Object.entries(misfireSenders)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${d}: ${n}`)
    .join("\n"),
);
