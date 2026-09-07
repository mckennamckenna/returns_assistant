// Read-only verification of the 2026-09-07 selfOutboundGuard fix: replays
// the REAL, deployed detectSelfOutboundLoop() (not a hypothetical stand-in)
// against the 87 cached Postmark payloads from the guard-tradeoff
// diagnostic, using the real production sending addresses. No DB writes, no
// model calls, no new network calls.
import fs from "fs";
process.env.REMINDER_FROM_EMAIL = "reminders@myreturnwindow.com";
process.env.LOGIN_FROM_EMAIL = "hello@myreturnwindow.com";

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
let genuineLoopCaught = 0;
let genuineLoopMissed = 0;
let misfireStillFires = 0;
let misfireFixed = 0;

for (const entry of pool) {
  if (seen.has(entry.messageId)) continue;
  seen.add(entry.messageId);
  const file = `${dir}/${entry.messageId}.json`;
  if (!fs.existsSync(file)) continue;
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const forwardType = classifyForwardType(payload.Headers);
  const fromDomain = extractDomain(payload.FromFull?.Email ?? "");
  const isGenuineLoop = isOwnDomain(fromDomain);
  const detection = detectSelfOutboundLoop({ fromEmail: payload.FromFull?.Email, headers: payload.Headers, forwardType });

  if (isGenuineLoop) {
    if (detection.isSelfOutbound) genuineLoopCaught++;
    else genuineLoopMissed++;
  } else {
    if (detection.isSelfOutbound) misfireStillFires++;
    else misfireFixed++;
  }
}

console.log({ totalUnique: seen.size, genuineLoopCaught, genuineLoopMissed, misfireStillFires, misfireFixed });
