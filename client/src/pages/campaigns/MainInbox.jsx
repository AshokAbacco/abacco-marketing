import React, { useState, useEffect, useRef } from "react";
import ModernSidebar from "./components/LeftSidebar.jsx";
import InboxHeader from "./components/Inboxheader.jsx";
import ConversationList from "./components/EmailList.jsx";
import MessageView from "./components/EmailPreview.jsx";
import AddAccountManager from "./components/AddEmailAccount.jsx";
import ScheduleModal from "./campaignPages/Schedulemodal.jsx";
import { api } from "../utils/api.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function InboxMain() {
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Accounts state
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // Selection state
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState("inbox");
  const [selectedConversation, setSelectedConversation] = useState(null);

  // ✅ Initialize activeView from localStorage
  const [activeView, setActiveView] = useState(() => {
    return localStorage.getItem("activeView") || "inbox";
  });

  // ✅ CALCULATE DEFAULT DATE (3 MONTHS AGO)
  const getDefaultDateFrom = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  };

  // Filter state (With Default 3 Months)
  const [filters, setFilters] = useState({
    leadStatus: "",
    sender: "",
    recipient: "",
    subject: "",
    tags: [],
    dateFrom: getDefaultDateFrom(),
    dateTo: "",
    hasAttachment: false,
    isUnread: false,
    isStarred: false,
    country: "",
  });

  // Search state
  const [searchEmail, setSearchEmail] = useState("");

  // Mobile state
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const [isScheduleMode, setIsScheduleMode] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);

  // ✅ NEW: Track last fetch time
  const lastFetchTimeRef = useRef(Date.now());
  const pollingIntervalRef = useRef(null);

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, []);

  // ✅ NEW: Aggressive auto-refresh every 15 seconds
  useEffect(() => {
    if (!selectedAccount?.id) return;

    // Clear existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Set up new polling interval
    pollingIntervalRef.current = setInterval(() => {
      console.log("🔄 Auto-refresh: Fetching new conversations...");
      fetchConversations(true); // Pass true to force refresh
    }, 15000); // 15 seconds

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [selectedAccount?.id, selectedFolder]);

  // ✅ UPDATED: Initial load with faster refresh
  useEffect(() => {
    if (!selectedAccount?.id) return;

    // 1️⃣ Immediate fetch
    fetchConversations();

    // 2️⃣ Quick second fetch after 3 seconds (to catch any synced emails)
    const quickRefreshTimer = setTimeout(() => {
      console.log("⚡ Quick refresh after 3 seconds...");
      fetchConversations(true);
    }, 3000);

    return () => clearTimeout(quickRefreshTimer);
  }, [selectedAccount?.id, selectedFolder]);

  // Auto-load based on activeView
  useEffect(() => {
    if (!selectedAccount) return;

    if (activeView === "today") {
      fetchTodayFollowUps();
      return;
    }

    if (searchEmail && searchEmail.trim() !== "") {
      fetchSearchResults();
    } else {
      fetchConversations();
    }
  }, [selectedAccount, selectedFolder, activeView, filters, searchEmail]);

  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const response = await api.get(`${API_BASE_URL}/api/accounts`);
      const accountsData = Array.isArray(response.data?.data)
        ? response.data.data
        : [];

      const accountsWithUnread = await Promise.all(
        accountsData.map(async (account) => {
          try {
            const unreadRes = await api.get(
              `${API_BASE_URL}/api/inbox/accounts/${account.id}/unread`
            );
            return {
              ...account,
              unreadCount: unreadRes.data?.data?.inboxUnread || 0,
            };
          } catch {
            return { ...account, unreadCount: 0 };
          }
        })
      );

      setAccounts(accountsWithUnread);

      if (!selectedAccount && accountsWithUnread.length > 0) {
        setSelectedAccount(accountsWithUnread[0]);
      }
    } catch (error) {
      console.error("Error fetching accounts:", error);
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchSearchResults = async () => {
    if (!searchEmail || searchEmail.trim() === "" || !selectedAccount) return;

    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/inbox/search`, {
        params: {
          query: searchEmail,
          accountId: selectedAccount.id,
        },
      });

      const rawMessages = res.data?.data || [];
      const uniqueConversations = new Map();

      rawMessages.forEach((msg) => {
        const convId = msg.conversationId;
        if (
          !uniqueConversations.has(convId) ||
          new Date(msg.sentAt) >
            new Date(uniqueConversations.get(convId).sentAt)
        ) {
          uniqueConversations.set(convId, msg);
        }
      });

      const formattedResults = Array.from(uniqueConversations.values()).map(
        (msg) => ({
          conversationId: msg.conversationId,
          subject: msg.subject || "(No Subject)",
          initiatorEmail: msg.fromEmail,
          lastSenderEmail: msg.fromEmail,
          displayEmail:
            msg.direction === "sent"
              ? `To: ${msg.toEmail?.split(",")[0]}`
              : msg.fromEmail,
          lastDate: msg.sentAt,
          lastBody: msg.body
            ? msg.body.replace(/<[^>]*>/g, "").substring(0, 100)
            : "",
          unreadCount: 0,
          messageCount: 1,
          isStarred: false,
        })
      );

      setConversations(formattedResults);
    } catch (error) {
      console.error("Search failed:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // ✅ UPDATED: Force refresh with cache busting
  const fetchConversations = async (forceRefresh = false) => {
    if (!selectedAccount) return;

    try {
      setLoading(true);
      const params = { 
        folder: selectedFolder,
        // ✅ Add timestamp to bust cache
        _t: forceRefresh ? Date.now() : undefined
      };

      if (filters.leadStatus) params.leadStatus = filters.leadStatus;
      if (filters.country) params.country = filters.country;
      if (filters.sender) params.sender = filters.sender;
      if (filters.recipient) params.recipient = filters.recipient;
      if (filters.subject) params.subject = filters.subject;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.hasAttachment) params.hasAttachment = true;
      if (filters.isUnread) params.isUnread = true;
      if (filters.isStarred) params.isStarred = true;

      const res = await api.get(
        `${API_BASE_URL}/api/inbox/conversations/${selectedAccount.id}`,
        { params }
      );

      const newConversations = res.data?.data || [];
      
      // ✅ Log conversation count change
      if (conversations.length !== newConversations.length) {
        console.log(`📊 Conversation count changed: ${conversations.length} → ${newConversations.length}`);
      }

      setConversations(newConversations);
      lastFetchTimeRef.current = Date.now();

      // ✅ Update unread count in sidebar
      if (forceRefresh) {
        fetchAccounts();
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTodayFollowUps = async () => {
    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/scheduled-messages/today`);

      const formatted = res.data.map((msg) => {
        let actualEmail = msg.toEmail;
        if (msg.toEmail.includes("<") && msg.toEmail.includes(">")) {
          const match = msg.toEmail.match(/<(.+?)>/);
          if (match && match[1]) {
            actualEmail = match[1];
          }
        }

        return {
          conversationId: msg.conversationId,
          subject: msg.subject || "(No subject)",
          displayName: actualEmail,
          displayEmail: actualEmail,
          primaryRecipient: actualEmail,
          lastDate: msg.sendAt,
          lastBody: "(Scheduled follow-up)",
          unreadCount: 0,
          isScheduled: true,
          scheduledMessageId: msg.id,
          scheduledMessageData: msg,
        };
      });

      setConversations(formatted);
    } catch (err) {
      console.error("❌ Failed to fetch today follow-ups", err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // Helper to update view and persist it
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

  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
  };

  const handleFilterApply = (newFilters) => {
    changeView("inbox");
    setFilters(newFilters);
  };

  const handleSearchEmail = (email) => {
    setSearchEmail(email);
  };

  const handleAddAccount = () => {
    setShowAddAccountModal(true);
  };

  const handleTodayFollowUp = async () => {
    changeView("today");
    setFilters({
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
  };

  const handleSchedule = () => {
    setIsScheduleMode(true);
  };

  // ✅ Callback when a message is successfully sent
  const handleMessageSent = (conversationId) => {
    if (activeView === "today") {
      setConversations((prev) =>
        prev.filter((c) => c.conversationId !== conversationId)
      );
      if (selectedConversation?.conversationId === conversationId) {
        setSelectedConversation(null);
      }
    } else {
      // ✅ Force refresh after sending
      fetchConversations(true);
      fetchAccounts(); // Update unread counts
    }
  };

  // ✅ Handle when schedule modal closes successfully
  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    setIsScheduleMode(false);
    setSelectedConversations([]);

    if (activeView === "today") {
      fetchTodayFollowUps();
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 overflow-hidden relative">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '4s'}}></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '6s', animationDelay: '1s'}}></div>
      </div>

      <ModernSidebar
        accounts={accounts}
        selectedAccount={selectedAccount}
        selectedFolder={selectedFolder}
        onAccountSelect={handleAccountSelect}
        onFolderSelect={handleFolderSelect}
        onAddAccount={handleAddAccount}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={setSidebarCollapsed}
      />

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
        />

        {isScheduleMode && (
          <div className="px-4 py-3 border-b bg-gradient-to-r from-emerald-50 to-teal-50 flex items-center justify-between shadow-sm">
            <span className="text-sm text-emerald-700 font-medium">
              {selectedConversations.length} selected
            </span>
            <div className="flex gap-2">
              <button
                disabled={selectedConversations.length === 0}
                onClick={() => setShowScheduleModal(true)}
                className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg disabled:opacity-50 font-medium hover:shadow-lg shadow-emerald-500/30 transition-all transform hover:scale-105"
              >
                Schedule
              </button>
              <button
                onClick={() => {
                  setIsScheduleMode(false);
                  setSelectedConversations([]);
                }}
                className="px-4 py-1.5 border border-emerald-300 rounded-lg text-emerald-700 hover:bg-emerald-50 font-medium transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div
            className={`${
              selectedConversation ? "hidden lg:flex" : "flex"
            } w-full lg:w-96 flex-col`}
          >
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
            />
          </div>

          <div
            className={`${
              selectedConversation ? "flex" : "hidden lg:flex"
            } flex-1 flex-col`}
          >
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

      {showAddAccountModal && (
        <AddAccountManager
          onClose={() => {
            setShowAddAccountModal(false);
            fetchAccounts();
          }}
          onAccountAdded={fetchAccounts}
        />
      )}

      {showScheduleModal && (
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