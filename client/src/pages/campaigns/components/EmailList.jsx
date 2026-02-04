import React, { useState, useEffect } from "react";
import { Mail, ChevronDown, ChevronUp, Users, Globe, Zap } from "lucide-react";
import { api } from "../../utils/api"; 

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function ConversationList({ 
  selectedAccount,
  selectedFolder,
  onConversationSelect,
  selectedConversation,
  filters = {},
  searchEmail = "",
  isScheduleMode = false,
  selectedConversations = [],
  setSelectedConversations,
  conversations,
  setConversations,
  activeView,
}) {
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");

  // ✅ DEBUG: Log when conversations change
  useEffect(() => {
    console.log(`📊 EmailList rendered with ${conversations.length} conversations`);
  }, [conversations]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }

    const sorted = [...conversations].sort((a, b) => {
      let compareA, compareB;

      switch (field) {
        case "date":
          compareA = new Date(a.lastDate);
          compareB = new Date(b.lastDate);
          break;
        case "sender":
          compareA = (a.primaryRecipient || a.initiatorEmail || "").toLowerCase();
          compareB = (b.primaryRecipient || b.initiatorEmail || "").toLowerCase();
          break;
        case "subject":
          compareA = (a.subject || "").toLowerCase();
          compareB = (b.subject || "").toLowerCase();
          break;
        default:
          return 0;
      }

      if (sortOrder === "asc") {
        return compareA > compareB ? 1 : -1;
      } else {
        return compareA < compareB ? 1 : -1;
      }
    });

    setConversations(sorted);
  };

  const toggleSelectConversation = (conversation) => {
    setSelectedConversations((prev) => {
      const exists = prev.some((c) => c.conversationId === conversation.conversationId);
      if (exists) {
        return prev.filter((c) => c.conversationId !== conversation.conversationId);
      }
      return [...prev, conversation];
    });
  };

  const formatDate = (date) => {
    const now = new Date();
    const messageDate = new Date(date);
    const diffMs = now - messageDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return messageDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return messageDate.toLocaleDateString([], { weekday: "short" });
    } else {
      return messageDate.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  const truncateText = (html, maxLength = 80) => {
    if (!html) return "";
    let cleanHtml = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "");
    const tmp = document.createElement("DIV");
    tmp.innerHTML = cleanHtml;
    let cleanText = tmp.textContent || tmp.innerText || "";
    cleanText = cleanText.replace(/\s+/g, " ").trim();
    return cleanText.length > maxLength ? cleanText.substring(0, maxLength) + "..." : cleanText;
  };

  const getAvatarLetter = (name) => {
    if (!name) return "?";
    const cleanName = name.replace(/^[^a-zA-Z0-9]+/, "");
    return cleanName.charAt(0).toUpperCase() || "?";
  };

  const handleConversationSelect = async (conversation) => {
    onConversationSelect(conversation);

    try {
      await api.patch(`${API_BASE_URL}/api/inbox/conversations/${conversation.conversationId}/read`);
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversation.conversationId ? { ...c, unreadCount: 0 } : c
        )
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  if (!selectedAccount || !selectedFolder) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p className="text-sm">Select an account and folder to view messages</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-sm border-r border-emerald-200/50">
      <div className="border-b border-emerald-200/50 px-4 py-3 flex items-center justify-between bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
        <h3 className="text-sm font-bold text-emerald-700">
          {conversations.length} Conversation{conversations.length !== 1 ? "s" : ""}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSort("date")}
            className={`text-xs px-3 py-1 rounded-lg font-medium transition-all ${
              sortBy === "date"
                ? "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200 shadow-sm"
                : "text-slate-600 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50"
            } flex items-center gap-1`}
          >
            Date
            {sortBy === "date" && (sortOrder === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
          </button>
          <button
            onClick={() => handleSort("sender")}
            className={`text-xs px-3 py-1 rounded-lg font-medium transition-all ${
              sortBy === "sender"
                ? "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200 shadow-sm"
                : "text-slate-600 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50"
            } flex items-center gap-1`}
          >
            {selectedFolder === "sent" ? "Recipient" : "Sender"}
            {sortBy === "sender" && (sortOrder === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-emerald-200/20 rounded-full blur-xl"></div>
              <Mail className="relative w-12 h-12 text-emerald-300" />
            </div>
            <p className="text-sm font-medium">No conversations found</p>
            {(searchEmail || Object.values(filters).some((v) => v && v !== "all" && v !== "")) && (
              <p className="text-xs mt-2 text-slate-400">Try adjusting your filters</p>
            )}
          </div>
        ) : (
          conversations.map((conversation) => {
            const conversationId = conversation.conversationId;
            const isSelected = selectedConversation?.conversationId === conversationId;
            const clientEmail = conversation.displayName?.trim() ? conversation.displayName : conversation.displayEmail || "Unknown";
            const hasMultipleParticipants = false;

            return (
              <div
                key={conversationId}
                onClick={() => handleConversationSelect(conversation)}
                className={`px-4 py-3 border-b border-emerald-100/50 cursor-pointer transition-all ${
                  isSelected
                    ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-emerald-600 shadow-sm"
                    : "hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-teal-50/50"
                }`}
              >
                <div className="flex items-start gap-3">
                  {isScheduleMode && (
                    <input
                      type="checkbox"
                      checked={selectedConversations.some((c) => c.conversationId === conversation.conversationId)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelectConversation(conversation);
                      }}
                      className="mt-2 accent-emerald-600"
                    />
                  )}

                  <div className="relative w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur opacity-50"></div>
                    <div className="relative w-10 h-10 bg-gradient-to-br from-emerald-600 to-green-600 rounded-full flex items-center justify-center shadow-md shadow-emerald-500/30">
                      {hasMultipleParticipants ? <Users className="w-5 h-5" /> : getAvatarLetter(clientEmail)}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`text-sm truncate ${conversation.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>
                          {clientEmail}
                          {hasMultipleParticipants && (
                            <span className="text-slate-400 text-[10px] ml-1 font-normal">+{conversation.participants.length - 1} more</span>
                          )}
                        </span>
                        {conversation.isCrmLead && (
                          <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200 uppercase tracking-tighter shadow-sm" title="This lead exists in your CRM">
                            <Zap className="w-2.5 h-2.5 fill-emerald-700" />
                            CRM
                          </span>
                        )}
                        {conversation.unreadCount > 0 && (
                          <span className="flex-shrink-0 w-2 h-2 bg-emerald-600 rounded-full shadow-sm"></span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 flex-shrink-0 ml-2 font-medium">
                        {formatDate(conversation.lastDate)}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm mb-0.5 truncate ${conversation.unreadCount > 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>
                          {conversation.subject || "(No subject)"}
                        </p>
                        <p className="text-xs text-slate-400 line-clamp-1 italic">{truncateText(conversation.lastBody)}</p>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {conversation.unreadCount > 0 && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-gradient-to-r from-emerald-100 to-teal-100 px-1.5 py-0.5 rounded-full uppercase border border-emerald-200 shadow-sm">
                          {conversation.unreadCount} New
                        </span>
                      )}
                      {conversation.messageCount > 1 && (
                        <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium border border-slate-200">
                          {conversation.messageCount} msgs
                        </span>
                      )}
                      {conversation.country && (
                        <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full flex items-center gap-1 font-medium border border-slate-200">
                          <Globe className="w-2.5 h-2.5" />
                          {conversation.country}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}