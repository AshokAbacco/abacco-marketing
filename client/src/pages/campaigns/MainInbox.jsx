import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import ModernSidebar from "./components/LeftSidebar.jsx";
import InboxHeader from "./components/Inboxheader.jsx";
import ConversationList from "./components/EmailList.jsx";
import MessageView from "./components/EmailPreview.jsx";
import AddAccountManager from "./components/AddEmailAccount.jsx";
import GroupSelectModal from "./components/GroupSelectModal.jsx";
import ScheduleModal from "./campaignPages/Schedulemodal.jsx";
import { api } from "../utils/api.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function InboxMain() {
  // ── Sidebar ──────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── URL params ───────────────────────────────────────────
  const [searchParams] = useSearchParams();

  // ── Groups (folders) ─────────────────────────────────────
  const [accountGroups, setAccountGroups] = useState([]);
  // Always derive selectedGroupId from the URL so navigation is instant
  const urlGroupId = searchParams.get("groupId") ? String(searchParams.get("groupId")) : null;
  const [selectedGroupId, setSelectedGroupId] = useState(urlGroupId);

  // ── Add-account flow ─────────────────────────────────────
  // Step 1: show GroupSelectModal  (showGroupPicker = true)
  // Step 2: show AddAccountManager (showAddAccountModal = true, pendingGroup set)
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [pendingGroup, setPendingGroup] = useState(null); // { groupId, groupName }

  // ── Accounts ─────────────────────────────────────────────
  const [accounts, setAccounts] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // ── Selection ────────────────────────────────────────────
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState("inbox");
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Active view ───────────────────────────────────────────
  const [activeView, setActiveView] = useState(
    () => localStorage.getItem("activeView") || "inbox"
  );

  // ── Month filter ──────────────────────────────────────────
  const [monthFilter, setMonthFilter] = useState("current");

  // ── Filters ───────────────────────────────────────────────
  const [filters, setFilters] = useState({
    leadStatus: "",
    sender: "",
    recipient: "",
    subject: "",
    tags: [],
    dateFrom: "",
    dateTo: "",
    hasAttachment: false,
    isUnread: false,
    isStarred: false,
    country: "",
  });

  // ── Search ────────────────────────────────────────────────
  const [searchEmail, setSearchEmail] = useState("");

  // ── Mobile / schedule ─────────────────────────────────────
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const [isScheduleMode, setIsScheduleMode] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // ── Conversations ─────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);

  // ──────────────────────────────────────────────────────────
  // SYNC GROUP FROM URL — fires whenever ?groupId changes
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    const newGroupId = searchParams.get("groupId") ? String(searchParams.get("groupId")) : null;
    setSelectedGroupId(newGroupId);

    if (accounts.length === 0) return; // will be handled after fetchAccounts

    if (newGroupId) {
      // Auto-select first account of the newly chosen group
      const groupAccs = accounts.filter((a) => String(a.groupId) === newGroupId);
      if (groupAccs.length > 0) {
        setSelectedAccount(groupAccs[0]);
        setSelectedFolder("inbox");
        setSelectedConversation(null);
        changeView("inbox");
      }
    } else {
      // "All Accounts" — select the very first account
      if (accounts.length > 0) {
        setSelectedAccount(accounts[0]);
        setSelectedFolder("inbox");
        setSelectedConversation(null);
        changeView("inbox");
      }
    }
  }, [searchParams]);



  // ──────────────────────────────────────────────────────────
  // MOUNT
  // ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchGroups();
    fetchAccounts();
  }, []);
  // ──────────────────────────────────────────────────────────
  // FETCH GROUPS
  // ──────────────────────────────────────────────────────────
  const fetchGroups = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/account-groups`);
      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      setAccountGroups(data);
    } catch (err) {
      console.error("Failed to fetch account groups:", err);
      setAccountGroups([]);
    }
  };

  // ──────────────────────────────────────────────────────────
  // FETCH ACCOUNTS  (include groupId returned from API)
  // ──────────────────────────────────────────────────────────
  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const groupId = searchParams.get("groupId");
      const url = groupId
        ? `${API_BASE_URL}/api/accounts?groupId=${groupId}`
        : `${API_BASE_URL}/api/accounts`;

      const response = await api.get(url);
      const accountsData = Array.isArray(response.data?.data)
        ? response.data.data
        : [];

      if (accountsData.length === 0) {
        setAccounts([]);
        setLoadingAccounts(false);
        return;
      }

      // ── Single bulk request instead of N individual unread calls ──
      // Previously: Promise.all with one HTTP call per account → 80 requests
      // Now: one POST returns all counts in one DB groupBy query
      let unreadMap = {};
      try {
        const bulkRes = await api.post(
          `${API_BASE_URL}/api/inbox/accounts/unread-bulk`,
          { accountIds: accountsData.map((a) => a.id) }
        );
        unreadMap = bulkRes.data?.data || {};
      } catch {
        // Fallback: zero counts — don't block the account list from loading
      }

      const normalizedAccounts = accountsData.map((a) => ({
        ...a,
        groupId: a.groupId ? String(a.groupId) : null,
        unreadCount: unreadMap[a.id] || 0,
      }));

      setAccounts(normalizedAccounts);

      // Auto-select first account based on active group from URL
      const activeGroupId = searchParams.get("groupId")
        ? String(searchParams.get("groupId"))
        : null;
      if (activeGroupId) {
        const groupAccs = normalizedAccounts.filter((a) => a.groupId === activeGroupId);
        setSelectedAccount(groupAccs[0] ?? normalizedAccounts[0] ?? null);
      } else if (!selectedAccount && normalizedAccounts.length > 0) {
        setSelectedAccount(normalizedAccounts[0]);
      } else if (
        selectedAccount &&
        !normalizedAccounts.some((a) => a.id === selectedAccount.id)
      ) {
        // The previously-selected account is gone from the list — most
        // commonly because it was just deleted (soft-deleted accounts are
        // excluded from GET /accounts immediately). Fall back to the next
        // available account instead of leaving EmailList pointed at a
        // deleted account's id.
        setSelectedAccount(normalizedAccounts[0] ?? null);
      }
    } catch (error) {
      console.error("Error fetching accounts:", error);
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // ── Fetch when view/filters/search changes ───────────────
  // NOTE: the plain "inbox" case is intentionally NOT handled here anymore —
  // ConversationList (EmailList.jsx) fetches (and paginates + polls + caches)
  // conversations for the active account/folder/monthFilter on its own.
  // Bumping refreshKey tells it to do a cache-bypassing refresh instead of
  // this component fetching an un-paginated copy in parallel.
  useEffect(() => {
    if (!selectedAccount) return;
    if (activeView === "today") { fetchTodayFollowUps(); return; }
    if (searchEmail?.trim()) fetchSearchResults();
    else if (activeView === "inbox") setRefreshKey((prev) => prev + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, filters, searchEmail]);

  // ──────────────────────────────────────────────────────────
  // FETCH SEARCH
  // ──────────────────────────────────────────────────────────
  const fetchSearchResults = async () => {
    if (!searchEmail?.trim() || !selectedAccount) return;
    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/inbox/search`, {
        params: { query: searchEmail, accountId: selectedAccount.id },
      });
      const rawMessages = res.data?.data || [];
      const uniqueConversations = new Map();
      rawMessages.forEach((msg) => {
        const convId = msg.conversationId;
        if (!uniqueConversations.has(convId) || new Date(msg.sentAt) > new Date(uniqueConversations.get(convId).sentAt)) {
          uniqueConversations.set(convId, msg);
        }
      });
      const formattedResults = Array.from(uniqueConversations.values()).map((msg) => ({
        conversationId: msg.conversationId,
        subject: msg.subject || "(No Subject)",
        initiatorEmail: msg.fromEmail,
        lastSenderEmail: msg.fromEmail,
        displayEmail: msg.direction === "sent" ? `To: ${msg.toEmail?.split(",")[0]}` : msg.fromEmail,
        lastDate: msg.sentAt,
        lastBody: msg.body ? msg.body.replace(/<[^>]*>/g, "").substring(0, 100) : "",
        unreadCount: 0,
        messageCount: 1,
        isStarred: false,
      }));
      setConversations(formattedResults);
    } catch (error) {
      console.error("Search failed:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // FETCH CONVERSATIONS
  // ──────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────
  // FETCH TODAY FOLLOW-UPS
  // ──────────────────────────────────────────────────────────
  const fetchTodayFollowUps = async () => {
    if (!selectedAccount) return;
    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/inbox/today-follow-ups`, {
        params: { accountId: selectedAccount.id },
      });
      const msgs = res.data?.data || [];
      const formatted = msgs.map((msg) => ({
        conversationId: msg.conversationId || msg.id,
        subject: msg.subject || "(No Subject)",
        initiatorEmail: msg.toEmail,
        lastSenderEmail: msg.toEmail,
        displayEmail: `To: ${msg.toEmail}`,
        lastDate: msg.sendAt,
        lastBody: msg.bodyHtml ? msg.bodyHtml.replace(/<[^>]*>/g, "").substring(0, 100) : "",
        unreadCount: 0,
        messageCount: 1,
        isStarred: false,
        isScheduled: true,
        scheduledMessageId: msg.id,
        scheduledMessageData: msg,
      }));
      setConversations(formatted);
    } catch (err) {
      console.error("Failed to fetch today follow-ups:", err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // ADD-ACCOUNT FLOW
  // ──────────────────────────────────────────────────────────
  /**
   * Called from sidebar:
   *   - null              → show group picker first
   *   - { groupId, groupName } → skip picker, go straight to add-account
   */
  const handleAddAccount = (groupInfo) => {
    if (groupInfo) {
      // Came from group context menu (groupId already known)
      setPendingGroup(groupInfo);
      setShowAddAccountModal(true);
    } else {
      // Came from header "Add" button → show picker
      setShowGroupPicker(true);
    }
  };

  const handleGroupPickerConfirm = (groupInfo) => {
    setShowGroupPicker(false);
    setPendingGroup(groupInfo);
    setShowAddAccountModal(true);
  };

  const handleAddAccountClose = () => {
    setShowAddAccountModal(false);
    setPendingGroup(null);
    fetchAccounts();
    fetchGroups();
  };

  // ──────────────────────────────────────────────────────────
  // OTHER HANDLERS
  // ──────────────────────────────────────────────────────────
  const changeView = (view) => {
    setActiveView(view);
    localStorage.setItem("activeView", view);
  };

  const handleAccountSelect = (account) => {
    setSelectedAccount(account);
    setSelectedFolder("inbox");
    setSearchEmail("");
    setSelectedConversation(null);
    setShowMobileConversations(true);
    changeView("inbox");
  };

  const handleFolderSelect = (folder) => {
    setSelectedFolder(folder);
    setSearchEmail("");
    setSelectedConversation(null);
    setShowMobileConversations(true);
    changeView("inbox");
  };

  const handleGroupSelect = (groupId) => {
    setSelectedGroupId(groupId);
    // When a group is selected, auto-select first account in that group
    const groupAccounts = accounts.filter((a) => a.groupId === groupId);
    if (groupAccounts.length > 0) {
      setSelectedAccount(groupAccounts[0]);
      setSelectedFolder("inbox");
      setSelectedConversation(null);
      changeView("inbox");
    }
  };

  const handleConversationSelect = (conversation) => setSelectedConversation(conversation);

  const handleFilterApply = (newFilters) => {
    changeView("inbox");
    setFilters(newFilters);
  };

  const handleSearchEmail = (email) => setSearchEmail(email);

  const handleTodayFollowUp = async () => {
    changeView("today");
    setFilters({ leadStatus: "", sender: "", recipient: "", subject: "", tags: [], dateFrom: "", dateTo: "", hasAttachment: false, isUnread: false, isStarred: false, country: "" });
  };

  const handleSchedule = () => setIsScheduleMode(true);

  const handleMessageSent = (conversationId) => {
    if (activeView === "today") {
      conversationId((prev) => prev.filter((c) => c.conversationId !== conversationId));
      if (selectedConversation?.conversationId === conversationId) setSelectedConversation(null);
    } else {
      setRefreshKey((prev) => prev + 1);
      fetchAccounts();
    }
  };

  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    setIsScheduleMode(false);
    setSelectedConversations([]);
    if (activeView === "today") fetchTodayFollowUps();
  };

  const handleMonthFilterChange = (value) => setMonthFilter(value);

  const handleRefresh = async () => {
    if (selectedAccount) {
      try {
        await api.get(`${API_BASE_URL}/api/accounts/sync/${selectedAccount.email}`);
      } catch (e) {
        // sync errors are non-fatal
      }
    }
    setRefreshKey((prev) => prev + 1);
  };

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 overflow-hidden relative">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: "4s" }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: "6s", animationDelay: "1s" }} />
      </div>

      {/* Sidebar */}
      <ModernSidebar
        accounts={accounts}
        selectedAccount={selectedAccount}
        selectedFolder={selectedFolder}
        onAccountSelect={handleAccountSelect}
        onFolderSelect={handleFolderSelect}
        onAddAccount={handleAddAccount}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={setSidebarCollapsed}
        unreadRefreshKey={refreshKey}
        refreshKey={refreshKey}
        accountGroups={accountGroups}
        onGroupsChange={fetchGroups}
        selectedGroupId={selectedGroupId}
        onGroupSelect={handleGroupSelect}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        <InboxHeader
          selectedAccount={selectedAccount}
          selectedFolder={selectedFolder}
          onFilterApply={handleFilterApply}
          onSearchEmail={handleSearchEmail}
          onTodayFollowUpClick={handleTodayFollowUp}
          onScheduleClick={handleSchedule}
          activeView={activeView}
          activeFilters={filters}
          onRefresh={handleRefresh}
          monthFilter={monthFilter}
          onMonthFilterChange={handleMonthFilterChange}
        />

       

        <div className="flex-1 flex overflow-hidden">
          <div className={`${selectedConversation ? "hidden lg:flex" : "flex"} w-full lg:w-96 flex-col`}>
            <ConversationList
              key={`${selectedAccount?.id}-${selectedFolder}`}
              conversations={conversations}
              selectedConversation={selectedConversation}
              onConversationSelect={handleConversationSelect}
              activeView={activeView}
              selectedAccount={selectedAccount}
              selectedFolder={selectedFolder}
              setConversations={setConversations}
              isScheduleMode={isScheduleMode}
              selectedConversations={selectedConversations}
              setSelectedConversations={setSelectedConversations}
              refreshKey={refreshKey}
              onUnreadChange={() => setRefreshKey((prev) => prev + 1)}
              monthFilter={monthFilter}
            />
          </div>

          <div className={`${selectedConversation ? "flex" : "hidden lg:flex"} flex-1 flex-col`}>
            <MessageView
              selectedAccount={selectedAccount}
              selectedConversation={selectedConversation}
              selectedFolder={selectedFolder}
              onBack={() => setSelectedConversation(null)}
              onMessageSent={handleMessageSent}
            />
          </div>
        </div>
      </div>

      {/* ── Step 1: Group picker ── */}
      {showGroupPicker && (
        <GroupSelectModal
          groups={accountGroups}
          onConfirm={handleGroupPickerConfirm}
          onClose={() => setShowGroupPicker(false)}
          onGroupsChange={fetchGroups}
        />
      )}

      {/* ── Step 2: Add account (with group pre-selected) ── */}
      {showAddAccountModal && (
        <AddAccountManager
          onClose={handleAddAccountClose}
          onAccountAdded={fetchAccounts}
          pendingGroup={pendingGroup}   // pass to AddEmailAccount so it can store groupId
        />
      )}

      {ScheduleModal && (
        <ScheduleModal
          isOpen={showScheduleModal}
          selectedAccount={selectedAccount}
          selectedConversations={selectedConversations}
          onClose={handleScheduleSuccess}
        />
      )}
    </div>
  );
}