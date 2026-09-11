import React, { useState, useEffect } from "react";
import {
  Mail,
  Inbox,
  Send,
  AlertOctagon,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightSm,
  Settings,
  FileEdit,
  Folder,
  FolderOpen,
  Users,
  MoreVertical,
  Edit2,
  Trash,
} from "lucide-react";
import { api } from "../../utils/api";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function ModernSidebar({
  accounts = [],
  selectedAccount,
  selectedFolder,
  onAccountSelect,
  onFolderSelect,
  onAddAccount,        // now receives { groupId, groupName } before opening modal
  isCollapsed: externalCollapsed,
  onToggleCollapse,
  unreadRefreshKey,
  refreshKey,
  // NEW: group management
  accountGroups = [],          // [{ id, name, color }]
  onGroupsChange,              // callback to reload groups in parent
  selectedGroupId,             // which group is currently active
  onGroupSelect,               // (groupId) => void
}) {
  const [isCollapsed, setIsCollapsed] = useState(externalCollapsed || false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [accountsWithUnread, setAccountsWithUnread] = useState(accounts);
  // Tracks the latest unread counts fetched from API, keyed by account id
  const unreadMapRef = React.useRef({});

  // group management UI
  const [showGroupMenu, setShowGroupMenu] = useState(null); // groupId
  const [editingGroup, setEditingGroup] = useState(null);   // { id, name }
  const [editGroupName, setEditGroupName] = useState("");

  // Latest accounts, so a debounced fetch never uses a stale list.
  const accountsRef = React.useRef(accounts);
  accountsRef.current = accounts;
  const unreadTimerRef = React.useRef(null);
  // Drops responses from older requests that finish after a newer one.
  const unreadRequestIdRef = React.useRef(0);

  // ── Unread fetch ──────────────────────────────────────────────────────
  const fetchUnreadCounts = async (baseAccounts) => {
    const source = baseAccounts || accountsRef.current;

    if (!source.length) return;
    const requestId = ++unreadRequestIdRef.current;

    try {
      // ✅ ONE BULK REQUEST INSTEAD OF MANY
      const res = await api.post(
        `${API_BASE_URL}/api/inbox/accounts/unread-bulk`,
        {
          accountIds: source.map((a) => a.id),
        }
      );

      if (requestId !== unreadRequestIdRef.current) return; // superseded
      const unreadData = res.data?.data || {};

      const updatedMap = {};

      source.forEach((account) => {
        updatedMap[account.id] = unreadData[account.id] || 0;
      });

      unreadMapRef.current = updatedMap;

      // Merge fresh counts into the accounts we're actually rendering.
      setAccountsWithUnread((prev) =>
        prev.map((a) => ({
          ...a,
          unreadCount: updatedMap[a.id] !== undefined ? updatedMap[a.id] : a.unreadCount || 0,
        }))
      );

    } catch (err) {
      console.error("Unread fetch failed:", err);
    }
  };

  useEffect(() => {
    if (accounts.length > 0) {
      // Merge incoming accounts with already-known unread counts so we
      // never flash stale (or zero) counts when the parent re-renders.
      const merged = accounts.map((a) => ({
        ...a,
        unreadCount:
          unreadMapRef.current[a.id] !== undefined
            ? unreadMapRef.current[a.id]
            : a.unreadCount || 0,
      }));
      setAccountsWithUnread(merged);
      // Then re-fetch fresh counts in the background
      scheduleUnreadFetch();
    } else {
      setAccountsWithUnread([]);
    }
  }, [accounts]);

  // One debounced fetch for any burst of triggers. Previously a single
  // action could fire 2–3 identical POST /unread-bulk requests (accounts
  // changed + unreadRefreshKey + refreshKey, all in the same tick).
  function scheduleUnreadFetch() {
    if (unreadTimerRef.current) clearTimeout(unreadTimerRef.current);
    unreadTimerRef.current = setTimeout(() => fetchUnreadCounts(), 300);
  }

  const isFirstKeyRunRef = React.useRef(true);
  useEffect(() => {
    // Skip mount: the [accounts] effect above already covers the first load.
    if (isFirstKeyRunRef.current) {
      isFirstKeyRunRef.current = false;
      return;
    }
    scheduleUnreadFetch();
  }, [unreadRefreshKey, refreshKey]);

  useEffect(() => () => clearTimeout(unreadTimerRef.current), []);

  useEffect(() => {
    if (externalCollapsed !== undefined) setIsCollapsed(externalCollapsed);
  }, [externalCollapsed]);

  // ── Helpers ───────────────────────────────────────────────────────────
  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    if (onToggleCollapse) onToggleCollapse(next);
  };

  const toggleGroup = (groupId) => {
    const isNowExpanded = !expandedGroups[groupId];
    setExpandedGroups((prev) => ({ ...prev, [groupId]: isNowExpanded }));
    if (onGroupSelect) onGroupSelect(groupId);

    // Auto-select the first account in this group when it expands
    if (isNowExpanded) {
      const groupAccs = accounts.filter((a) => String(a.groupId) === String(groupId));
      if (groupAccs.length > 0 && onAccountSelect) {
        onAccountSelect(groupAccs[0]);
        setExpandedAccounts((prev) => ({ ...prev, [groupAccs[0].id]: true }));
      }
    }
  };

  const toggleAccount = (accountId) => {
    setExpandedAccounts((prev) => ({ ...prev, [accountId]: !prev[accountId] }));
  };

  const folders = [
    { id: "inbox", label: "Inbox",  icon: Inbox,        color: "text-sky-600" },
    { id: "sent",  label: "Sent",   icon: Send,          color: "text-teal-600"   },
    { id: "spam",  label: "Spam",   icon: AlertOctagon,  color: "text-orange-600" },
    { id: "draft", label: "Drafts", icon: FileEdit,      color: "text-blue-600"   },
    { id: "trash", label: "Trash",  icon: Trash2,        color: "text-red-600"    },
  ];

  // Group → accounts map
  const ungroupedAccounts = accountsWithUnread.filter(
    (a) => !a.groupId || !accountGroups.find((g) => String(g.id) === String(a.groupId))
  );

  // When a group is selected, show only that group + ungrouped accounts.
  // When no group is selected, show everything.
  // Normalize IDs to strings so number/string mismatches never cause empty results.
  const visibleGroups = selectedGroupId
    ? accountGroups.filter((g) => String(g.id) === String(selectedGroupId))
    : accountGroups;

  // Ungrouped accounts appear in all views (they belong to no group)
  const showUngrouped = ungroupedAccounts.length > 0;

  const getGroupAccounts = (groupId) =>
    accountsWithUnread.filter((a) => String(a.groupId) === String(groupId));

  const getGroupUnread = (groupId) =>
    getGroupAccounts(groupId).reduce((sum, a) => sum + (a.unreadCount || 0), 0);

const renameInFlightRef = React.useRef(false);

const handleDeleteGroup = async (groupId) => {
  const group = accountGroups.find((g) => String(g.id) === String(groupId));
  const groupAccounts = accounts.filter((a) => String(a.groupId) === String(groupId));
  const accountCount = groupAccounts.length;

  const confirmMsg = accountCount > 0
    ? `Delete "${group?.name}"?\n\nThis will permanently delete the group AND all ${accountCount} account(s) inside it, along with all their emails and data.\n\nThis cannot be undone.`
    : `Delete "${group?.name}"? This group is empty and will be permanently removed.`;

  if (!window.confirm(confirmMsg)) return;

  try {
    await api.delete(`${API_BASE_URL}/api/account-groups/${groupId}`);
    if (onGroupsChange) onGroupsChange();
  } catch (err) {
    console.error("Failed to delete group:", err);
    const serverMsg = err?.response?.data?.error;
    alert(serverMsg ? `Failed to delete group: ${serverMsg}` : "Failed to delete group. Please try again.");
  }
  setShowGroupMenu(null);
};

const handleRenameGroup = async (groupId) => {
  const trimmed = editGroupName.trim();
  if (!trimmed || renameInFlightRef.current) {
    setEditingGroup(null);
    setEditGroupName("");
    return;
  }

  renameInFlightRef.current = true;
  try {
    await api.patch(`${API_BASE_URL}/api/account-groups/${groupId}`, {
      name: trimmed,
    });
    if (onGroupsChange) onGroupsChange();
  } catch (err) {
    console.error("Failed to rename group:", err);
    const serverMsg = err?.response?.data?.error;
    alert(serverMsg ? `Failed to rename group: ${serverMsg}` : "Failed to rename group. Please try again.");
  } finally {
    renameInFlightRef.current = false;
    setEditingGroup(null);
    setEditGroupName("");
  }
};

  // ── Render helpers ────────────────────────────────────────────────────
  // These are plain functions called as renderAccountRow(account), NOT
  // components used as <AccountRow />. A component declared inside another
  // component is a brand-new type on every render, so React unmounted and
  // rebuilt all 30–50 account rows each time the sidebar re-rendered (e.g.
  // whenever unread counts arrived).
  const renderAccountRow = (account) => {
    const isExpanded = expandedAccounts[account.id];

    return (
      <div key={account.id} className="mb-0.5">
        {/* Account header */}
        <button
          onClick={() => toggleAccount(account.id)}
          className={`w-full px-3 py-2 flex items-center justify-between rounded-lg transition-all ${
            selectedAccount?.id === account.id
              ? "bg-gradient-to-r from-sky-50 to-teal-50 border-l-4 border-sky-500"
              : "hover:bg-sky-50/60"
          }`}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative w-7 h-7 flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-600 rounded-full blur opacity-40" />
              <div className="relative w-7 h-7 bg-gradient-to-br from-sky-600 to-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm">
                {account.email.charAt(0).toUpperCase()}
              </div>
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{account.email}</p>
              {account.unreadCount > 0 && (
                <p className="text-[10px] text-sky-600 font-bold">{account.unreadCount} unread</p>
              )}
            </div>
          </div>
          <ChevronDown
            className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Folders */}
        {isExpanded && (
          <div className="ml-6 mt-0.5 space-y-0.5 pb-1">
            {folders.map((folder) => {
              const Icon = folder.icon;
              const isSelected =
                selectedAccount?.id === account.id && selectedFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    onAccountSelect(account);
                    onFolderSelect(folder.id);
                  }}
                  className={`w-full px-3 py-1.5 flex items-center gap-2 rounded-md transition-all ${
                    isSelected
                      ? "bg-gradient-to-r from-sky-100 to-teal-100 border-l-2 border-sky-500"
                      : "hover:bg-sky-50/70"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-sky-600" : folder.color}`} />
                  <span className={`text-xs ${isSelected ? "text-sky-700 font-bold" : "text-slate-600 font-medium"}`}>
                    {folder.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderGroupRow = (group) => {
    const groupAccounts = getGroupAccounts(group.id);
    const totalUnread = groupAccounts.reduce((sum, a) => sum + (a.unreadCount || 0), 0);
    const isExpanded = expandedGroups[group.id];
    const isEditing = editingGroup?.id === group.id;

    return (
      <div key={group.id} className="mb-1">
        {/* Group header */}
        <div className="relative flex items-center group/grow">
          <button
            onClick={() => toggleGroup(group.id)}
            className={`flex-1 px-3 py-2.5 flex items-center gap-2.5 rounded-lg transition-all ${
              selectedGroupId === group.id
                ? "bg-gradient-to-r from-sky-100 to-teal-100"
                : "hover:bg-gradient-to-r hover:from-sky-50 hover:to-teal-50"
            }`}
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: group.color || "#10b981", opacity: 0.9 }}
            >
              {isExpanded
                ? <FolderOpen className="w-3.5 h-3.5 text-white" />
                : <Folder className="w-3.5 h-3.5 text-white" />
              }
            </div>

           {isEditing ? (
            <input
              autoFocus
              value={editGroupName}
              onChange={(e) => setEditGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur(); // funnel through onBlur so there's only one save path
                }
                if (e.key === "Escape") {
                  e.currentTarget.dataset.cancelled = "true";
                  setEditingGroup(null);
                  setEditGroupName("");
                }
              }}
              onBlur={(e) => {
                if (e.currentTarget.dataset.cancelled === "true") return;
                handleRenameGroup(group.id);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-sm font-semibold text-slate-800 bg-transparent border-b border-sky-400 outline-none"
            />
          ) : (
            <span className="flex-1 text-sm font-semibold text-slate-800 text-left truncate">
              {group.name}
            </span>
          )}

            <div className="flex items-center gap-1.5">
              {totalUnread > 0 && (
                <span className="px-1.5 py-0.5 bg-sky-500 text-white text-[10px] font-bold rounded-full">
                  {totalUnread}
                </span>
              )}
              <span className="text-[10px] text-slate-400 font-medium">
                {groupAccounts.length}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              />
            </div>
          </button>

          {/* Group context menu */}
          <div className="absolute right-1 opacity-0 group-hover/grow:opacity-100 transition-opacity flex items-center">
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowGroupMenu(showGroupMenu === group.id ? null : group.id);
                }}
                className="p-1 hover:bg-slate-200 rounded"
              >
                <MoreVertical className="w-3 h-3 text-slate-500" />
              </button>
              {showGroupMenu === group.id && (
                <div className="absolute right-0 top-6 w-36 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingGroup(group);
                      setEditGroupName(group.name);
                      setShowGroupMenu(null);
                    }}
                    className="w-full px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Edit2 className="w-3 h-3" /> Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAccount({ groupId: group.id, groupName: group.name });
                      setShowGroupMenu(null);
                    }}
                    className="w-full px-3 py-2 text-xs text-sky-700 hover:bg-sky-50 flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3" /> Add Account
                  </button>
                  <hr className="my-1 border-slate-100" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(group.id);
                    }}
                    className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <Trash className="w-3 h-3" /> Delete Group
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Accounts inside group */}
        {isExpanded && (
          <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-sky-100 pl-2">
            {groupAccounts.length === 0 ? (
              <div className="px-3 py-3 text-center">
                <p className="text-xs text-slate-400 mb-2">No accounts yet</p>
                <button
                  onClick={() => onAddAccount({ groupId: group.id, groupName: group.name })}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1 mx-auto"
                >
                  <Plus className="w-3 h-3" /> Add first account
                </button>
              </div>
            ) : (
              groupAccounts.map((account) => renderAccountRow(account))
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────
  return (
    <div
      className={`bg-white/80 backdrop-blur-xl border-r border-sky-200/50 flex flex-col transition-all duration-300 shadow-sm ${
        isCollapsed ? "w-16" : "w-72"
      }`}
      onClick={() => setShowGroupMenu(null)}
    >
      {/* Header */}
      <div className="p-3 border-b border-sky-200/50 flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-600 rounded-lg blur opacity-50" />
              <div className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-sky-600 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/30">
                <Mail className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <span className="font-bold text-sm bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
              Mail
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          {!isCollapsed && (
            <button
              onClick={() => onAddAccount(null)}   // null = show group picker first
              className="px-2.5 py-1.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 text-white rounded-md text-xs font-bold flex items-center gap-1 transition-all shadow-sm hover:shadow-lg shadow-sky-500/30"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
          <button
            onClick={toggleCollapse}
            className="p-1.5 hover:bg-sky-50 rounded-lg transition-colors"
          >
            {isCollapsed
              ? <ChevronRight className="w-4 h-4 text-sky-600" />
              : <ChevronLeft  className="w-4 h-4 text-sky-600" />}
          </button>
        </div>
      </div>

      {/* ── Expanded view ─────────────────────────────────────────── */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {/* Groups */}
          {visibleGroups.map((group) => renderGroupRow(group))}

          {/* Ungrouped accounts — always shown as they belong to no group */}
          {showUngrouped && (
            <div className="mt-2">
              {accountGroups.length > 0 && (
                <div className="px-3 py-1 flex items-center gap-2">
                  <div className="flex-1 h-px bg-slate-100" />
                  <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                    Ungrouped
                  </span>
                  <div className="flex-1 h-px bg-slate-100" />
                </div>
              )}
              {ungroupedAccounts.map((account) => renderAccountRow(account))}
            </div>
          )}

          {/* Empty state */}
          {visibleGroups.length === 0 && ungroupedAccounts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-12 h-12 bg-sky-50 rounded-xl flex items-center justify-center mb-3">
                <Folder className="w-6 h-6 text-sky-400" />
              </div>
              <p className="text-sm font-semibold text-slate-600 mb-1">No accounts yet</p>
              <p className="text-xs text-slate-400 mb-4">Create a group and add email accounts to get started.</p>
              <button
                onClick={() => onAddAccount(null)}
                className="px-3 py-2 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Account
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Collapsed view ────────────────────────────────────────── */}
      {isCollapsed && (
        <div className="flex-1 flex flex-col items-center py-4 space-y-3">
          {accountGroups.slice(0, 6).map((group) => {
            const unread = getGroupUnread(group.id);
            return (
              <button
                key={group.id}
                onClick={() => {
                  setIsCollapsed(false);
                  if (onToggleCollapse) onToggleCollapse(false);
                  toggleGroup(group.id);
                }}
                className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                style={{ backgroundColor: group.color || "#10b981" }}
                title={group.name}
              >
                <Folder className="w-4 h-4 text-white" />
                 
              </button>
            );
          })}
          <button
            onClick={() => onAddAccount(null)}
            className="w-9 h-9 rounded-lg bg-sky-100 hover:bg-sky-200 flex items-center justify-center transition-all"
            title="Add Account"
          >
            <Plus className="w-4 h-4 text-sky-600" />
          </button>
        </div>
      )}
    </div>
  );
}