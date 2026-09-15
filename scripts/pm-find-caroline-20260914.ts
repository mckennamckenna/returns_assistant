import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const byEmail = await prisma.user.findMany({
    where: { email: { contains: "caroline", mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  console.log("by email:", byEmail.map((u) => ({ id: u.id, name: u.name, emailPrefix: u.email.slice(0, 3) + "***" })));
  const totalUsers = await prisma.user.count();
  console.log("total users:", totalUsers);
}
main().finally(() => prisma.$disconnect());
