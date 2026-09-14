/**
 * GroupSelectModal.jsx
 *
 * Shown BEFORE the AddEmailAccount modal.
 * The user either picks an existing group or creates a new one.
 * On confirm → parent opens AddEmailAccount with { groupId, groupName, ... }.
 *
 * FULL GROUPS (8/8)
 *   A full group is still selectable and still openable. AddEmailAccount is
 *   also the "manage this group" screen: it lists the group's accounts, lets
 *   the user delete one, and keeps its own Add button disabled while the
 *   group is at GROUP_ACCOUNT_LIMIT. So the correct behaviour here is to let
 *   the user through, clearly labelled ("Open & Manage"), rather than
 *   blocking the click — blocking it left users with no way to free a slot.
 *   The 9th account is prevented in AddEmailAccount (button disabled) and,
 *   authoritatively, by POST /api/accounts on the backend.
 */

import React, { useState } from "react";
import {
  Folder,
  Plus,
  X,
  Check,
  AlertTriangle,
  Settings2,
} from "lucide-react";
import { api } from "../../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Must match TOTAL_ACCOUNT_LIMIT / GROUP_ACCOUNT_LIMIT in
// routes/inbox/accounts.js on the backend.
const TOTAL_ACCOUNT_LIMIT = 50;
const GROUP_ACCOUNT_LIMIT = 8;

const GROUP_COLORS = [
  "#10b981", // emerald
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
];

