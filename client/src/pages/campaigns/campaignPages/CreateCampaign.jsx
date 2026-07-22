import { useState, useRef, useEffect, useCallback } from "react";
import { useDailyLimit } from "./DailyLimitBanner";
import { AlertTriangle } from "lucide-react";
import {
  Send,
  Calendar,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link,
  Paperclip,
  Type,
  Minus,
  X,
  Eye,
  ChevronDown,
  Clock,
  Lock,
  CheckCircle2,
  Mail,
  Zap,
  Users,
  Target,
  Sparkles
} from "lucide-react";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const FONT_FAMILIES = [
  { value: "Calibri, sans-serif", label: "Calibri" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Verdana, sans-serif", label: "Verdana" },
];

const FONT_SIZES = [
  { value: "13px", label: "10" },
  { value: "14px", label: "11" },
  { value: "15px", label: "12" },
  { value: "16px", label: "13" },
  { value: "18px", label: "14" },
  { value: "20px", label: "15" },
  { value: "24px", label: "16" },
  { value: "26px", label: "18" },
  { value: "28px", label: "20" },
  { value: "30px", label: "24" },
  { value: "32px", label: "28" },
  { value: "34px", label: "32" },
  { value: "36px", label: "36" },
];

const COLOR_FAMILIES = [
  {
    name: "Black",
    colors: ["#000000", "#1a1a1a", "#333333", "#4d4d4d", "#666666", "#808080", "#999999", "#b3b3b3"]
  },
  {
    name: "Blue",
    colors: ["#35516e", "#0d2741", "#007dfa", "#2189f1", "#1a8cff", "#1364b6", "#07437a", "#032442"]
  },
  {
    name: "Yellow",
    colors: ["#ffffe6", "#ffffcc", "#ffffb3", "#ffff99", "#ffff80", "#ffff66", "#ffff4d", "#ffff33"]
  },
  {
    name: "Red",
    colors: ["#521212", "#a04949", "#da8c8c", "#c25454", "#fa4f4f", "#e92424", "#e60e0e", "#920303"]
  },
  {
    name: "Green",
    colors: ["#e6ffe6", "#ccffcc", "#b3ffb3", "#99ff99", "#80ff80", "#66ff66", "#4dff4d", "#33ff33"]
  }
];

const LIMIT_OPTIONS = [10,20, 30, 40, 50,60, 70, 80, 100, 150, 200];


export default function CreateCampaign() {
  const [accounts, setAccounts] = useState([]);
  const [accountGroups, setAccountGroups] = useState([]);
  const [expandedGroupsInDropdown, setExpandedGroupsInDropdown] = useState({});
  const [recipientMode, setRecipientMode] = useState("manual");
  const [manualEmails, setManualEmails] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [parsedEmails, setParsedEmails] = useState([]);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedFroms, setSelectedFroms] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [selectedPitchIds, setSelectedPitchIds] = useState([]);
  const [campaignName, setCampaignName] = useState("");
  const [existingNames, setExistingNames] = useState([]);
  const [nameError, setNameError] = useState("");
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showPitchDropdown, setShowPitchDropdown] = useState(false);
  const [lockedAccounts, setLockedAccounts] = useState([]);          // busy (campaign sending)
  const [lockedLoading, setLockedLoading] = useState(true);         // true until first fetch completes
  const fetchLockedRef = useRef(null);                               // stable ref so dropdown can trigger it
  const [customLimits, setCustomLimits] = useState({});
  const [customLimitEditing, setCustomLimitEditing] = useState({}); // accountId -> boolean, shows manual number input
  const [customLimitDraft, setCustomLimitDraft] = useState({});     // accountId -> string, raw text while typing

  const [campaignType, setCampaignType] = useState("immediate");
  const [subject, setSubject] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [attachments, setAttachments] = useState([]);

  const [currentFont, setCurrentFont] = useState("Calibri, sans-serif");
  const [currentSize, setCurrentSize] = useState("13px");
  const [currentColor, setCurrentColor] = useState("#000000");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [customSize, setCustomSize] = useState("");
  const fromDropdownRef = useRef(null);
  const pitchDropdownRef = useRef(null);

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  const [senderRole, setSenderRole] = useState("");
  const [editingRole, setEditingRole] = useState(false);
  const [tempRole, setTempRole] = useState("");

  // ── Daily limit ────────────────────────────────────────────
  const dailyLimit = useDailyLimit();


  const formatText = (command, value = null) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const applyFontFamily = (font) => {
    setCurrentFont(font);
    formatText("fontName", font);
  };

  const applyFontSize = (size) => {
    setCurrentSize(size);

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedContent = range.extractContents();
    
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.appendChild(selectedContent);
    
    range.insertNode(span);
    
    editorRef.current?.focus();
  };

  const applyColor = (color) => {
    setCurrentColor(color);
    
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      if (editorRef.current) {
        editorRef.current.style.color = color;
      }
      setShowColorPicker(false);
      return;
    }

    document.execCommand('foreColor', false, color);
    
    if (!selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      const selectedContent = range.extractContents();
      
      const span = document.createElement('span');
      span.style.color = color;
      span.appendChild(selectedContent);
      
      range.insertNode(span);
    }
    
    setShowColorPicker(false);
    editorRef.current?.focus();
  };

  const insertLink = () => {
    const url = prompt("Enter URL:");
    if (url) {
      formatText("createLink", url);
    }
  };

  const handleAttachmentUpload = (e) => {
    const files = Array.from(e.target.files);
    setAttachments([...attachments, ...files]);
  };

  const removeAttachment = (index) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  useEffect(() => {
    let isMounted = true;

    const fetchLocked = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/campaigns/accounts/locked`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.error("Failed to fetch locked accounts:", res.status);
          return;
        }
        const data = await res.json();
        if (!isMounted) return;
        if (data.success) {
          if (Array.isArray(data.data)) {
            setLockedAccounts(data.data);
          } else {
            setLockedAccounts(data.data?.busy || []);
          }
        }
      } catch (err) {
        console.error("Failed to fetch locked accounts", err);
      } finally {
        if (isMounted) setLockedLoading(false);
      }
    };

    // Store in ref so the dropdown open button can call it immediately too
    fetchLockedRef.current = fetchLocked;

    // Run immediately on mount — no initial delay
    fetchLocked();

    // Then poll every 5 seconds
    const timer = setInterval(fetchLocked, 5000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (campaignType === "immediate") {
      setSelectedFroms(prev => prev.filter(id => !lockedAccounts.includes(id)));
    }
  }, [lockedAccounts, campaignType]);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/accounts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          setAccounts(data.data);
        }
      } catch (err) {
        console.error("Failed to fetch email accounts", err);
      }
    };
    fetchAccounts();
  }, []);

  useEffect(() => {
    const fetchAccountGroups = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/account-groups`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          setAccountGroups(data.data || []);
          // Default: expand all groups so user sees accounts immediately
          const expanded = {};
          (data.data || []).forEach(g => { expanded[g.id] = true; });
          setExpandedGroupsInDropdown(expanded);
        }
      } catch (err) {
        console.error("Failed to fetch account groups", err);
      }
    };
    fetchAccountGroups();
  }, []);

  useEffect(() => {
    const fetchPitches = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/pitches`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          const freshPitches = data.data.filter(p => p.type === "fresh");
          setPitches(freshPitches);
        }
      } catch (err) {
        console.error("Failed to load pitches", err);
      }
    };
    fetchPitches();
  }, []);

  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API_BASE_URL}/api/campaigns`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) {
          const names = (data.data || [])
            .map(c => c.name?.toLowerCase())
            .filter(Boolean);
          setExistingNames(names);
        }
      } catch (err) {
        console.error("Failed to load campaigns", err);
      }
    };
    fetchCampaigns();
  }, []);

  useEffect(() => {
    const savedRole = localStorage.getItem("senderRole");
    if (savedRole) {
      setSenderRole(savedRole);
    }
  }, []);

  const handleSaveRole = () => {
    setSenderRole(tempRole);
    localStorage.setItem("senderRole", tempRole);
    setEditingRole(false);
  };

 

  useEffect(() => {

  const nowIST = new Date(

    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })

  );
 
  const hours = String(nowIST.getHours()).padStart(2, "0");

  const minutes = String(nowIST.getMinutes()).padStart(2, "0");
 
  setScheduleTime(`${hours}:${minutes}`);

}, []);
 

  const handleSend = async () => {
    try {
      setErrorMsg("");

      if (!selectedFroms.length) {
        return setErrorMsg("Please select at least one From Email account");
      }
      if (!campaignName.trim()) {
        return setErrorMsg("Campaign name is required");
      }
      const subjectList = subject.split("\n").filter(s => s.trim());
      if (!subjectList.length) {
        return setErrorMsg("At least one subject is required");
      }
      if (!parsedEmails.length) {
        return setErrorMsg("Add at least one recipient");
      }

      // ── Daily-limit guard ───────────────────────────────────
      if (dailyLimit) {
        if (parsedEmails.length > dailyLimit.remaining) {
          return setErrorMsg(
            `⚠️ Daily quota reached. You only have ${dailyLimit.remaining.toLocaleString()} email credits remaining today (limit: ${dailyLimit.dailyLimit.toLocaleString()}/day). ` +
            `This campaign needs ${parsedEmails.length.toLocaleString()} recipients. Please reduce recipients or try again tomorrow.`
          );
        }
      }
      // ───────────────────────────────────────────────────────

      if (!editorRef.current?.innerHTML?.trim() && selectedPitchIds.length === 0) {
        return setErrorMsg("Email content is empty");
      }
      if (campaignType === "scheduled" && (!scheduleDate || !scheduleTime)) {
        return setErrorMsg("Please select schedule date and time");
      }

      setSending(true);

      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/api/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          campaignName,
          subjects: subjectList,
          bodyHtml: editorRef.current?.innerHTML || "",
          recipients: parsedEmails,
          fromAccountIds: selectedFroms,
          pitchIds: selectedPitchIds,
          sendType: campaignType,
          scheduledAt: campaignType === "scheduled" ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString() : null,
          customLimits: customLimits,
          senderRole, 
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to create campaign");
      }

      alert(campaignType === "immediate" ? "Campaign sent successfully! It will continue sending automatically." : "Campaign scheduled successfully!");
      window.location.href = "/campaigns";
      setSubject("");
      setManualEmails("");
      setParsedEmails([]);
      setSelectedFroms([]);
      setSelectedPitchIds([]);
      setCampaignName("");
      setCustomLimits({});
      if (editorRef.current) editorRef.current.innerHTML = "";

    } catch (err) {
        console.error(err);
        setErrorMsg(err.message || "Something went wrong");
    } finally {
      setSending(false);
    }
  };

  const extractEmails = (text) => {
    const emails = text
      .split(/[\n,;]/)
      .map((e) => e.trim())
      .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    setParsedEmails([...new Set(emails)]);
  };

  const handleCsvUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      extractEmails(text);
    };
    reader.readAsText(file);
  };

  const savePitchTemplate = async () => {
    if (!selectedPitchIds.length) return;
    const pitchId = selectedPitchIds[selectedPitchIds.length - 1];
    const updatedBody = editorRef.current?.innerHTML || "";

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/api/pitches/${pitchId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bodyHtml: updatedBody,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert("Pitch template updated successfully ✅");
    } catch (err) {
      alert("Failed to save pitch ❌");
      console.error(err);
    }
  };

  const LIMITS = {
    gmail: 50,
    gsuite: 80,
    rediff: 40,
    amazon: 60,
    custom: 60
  };

  const getDefaultLimit = (provider) => {
    const key = (provider || "custom").toLowerCase();
    return LIMITS[key] || LIMITS.custom;
  };

  const getActualLimit = (accountId) => {
    if (customLimits[accountId]) {
      return customLimits[accountId];
    }
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return 60;
    return getDefaultLimit(acc.provider);
  };

  const getCapacity = () => {
    let total = 0;
    selectedFroms.forEach(id => {
      total += getActualLimit(id);
    });
    return total;
  };

  const availableAccounts =
    campaignType === "scheduled"
      ? accounts
      : accounts.filter(
          acc => !lockedAccounts.includes(Number(acc.id))
        );

  const lockedAccountsList =
    campaignType === "scheduled"
      ? []
      : accounts.filter(acc => lockedAccounts.includes(Number(acc.id)));

  const lockedAccountsCount = lockedAccountsList.length;

  const subjectCount = subject
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean).length;


  useEffect(() => {
    const handleClickOutside = (event) => {

      // Close From Dropdown
      if (
        fromDropdownRef.current &&
        !fromDropdownRef.current.contains(event.target)
      ) {
        setShowFromDropdown(false);
      }

      // Close Pitch Dropdown
      if (
        pitchDropdownRef.current &&
        !pitchDropdownRef.current.contains(event.target)
      ) {
        setShowPitchDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);







  return (
    <div className="space-y-6 p-6 bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-1/4 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '5s'}}></div>
        <div className="absolute bottom-20 left-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '7s', animationDelay: '2s'}}></div>
      </div>

      <div className="relative z-10 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl blur opacity-50"></div>
            <div className="relative w-14 h-14 bg-gradient-to-br from-emerald-600 to-green-600 rounded-2xl flex items-center justify-center shadow-lg ">
              <Sparkles className="text-white" size={26} />
            </div>
          </div>
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent py-2">
              Create Campaign
            </h1>
            <p className="text-sm text-emerald-600 mt-1 font-semibold">Send immediate or scheduled email campaigns (continuous sending)</p>
          </div>
        </div>
      </div>

      <div className="relative z-10 flex gap-3">
        <button
          onClick={() => setCampaignType("immediate")}
          className={`group relative px-8 py-3.5 rounded-xl font-bold transition-all transform hover:scale-105 ${
            campaignType === "immediate"
              ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg "
              : "bg-white/80 backdrop-blur-sm text-emerald-600 border border-emerald-200 hover:border-emerald-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Zap className={`${campaignType === "immediate" ? "animate-pulse" : ""}`} size={18} />
            Immediate Campaign
          </div>
        </button>
        <button
          onClick={() => setCampaignType("scheduled")}
          className={`group relative px-8 py-3.5 rounded-xl font-bold transition-all transform hover:scale-105 ${
            campaignType === "scheduled"
              ? "bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg "
              : "bg-white/80 backdrop-blur-sm text-emerald-600 border border-emerald-200 hover:border-emerald-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <Calendar size={18} />
            Scheduled Campaign
          </div>
        </button>
      </div>

      <div className="relative z-10 grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-5">
          <div className="bg-white/80 backdrop-blur-sm border border-emerald-200/50 rounded-2xl p-6 space-y-5 shadow-lg">
            <div>
              <label className="block text-sm font-bold text-emerald-600 mb-2 uppercase tracking-wide flex items-center gap-2">
                <Target size={16} />
                Campaign Name
              </label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => {
                  const value = e.target.value;
                  setCampaignName(value);
                  if (existingNames.includes(value.trim().toLowerCase())) {
                    setNameError("Campaign name already exists. Please use another name.");
                  } else {
                    setNameError("");
                  }
                }}
                placeholder="Association Name Outreach"
                className="w-full border border-emerald-200 rounded-xl p-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium hover:border-emerald-300 transition-colors"
              />
              {nameError && <p className="text-xs text-red-600 mt-2 bg-red-50 p-2 rounded-lg border border-red-200 font-semibold">{nameError}</p>}
            </div>

            <div ref={fromDropdownRef} className="relative">
              <label className="block text-sm font-bold text-emerald-600 mb-2 uppercase tracking-wide flex items-center gap-2">
                <Mail size={16} />
                From Email Accounts
              </label>

              <div className="flex items-center gap-4 mb-3 text-xs">
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  <CheckCircle2 size={14} />
                  {lockedLoading ? (
                    <span className="inline-block w-6 h-3 bg-emerald-200 rounded animate-pulse" />
                  ) : (
                    <>{availableAccounts.length} Available</>
                  )}
                </span>
                {!lockedLoading && lockedAccountsCount > 0 && (
                  <span className="flex items-center gap-1.5 text-red-600 font-bold bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                    <Lock size={14} />
                    {lockedAccountsCount} In Use / Locked
                  </span>
                )}
                {lockedLoading && (
                  <span className="flex items-center gap-1.5 text-slate-500 font-bold bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                    <div className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
                    Checking...
                  </span>
                )}
              </div>

              <button
                type="button"
                 onClick={() => {
                  const opening = !showFromDropdown;
                  setShowFromDropdown(opening);
                  setShowPitchDropdown(false);
                  // Re-fetch locked status the instant user opens the dropdown
                  if (opening) {
                    setLockedLoading(true);
                    fetchLockedRef.current?.();
                  }
                 }}
                
                className="w-full border border-emerald-200 rounded-xl p-3.5 text-left flex justify-between items-center bg-white hover:border-emerald-300 transition-all font-medium"
              >
                <span className="text-slate-700">
                  {selectedFroms.length > 0 
                    ? `${selectedFroms.length} account(s) selected` 
                    : "Select From Emails"}
                </span>
                <ChevronDown size={18} className={`text-emerald-600 transition-transform ${showFromDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showFromDropdown && (
                <div className="relative z-50 mt-2 w-full bg-white/95 backdrop-blur-sm border border-emerald-200 rounded-xl shadow-2xl max-h-96 overflow-y-auto">
                  {(() => {
                    // Build grouped view mirroring the sidebar structure
                    const ungrouped = availableAccounts.filter(
                      a => !a.groupId || !accountGroups.find(g => g.id === a.groupId)
                    );
                    const groupsWithAccounts = accountGroups.map(group => ({
                      ...group,
                      accounts: availableAccounts.filter(a => a.groupId === group.id),
                    }));

                    const renderAccountRow = (acc) => (
                      <label
                        key={acc.id}
                        className="flex items-center gap-3 p-2.5 hover:bg-emerald-50 rounded-lg cursor-pointer transition group"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFroms.includes(acc.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFroms([...selectedFroms, acc.id]);
                            } else {
                              setSelectedFroms(selectedFroms.filter(id => id !== acc.id));
                            }
                          }}
                          className="w-4 h-4 text-emerald-600 border-emerald-300 rounded focus:ring-emerald-500"
                        />
                        <div className="w-6 h-6 flex-shrink-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold">
                          {acc.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{acc.email}</p>
                          <p className="text-xs text-emerald-600 font-medium">
                            {acc.provider?.toUpperCase()} • Limit: {getActualLimit(acc.id)}/hr
                          </p>
                        </div>
                        {(() => {
                          const currentVal = customLimits[acc.id];
                          const isPreset = currentVal != null && LIMIT_OPTIONS.includes(currentVal);
                          const isCustomActive = !!customLimitEditing[acc.id] || (currentVal != null && !isPreset);
                          const selectValue = isCustomActive ? "custom" : (currentVal || "");

                          const commitCustomValue = () => {
                            const raw = customLimitDraft[acc.id];
                            const parsed = parseInt(raw, 10);
                            const newLimits = { ...customLimits };
                            if (raw === "" || raw === undefined || isNaN(parsed) || parsed <= 0) {
                              // nothing valid typed — drop back to default
                              delete newLimits[acc.id];
                              setCustomLimitEditing({ ...customLimitEditing, [acc.id]: false });
                            } else {
                              // clamp to a sane range so no one fat-fingers 99999/hr
                              newLimits[acc.id] = Math.min(parsed, 999);
                            }
                            setCustomLimits(newLimits);
                          };

                          return (
                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={selectValue}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === "custom") {
                                    setCustomLimitDraft({ ...customLimitDraft, [acc.id]: currentVal ? String(currentVal) : "" });
                                    setCustomLimitEditing({ ...customLimitEditing, [acc.id]: true });
                                    return;
                                  }
                                  setCustomLimitEditing({ ...customLimitEditing, [acc.id]: false });
                                  const newLimits = { ...customLimits };
                                  if (val) {
                                    newLimits[acc.id] = parseInt(val);
                                  } else {
                                    delete newLimits[acc.id];
                                  }
                                  setCustomLimits(newLimits);
                                }}
                                className="text-xs border border-emerald-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-50 font-semibold"
                              >
                                <option value="">Default ({getDefaultLimit(acc.provider)})</option>
                                {LIMIT_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}/hr</option>
                                ))}
                                <option value="custom">Custom…</option>
                              </select>

                              {isCustomActive && (
                                <input
                                  type="number"
                                  min={1}
                                  max={999}
                                  autoFocus
                                  placeholder="e.g. 25"
                                  value={customLimitDraft[acc.id] ?? (currentVal || "")}
                                  onChange={(e) =>
                                    setCustomLimitDraft({ ...customLimitDraft, [acc.id]: e.target.value })
                                  }
                                  onBlur={commitCustomValue}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitCustomValue();
                                    }
                                  }}
                                  className="w-14 text-xs border border-emerald-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-semibold"
                                />
                              )}
                            </div>
                          );
                        })()}
                      </label>
                    );

                    return (
                      <div className="p-2">
                        {/* Grouped accounts — only show groups that have at least one available account */}
                        {groupsWithAccounts.filter(group => group.accounts.length > 0).map(group => {
                          const isExpanded = expandedGroupsInDropdown[group.id] !== false;
                          const groupSelectedCount = group.accounts.filter(a => selectedFroms.includes(a.id)).length;
                          return (
                            <div key={group.id} className="mb-1">
                              {/* Group header row */}
                              <button
                                type="button"
                                onClick={() => setExpandedGroupsInDropdown(prev => ({ ...prev, [group.id]: !isExpanded }))}
                                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-emerald-50 transition"
                              >
                                <span
                                  className="w-5 h-5 rounded flex items-center justify-center text-white flex-shrink-0"
                                  style={{ backgroundColor: group.color || "#10b981" }}
                                >
                                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.764c.958 0 1.76.56 2.09 1.328L9 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>
                                </span>
                                <span className="text-xs font-bold text-slate-700 flex-1 text-left">{group.name}</span>
                                {groupSelectedCount > 0 && (
                                  <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full">
                                    {groupSelectedCount} selected
                                  </span>
                                )}
                                <span className="text-slate-400 text-xs">{isExpanded ? "▾" : "▸"}</span>
                              </button>
                              {/* Accounts under this group */}
                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l-2 border-emerald-100 space-y-0.5">
                                  {group.accounts.length === 0 ? (
                                    <p className="text-xs text-slate-400 px-3 py-2">No accounts in this group</p>
                                  ) : (
                                    group.accounts.map(renderAccountRow)
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Ungrouped accounts */}
                        {ungrouped.length > 0 && (
                          <div className="mt-1">
                            {accountGroups.length > 0 && (
                              <div className="flex items-center gap-2 px-2 py-1 mb-1">
                                <div className="flex-1 h-px bg-slate-100" />
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Ungrouped</span>
                                <div className="flex-1 h-px bg-slate-100" />
                              </div>
                            )}
                            {ungrouped.map(renderAccountRow)}
                          </div>
                        )}

                        {availableAccounts.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4">No available accounts</p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Locked / In Use accounts — with loading skeleton */}
                  {lockedLoading ? (
                    <div className="border-t border-emerald-200 p-3">
                      <div className="flex items-center gap-2 mb-2 px-2">
                        <div className="w-3 h-3 rounded-full bg-slate-200 animate-pulse" />
                        <div className="h-3 w-40 bg-slate-200 rounded animate-pulse" />
                      </div>
                      {[1, 2].map(i => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg mb-2 bg-slate-50">
                          <div className="w-4 h-4 rounded-full bg-slate-200 animate-pulse flex-shrink-0" />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 w-48 bg-slate-200 rounded animate-pulse" />
                            <div className="h-2.5 w-32 bg-slate-100 rounded animate-pulse" />
                          </div>
                          <div className="h-6 w-28 bg-slate-200 rounded-lg animate-pulse" />
                        </div>
                      ))}
                    </div>
                  ) : lockedAccountsList.length > 0 ? (
                    <div className="border-t border-emerald-200 p-3">
                      {/* Campaign-busy accounts */}
                      {lockedAccountsList.length > 0 && (
                        <>
                          <h4 className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2 px-2 flex items-center gap-1.5">
                            <Lock size={12} />
                            Currently In Use (Unavailable)
                          </h4>
                          {lockedAccountsList.map(acc => (
                            <div
                              key={acc.id}
                              className="flex items-center gap-3 p-3 bg-red-50/50 rounded-lg opacity-60 mb-2"
                            >
                              <Lock size={14} className="text-red-500" />
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-slate-700">{acc.email}</p>
                                <p className="text-xs text-red-600 font-medium">Busy sending another campaign</p>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {campaignType === "scheduled" && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-200">
                <div>
                  <label className="block text-sm font-bold text-emerald-600 mb-2">Schedule Date (IST)</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full border border-emerald-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-emerald-600 mb-2">Schedule Time (IST)</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full border border-emerald-200 rounded-lg p-3"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-emerald-600 mb-2 uppercase tracking-wide">
                Subject Lines (one per line)
              </label>
              <textarea
                rows={3}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter multiple subject lines...&#10;One per line&#10;Random selection"
                className="w-full border border-emerald-200 rounded-xl p-3.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium hover:border-emerald-300 transition-colors"
              />
              <p className="mt-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                Total Subject Lines:{" "}
                <span className="text-lg font-bold text-emerald-600">
                  {subjectCount}
                </span>
              </p>
            </div>

            <div ref={pitchDropdownRef} className="relative">
              <label className="block text-sm font-bold text-emerald-600 mb-2 uppercase tracking-wide">Pitch Templates (Optional)</label>
              <button
                type="button"
                 onClick={() => {
                    setShowPitchDropdown(!showPitchDropdown); // open/close pitch dropdown
                    setShowFromDropdown(false);               // close from dropdown
                  }}
                className="w-full border border-emerald-200 rounded-xl p-3.5 text-left flex justify-between items-center bg-white hover:border-emerald-300 transition-all font-medium"
              >
                <span className="text-slate-700">
                  {selectedPitchIds.length > 0 
                    ? `${selectedPitchIds.length} template(s) selected` 
                    : "Select Pitch Templates"}
                </span>
                <ChevronDown size={18} className={`text-emerald-600 transition-transform ${showPitchDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showPitchDropdown && (
                <div className="relative z-[9999] bottom mb-2 w-full bg-white border border-emerald-200 rounded-xl shadow-2xl max-h-72 overflow-y-auto">
                  <div className="p-3 space-y-1">
                    {pitches.map((pitch) => (
                      <label
                        key={pitch.id}
                        className="flex items-center gap-3 p-3 hover:bg-emerald-50 rounded-lg cursor-pointer transition"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPitchIds.includes(pitch.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPitchIds([...selectedPitchIds, pitch.id]);
                              if (editorRef.current) {
                                editorRef.current.innerHTML = pitch.bodyHtml || "";
                              }
                            } else {
                              setSelectedPitchIds(
                                selectedPitchIds.filter((id) => id !== pitch.id)
                              );
                            }
                          }}
                        />
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {pitch.name}
                          </p>
                          <p className="text-xs text-emerald-600">
                            Click to load template
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm border border-emerald-200/50 rounded-2xl overflow-visible shadow-lg relative z-[1]">
            <div className="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-3">
              <h3 className="text-sm font-bold text-emerald-600 uppercase tracking-wide">Email Content Editor</h3>
            </div>

            <div className="flex flex-wrap gap-2 p-3 border-b border-emerald-100 bg-white/50">
              <select
                value={currentFont}
                onChange={(e) => applyFontFamily(e.target.value)}
                className="px-3 py-1.5 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              <select
                value={currentSize}
                onChange={(e) => applyFontSize(e.target.value)}
                className="px-3 py-1.5 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-medium"
              >
                {FONT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>

              <div className="w-px h-7 bg-emerald-300 mx-1" />

              <ToolbarButton icon={<Bold size={16} />} onClick={() => formatText("bold")} title="Bold" />
              <ToolbarButton icon={<Italic size={16} />} onClick={() => formatText("italic")} title="Italic" />
              <ToolbarButton icon={<Underline size={16} />} onClick={() => formatText("underline")} title="Underline" />
              <ToolbarButton icon={<Strikethrough size={16} />} onClick={() => formatText("strikeThrough")} title="Strikethrough" />

              <div className="w-px h-7 bg-emerald-300 mx-1" />

              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="p-2 hover:bg-emerald-100 rounded-lg transition border border-emerald-200"
                  title="Text Color"
                >
                  <div className="w-5 h-5 rounded" style={{ backgroundColor: currentColor }} />
                </button>
                {showColorPicker && (
                  <div className="absolute z-50 mt-2 p-3 bg-white border border-emerald-200 rounded-xl shadow-xl" style={{ width: "280px" }}>
                    {COLOR_FAMILIES.map((family, familyIndex) => (
                      <div key={family.name} className={familyIndex > 0 ? "mt-3 pt-3 border-t border-emerald-200" : ""}>
                        <div className="text-xs font-medium text-slate-600 mb-2">{family.name}</div>
                        <div className="grid grid-cols-8 gap-1">
                          {family.colors.map((color, colorIndex) => (
                            <button
                              key={`${family.name}-${colorIndex}`}
                              onClick={() => applyColor(color)}
                              className="w-6 h-6 rounded border-2 border-emerald-200 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="w-px h-7 bg-emerald-300 mx-1" />

              <ToolbarButton icon={<AlignLeft size={16} />} onClick={() => formatText("justifyLeft")} title="Align Left" />
              <ToolbarButton icon={<AlignCenter size={16} />} onClick={() => formatText("justifyCenter")} title="Center" />
              <ToolbarButton icon={<AlignRight size={16} />} onClick={() => formatText("justifyRight")} title="Align Right" />
              <ToolbarButton icon={<AlignJustify size={16} />} onClick={() => formatText("justifyFull")} title="Justify" />

              <div className="w-px h-7 bg-emerald-300 mx-1" />

              <ToolbarButton icon={<List size={16} />} onClick={() => formatText("insertUnorderedList")} title="Bullet List" />
              <ToolbarButton icon={<ListOrdered size={16} />} onClick={() => formatText("insertOrderedList")} title="Numbered List" />

              <div className="w-px h-7 bg-emerald-300 mx-1" />

              <ToolbarButton icon={<Link size={16} />} onClick={insertLink} title="Insert Link" />
            </div>

            <div
              ref={editorRef}
              contentEditable
              className="min-h-[300px] max-h-[500px] overflow-y-auto p-5 outline-none bg-white"
              style={{ 
                fontFamily: currentFont, 
                fontSize: currentSize,
                lineHeight: "1.6",
                color: currentColor
              }}
              suppressContentEditableWarning
            />

            {attachments.length > 0 && (
              <div className="border-t border-emerald-100 p-4 bg-emerald-50/50">
                <p className="text-xs text-emerald-600 font-bold mb-3 uppercase tracking-wide">Attachments:</p>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-emerald-200 shadow-sm"
                    >
                      <Paperclip size={14} className="text-emerald-600" />
                      <span className="text-xs text-slate-700 font-medium">{file.name}</span>
                      <button onClick={() => removeAttachment(index)} className="p-1 hover:bg-red-100 rounded-full transition">
                        <X size={12} className="text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-emerald-200 p-4 flex justify-between items-center bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
              <div className="flex items-center gap-3">
                {!editingRole ? (
                  <>
                    <p className="text-sm font-semibold text-gray-700">
                      Sender: <span className="text-emerald-600">{senderRole || "Not Set"}</span>
                    </p>

                    <button
                      onClick={() => {
                        setTempRole(senderRole);
                        setEditingRole(true);
                      }}
                      className="text-xs text-blue-600 underline"
                    >
                      Edit
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={tempRole}
                      onChange={(e) => setTempRole(e.target.value)}
                      placeholder="Enter Job Title (e.g. VP Analyst)"
                      className="border rounded px-2 py-1 text-sm"
                    />

                    <button
                      onClick={handleSaveRole}
                      className="bg-emerald-600 text-white px-3 py-1 rounded text-sm"
                    >
                      Save
                    </button>
                  </>
                )}
              </div>


              {selectedPitchIds.length > 0 && (
                <button
                  onClick={savePitchTemplate}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-gradient-to-r from-emerald-600 to-green-600 text-white hover:shadow-lg rounded-lg transition font-bold"
                >
                  Save
                </button>
              )}

              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-white text-emerald-600 hover:bg-emerald-50 rounded-lg transition font-bold border border-emerald-200"
              >
                <Eye size={16} />
                {showPreview ? "Hide" : "Show"} Preview
              </button>
            </div>
          </div>

          {showPreview && (
            <div className="bg-white/80 backdrop-blur-sm border border-emerald-200/50 rounded-2xl p-6 shadow-lg">
              <h3 className="text-sm font-bold text-emerald-600 mb-4 uppercase tracking-wide">Email Preview</h3>
              <div className="border border-emerald-200 rounded-xl p-5 min-h-32 max-h-96 overflow-y-auto bg-white">
                <div className="mb-4 pb-4 border-b border-emerald-200">
                  <p className="text-xs text-emerald-600 font-semibold">From: {selectedFroms.length} account(s) selected</p>
                  <p className="text-xs text-emerald-600 font-semibold">To: {parsedEmails.length} recipient(s)</p>
                  <p className="text-base font-bold text-slate-900 mt-3">{subject || "No subject"}</p>
                  {campaignType === "scheduled" && scheduleDate && (
                    <p className="text-xs text-emerald-600 font-semibold mt-2">
                      Scheduled: {scheduleDate} at {scheduleTime}
                    </p>
                  )}
                </div>
                <div
                  dangerouslySetInnerHTML={{
                    __html: editorRef.current?.innerHTML || "<p>No content yet...</p>"
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="col-span-4 space-y-5">
          <div className="bg-white/80 backdrop-blur-sm border border-emerald-200/50 rounded-2xl p-6 shadow-lg">
            <h3 className="text-sm font-bold text-emerald-600 mb-4 uppercase tracking-wide flex items-center gap-2">
              <Users size={16} />
              Client Mails
            </h3>

            <div className="flex gap-6 mb-5">
              <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold text-slate-700">
                <input
                  type="radio"
                  checked={recipientMode === "manual"}
                  onChange={() => {
                    setRecipientMode("manual");
                    setCsvFile(null);
                  }}
                  className="w-4 h-4 text-emerald-600 border-emerald-300 focus:ring-emerald-500"
                />
                Manual Entry
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold text-slate-700">
                <input
                  type="radio"
                  checked={recipientMode === "file"}
                  onChange={() => {
                    setRecipientMode("file");
                    setManualEmails("");
                  }}
                  className="w-4 h-4 text-emerald-600 border-emerald-300 focus:ring-emerald-500"
                />
                Upload CSV
              </label>
            </div>

            {recipientMode === "manual" && (
              <div>
                <label className="block text-[13px] text-emerald-600 mb-2 font-bold tracking-wide">
                  Paste emails (comma or new line separated)
                </label>
                <textarea
                  rows={6}
                  value={manualEmails}
                  onChange={(e) => {
                    setManualEmails(e.target.value);
                    extractEmails(e.target.value);
                  }}
                  placeholder="client1@gmail.com&#10;client2@gmail.com, client3@gmail.com"
                  className="w-full border border-emerald-200 rounded-xl p-3.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 font-medium hover:border-emerald-300 transition-colors"
                />
              </div>
            )}

            {recipientMode === "file" && (
              <div>
                <label className="block text-[13px] text-emerald-600 mb-3 font-bold tracking-wide">
                  Upload CSV file containing emails
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    setCsvFile(e.target.files[0]);
                    handleCsvUpload(e.target.files[0]);
                  }}
                  className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-600 hover:file:bg-emerald-100"
                />
                {csvFile && (
                  <p className="text-xs text-emerald-600 font-semibold mt-3 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                    File selected: {csvFile.name}
                  </p>
                )}
              </div>
            )}

            <div className="mt-5 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-slate-900">
                Total Emails:
                <span className="ml-2 text-emerald-600 text-lg">
                  {parsedEmails.length}
                </span>
              </p>

              {selectedFroms.length > 0 && (
                <div className="text-xs text-emerald-600 bg-white border border-emerald-200 p-3 rounded-lg font-semibold space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    Continuous sending enabled
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap size={14} className="text-emerald-600" />
                    Capacity: {getCapacity()} emails/hour
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-emerald-600" />
                    Est. time: {Math.ceil(parsedEmails.length / getCapacity())} hour(s)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Daily Limit Warning ─────────────────────────────── */}
          {dailyLimit && parsedEmails.length > 0 && parsedEmails.length > dailyLimit.remaining && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-700">Daily Quota Exceeded</p>
                <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
                  You have only <strong>{dailyLimit.remaining.toLocaleString()}</strong> credits remaining today (out of{" "}
                  {dailyLimit.dailyLimit.toLocaleString()}). This campaign needs{" "}
                  <strong>{parsedEmails.length.toLocaleString()}</strong> recipients.
                  Please reduce recipients or try again tomorrow.
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={sending || (dailyLimit && parsedEmails.length > dailyLimit.remaining)}
            className={`w-full px-6 py-4 text-white rounded-xl font-black text-base transition-all flex items-center justify-center gap-3 shadow-lg transform hover:scale-105 ${
              sending || (dailyLimit && parsedEmails.length > dailyLimit.remaining)
                ? "opacity-60 cursor-not-allowed"
                : ""
            } ${
              campaignType === "immediate"
                ? "bg-gradient-to-r from-emerald-600 to-green-600 hover:shadow-emerald-500/50"
                : "bg-gradient-to-r from-emerald-600 to-green-600 hover:shadow-emerald-500/50"
            }`}
          >
            {sending ? (
              "Processing..."
            ) : (
              <>
                {campaignType === "immediate" ? <Zap size={20} /> : <Calendar size={20} />}
                {campaignType === "immediate" ? "Send Campaign Now" : "Schedule Campaign"}
              </>
            )}
          </button>

          {errorMsg && (
            <p className="text-sm text-red-600 font-semibold mt-2 bg-red-50 p-4 rounded-xl border border-red-200">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const ToolbarButton = ({ icon, onClick, title }) => (
  <button 
    onClick={onClick} 
    className="p-2 hover:bg-emerald-100 rounded-lg transition border border-transparent hover:border-emerald-200" 
    title={title}
  >
    {icon}
  </button>
);