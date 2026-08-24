import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import crypto from "node:crypto";
import prisma from "./db";
import { setWorkspaceContext, withUserDatabaseContext } from "./db-context";

export type SessionResolutionError =
  | "AUTH_CONFIGURATION_ERROR"
  | "AUTH_SESSION_INVALID"
  | "AUTH_PROVIDER_UNAVAILABLE"
  | "WORKSPACE_RESOLUTION_FAILED";

function authErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") return { name: "UnknownError" };
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
    clientVersion?: unknown;
  };
  return {
    name: typeof candidate.name === "string" ? candidate.name : "UnknownError",
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : undefined,
    clientVersion:
      typeof candidate.clientVersion === "string" ? candidate.clientVersion : undefined,
  };
}

const EMAIL_ROLE_MAPPING: Record<
  string,
  { role: "OWNER" | "ADMIN" | "CLIENT_MANAGER" | "REVIEWER"; isPlatformAdmin: boolean }
> = {
  "akshaiofficial97@gmail.com": { role: "OWNER", isPlatformAdmin: true },
  "akshairofficial@gmail.com": { role: "ADMIN", isPlatformAdmin: false },
  "roxx.akshai@gmail.com": { role: "CLIENT_MANAGER", isPlatformAdmin: false },
  "akshaiindia97@gmail.com": { role: "REVIEWER", isPlatformAdmin: false },
  "pm@agency.com": { role: "CLIENT_MANAGER", isPlatformAdmin: false },
  "pm@agency": { role: "CLIENT_MANAGER", isPlatformAdmin: false },
};

/**
 * Retrieves the current authenticated user and workspace session.
 * Wrapped with React cache() to eliminate duplicate Supabase Auth network roundtrips during Next.js rendering.
 */
const safeCache = cache;

