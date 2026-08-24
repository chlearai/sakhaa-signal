import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../packages/db/generated/client/index.js";

// Load environment variables from apps/web/.env if needed
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), "apps/web/.env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
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

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding persistent unopened notifications for accounts...\n");

  const workspace = await prisma.workspace.findFirst({ where: { status: "ACTIVE" } });
  const workspaceId = workspace?.id || null;

  // Find target users or all users in database
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} registered users in database.`);

  const sampleNotifications = [
    {
      type: "TASK_ASSIGNED",
      title: "New Creative Analysis Task Assigned",
      body: "You have been assigned as Project Manager for the Q3 Meta Video Creative Test.",
      metadata: { taskId: "task-001", priority: "HIGH" },
    },
    {
      type: "TASK_OVERDUE",
      title: "Task Processing Overdue Alert",
      body: "Analysis job 'Summer Launch 9:16 Video' has exceeded the expected 30-minute window.",
      metadata: { jobId: "job-overdue-999" },
    },
    {
      type: "BLOCKER_ESCALATED",
      title: "Blocker Escalated: GPU Worker Capacity",
      body: "GPU execution queue delay escalated to Project Manager for review.",
      metadata: { blockerId: "blocker-777", severity: "CRITICAL" },
    },
  ];

  for (const user of users) {
    console.log(`\nSeeding notifications for user: ${user.email || user.id}`);

    for (const item of sampleNotifications) {
      // Check if exact notification already exists
      const existing = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          type: item.type,
          title: item.title,
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            userId: user.id,
            workspaceId,
            type: item.type,
            title: item.title,
            body: item.body,
            readAt: null, // Unopened notification
            metadata: item.metadata,
          },
        });
        console.log(`  ✓ Created unopened notification: [${item.type}] ${item.title}`);
      } else {
        // Ensure readAt is null (unopened)
        await prisma.notification.update({
          where: { id: existing.id },
          data: { readAt: null },
        });
        console.log(`  ✓ Updated existing notification to unopened (readAt = null): [${item.type}]`);
      }
    }
  }

  console.log("\nPersistent Notification Seeding Completed Successfully!");
}

main()
  .catch((e) => {
    console.error("Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
