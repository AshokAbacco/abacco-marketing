import { useState, useRef, useEffect } from "react";
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
  CheckCircle2
} from "lucide-react";

const FONT_FAMILIES = [
  { value: "Calibri, sans-serif", label: "Calibri" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Verdana, sans-serif", label: "Verdana" },
];

const FONT_SIZES = [
  { value: "8pt", label: "8" },
  { value: "10pt", label: "10" },
  { value: "11pt", label: "11" },
  { value: "12pt", label: "12" },
  { value: "13pt", label: "13" },
  { value: "14pt", label: "14" },
  { value: "16pt", label: "16" },
  { value: "18pt", label: "18" },
  { value: "20pt", label: "20" },
  { value: "24pt", label: "24" },
  { value: "28pt", label: "28" },
  { value: "32pt", label: "32" },
  { value: "36pt", label: "36" },
  { value: "40pt", label: "40" },
  { value: "48pt", label: "48" },
  { value: "56pt", label: "56" },
];


const COLORS = [
  "#000000", "#444444", "#666666", "#999999", "#CCCCCC", "#EEEEEE",
  "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#9900FF", "#FF00FF",
];

// 🔥 NEW: Email limit options per hour
const LIMIT_OPTIONS = [20, 30, 40, 50, 70, 80, 100, 150];

export default function CreateCampaign() {
  const [accounts, setAccounts] = useState([]);
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
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [customLimits, setCustomLimits] = useState({}); // 🔥 NEW: Store custom limits per account

  const [campaignType, setCampaignType] = useState("immediate");
  const [subject, setSubject] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [attachments, setAttachments] = useState([]);

  const [currentFont, setCurrentFont] = useState("Calibri, sans-serif");
  const [currentSize, setCurrentSize] = useState("11pt");
  const [currentColor, setCurrentColor] = useState("#000000");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [customSize, setCustomSize] = useState("");

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

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

  // Map pt sizes to execCommand sizes (1–7)
const sizeMap = {
  "8pt": "1",
  "10pt": "2",
  "11pt": "2",
  "12pt": "3",
  "13pt": "3",
  "14pt": "4",
  "16pt": "5",
  "18pt": "6",
  "20pt": "6",
  "24pt": "7",
  "28pt": "7",
  "32pt": "7",
  "36pt": "7",
  "40pt": "7",
  "48pt": "7",
  "56pt": "7",
 
};

  document.execCommand("fontSize", false, sizeMap[size] || "3");

  // Fix the ugly <font size="..."> tags and convert to inline style
  const editor = editorRef.current;
  const fonts = editor.querySelectorAll("font[size]");
  fonts.forEach(font => {
    font.removeAttribute("size");
    font.style.fontSize = size;
  });

  editor.focus();
};


  const applyColor = (color) => {
    setCurrentColor(color);
    formatText("foreColor", color);
    setShowColorPicker(false);
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

  // Fetch locked accounts every 4 seconds
  useEffect(() => {
    const fetchLocked = async () => {
        try {
          const token = localStorage.getItem("token");

          const res = await fetch("http://localhost:5000/api/campaigns/accounts/locked", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            console.error("Failed to fetch locked accounts:", res.status);
            return;
          }

          const data = await res.json();

          if (data.success && Array.isArray(data.data)) {
            setLockedAccounts(data.data);
          }
        } catch (err) {
          console.error("Failed to fetch locked accounts", err);
        }
    };


    fetchLocked();
    const timer = setInterval(fetchLocked, 4000);
    return () => clearInterval(timer);
  }, []);

  // Auto-deselect locked accounts
  useEffect(() => {
    if (campaignType === "immediate") {
      setSelectedFroms(prev => prev.filter(id => !lockedAccounts.includes(id)));
    }
  }, [lockedAccounts, campaignType]);


  // Fetch email accounts
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/api/accounts", {
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

  // Fetch pitches
  useEffect(() => {
    const fetchPitches = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/api/pitches", {
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

  // Fetch existing campaign names
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("http://localhost:5000/api/campaigns", {
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
      if (!editorRef.current?.innerHTML?.trim() && selectedPitchIds.length === 0) {
        return setErrorMsg("Email content is empty");
      }
      if (campaignType === "scheduled" && (!scheduleDate || !scheduleTime)) {
        return setErrorMsg("Please select schedule date and time");
      }

      // 🔥 REMOVED: Capacity check - now sends continuously
      // const capacity = getCapacity();
      // if (parsedEmails.length > capacity) {
      //   return setErrorMsg(...);
      // }

      setSending(true);

      const token = localStorage.getItem("token");
      const res = await fetch("http://localhost:5000/api/campaigns", {
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
          scheduledAt: campaignType === "scheduled" ? `${scheduleDate}T${scheduleTime}` : null,
          customLimits: customLimits // 🔥 NEW: Pass custom limits to backend
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to create campaign");
      }

      if (campaignType === "immediate") {
        const sendRes = await fetch(`http://localhost:5000/api/campaigns/${data.data.id}/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const sendData = await sendRes.json();
        if (!sendData.success) {
          throw new Error("Campaign created but sending failed");
        }
      }

      alert(campaignType === "immediate" ? "Campaign sent successfully! It will continue sending automatically." : "Campaign scheduled successfully!");

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
    const updatedSubject = subject || "";

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`http://localhost:5000/api/pitches/${pitchId}`, {
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

// 🔥 UPDATED: Get default limit for an account
const getDefaultLimit = (provider) => {
  const key = (provider || "custom").toLowerCase();
  return LIMITS[key] || LIMITS.custom;
};

// 🔥 NEW: Get actual limit (custom or default) for an account
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

  // Calculate available vs locked accounts
const availableAccounts =
  campaignType === "scheduled"
    ? accounts
    : accounts.filter(acc => !lockedAccounts.includes(Number(acc.id)));

const lockedAccountsList =
  campaignType === "scheduled"
    ? []
    : accounts.filter(acc => lockedAccounts.includes(Number(acc.id)));

const lockedAccountsCount = lockedAccountsList.length;


  return (
    <div className="space-y-6 p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Campaign</h1>
          <p className="text-sm text-gray-500 mt-1">Send immediate or scheduled email campaigns (continuous sending)</p>
        </div>
      </div>

      {/* Campaign Type Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setCampaignType("immediate")}
          className={`px-6 py-2 rounded-lg font-medium transition ${
            campaignType === "immediate"
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
          }`}
        >
          <Send className="inline mr-2" size={16} />
          Immediate Campaign
        </button>
        <button
          onClick={() => setCampaignType("scheduled")}
          className={`px-6 py-2 rounded-lg font-medium transition ${
            campaignType === "scheduled"
              ? "bg-green-600 text-white"
              : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
          }`}
        >
          <Calendar className="inline mr-2" size={16} />
          Scheduled Campaign
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Side */}
        <div className="col-span-8 space-y-4">
          {/* Campaign Details */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Campaign Name</label>
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
                className="w-full border rounded-lg p-3"
              />
              {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
            </div>

            {/* From Email Accounts - ENHANCED */}
            <div className="relative">
              <label className="block text-sm font-medium mb-2">From Email Accounts</label>

              {/* Status Summary */}
              <div className="flex items-center gap-4 mb-2 text-xs">
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 size={14} />
                  {availableAccounts.length} Available
                </span>
                {lockedAccountsCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600">
                    <Lock size={14} />
                    {lockedAccountsCount} In Use
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowFromDropdown(!showFromDropdown)}
                className="w-full border rounded-lg p-3 text-left flex justify-between items-center bg-white hover:bg-gray-50 transition"
              >
                <span className="text-gray-700">
                  {selectedFroms.length > 0 
                    ? `${selectedFroms.length} account(s) selected` 
                    : "Select From Emails"}
                </span>
                <ChevronDown size={16} className={`transition-transform ${showFromDropdown ? 'rotate-180' : ''}`} />
              </button>

             {showFromDropdown && (
                <div className="absolute z-50 mt-2 w-full bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">

                  {/* AVAILABLE ACCOUNTS */}
                  {availableAccounts.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                        Available Accounts (Set Email Limit per Hour)
                      </div>

                      {availableAccounts.map(acc => (
                        <label
                          key={acc.id}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50 cursor-pointer border-b"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFroms.includes(acc.id)}
                            onChange={() => {
                              setSelectedFroms(prev =>
                                prev.includes(acc.id)
                                  ? prev.filter(id => id !== acc.id)
                                  : [...prev, acc.id]
                              );
                            }}
                            className="mt-1"
                          />

                          <div className="flex-1">
                            <div className="font-medium text-sm text-gray-800">
                              {acc.senderName || acc.email}
                            </div>
                            <div className="text-xs text-gray-500">{acc.email}</div>
                            <div className="text-xs text-gray-400">Provider: {acc.provider}</div>
                            
                            {/* 🔥 NEW: Per-domain limit dropdown */}
                            <div className="mt-2 flex items-center gap-2">
                              <label className="text-xs text-gray-600">Limit per hour:</label>
                              <select
                                value={customLimits[acc.id] || getDefaultLimit(acc.provider)}
                                onChange={(e) => {
                                  const newLimit = Number(e.target.value);
                                  setCustomLimits(prev => ({
                                    ...prev,
                                    [acc.id]: newLimit
                                  }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs border rounded px-2 py-1 bg-white"
                              >
                                {LIMIT_OPTIONS.map(limit => (
                                  <option key={limit} value={limit}>
                                    {limit} emails/hr
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <CheckCircle2 size={18} className="text-green-500 mt-1" />
                        </label>
                      ))}
                    </>
                  )}

                  {/* LOCKED ACCOUNTS */}
                  {lockedAccountsList.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 border-b">
                        Locked (Campaign Sending)
                      </div>

                      {lockedAccountsList.map(acc => (
                        <div
                          key={acc.id}
                          className="flex items-start gap-3 px-4 py-3 border-b bg-gray-50 opacity-70 cursor-not-allowed"
                        >
                          <input
                            type="checkbox"
                            disabled
                            className="mt-1 cursor-not-allowed"
                          />

                          <div className="flex-1">
                            <div className="font-medium text-sm text-gray-700">
                              {acc.senderName || acc.email}
                            </div>
                            <div className="text-xs text-gray-500">{acc.email}</div>
                            <div className="text-xs text-gray-400">Provider: {acc.provider}</div>
                            <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
                              <Lock size={12} />
                              Campaign in progress
                            </div>
                          </div>

                          <Lock size={18} className="text-red-500 mt-1" />
                        </div>
                      ))}
                    </>
                  )}

                </div>
              )}


              <p className="text-xs text-gray-500 mt-2">
                Selected: {selectedFroms.length} account(s) • Total capacity: {getCapacity()} emails/hour
              </p>
            </div>

            {/* Subjects */}
            <div>
              <label className="block text-sm font-medium mb-2">Subjects (one per line)</label>
              <textarea
                rows={4}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject 1&#10;Subject 2&#10;Subject 3"
                className="w-full border rounded-lg p-3"
              />
              <p className="text-xs text-gray-500 mt-1">
                Total Subjects: {subject.split("\n").filter(s => s.trim()).length}
              </p>
            </div>

            {/* Pitch Templates */}
            <div className="relative">
              <label className="block text-sm font-medium mb-2">Pitch Templates (optional)</label>
              <button
                type="button"
                onClick={() => setShowPitchDropdown(!showPitchDropdown)}
                className="w-full border rounded-lg p-3 text-left flex justify-between items-center bg-white hover:bg-gray-50 transition"
              >
                <span className="text-gray-700">
                  {selectedPitchIds.length > 0 
                    ? `${selectedPitchIds.length} pitch(es) selected` 
                    : "Select Pitch Templates"}
                </span>
                <ChevronDown size={16} />
              </button>

              {showPitchDropdown && (
                <div className="absolute z-50 mt-2 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {pitches.map((pitch) => (
                    <label
                      key={pitch.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-3 py-2 border-b"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPitchIds.includes(pitch.id)}
                        onChange={() => {
                          setSelectedPitchIds(prev => {
                            let updated;
                            if (prev.includes(pitch.id)) {
                              updated = prev.filter(id => id !== pitch.id);
                            } else {
                              updated = [...prev, pitch.id];
                            }
                            const last = updated[updated.length - 1];
                            const selectedPitch = pitches.find(p => p.id === last);
                            if (selectedPitch && editorRef.current) {
                              
                              editorRef.current.innerHTML = selectedPitch.bodyHtml || "";
                            }
                            return updated;
                          });
                        }}
                      />
                      {pitch.name}
                    </label>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500 mt-2">
                Selected: {selectedPitchIds.length} pitch(es)
              </p>
            </div>

            {/* Schedule Date/Time */}
            {campaignType === "scheduled" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Clock className="inline mr-1" size={14} />
                    Schedule Date
                  </label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    <Clock className="inline mr-1" size={14} />
                    Schedule Time
                  </label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-4 py-2.5 border rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Email Editor */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <h3 className="text-sm font-semibold text-gray-700 p-4 border-b bg-gray-50">
              Email Body
            </h3>

            {/* Formatting Toolbar */}
            <div className="flex flex-wrap items-center gap-1 p-3 border-b bg-gray-50">
              {/* Font Family */}
              <select value={currentFont} onChange={(e) => applyFontFamily(e.target.value)} className="text-sm border rounded px-2 py-1 bg-white">
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              {/* Font Size */}
              <select value={currentSize} onChange={(e) => applyFontSize(e.target.value)} className="text-sm border rounded px-2 py-1 bg-white w-16">
                {FONT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>

              <div className="w-px h-6 bg-gray-300 mx-1" />

              <ToolbarButton icon={<Bold size={16} />} onClick={() => formatText("bold")} title="Bold" />
              <ToolbarButton icon={<Italic size={16} />} onClick={() => formatText("italic")} title="Italic" />
              <ToolbarButton icon={<Underline size={16} />} onClick={() => formatText("underline")} title="Underline" />
              <ToolbarButton icon={<Strikethrough size={16} />} onClick={() => formatText("strikeThrough")} title="Strikethrough" />

              <div className="w-px h-6 bg-gray-300 mx-1" />

              {/* Text Color */}
              <div className="relative">
                <button onClick={() => setShowColorPicker(!showColorPicker)} className="p-2 hover:bg-gray-200 rounded transition" title="Text Color">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: currentColor, border: "1px solid #ccc" }} />
                </button>

                {showColorPicker && (
                  <div className="absolute z-10 mt-1 p-2 bg-white border rounded shadow-lg">
                    <div className="grid grid-cols-7 gap-1">
                      {COLORS.map(color => (
                        <button key={color} onClick={() => applyColor(color)} className="w-6 h-6 rounded border hover:scale-110 transition" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-6 bg-gray-300 mx-1" />

              <ToolbarButton icon={<AlignLeft size={16} />} onClick={() => formatText("justifyLeft")} title="Align Left" />
              <ToolbarButton icon={<AlignCenter size={16} />} onClick={() => formatText("justifyCenter")} title="Align Center" />
              <ToolbarButton icon={<AlignRight size={16} />} onClick={() => formatText("justifyRight")} title="Align Right" />
              <ToolbarButton icon={<AlignJustify size={16} />} onClick={() => formatText("justifyFull")} title="Justify" />

              <div className="w-px h-6 bg-gray-300 mx-1" />

              <ToolbarButton icon={<List size={16} />} onClick={() => formatText("insertUnorderedList")} title="Bullet List" />
              <ToolbarButton icon={<ListOrdered size={16} />} onClick={() => formatText("insertOrderedList")} title="Numbered List" />

              <div className="w-px h-6 bg-gray-300 mx-1" />

              <ToolbarButton icon={<Link size={16} />} onClick={insertLink} title="Insert Link" />
            </div>

            {/* Editor Area */}
            <div
              ref={editorRef}
              contentEditable
              className="min-h-[300px] max-h-[500px] overflow-y-auto p-4 outline-none text-gray-900"
              style={{ fontFamily: currentFont, fontSize: currentSize }}
              suppressContentEditableWarning
            />

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="border-t p-3 bg-gray-50">
                <p className="text-xs text-gray-600 mb-2">Attachments:</p>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200"
                    >
                      <Paperclip size={14} className="text-gray-500" />
                      <span className="text-xs text-gray-700">{file.name}</span>
                      <button onClick={() => removeAttachment(index)} className="p-0.5 hover:bg-gray-200 rounded-full">
                        <X size={12} className="text-gray-500" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 p-3 flex justify-between items-center bg-gray-50">
              <div>
                <input ref={fileInputRef} type="file" multiple onChange={handleAttachmentUpload} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg"
                >
                  <Paperclip size={16} />
                  Attach files
                </button>
              </div>

              {selectedPitchIds.length > 0 && (
                <button
                  onClick={savePitchTemplate}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded-lg"
                >
                  Save
                </button>
              )}

              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg transition"
              >
                <Eye size={16} />
                {showPreview ? "Hide" : "Show"} Preview
              </button>
            </div>
          </div>

          {/* Preview Section */}
          {showPreview && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Email Preview</h3>
              <div className="border border-gray-200 rounded-lg p-4 min-h-32 max-h-96 overflow-y-auto bg-gray-50">
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <p className="text-xs text-gray-500">From: {selectedFroms.length} account(s) selected</p>
                  <p className="text-xs text-gray-500">To: {parsedEmails.length} recipient(s)</p>
                  <p className="text-sm font-medium text-gray-800 mt-2">{subject || "No subject"}</p>
                  {campaignType === "scheduled" && scheduleDate && (
                    <p className="text-xs text-gray-500 mt-1">
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

        {/* Right Side - Client Mails */}
        <div className="col-span-4 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              Client Mails
            </h3>

            {/* Mode Selector */}
            <div className="flex gap-6 mb-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={recipientMode === "manual"}
                  onChange={() => {
                    setRecipientMode("manual");
                    setCsvFile(null);
                  }}
                />
                Manual Entry
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  checked={recipientMode === "file"}
                  onChange={() => {
                    setRecipientMode("file");
                    setManualEmails("");
                  }}
                />
                Upload CSV
              </label>
            </div>

            {/* Manual Entry */}
            {recipientMode === "manual" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
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
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* CSV Upload */}
            {recipientMode === "file" && (
              <div>
                <label className="block text-xs text-gray-500 mb-2">
                  Upload CSV file containing emails
                </label>

                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    setCsvFile(e.target.files[0]);
                    handleCsvUpload(e.target.files[0]);
                  }}
                  className="w-full text-sm"
                />

                {csvFile && (
                  <p className="text-xs text-green-600 mt-2">
                    File selected: {csvFile.name}
                  </p>
                )}
              </div>
            )}

            {/* Email Count */}
            <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Total Emails:
                <span className="ml-2 text-blue-600 font-bold">
                  {parsedEmails.length}
                </span>
              </p>

              {selectedFroms.length > 0 && (
                <div className="text-xs text-blue-600 bg-blue-50 border border-blue-200 p-2 rounded">
                  ✅ Continuous sending enabled<br/>
                  📊 Capacity: {getCapacity()} emails/hour<br/>
                  ⏱️ Est. time: {Math.ceil(parsedEmails.length / getCapacity())} hour(s)
                </div>
              )}

            </div>

          </div>

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={sending}
            className={`w-full px-6 py-3 text-white rounded-lg font-medium transition flex items-center justify-center gap-2
              ${sending ? "opacity-60 cursor-not-allowed" : ""}
              ${campaignType === "immediate" ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}
            `}
          >
            {sending ? (
              "Processing..."
            ) : (
              <>
                {campaignType === "immediate" ? <Send size={18} /> : <Calendar size={18} />}
                {campaignType === "immediate" ? "Send Campaign Now" : "Schedule Campaign"}
              </>
            )}
          </button>

          {errorMsg && (
            <p className="text-sm text-red-600 mt-2 bg-red-50 p-3 rounded-lg border border-red-200">{errorMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const ToolbarButton = ({ icon, onClick, title }) => (
  <button onClick={onClick} className="p-2 hover:bg-gray-200 rounded transition" title={title}>
    {icon}
  </button>
)