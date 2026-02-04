import React, { useState, useEffect } from "react";
import {
  Mail,
  Inbox,
  Send,
  AlertOctagon, 
  Trash2,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
  Settings,
} from "lucide-react";

export default function ModernSidebar({
  accounts = [],
  selectedAccount,
  selectedFolder,
  onAccountSelect,
  onFolderSelect,
  onAddAccount,
  isCollapsed: externalCollapsed,
  onToggleCollapse,
}) {
  const [isCollapsed, setIsCollapsed] = useState(externalCollapsed || false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState({});

  useEffect(() => {
    if (externalCollapsed !== undefined) {
      setIsCollapsed(externalCollapsed);
    }
  }, [externalCollapsed]);

  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (onToggleCollapse) {
      onToggleCollapse(newState);
    }
  };

  const toggleAccountExpanded = (accountId) => {
    setExpandedAccounts((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  const folders = [
    { id: "inbox", label: "Inbox", icon: Inbox, color: "text-emerald-600" },
    { id: "sent", label: "Sent", icon: Send, color: "text-teal-600" },
    { id: "spam", label: "Spam", icon: AlertOctagon, color: "text-orange-600" },
    { id: "trash", label: "Trash", icon: Trash2, color: "text-red-600" },
  ];

  const filteredAccounts = accounts.filter((acc) =>
    acc.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      className={`bg-white/80 backdrop-blur-xl border-r border-emerald-200/50 flex flex-col transition-all duration-300 shadow-sm ${
        isCollapsed ? "w-16" : "w-80"
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-emerald-200/50 flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg blur opacity-50"></div>
              <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <Mail className="w-4 h-4 text-white" />
              </div>
            </div>
            <span className="font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">Mail</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Add Account Button in Header */}
          {!isCollapsed && (
            <button
              onClick={onAddAccount}
              className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-md text-xs font-bold flex items-center gap-1 transition-all shadow-sm hover:shadow-lg shadow-emerald-500/30 transform hover:scale-105"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          )}

          {/* Collapse button */}
          <button
            onClick={toggleCollapse}
            className="p-2 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 rounded-lg transition-colors"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-emerald-600" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-emerald-600" />
            )}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Accounts & Folders */}
          <div className="flex-1 overflow-y-auto">
            {filteredAccounts.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                No accounts found
              </div>
            ) : (
              <div className="py-2">
                {filteredAccounts.map((account) => (
                  <div key={account.id} className="mb-1">
                    {/* Account Header */}
                    <button
                      onClick={() => toggleAccountExpanded(account.id)}
                      className={`w-full px-4 py-2 flex items-center justify-between hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 transition-all ${
                        selectedAccount?.id === account.id ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-emerald-600" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="relative w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur opacity-50"></div>
                          <div className="relative w-8 h-8 bg-gradient-to-br from-emerald-600 to-green-600 rounded-full flex items-center justify-center shadow-md shadow-emerald-500/30">
                            {account.email.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div className="text-left flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {account.email}
                          </p>
                          {account.unreadCount > 0 && (
                            <p className="text-xs text-emerald-600 font-bold">
                              {account.unreadCount} unread
                            </p>
                          )}
                        </div>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-emerald-400 transition-transform ${
                          expandedAccounts[account.id] ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Folders for this account */}
                    {expandedAccounts[account.id] && (
                      <div className="ml-4 mt-1 space-y-1">
                        {folders.map((folder) => {
                          const Icon = folder.icon;
                          const isSelected =
                            selectedAccount?.id === account.id &&
                            selectedFolder === folder.id;
                          return (
                            <button
                              key={folder.id}
                              onClick={() => {
                                onAccountSelect(account);
                                onFolderSelect(folder.id);
                              }}
                              className={`w-full px-4 py-2 flex items-center gap-3 rounded-lg transition-all ${
                                isSelected
                                  ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-emerald-600 shadow-sm"
                                  : "hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-teal-50/50"
                              }`}
                            >
                              <Icon
                                className={`w-4 h-4 ${
                                  isSelected ? "text-emerald-600" : folder.color
                                }`}
                              />
                              <span
                                className={`text-sm ${
                                  isSelected
                                    ? "text-emerald-700 font-bold"
                                    : "text-slate-700 font-medium"
                                }`}
                              >
                                {folder.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Collapsed View - Just Icons */}
      {isCollapsed && (
        <div className="flex-1 flex flex-col items-center py-4 space-y-4">
          {accounts.slice(0, 5).map((account) => (
            <button
              key={account.id}
              onClick={() => {
                onAccountSelect(account);
                setIsCollapsed(false);
              }}
              className={`relative w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all ${
                selectedAccount?.id === account.id
                  ? "ring-2 ring-emerald-600 ring-offset-2"
                  : "hover:ring-2 hover:ring-emerald-300"
              }`}
              title={account.email}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur opacity-50"></div>
              <div className={`relative w-10 h-10 rounded-full flex items-center justify-center shadow-md ${
                selectedAccount?.id === account.id 
                  ? "bg-gradient-to-br from-emerald-600 to-green-600 shadow-emerald-500/50" 
                  : "bg-gradient-to-br from-slate-400 to-slate-500"
              }`}>
                {account.email.charAt(0).toUpperCase()}
              </div>
              {account.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                  {account.unreadCount > 9 ? "9+" : account.unreadCount}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={onAddAccount}
            className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 hover:from-emerald-200 hover:to-teal-200 flex items-center justify-center transition-all shadow-sm hover:shadow-md transform hover:scale-105"
            title="Add Account"
          >
            <Plus className="w-5 h-5 text-emerald-600" />
          </button>
        </div>
      )}
    </div>
  );
}