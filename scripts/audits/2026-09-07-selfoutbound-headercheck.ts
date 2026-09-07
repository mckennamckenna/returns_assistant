// Read-only replay of classifyForwardType + detectSelfOutboundLoop against
// real Postmark header payloads for the three Gap #1RYJR48 emails, to test
// whether the self-outbound-loop guard could explain the missing 3rd email.
// No DB writes, no network calls beyond reading local JSON files already
// fetched from Postmark. Part of the 2026-09-07 diagnostic (TASKS.md 🔴 Now).
import fs from "fs";
import { classifyForwardType } from "../../lib/forwardResolver";
import { detectSelfOutboundLoop } from "../../lib/selfOutboundGuard";

const files = [
  ["403fd9fd (in DB, order_confirmation)", "403fd9fd-8d96-4a0a-b048-4d4fbbd08e00.json"],
  ["f967ec9f (in DB, shipping_confirmation)", "f967ec9f-c61a-4c07-a9ef-ebef2d0044f0.json"],
  ["3242e727 (MISSING from DB — Gap 3rd email)", "3242e727-2da0-4bba-b1ef-1f3bce4b3117.json"],
  ["f3410ac9 (MISSING from DB — eBay order confirmation)", "f3410ac9-a5e5-4ef7-ba55-e46391134d15.json"],
  ["6a606aff (MISSING from DB — eBay order update)", "6a606aff-49f6-4af1-97d3-97cf49b13a00.json"],
] as const;

const dir = "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad";

for (const [label, file] of files) {
  const payload = JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8"));
  const forwardType = classifyForwardType(payload.Headers);
  const detection = detectSelfOutboundLoop({
    fromEmail: payload.FromFull?.Email,
    headers: payload.Headers,
    forwardType,
  });
  console.log(label, "-> forwardType:", forwardType, "| selfOutboundDetection:", detection);
}
