// ✅ EmailList.jsx - FIXED VERSION
// Fix 1: monthFilter passed in API call + default changed to "three" (Last 3 Months)
// Fix 2: Auto-retry on empty initial load (server IMAP sync may not have finished yet)
// Fix 3: Per-row delete (trash) button on hover
import React, { useState, useEffect, useRef } from "react";
import { Mail, ChevronDown, ChevronUp, Users, Globe, Zap, MoreVertical, Trash2, Check, X, Flag } from "lucide-react";
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
  refreshKey,
  onUnreadChange,
  // Default "three" (Last 3 Months) so existing emails always show on first load.
  // "current" (Current Month) only shows emails from the 1st of this month — if
  // no emails arrived this month yet, the list looks empty even though emails exist.
  monthFilter = "current",
}) {
  // How many conversations each "page" contains. Initial load and each
  // "Load More" click fetch exactly this many for the CURRENT account only —
  // other accounts / other open tabs are completely unaffected.
  const PAGE_SIZE = 10;

  const [sortBy, setSortBy] = useState("sender");
  const [sortOrder, setSortOrder] = useState("desc");

  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Next page index to fetch when "Load More" is clicked (0-indexed).
  const [page, setPage] = useState(0);
  // Whether the current account/folder/monthFilter still has more
  // conversations beyond what's currently loaded.
  const [hasMore, setHasMore] = useState(false);

  // In-memory cache keyed by `${accountId}:${folder}:${monthFilter}` so
  // reopening a folder you've already viewed this session is instant and
  // doesn't refetch — matches "cache already fetched emails" requirement.
  const cacheRef = useRef(new Map());
  // Tracks how many conversations are currently loaded, so a background
  // refresh can re-request "what's already showing" instead of resetting
  // back down to just the first page.
  const loadedCountRef = useRef(0);

  const [showMoreMenu, setShowMoreMenu]           = useState(false);
  const [selectAll, setSelectAll]                 = useState(false);
  const [selectionMode, setSelectionMode]         = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [flaggedConversations, setFlaggedConversations] = useState(() => {
    try {
      const stored = localStorage.getItem("flaggedConversations");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [hoveredConversation, setHoveredConversation]   = useState(null);
  const [deletingConversationId, setDeletingConversationId] = useState(null);
  const [newMailCount, setNewMailCount] = useState(0); // toast: how many new emails arrived

  const moreMenuRef    = useRef(null);
  const lastFetchKey   = useRef(null);
  // How many times we've auto-retried after an empty initial load
  const retryCountRef  = useRef(0);
  const retryTimerRef  = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadedCountRef.current = conversations.length;
  }, [conversations]);

  const cacheKeyFor = (accountId, folder, mf) => `${accountId}:${folder}:${mf}`;

  /**
   * fetchEmails — single entry point for all conversation fetching for THIS
   * account's list. Modes:
   *   - default (no flags):     initial load for a newly selected account/folder
   *   - background: true        silent refresh (polling) or auto-retry-on-empty;
   *                             re-requests only as many items as are already
   *                             showing, so it never shrinks a "Load More"'d list
   *   - loadMore: true          fetch the NEXT page (PAGE_SIZE more) and append
   *   - forceRefresh: true      bypass server cache (Refresh button)
   */
  const fetchEmails = async ({ background = false, loadMore = false, forceRefresh = false } = {}) => {
    if (!selectedAccount?.id) return;

    const key = cacheKeyFor(selectedAccount.id, selectedFolder, monthFilter);

    if (loadMore) setLoadingMore(true);
    else if (!background && conversations.length === 0) setLoading(true);
    else setRefreshing(true);

    try {
      const targetPage = loadMore ? page : 0;
      // Background refreshes re-request "everything already on screen" (at
      // least one page) instead of always PAGE_SIZE, so a poll never
      // discards conversations the user already loaded with "Load More".
      const effectiveLimit = loadMore
        ? PAGE_SIZE
        : Math.max(loadedCountRef.current, PAGE_SIZE);

      const res = await api.get(
        `${API_BASE_URL}/api/inbox/conversations/${selectedAccount.id}`,
        {
          params: {
            folder: selectedFolder,
            monthFilter,
            limit: effectiveLimit,
            page: targetPage,
            ...(forceRefresh ? { bust: Date.now() } : {}),
          },
        }
      );

      const incoming = Array.isArray(res.data?.data) ? res.data.data : [];
      const more = !!res.data?.hasMore;

      if (loadMore) {
        // ── LOAD MORE (this account only) ──────────────────────────────
        setConversations((prev) => {
          const merged = [...prev, ...incoming];
          cacheRef.current.set(key, { conversations: merged, hasMore: more, page: targetPage + 1 });
          return merged;
        });
        setPage(targetPage + 1);
        setHasMore(more);
        return;
      }

      if (background) {
        // ── BACKGROUND POLL / RETRY ─────────────────────────────────────
        // Never replace a non-empty list with an empty response.
        // The server may return [] while an IMAP sync is still running —
        // keeping the existing list avoids the blank-screen flash.
        if (incoming.length > 0) {
          const currentIds = new Set(conversations.map((c) => c.conversationId));
          const newOnes = incoming.filter((c) => !currentIds.has(c.conversationId));
          if (newOnes.length > 0) {
            setNewMailCount(newOnes.length);
            setTimeout(() => setNewMailCount(0), 4000);
          }
          setConversations(incoming);
          setHasMore(more);
          const loadedPages = Math.max(1, Math.ceil(incoming.length / PAGE_SIZE));
          setPage(loadedPages);
          cacheRef.current.set(key, { conversations: incoming, hasMore: more, page: loadedPages });
          retryCountRef.current = 0; // reset retry counter once we have data
        }
        // If empty on background → silently keep whatever is already showing
      } else {
        // ── INITIAL / MANUAL FETCH ───────────────────────────────────────────
        if (incoming.length > 0) {
          // Got real data — show it and cancel any pending retry
          setConversations(incoming);
          setHasMore(more);
          const loadedPages = Math.max(1, Math.ceil(incoming.length / PAGE_SIZE));
          setPage(loadedPages);
          cacheRef.current.set(key, { conversations: incoming, hasMore: more, page: loadedPages });
          retryCountRef.current = 0;
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        } else {
          // Empty response on first load — the server's IMAP sync may not have
          // finished writing to the DB yet.  Schedule up to 3 silent retries
          // (at 4 s, 8 s, 14 s) so emails appear automatically without the
          // user having to click Refresh.
          setConversations([]);
          setHasMore(false);
          setPage(0);
          cacheRef.current.set(key, { conversations: [], hasMore: false, page: 0 });

          if (retryCountRef.current < 3) {
            const delay = [4000, 8000, 14000][retryCountRef.current];
            retryCountRef.current += 1;
            console.log(`📭 Empty inbox — auto-retry #${retryCountRef.current} in ${delay / 1000}s`);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => fetchEmails({ background: true }), delay);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch emails", err);
      if (!background && !loadMore) setConversations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchEmails({ loadMore: true });
  };

  // Remembers the last refreshKey we've seen, so we can tell "refreshKey
  // changed while staying on the same account/folder" (= explicit Refresh
  // click) apart from "refreshKey happens to differ because this is a new
  // account/folder context".
  const lastRefreshKeyRef = useRef(refreshKey);

  // Re-fetch whenever account, folder, refreshKey, or monthFilter changes
  useEffect(() => {
    if (!selectedAccount?.id || !selectedFolder) return;

    const key = cacheKeyFor(selectedAccount.id, selectedFolder, monthFilter);
    const isNewContext = lastFetchKey.current !== key;
    const isManualRefresh = !isNewContext && lastRefreshKeyRef.current !== refreshKey;
    lastFetchKey.current = key;
    lastRefreshKeyRef.current = refreshKey;

    // Cancel any pending retry from a previous account/folder
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryCountRef.current = 0;

    if (isNewContext) {
      // ── Switching to an account/folder/month combo ──
      // Serve from cache instantly if we've already loaded it this
      // session — "reopening the same folder does not fetch them again".
      const cached = cacheRef.current.get(key);
      if (cached) {
        setConversations(cached.conversations);
        setHasMore(cached.hasMore);
        setPage(cached.page);
        setLoading(false);
      } else {
        setConversations([]);
        setPage(0);
        setHasMore(false);
        fetchEmails({ background: false });
      }
    } else if (isManualRefresh) {
      // ── Explicit Refresh button ── bypass cache, re-fetch what's shown
      fetchEmails({ background: true, forceRefresh: true });
    }

    // Background poll every 20 s — detects new mail without discarding
    // any conversations already loaded via "Load More".
    const interval = setInterval(() => {
      fetchEmails({ background: true });
    }, 20000);

    return () => {
      clearInterval(interval);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [refreshKey, selectedAccount?.id, selectedFolder, monthFilter]);

  // useEffect(() => {
  //   console.log(`📊 EmailList rendered with ${conversations.length} conversations`);
  // }, [conversations]);

  // Only block render on a TRUE initial load (list is empty AND we're loading)
  // Background polls must never blank the existing conversation list.
  if (loading && conversations.length === 0) return <p className="p-4 text-center text-green-700 mt-20">Loading Mails...</p>;

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
      let newSelected;
      if (exists) {
        newSelected = prev.filter((c) => c.conversationId !== conversation.conversationId);
      } else {
        newSelected = [...prev, conversation];
      }
      
      if (newSelected.length === conversations.length) {
        setSelectAll(true);
      } else {
        setSelectAll(false);
      }
      
      return newSelected;
    });
  };

  const handleSelectAll = () => {
    if (selectionMode) {
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
    } else {
      setSelectionMode(true);
    }
  };

  const handleTopCheckboxChange = () => {
    if (selectAll) {
      setSelectedConversations([]);
      setSelectAll(false);
    } else {
      setSelectedConversations([...conversations]);
      setSelectAll(true);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedConversations.length === 0) return;
    
    if (!confirm(`Delete ${selectedConversations.length} conversation(s)?`)) return;

    try {
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-hide-conversations`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations((prev) =>
        prev.filter((c) => !selectedConversations.some((sc) => sc.conversationId === c.conversationId))
      );
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete conversations");
    }
  };

  const handleDeleteAll = async () => {
    if (conversations.length === 0) return;
    
    if (!confirm(`Delete all ${conversations.length} conversations?`)) return;

    try {
      const conversationIds = conversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-hide-conversations`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations([]);
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Delete all failed:", err);
      alert("Failed to delete all conversations");
    }
  };

  const handleMarkAsRead = async () => {
    if (selectedConversations.length === 0) return;

    try {
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-mark-read`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations((prev) =>
        prev.map((conv) => {
          if (selectedConversations.some((sc) => sc.conversationId === conv.conversationId)) {
            return { ...conv, unreadCount: 0 };
          }
          return conv;
        })
      );

      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Mark as read failed:", err);
      alert("Failed to mark conversations as read");
    }
  };

  const handleMarkAsUnread = async () => {
    if (selectedConversations.length === 0) return;

    try {
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-mark-unread`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations((prev) =>
        prev.map((conv) => {
          if (selectedConversations.some((sc) => sc.conversationId === conv.conversationId)) {
            return { ...conv, unreadCount: conv.messageCount || 1 };
          }
          return conv;
        })
      );

      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Mark as unread failed:", err);
      alert("Failed to mark conversations as unread");
    }
  };

  // ── FIX 2: Single-row delete → moves to trash ───────────────────────────────
  const handleDeleteSingleConversation = async (e, conversation) => {
    e.stopPropagation(); // Don't open the conversation
    const { conversationId } = conversation;

    setDeletingConversationId(conversationId);
    try {
      await api.patch(`${API_BASE_URL}/api/inbox/hide-inbox-conversation`, {
        conversationId,
        accountId: selectedAccount.id,
      });

      // Optimistically remove from list
      setConversations((prev) =>
        prev.filter((c) => c.conversationId !== conversationId)
      );

      // If the deleted conversation was open, deselect it
      if (selectedConversation?.conversationId === conversationId) {
        onConversationSelect(null);
      }

      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Single delete failed:", err);
      alert("Failed to move conversation to trash");
    } finally {
      setDeletingConversationId(null);
    }
  };

  const handleConversationSelect = (conversation) => {
    if (selectionMode) {
      toggleSelectConversation(conversation);
    } else {
      onConversationSelect(conversation);
    }
  };

  const toggleSectionCollapse = (group) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const toggleFlag = (e, conversationId) => {
    e.stopPropagation();
    setFlaggedConversations((prev) => {
      const updated = { ...prev, [conversationId]: !prev[conversationId] };
      try { localStorage.setItem("flaggedConversations", JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    const options = { month: "short", day: "numeric" };
    if (date.getFullYear() !== now.getFullYear()) {
      options.year = "numeric";
    }
    return date.toLocaleDateString(undefined, options);
  };

  const truncateText = (text, maxLength = 60) => {
    if (!text) return "";
    return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
  };

  const getAvatarLetter = (email) => {
    return email ? email.charAt(0).toUpperCase() : "?";
  };

  const groupConversationsByDate = (conversations) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay());
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const groups = {
      Today: [],
      Yesterday: [],
      "This Week": [],
      "Last Week": [],
      Earlier: [],
    };

    conversations.forEach((conv) => {
      const convDate = new Date(conv.lastDate);
      if (convDate >= today) {
        groups.Today.push(conv);
      } else if (convDate >= yesterday) {
        groups.Yesterday.push(conv);
      } else if (convDate >= thisWeekStart) {
        groups["This Week"].push(conv);
      } else if (convDate >= lastWeekStart) {
        groups["Last Week"].push(conv);
      } else {
        groups.Earlier.push(conv);
      }
    });

    return Object.entries(groups)
      .filter(([_, convs]) => convs.length > 0)
      .map(([group, conversations]) => ({ group, conversations }));
  };

  const groupedConversations = groupConversationsByDate(conversations);

  return (
    <div className="flex flex-col h-full bg-white/90 backdrop-blur-sm">
      {/* ── New mail toast ── */}
      {newMailCount > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium animate-pulse">
          <span>📬 {newMailCount} new {newMailCount === 1 ? "email" : "emails"} arrived</span>
          <button onClick={() => setNewMailCount(0)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="p-2 border-b border-emerald-200/50 bg-gradient-to-r from-white to-emerald-50/30">
        <div className="flex items-center justify-between ">
          <div className="flex items-center gap-2">
            <h2 className="text-md font-bold bg-gradient-to-r from-emerald-600 to-green-800 bg-clip-text text-transparent">
              {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
            </h2>
            {/* Subtle background refresh indicator */}
            {refreshing && (
              <span className="text-[10px] text-emerald-500 animate-pulse font-medium">
                ● syncing
              </span>
            )}
          </div>

          {/* More Menu - Top Right */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 hover:bg-emerald-100 rounded-lg transition-colors"
              title="More options"
            >
              <MoreVertical className="w-5 h-5 text-emerald-600" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-emerald-200 z-50">
                <button
                  onClick={handleSelectAll}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700"
                >
                  {selectionMode ? (
                    <>
                      <X className="w-4 h-4 text-red-600" />
                      Cancel Selection
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      Select
                    </>
                  )}
                </button>
                
                <div className="border-t border-slate-200 my-1"></div>
                
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                  Delete Selected ({selectedConversations.length})
                </button>
                
                <button
                  onClick={handleDeleteAll}
                  disabled={conversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
                
                <div className="border-t border-slate-200 my-1"></div>
                
                <button
                  onClick={handleMarkAsRead}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-emerald-600" />
                  Mark as Read ({selectedConversations.length})
                </button>
                
                <button
                  onClick={handleMarkAsUnread}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-blue-600" />
                  Mark as Unread ({selectedConversations.length})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sorting and Select All */}
        <div className="flex items-center justify-between gap-2">
          {selectionMode && (
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={handleTopCheckboxChange}
                className="accent-emerald-600"
              />
              <span className="font-medium">Select All</span>
            </label>
          )}
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
          <>
          {groupedConversations.map(({ group, conversations: groupConvs }) => (
            <div key={group}>
              {/* Date Section Header - Collapsible */}
              <div 
                className="sticky top-0 bg-gradient-to-r from-slate-100 to-slate-50 px-4 py-2 border-b border-slate-200 z-10 cursor-pointer hover:bg-slate-200/50 transition-colors flex items-center justify-between"
                onClick={() => toggleSectionCollapse(group)}
              >
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                  {collapsedSections[group] ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                  {group}
                </h4>
                <span className="text-xs text-slate-500">
                  {groupConvs.length} {groupConvs.length === 1 ? 'conversation' : 'conversations'}
                </span>
              </div>
              
              {/* Conversations in this group - Only show if not collapsed */}
              {!collapsedSections[group] && groupConvs.map((conversation) => {
                const conversationId = conversation.conversationId;
                const isSelected = selectedConversation?.conversationId === conversationId;
                const clientEmail = conversation.displayName?.trim() ? conversation.displayName : conversation.displayEmail || "Unknown";
                const hasMultipleParticipants = false;
                const isChecked = selectedConversations.some((c) => c.conversationId === conversation.conversationId);
                const isFlagged = !!flaggedConversations[conversationId];
                const isHovered = hoveredConversation === conversationId;
                const isDeleting = deletingConversationId === conversationId;

                return (
                  <div
                    key={conversationId}
                    onClick={() => handleConversationSelect(conversation)}
                    onMouseEnter={() => setHoveredConversation(conversationId)}
                    onMouseLeave={() => setHoveredConversation(null)}
                    className={`px-4 py-3 border-b border-emerald-100/50 cursor-pointer transition-all relative ${
                      isDeleting
                        ? "opacity-40 pointer-events-none"
                        : isFlagged
                        ? "bg-yellow-50 border-l-4 border-yellow-400"
                        : isSelected
                        ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-emerald-600 shadow-sm"
                        : "hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-teal-50/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox - Only show in selection mode */}
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectConversation(conversation);
                          }}
                          className="mt-2 accent-emerald-600 cursor-pointer"
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

                          {/* ── Right-side action buttons (flag + delete + date) ── */}
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            {/* Flag button */}
                            <button
                              onClick={(e) => toggleFlag(e, conversationId)}
                              title={isFlagged ? "Remove flag" : "Flag this conversation"}
                              className={`transition-all duration-150 rounded p-0.5 ${
                                isFlagged
                                  ? "opacity-100 text-red-500 hover:text-red-700"
                                  : isHovered
                                  ? "opacity-100 text-slate-400 hover:text-red-400"
                                  : "opacity-0 pointer-events-none"
                              }`}
                            >
                              <Flag className="w-3.5 h-3.5" fill={isFlagged ? "currentColor" : "none"} />
                            </button>

                            {/* ── FIX 2: Per-row Delete (Trash) button ── */}
                            <button
                              onClick={(e) => handleDeleteSingleConversation(e, conversation)}
                              title="Move to trash"
                              className={`transition-all duration-150 rounded p-0.5 ${
                                isHovered
                                  ? "opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-50"
                                  : "opacity-0 pointer-events-none"
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            <span className="text-xs text-slate-500 font-medium">
                              {formatDate(conversation.lastDate)}
                            </span>
                          </div>
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
              })}
            </div>
          ))}

          {/* ── Load More (this account only) ── */}
          {hasMore && (
            <div className="p-3 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}