export const getAuthenticatedSession = safeCache(async () => {
  const cookieStore = await cookies();
  const isDevBypassAllowed =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_BYPASS === "true";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[AUTH_CONFIGURATION_ERROR] Supabase server configuration is incomplete");
    return {
      user: null,
      workspace: null,
      sessionError: "AUTH_CONFIGURATION_ERROR" as SessionResolutionError,
    };
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      const metadata = authErrorMetadata(error);
      console.warn("[AUTH_SESSION_VALIDATION_ERROR]", metadata);
      const isInvalidSession =
        metadata.status === 400 || metadata.status === 401 || metadata.status === 403;
      if (!isDevBypassAllowed) {
        return {
          user: null,
          workspace: null,
          sessionError: (isInvalidSession
            ? "AUTH_SESSION_INVALID"
            : "AUTH_PROVIDER_UNAVAILABLE") as SessionResolutionError,
        };
      }
    }
    user = data.user;
  } catch (error) {
    console.error("[AUTH_PROVIDER_ERROR]", authErrorMetadata(error));
    if (!isDevBypassAllowed) {
      return {
        user: null,
        workspace: null,
        sessionError: "AUTH_PROVIDER_UNAVAILABLE" as SessionResolutionError,
      };
    }
  }

  // If unauthenticated and dev bypass is not enabled, return null session
  if (!user) {
    if (!isDevBypassAllowed) {
      return {
        user: null,
        workspace: null,
        sessionError: "AUTH_SESSION_INVALID" as SessionResolutionError,
      };
    }

    // Dev bypass only for local development testing when explicitly enabled
    const devUserId = "00000000-0000-4000-8000-000000000001";
    const devWorkspaceId = "00000000-0000-4000-8000-000000000002";

    await prisma.user.upsert({
      where: { id: devUserId },
      update: { email: "dev@local.internal", displayName: "Local Dev User" },
      create: {
        id: devUserId,
        email: "dev@local.internal",
        displayName: "Local Dev User",
      },
    });

    let ws = await prisma.workspace.findUnique({ where: { id: devWorkspaceId } });
    if (!ws) {
      ws = await prisma.workspace.create({
        data: {
          id: devWorkspaceId,
          name: "Local Dev Workspace",
          slug: "local-dev-workspace",
          memberships: {
            create: { userId: devUserId, role: "OWNER" },
          },
        },
      });
    } else {
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: devWorkspaceId, userId: devUserId } },
        update: { role: "OWNER", status: "ACTIVE" },
        create: { workspaceId: devWorkspaceId, userId: devUserId, role: "OWNER" },
      });
    }

    return {
      user: { id: devUserId, email: "dev@local.internal", isPlatformAdmin: true },
      workspace: ws,
      sessionError: null,
    };
  }

  let isPlatformAdmin = false;
  let ws: Awaited<ReturnType<typeof prisma.workspace.findFirst>> = null;
  let workspaceResolutionPhase = "INITIALIZING";

  try {
    const emailLower = user.email?.toLowerCase() || "";
    const roleConfig = EMAIL_ROLE_MAPPING[emailLower];
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const rawWorkspaceId = cookieStore.get("workspace-id")?.value;
    const workspaceId = rawWorkspaceId && UUID_REGEX.test(rawWorkspaceId) ? rawWorkspaceId : null;

    const resolved = await withUserDatabaseContext(user.id, workspaceId, async (tx) => {
      workspaceResolutionPhase = "SYNCING_USER";
      await tx.user.upsert({
        where: { id: user.id },
        update: {
          email: user.email || null,
          displayName: user.user_metadata?.full_name || user.email?.split("@")[0] || null,
        },
        create: {
            id: user.id,
            email: user.email || null,
            displayName: user.user_metadata?.full_name || user.email?.split("@")[0] || null,
        },
      });

      workspaceResolutionPhase = "RESOLVING_PLATFORM_ADMIN";
      let platformAdminRecord = await tx.platformAdmin.findUnique({ where: { userId: user.id } });
      if (roleConfig?.isPlatformAdmin) {
        platformAdminRecord = await tx.platformAdmin.upsert({
          where: { userId: user.id },
          update: { role: "SUPER_ADMIN", status: "ACTIVE" },
          create: { userId: user.id, role: "SUPER_ADMIN", status: "ACTIVE" },
        });
      }

      workspaceResolutionPhase = "RESOLVING_WORKSPACE_COOKIE";
      let workspace = workspaceId
        ? await tx.workspace.findFirst({
            where: {
              id: workspaceId,
              status: "ACTIVE",
              memberships: { some: { userId: user.id, status: "ACTIVE" } },
            },
          })
        : null;

      if (!workspace) {
        workspaceResolutionPhase = "RESOLVING_MEMBERSHIP";
        const membership = await tx.membership.findFirst({
          where: {
            userId: user.id,
            status: "ACTIVE",
            workspace: { status: "ACTIVE" },
          },
          include: { workspace: true },
        });
        workspace = membership?.workspace || null;
      }

      if (!workspace) {
        workspaceResolutionPhase = "LOCKING_WORKSPACE_PROVISIONING";
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;

        workspaceResolutionPhase = "RECHECKING_MEMBERSHIP";
        const membership = await tx.membership.findFirst({
          where: {
            userId: user.id,
            status: "ACTIVE",
            workspace: { status: "ACTIVE" },
          },
          include: { workspace: true },
        });
        workspace = membership?.workspace || null;
      }

      if (!workspace) {
        workspaceResolutionPhase = "PROVISIONING_WORKSPACE";
        const newWorkspaceId = crypto.randomUUID();
        await setWorkspaceContext(tx, newWorkspaceId);
        workspace = await tx.workspace.create({
          data: {
            id: newWorkspaceId,
            name: `${user.email?.split("@")[0] || "User"}'s Workspace`,
            slug: `ws-${user.id.substring(0, 8)}-${Date.now().toString(36)}`,
            memberships: {
              create: { userId: user.id, role: "OWNER" },
            },
          },
        });
      }

      return {
        workspace,
        isPlatformAdmin: !!platformAdminRecord || !!roleConfig?.isPlatformAdmin,
      };
    });

    ws = resolved.workspace;
    isPlatformAdmin = resolved.isPlatformAdmin;
  } catch (dbError) {
    console.error("[AUTH_DB_PROVISIONING_ERROR]", {
      phase: workspaceResolutionPhase,
      ...authErrorMetadata(dbError),
    });
  }

  const userPayload = {
    ...user,
    isPlatformAdmin,
  };

  return {
    user: userPayload,
    workspace: ws,
    sessionError: ws ? null : ("WORKSPACE_RESOLUTION_FAILED" as SessionResolutionError),
  };
});
