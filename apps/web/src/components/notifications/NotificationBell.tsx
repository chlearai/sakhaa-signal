"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface NotificationItem {
  id: string;
  workspaceId: string | null;
  userId: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  metadata: any;
  createdAt: string;
}

const TYPE_CONFIG: Record<string, { label: string; colorClass: string; iconBg: string }> = {
  TASK_ASSIGNED: { label: "Task Assigned", colorClass: "text-[#7C70F6] border-[#7C70F6]/30 bg-[#7C70F6]/10", iconBg: "bg-[#7C70F6]" },
  TASK_OVERDUE: { label: "Overdue Alert", colorClass: "text-[#F2786C] border-[#F2786C]/30 bg-[#F2786C]/10", iconBg: "bg-[#F2786C]" },
  BLOCKER_FLAGGED: { label: "Blocker Flagged", colorClass: "text-[#E8B84B] border-[#E8B84B]/30 bg-[#E8B84B]/10", iconBg: "bg-[#E8B84B]" },
  BLOCKER_ESCALATED: { label: "Blocker Escalated", colorClass: "text-[#DC2626] border-[#DC2626]/30 bg-[#DC2626]/10", iconBg: "bg-[#DC2626]" },
  MONTH_PLANNING_ALERT: { label: "Month Planning", colorClass: "text-[#5FC6DD] border-[#5FC6DD]/30 bg-[#5FC6DD]/10", iconBg: "bg-[#5FC6DD]" },
  JOB_COMPLETED: { label: "Job Completed", colorClass: "text-[#5BD08C] border-[#5BD08C]/30 bg-[#5BD08C]/10", iconBg: "bg-[#5BD08C]" },
  JOB_FAILED: { label: "Job Failed", colorClass: "text-[#F2786C] border-[#F2786C]/30 bg-[#F2786C]/10", iconBg: "bg-[#F2786C]" },
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "UNREAD">("ALL");
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
        );
        setUnreadCount(0);
      }
    } catch (err) {
      console.error("Failed to mark all notifications read:", err);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, read: true }),
        });
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        console.error("Failed to mark notification read:", err);
      }
    }

    setIsOpen(false);
    const actionUrl = item.metadata?.actionUrl;
    if (actionUrl) {
      router.push(actionUrl);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "UNREAD") return !n.readAt;
    return true;
  });

  return (
    <div className="relative" ref={popoverRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-md border border-[#2E2B26] bg-[#121110] text-[#B4B0A7] hover:text-white hover:border-[#46433C] transition-colors flex items-center justify-center"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#7C70F6] text-white text-[10px] font-mono font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-[0_0_8px_rgba(124,112,246,0.6)] animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Popover Feed Drawer */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-[#121110] border border-[#2E2B26] rounded-xl shadow-[0_16px_40px_-8px_rgba(0,0,0,0.8)] z-[100] overflow-hidden flex flex-col max-h-[500px]">
          {/* Header */}
          <div className="p-3.5 border-b border-[#2E2B26] bg-[#1A1815] flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#F3F2EF]">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-mono font-bold bg-[#7C70F6]/15 text-[#7C70F6] rounded-full border border-[#7C70F6]/30">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs font-mono text-[#7C70F6] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex border-b border-[#2E2B26] bg-[#0E0D0C] text-xs font-mono">
            <button
              onClick={() => setFilter("ALL")}
              className={`flex-1 py-2 text-center border-b-2 transition-colors ${
                filter === "ALL" ? "border-[#7C70F6] text-white font-semibold" : "border-transparent text-[#8A867C] hover:text-white"
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              onClick={() => setFilter("UNREAD")}
              className={`flex-1 py-2 text-center border-b-2 transition-colors ${
                filter === "UNREAD" ? "border-[#7C70F6] text-white font-semibold" : "border-transparent text-[#8A867C] hover:text-white"
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#2E2B26]/60 custom-scrollbar">
            {loading ? (
              <div className="p-6 text-center text-xs font-mono text-[#8A867C]">Loading notifications…</div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8A867C] space-y-1">
                <p className="font-semibold text-[#B4B0A7]">No notifications</p>
                <p>You&apos;re all caught up!</p>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const config = TYPE_CONFIG[item.type] || {
                  label: item.type,
                  colorClass: "text-[#7C70F6] border-[#7C70F6]/30 bg-[#7C70F6]/10",
                  iconBg: "bg-[#7C70F6]",
                };
                const isUnread = !item.readAt;

                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`p-3.5 flex gap-3 items-start cursor-pointer transition-colors ${
                      isUnread ? "bg-[#1A1815]/90 hover:bg-[#201D19]" : "hover:bg-[#161513] opacity-80"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${isUnread ? "bg-[#7C70F6] shadow-[0_0_6px_#7C70F6]" : "bg-transparent"}`} />

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex justify-between items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wider ${config.colorClass}`}>
                          {config.label}
                        </span>
                        <span className="text-[10px] font-mono text-[#8A867C] shrink-0">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      <h4 className={`text-xs font-semibold truncate ${isUnread ? "text-[#F3F2EF]" : "text-[#D4D1CA]"}`}>
                        {item.title}
                      </h4>
                      <p className="text-xs text-[#8A867C] line-clamp-2 leading-relaxed">
                        {item.body}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Link to Settings */}
          <div className="p-2.5 border-t border-[#2E2B26] bg-[#0E0D0C] text-center">
            <Link
              href="/profile"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-mono text-[#8A867C] hover:text-white transition-colors"
            >
              Configure Notification Preferences &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
