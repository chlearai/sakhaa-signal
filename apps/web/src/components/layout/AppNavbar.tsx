"use client";

import React from "react";
import Link from "next/link";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import UserProfileMenu from "./UserProfileMenu";
import HamburgerMenu from "./HamburgerMenu";
import NotificationBell from "../notifications/NotificationBell";

export default function AppNavbar({
  user,
  workspace,
}: {
  user?: any;
  workspace?: any;
}) {
  return (
    <header className="border-b border-[#2E2B26] py-3 px-6 md:px-12 flex justify-between items-center bg-[#1A1815]/95 z-[60] sticky top-0 backdrop-blur-md h-[61px]">
      {/* Left side: Logo & Title */}
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-7 h-10 rounded border border-[#46433C] flex items-center justify-center relative shrink-0 bg-[#0C0B02] overflow-hidden">
            <span className="text-[10px] font-mono text-[#8A867C] leading-none">9:16</span>
            <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-[#FF6B3D] absolute right-0.5 top-0.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-[#F3F2EF]">Sakhaa Signal</span>
              <span className="text-xs text-[#7C70F6] font-mono bg-[#7C70F6]/10 px-1.5 py-0.5 rounded border border-[#7C70F6]/30">v2.0</span>
            </div>
            <p className="text-xs text-[#8A867C] tracking-wide font-mono">Neuromarketing Studio</p>
          </div>
        </Link>

        {/* Navigation items */}
        <nav className="hidden lg:flex items-center gap-4 text-sm font-medium text-[#B4B0A7]">
          <Link href="/dashboard" className="hover:text-white transition-colors px-2 py-1">
            Dashboard
          </Link>
          <Link href="/settings/billing" className="hover:text-white transition-colors px-2 py-1">
            Usage & Credits
          </Link>
          <Link href="/settings/members" className="hover:text-white transition-colors px-2 py-1">
            Team
          </Link>
        </nav>
      </div>

      {/* Right side: Workspace Switcher, Notification Bell, User Profile Menu & Hamburger Drawer */}
      <div className="flex items-center gap-3 md:gap-4">
        <WorkspaceSwitcher currentWorkspace={workspace} />
        <NotificationBell />
        <UserProfileMenu user={user} />
        <HamburgerMenu user={user} workspace={workspace} />
      </div>
    </header>
  );
}
