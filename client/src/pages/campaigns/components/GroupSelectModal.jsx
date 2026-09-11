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

export default function GroupSelectModal({ groups = [], onConfirm, onClose, onGroupsChange }) {
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [isCreating, setIsCreating] = useState(groups.length === 0);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSelectExisting = (group) => {
    setSelectedGroupId(group.id);
    setIsCreating(false);
  };

  const handleCreateAndProceed = async () => {
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

        <div className="p-6">
          {/* Existing groups */}
          {groups.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Existing Groups
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => handleSelectExisting(group)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                      selectedGroupId === group.id && !isCreating
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
                    <span className="font-semibold text-slate-800 text-sm flex-1 text-left">
                      {group.name}
                    </span>
                    {selectedGroupId === group.id && !isCreating && (
                      <Check className="w-4 h-4 text-sky-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
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
            disabled={saving || (isCreating ? !newGroupName.trim() : !selectedGroupId)}
            onClick={isCreating ? handleCreateAndProceed : handleSelectAndProceed}
            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow-lg shadow-sky-500/30 disabled:opacity-50"
          >
            {saving ? "Creating…" : isCreating ? "Create & Continue" : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}