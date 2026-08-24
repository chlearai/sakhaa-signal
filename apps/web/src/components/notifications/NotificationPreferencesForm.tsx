"use client";

import React, { useState, useEffect } from "react";

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_OVERDUE"
  | "BLOCKER_FLAGGED"
  | "BLOCKER_ESCALATED"
  | "MONTH_PLANNING_ALERT"
  | "JOB_COMPLETED"
  | "JOB_FAILED";

interface NotificationTypeMeta {
  key: NotificationType;
  label: string;
  desc: string;
}

const NOTIFICATION_TYPES: NotificationTypeMeta[] = [
  { key: "TASK_ASSIGNED", label: "Task Assigned", desc: "When a new job or task is assigned to you" },
  { key: "TASK_OVERDUE", label: "Task Overdue", desc: "When a task or job execution exceeds the expected window" },
  { key: "BLOCKER_FLAGGED", label: "Blocker Flagged", desc: "When a high-priority issue or execution blocker is flagged" },
  { key: "BLOCKER_ESCALATED", label: "Blocker Escalated", desc: "When a blocker is escalated to workspace management" },
  { key: "MONTH_PLANNING_ALERT", label: "Month Planning Alert", desc: "Monthly milestone alert to review testing goals & quotas" },
  { key: "JOB_COMPLETED", label: "Job Completed", desc: "When creative analysis finishes successfully" },
  { key: "JOB_FAILED", label: "Job Failed", desc: "When analysis processing encounters an execution error" },
];

export default function NotificationPreferencesForm() {
  const [preferences, setPreferences] = useState<{
    inApp: Record<string, boolean>;
    email: Record<string, boolean>;
  }>({
    inApp: {},
    email: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function loadPreferences() {
      try {
        const res = await fetch("/api/notifications/preferences");
        if (res.ok) {
          const data = await res.json();
          setPreferences(data.preferences || { inApp: {}, email: {} });
        }
      } catch (err) {
        console.error("Failed to load notification preferences:", err);
      } finally {
        setLoading(false);
      }
    }
    loadPreferences();
  }, []);

  const handleToggle = (channel: "inApp" | "email", key: NotificationType) => {
    setPreferences((prev) => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        [key]: !prev[channel]?.[key],
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg("");
    setSaved(false);

    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });

      if (res.ok) {
        const data = await res.json();
        setPreferences(data.preferences);
        setSaved(true);
        setTimeout(() => setSaved(false), 4000);
      } else {
        const err = await res.json();
        setErrorMsg(err.error || "Failed to save preferences.");
      }
    } catch {
      setErrorMsg("Network error saving notification preferences.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-xl bg-[#121110] border border-[#2E2B26] text-center text-xs font-mono text-[#8A867C] animate-pulse">
        Loading notification channel preferences…
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl bg-[#121110] border border-[#2E2B26] space-y-6">
      <div className="flex justify-between items-center border-b border-[#2E2B26] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[#F3F2EF]">Notification Preferences Matrix</h2>
          <p className="text-xs text-[#8A867C] mt-0.5">Control which event categories trigger In-App and Email alerts.</p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-mono font-semibold rounded-md bg-[#7C70F6] text-white hover:bg-[#6557F5] disabled:opacity-50 transition-all"
        >
          {saving ? "Saving…" : "Save Preferences"}
        </button>
      </div>

      {saved && (
        <div className="p-3 rounded-lg bg-[#5BD08C]/10 border border-[#5BD08C]/30 text-[#5BD08C] text-xs font-mono">
          ✓ Notification preferences saved successfully.
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-[#F2786C]/10 border border-[#F2786C]/30 text-[#F2786C] text-xs font-mono">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Preferences Matrix Table */}
      <div className="border border-[#2E2B26] rounded-lg overflow-hidden divide-y divide-[#2E2B26]">
        <div className="p-3 bg-[#1A1815] grid grid-cols-12 text-xs font-mono text-[#8A867C] font-semibold">
          <div className="col-span-8">NOTIFICATION EVENT TYPE</div>
          <div className="col-span-2 text-center">IN-APP</div>
          <div className="col-span-2 text-center">EMAIL</div>
        </div>

        {NOTIFICATION_TYPES.map(({ key, label, desc }) => {
          const inAppActive = preferences.inApp?.[key] !== false;
          const emailActive = preferences.email?.[key] !== false;

          return (
            <div key={key} className="p-3.5 grid grid-cols-12 items-center hover:bg-[#161513] transition-colors">
              <div className="col-span-8 pr-2">
                <p className="text-sm font-semibold text-[#F3F2EF]">{label}</p>
                <p className="text-xs text-[#8A867C]">{desc}</p>
              </div>

              <div className="col-span-2 flex justify-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inAppActive}
                    onChange={() => handleToggle("inApp", key)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2E2B26] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#7C70F6]"></div>
                </label>
              </div>

              <div className="col-span-2 flex justify-center">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={emailActive}
                    onChange={() => handleToggle("email", key)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2E2B26] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#7C70F6]"></div>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
