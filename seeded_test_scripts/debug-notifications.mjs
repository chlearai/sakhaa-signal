import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../packages/db/generated/client/index.js";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/web/.env"),
  path.resolve(process.cwd(), "apps/api/.env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...vals] = trimmed.split("=");
        const val = vals.join("=").replace(/^["']|["']$/g, "").trim();
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    }
  }
}

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const prisma = new PrismaClient();

async function debug() {
  console.log("===============================================");
  console.log("DATABASE DIAGNOSTIC REPORT FOR NOTIFICATIONS");
  console.log("===============================================\n");

  const users = await prisma.user.findMany({
    select: { id: true, email: true, displayName: true },
  });

  console.log(`FOUND ${users.length} USERS IN DATABASE:`);
  for (const u of users) {
    const count = await prisma.notification.count({ where: { userId: u.id } });
    const unreadCount = await prisma.notification.count({ where: { userId: u.id, readAt: null } });
    console.log(`- User ID: ${u.id} | Email: ${u.email || "(no email)"} | Name: ${u.displayName || "(none)"}`);
    console.log(`  └─ Total Notifications: ${count} | Unread Notifications: ${unreadCount}`);
  }

  console.log("\n-----------------------------------------------");
  const allNotifications = await prisma.notification.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  console.log(`RECENT NOTIFICATIONS IN DATABASE (${allNotifications.length} TOTAL):`);
  for (const n of allNotifications) {
    console.log(`- Notif ID: ${n.id} | User ID: ${n.userId} | Type: ${n.type} | Unread: ${n.readAt === null} | Title: "${n.title}"`);
  }
  console.log("===============================================");
}

debug()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
