import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "crypto";

const prisma = new PrismaClient();

function decrypt(text) {
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length !== 3) return text;
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(authTag);
  const dec = Buffer.concat([cipher.update(Buffer.from(cipherHex, "hex")), cipher.final()]);
  return dec.toString("utf8");
}

async function main() {
  const email = await prisma.email.findFirst({
    where: { subject: { contains: "Scotch Long Lasting", mode: "insensitive" } },
    select: { id: true, subject: true, receivedAt: true, rawJson: true, textBody: true },
  });
  if (!email) { console.log("not found"); return; }

  const raw = JSON.parse(decrypt(email.rawJson));
  console.log("Top-level rawJson keys:", Object.keys(raw));
  console.log("Date field:", raw.Date);
  console.log("HeaderKeys:", raw.Headers?.map(h => h.Name));
  const dateHeader = raw.Headers?.find(h => h.Name.toLowerCase() === "date");
  console.log("Date header value:", dateHeader?.Value);

  const tb = decrypt(email.textBody);
  console.log("\n--- textBody first 600 chars ---");
  console.log(tb?.slice(0, 600));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
