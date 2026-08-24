import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../packages/db/generated/client/index.js";

// Load apps/web/.env if DATABASE_URL is not set in process.env
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

const ROLE_ASSIGNMENTS = [
  {
    id: "a1111111-1111-4111-a111-111111111111",
    email: "akshaiofficial97@gmail.com",
    displayName: "Akshai Admin",
    role: "OWNER",
    isPlatformAdmin: true,
  },
  {
    id: "a2222222-2222-4222-a222-222222222222",
    email: "akshairofficial@gmail.com",
    displayName: "Akshai Workspace Admin",
    role: "ADMIN",
    isPlatformAdmin: false,
  },
  {
    id: "a3333333-3333-4333-a333-333333333333",
    email: "roxx.akshai@gmail.com",
    displayName: "Akshai Client Manager",
    role: "CLIENT_MANAGER",
    isPlatformAdmin: false,
  },
  {
    id: "a4444444-4444-4444-a444-444444444444",
    email: "akshaiindia97@gmail.com",
    displayName: "Akshai Reviewer",
    role: "REVIEWER",
    isPlatformAdmin: false,
  },
  {
    id: "a5555555-5555-4555-a555-555555555555",
    email: "pm@agency.com",
    displayName: "Agency Project Manager",
    role: "CLIENT_MANAGER",
    isPlatformAdmin: false,
  },
  {
    id: "a6666666-6666-4666-a666-666666666666",
    email: "pm@agency",
    displayName: "Agency PM Short",
    role: "CLIENT_MANAGER",
    isPlatformAdmin: false,
  },
];

async function main() {
  console.log("Seeding Sakhaa Signal User Roles & Platform Admins...\n");

  // Ensure default workspace
  let workspace = await prisma.workspace.findFirst({
    where: { status: "ACTIVE" },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        id: "d0000000-0000-4000-a000-000000000000",
        name: "Sakhaa Main Studio Workspace",
        slug: "sakhaa-main-studio",
      },
    });
    console.log(`Created default workspace: ${workspace.name} (${workspace.id})\n`);
  }

  for (const item of ROLE_ASSIGNMENTS) {
    // 1. Upsert User
    const user = await prisma.user.upsert({
      where: { id: item.id },
      update: {
        email: item.email,
        displayName: item.displayName,
      },
      create: {
        id: item.id,
        email: item.email,
        displayName: item.displayName,
      },
    });

    // 2. Upsert Membership in default workspace
    await prisma.membership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id,
        },
      },
      update: {
        role: item.role,
      },
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        role: item.role,
      },
    });

    // 3. Upsert PlatformAdmin if applicable
    if (item.isPlatformAdmin) {
      await prisma.platformAdmin.upsert({
        where: { userId: user.id },
        update: { role: "SUPER_ADMIN", status: "ACTIVE" },
        create: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE" },
      });
      console.log(`✓ [ASSIGNED] ${item.email}\n  └─ Workspace Membership: ${item.role}\n  └─ PlatformAdmin: SUPER_ADMIN`);
    } else {
      console.log(`✓ [ASSIGNED] ${item.email}\n  └─ Workspace Membership: ${item.role}`);
    }
  }

  console.log("\nRole Seeding Successfully Completed!");
}

main()
  .catch((e) => {
    console.error("Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