export default function GroupSelectModal({
  groups = [],
  onConfirm,
  onClose,
  onGroupsChange,
  totalAccountCount = 0, // total accounts across all groups, for the top progress bar
}) {
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [isCreating, setIsCreating] = useState(groups.length === 0);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalRemaining = Math.max(TOTAL_ACCOUNT_LIMIT - totalAccountCount, 0);
  const totalPct = Math.min(100, Math.round((totalAccountCount / TOTAL_ACCOUNT_LIMIT) * 100));
  const totalAtLimit = totalAccountCount >= TOTAL_ACCOUNT_LIMIT;

  // ── Per-group helpers ────────────────────────────────────────
  const countOf = (g) => g?.accountCount ?? 0;
  const limitOf = (g) => g?.accountLimit ?? GROUP_ACCOUNT_LIMIT;
  const isFull = (g) => countOf(g) >= limitOf(g);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || null;
  const selectedIsFull = selectedGroup ? isFull(selectedGroup) : false;

  // Full groups are selectable now — opening one is how the user gets to the
  // screen where accounts can be removed.
  const handleSelectExisting = (group) => {
    setError("");
    setSelectedGroupId(group.id);
    setIsCreating(false);
  };

  const handleCreateAndProceed = async () => {
    if (totalAtLimit) {
      setError(`You've reached the ${TOTAL_ACCOUNT_LIMIT}-account limit. Remove an account before adding another.`);
      return;
    }
    if (!newGroupName.trim()) {
      setError("Please enter a group name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await api.post(`${API_BASE_URL}/api/account-groups`, {
        name: newGroupName.trim(),
        color: newGroupColor,
      });
      const created = res.data?.data;
      if (onGroupsChange) await onGroupsChange();
      onConfirm({
        groupId: created.id,
        groupName: created.name,
        accountCount: 0,
        accountLimit: GROUP_ACCOUNT_LIMIT,
        isFull: false,
      });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create group.");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAndProceed = () => {
    const group = groups.find((g) => g.id === selectedGroupId);
    if (!group) {
      setError("Please select a group.");
      return;
    }

    // NOTE: deliberately not blocked on `isFull(group)` or `totalAtLimit`.
    // Opening an existing group is a management action, not an add. The add
    // itself is blocked downstream (AddEmailAccount's submit button) and on
    // the server. Blocking here would trap a user at 8/8 or 50/50 with no
    // route to remove an account.
    onConfirm({
      groupId: group.id,
      groupName: group.name,
      accountCount: countOf(group),
      accountLimit: limitOf(group),
      isFull: isFull(group),
    });
  };

  // ── Footer button state ──────────────────────────────────────
  const primaryDisabled =
    saving || (isCreating ? !newGroupName.trim() || totalAtLimit : !selectedGroupId);

  const primaryLabel = saving
    ? "Creating…"
    : isCreating
    ? totalAtLimit
      ? "Limit Reached"
      : "Create & Continue"
    : selectedIsFull
    ? "Open & Manage →"
    : "Continue →";

  const primaryClasses = selectedIsFull && !isCreating
    ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-500/30"
    : "bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 shadow-sky-500/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-600 to-blue-600 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Choose a Group</h2>
            <p className="text-sky-100 text-sm mt-0.5">
              Organise your email account into a group
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Total account usage across all groups */}
        <div className="px-6 pt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Mail Accounts
            </span>
            <span className={`text-xs font-semibold ${totalAtLimit ? "text-red-600" : "text-slate-500"}`}>
              {totalAccountCount} / {TOTAL_ACCOUNT_LIMIT} used
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                totalAtLimit ? "bg-red-500" : totalPct >= 80 ? "bg-amber-500" : "bg-sky-500"
              }`}
              style={{ width: `${totalPct}%` }}
            />
          </div>
          <p className={`text-[11px] mt-1 ${totalAtLimit ? "text-red-600 font-medium" : "text-slate-400"}`}>
            {totalAtLimit
              ? "Account limit reached — open a group below to remove an account."
              : `${totalRemaining} account${totalRemaining === 1 ? "" : "s"} remaining`}
          </p>
        </div>

        <div className="p-6">
          {/* Existing groups */}
          {groups.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Existing Groups
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {groups.map((group) => {
                  const count = countOf(group);
                  const limit = limitOf(group);
                  const full = count >= limit;
                  const pct = Math.min(100, Math.round((count / limit) * 100));
                  const isSelected = selectedGroupId === group.id && !isCreating;

                  return (
                    <button
                      key={group.id}
                      onClick={() => handleSelectExisting(group)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                        isSelected
                          ? full
                            ? "border-amber-400 bg-amber-50"
                            : "border-sky-500 bg-sky-50"
                          : full
                          ? "border-slate-100 bg-white hover:border-amber-300 hover:bg-amber-50/50"
                          : "border-slate-100 hover:border-sky-200 hover:bg-slate-50"
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: group.color || "#10b981" }}
                      >
                        <Folder className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 text-sm truncate">
                            {group.name}
                          </span>
                          {full && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 flex-shrink-0">
                              Full {count}/{limit}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
                            <div
                              className={`h-full rounded-full ${full ? "bg-red-400" : "bg-sky-400"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-[11px] ${full ? "text-red-500 font-medium" : "text-slate-400"}`}>
                            {count}/{limit}
                          </span>
                          {full && (
                            <span className="text-[11px] text-amber-600 font-medium flex items-center gap-0.5">
                              <Settings2 className="w-3 h-3" />
                              Manage
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <Check
                          className={`w-4 h-4 flex-shrink-0 ${full ? "text-amber-600" : "text-sky-600"}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => { setIsCreating(true); setSelectedGroupId(null); setError(""); }}
                className="mt-3 w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all text-sm text-slate-500 hover:text-sky-600"
              >
                <Plus className="w-4 h-4" />
                Create new group instead
              </button>
            </div>
          )}

          {/* Full-group notice — explains what "Open & Manage" will and won't do */}
          {selectedIsFull && !isCreating && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  "{selectedGroup.name}" is full ({countOf(selectedGroup)}/{limitOf(selectedGroup)})
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  You can open it to view and remove accounts, but a new account can't be added
                  until a slot frees up. Remove one and the group goes to{" "}
                  {limitOf(selectedGroup) - 1}/{limitOf(selectedGroup)} — then you can add again.
                </p>
              </div>
            </div>
          )}

          {/* Create new group form */}
          {isCreating && (
            <div className={`${groups.length > 0 ? "border-t border-slate-100 pt-5" : ""}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {groups.length === 0 ? "Create Your First Group" : "New Group"}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Group Name
                  </label>
                  <input
                    autoFocus
                    type="text"
                    placeholder='e.g. "Sales Team", "Marketing", "Personal"'
                    value={newGroupName}
                    onChange={(e) => { setNewGroupName(e.target.value); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateAndProceed()}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Group Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewGroupColor(color)}
                        className={`w-7 h-7 rounded-full transition-all ${
                          newGroupColor === color
                            ? "ring-2 ring-offset-2 ring-slate-400 scale-110"
                            : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={primaryDisabled}
            onClick={isCreating ? handleCreateAndProceed : handleSelectAndProceed}
            className={`flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow-lg disabled:opacity-50 ${primaryClasses}`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}