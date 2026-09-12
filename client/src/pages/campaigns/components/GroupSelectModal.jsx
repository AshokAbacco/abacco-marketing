/**
 * GroupSelectModal.jsx
 *
 * Shown BEFORE the AddEmailAccount modal.
 * The user either picks an existing group or creates a new one.
 * On confirm → parent opens AddEmailAccount with { groupId, groupName }.
 */

import React, { useState } from "react";
import {
  Folder,
  Plus,
  X,
  Check,
  Palette,
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
  totalAccountCount = 0, // ✅ NEW: total accounts across all groups, for the top progress bar
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

  const handleSelectExisting = (group) => {
    // A group at its 8-account cap can't take a new account — keep it
    // visible (so the user knows it exists) but not selectable.
    if ((group.accountCount ?? 0) >= (group.accountLimit ?? GROUP_ACCOUNT_LIMIT)) {
      setError(`"${group.name}" is full (${GROUP_ACCOUNT_LIMIT}/${GROUP_ACCOUNT_LIMIT} accounts). Choose another group or create a new one.`);
      return;
    }
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
      onConfirm({ groupId: created.id, groupName: created.name });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create group.");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectAndProceed = () => {
    if (totalAtLimit) {
      setError(`You've reached the ${TOTAL_ACCOUNT_LIMIT}-account limit. Remove an account before adding another.`);
      return;
    }
    const group = groups.find((g) => g.id === selectedGroupId);
    if (!group) { setError("Please select a group."); return; }
    onConfirm({ groupId: group.id, groupName: group.name });
  };

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
              ? "Account limit reached — remove an account to add another."
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
                  const count = group.accountCount ?? 0;
                  const limit = group.accountLimit ?? GROUP_ACCOUNT_LIMIT;
                  const isFull = count >= limit;
                  const pct = Math.min(100, Math.round((count / limit) * 100));

                  return (
                    <button
                      key={group.id}
                      onClick={() => handleSelectExisting(group)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                        isFull
                          ? "border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed"
                          : selectedGroupId === group.id && !isCreating
                          ? "border-sky-500 bg-sky-50"
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
                          <span className="font-semibold text-slate-800 text-sm">
                            {group.name}
                          </span>
                          {isFull && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 flex-shrink-0">
                              Full
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
                            <div
                              className={`h-full rounded-full ${isFull ? "bg-red-400" : "bg-sky-400"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {count}/{limit}
                          </span>
                        </div>
                      </div>
                      {selectedGroupId === group.id && !isCreating && !isFull && (
                        <Check className="w-4 h-4 text-sky-600 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => { setIsCreating(true); setSelectedGroupId(null); }}
                className="mt-3 w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all text-sm text-slate-500 hover:text-sky-600"
              >
                <Plus className="w-4 h-4" />
                Create new group instead
              </button>
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
            disabled={saving || totalAtLimit || (isCreating ? !newGroupName.trim() : !selectedGroupId)}
            onClick={isCreating ? handleCreateAndProceed : handleSelectAndProceed}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow-lg shadow-sky-500/30 disabled:opacity-50"
          >
            {saving
              ? "Creating…"
              : totalAtLimit
              ? "Limit Reached"
              : isCreating
              ? "Create & Continue"
              : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}