import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAuthenticatedSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { user, workspace: ws } = await getAuthenticatedSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || 30), 100);
    const unreadOnly = searchParams.get("unread") === "true";

    // Resolve all matching user IDs for the logged-in email/user
    const userEmails = user.email ? [user.email, user.email.split("@")[0]] : [];
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { id: user.id },
          ...(userEmails.length > 0 ? [{ email: { in: userEmails } }] : []),
        ],
      },
      select: { id: true },
    });
    const userIds = matchingUsers.length > 0 ? matchingUsers.map((u) => u.id) : [user.id];

    const whereClause: any = {
      userId: { in: userIds },
    };
    if (ws?.id) {
      whereClause.OR = [
        { workspaceId: ws.id },
        { workspaceId: null }
      ];
    }
    if (unreadOnly) {
      whereClause.readAt = null;
    }

    const [notifications, totalCount, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({
        where: {
          ...whereClause,
          readAt: null,
        },
      }),
    ]);

    return NextResponse.json({
      notifications,
      totalCount,
      unreadCount,
    });
  } catch (error: any) {
    console.error("[GET_NOTIFICATIONS_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications", details: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getAuthenticatedSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Bulk mark all read
    if (body.action === "mark_all_read") {
      const now = new Date();
      const result = await prisma.notification.updateMany({
        where: {
          userId: user.id,
          readAt: null,
        },
        data: {
          readAt: now,
        },
      });

      return NextResponse.json({
        success: true,
        markedCount: result.count,
        readAt: now.toISOString(),
      });
    }

    // Toggle single notification read status
    const { id, read } = body;
    if (!id) {
      return NextResponse.json({ error: "Notification ID is required" }, { status: 400 });
    }

    const notification = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notification || notification.userId !== user.id) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        readAt: read === false ? null : new Date(),
      },
    });

    // Get updated unread count
    const unreadCount = await prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null,
      },
    });

    return NextResponse.json({
      notification: updated,
      unreadCount,
    });
  } catch (error: any) {
    console.error("[PATCH_NOTIFICATIONS_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to update notification", details: error.message },
      { status: 500 }
    );
  }
}
