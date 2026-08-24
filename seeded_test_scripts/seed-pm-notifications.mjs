import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../packages/db/generated/client/index.js";

// Parse environment variables from candidates (.env, apps/web/.env, apps/api/.env)
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

async function runPmNotificationSeed() {
  console.log("[SEED] Starting notification seed script for pm@agency.com...\n");

  const pmEmail = "pm@agency.com";
  const pmEmailAlt = "pm@agency";

  // 1. Ensure or find default workspace
  let workspace = await prisma.workspace.findFirst({ where: { status: "ACTIVE" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "Agency PM Studio",
        slug: `agency-pm-studio-${Date.now()}`,
      },
    });
  }

  // 2. Target emails to seed notifications for
  const targetEmails = [pmEmail, pmEmailAlt];

  for (const email of targetEmails) {
    let users = await prisma.user.findMany({ where: { email } });

    if (users.length === 0) {
      const createdUser = await prisma.user.create({
        data: {
          email,
          displayName: "Project Manager (Agency)",
        },
      });
      users = [createdUser];
      console.log(`  + Created user record for ${email} (ID: ${createdUser.id})`);
    }

    for (const user of users) {
      console.log(`  ✓ Seeding notifications for user record ${email} (ID: ${user.id})`);

      // Ensure membership exists
      const membership = await prisma.membership.findFirst({
        where: { userId: user.id, workspaceId: workspace.id },
      });
      if (!membership) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            workspaceId: workspace.id,
            role: "CLIENT_MANAGER",
          },
        });
      }

      // 3. Unopened notification payloads
      const notificationsToSeed = [
        {
          type: "TASK_ASSIGNED",
          title: "New Creative Analysis Task Assigned",
          body: "You have been assigned as Project Manager for the Q3 Meta Video Creative Test.",
          metadata: { taskId: "task-assigned-101", priority: "HIGH" },
        },
        {
          type: "TASK_OVERDUE",
          title: "Task Processing Overdue Alert",
          body: "Analysis job 'Summer Launch 9:16 Video' has exceeded the 30-minute SLA.",
          metadata: { jobId: "job-overdue-999" },
        },
        {
          type: "BLOCKER_ESCALATED",
          title: "Blocker Escalated: GPU Worker Capacity",
          body: "GPU execution queue delay escalated to Project Manager for review.",
          metadata: { blockerId: "blocker-777", severity: "CRITICAL" },
        },
      ];

      for (const item of notificationsToSeed) {
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
              workspaceId: workspace.id,
              type: item.type,
              title: item.title,
              body: item.body,
              readAt: null, // Unopened / unread notification
              metadata: item.metadata,
            },
          });
          console.log(`    ✓ Created unopened notification: [${item.type}] ${item.title}`);
        } else {
          await prisma.notification.update({
            where: { id: existing.id },
            data: { readAt: null },
          });
          console.log(`    ✓ Reset to unopened (readAt = null): [${item.type}] ${item.title}`);
        }
      }
    }
  }

  console.log("\n[SEED COMPLETE] Seeded unopened notifications for pm@agency.com and pm@agency.");
}

runPmNotificationSeed()
  .catch((err) => {
    console.error("[SEED ERROR]", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
