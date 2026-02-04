import React, { useEffect, useState } from "react";
import { Send, Plus, Trash2, Eye, Mail, Users, Target, Zap, CheckCircle2, Calendar, Sparkles } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ------------------------------
// Enhanced UI components with green theme
// ------------------------------
const Card = ({ children, className = "" }) => (
  <div className={`bg-white/80 backdrop-blur-sm border border-emerald-200/50 rounded-2xl shadow-lg ${className}`}>{children}</div>
);

const CardHeader = ({ children }) => (
  <div className="px-6 py-5 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50">{children}</div>
);

const CardTitle = ({ children, className = "" }) => (
  <h2 className={`text-xl font-bold text-emerald-600 ${className}`}>{children}</h2>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`p-6 ${className}`}>{children}</div>
);

const Button = ({ children, className = "", variant = "default", size = "md", ...props }) => {
  const base = "inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all focus:outline-none transform hover:scale-105";
  const variants = {
    default: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:shadow-lg shadow-emerald-500/30",
    outline: "border-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300",
    ghost: "text-emerald-600 hover:bg-emerald-50",
  };
  const sizes = {
    sm: "px-4 py-2 text-xs",
    md: "px-6 py-3 text-sm",
    icon: "p-3",
  };

  return (
    <button {...props} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
};

export default function CampaignDetail() {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [loadedCampaign, setLoadedCampaign] = useState(null);

  const [subjects, setSubjects] = useState([]);
  const [followUpBody, setFollowUpBody] = useState("");
  const [originalBody, setOriginalBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [selectedPitchId, setSelectedPitchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [sendingFollowup, setSendingFollowup] = useState(false);
  const [modal, setModal] = useState({ open: false, type: "", message: "" });

  // ------------------------------
  // Fetch campaigns
  // ------------------------------
useEffect(() => {
  fetch(`${API_BASE_URL}/api/campaigns`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    },
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("Campaign API:", data);
      
      const allCampaigns = data.data || [];
      
      // Get IDs of campaigns that have completed follow-ups
      const campaignsWithFollowups = new Set();
      
      allCampaigns.forEach(c => {
        if (c.sendType === "followup" && c.status === "completed" && c.parentCampaignId) {
          campaignsWithFollowups.add(c.parentCampaignId);
        }
      });
      
      // Filter campaigns that:
      // 1. Are immediate or scheduled
      // 2. Are completed
      // 3. Are NOT parent campaigns (don't have parentCampaignId)
      // 4. Are at least 24 hours old
      // 5. DON'T already have a completed follow-up
      const filtered = allCampaigns.filter(c => {
        const completedTime = new Date(c.createdAt).getTime();
        const now = Date.now();
        const hours24 = 24 * 60 * 60 * 1000;

        return (
          (c.sendType === "immediate" || c.sendType === "scheduled") &&
          c.status === "completed" &&
          !c.parentCampaignId &&
          now - completedTime >= hours24 &&
          !campaignsWithFollowups.has(c.id)  // ✅ NEW: Exclude campaigns with completed follow-ups
        );
      });

      setCampaigns(filtered);
    })
    .catch(console.error);
}, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/accounts`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAccounts(data);
        } else if (Array.isArray(data.data)) {
          setAccounts(data.data);
        } else {
          setAccounts([]);
        }
      })
      .catch(console.error);
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
        const followupPitches = (data.data || []).filter(
          p => p.type === "followup"
        );
        setPitches(followupPitches);
      }
    } catch (err) {
      console.error("Failed to load pitches", err);
    }
  };

  fetchPitches();
}, []);

  const getFromEmails = () => {
    if (!loadedCampaign || !Array.isArray(accounts)) return [];

    let ids = [];
    try {
      ids = JSON.parse(loadedCampaign.fromAccountIds || "[]");
    } catch {}

    return accounts
      .filter(acc => ids.includes(acc.id))
      .map(acc => acc.email);
  };

const buildFollowupWithSignature = () => {
  return followUpBody || "";
};

const handleSelectCampaign = (id) => {
  setSelectedCampaignId(id);
  const campaign = campaigns.find((c) => String(c.id) === String(id));

  if (!campaign) return;

  setLoadedCampaign(campaign);

  try {
    const parsedSubjects = JSON.parse(campaign.subject || "[]");
    setSubjects(parsedSubjects.length ? parsedSubjects : [campaign.subject]);
  } catch {
    setSubjects([campaign.subject]);
  }

  // ✅ FIXED HERE
  const firstRecipient = campaign.recipients?.find(r => r.sentBodyHtml);

  setOriginalBody(
    firstRecipient?.sentBodyHtml ||
    campaign.bodyHtml ||
    ""
  );
};

const createFollowUp = async () => {
  // 🔴 STRICT VALIDATION: Campaign + Pitch BOTH REQUIRED
  if (!loadedCampaign || !selectedPitchId) {
    setModal({
      open: true,
      type: "error",
      message: "Please select Campaign and Pitch to send follow-up.",
    });
    return;
  }

  // Also ensure body is not empty (extra safety)
  const hasBody =
    followUpBody && followUpBody.replace(/<[^>]*>/g, "").trim() !== "";

  if (!hasBody) {
    setModal({
      open: true,
      type: "error",
      message: "Follow-up email body cannot be empty.",
    });
    return;
  }

  try {
    setSendingFollowup(true);

    const senderRecipientMap = {};

    let fromAccountIds = [];
    try {
      fromAccountIds = JSON.parse(loadedCampaign.fromAccountIds || "[]");
    } catch {}

    if (!fromAccountIds.length) {
      throw new Error("No sender accounts found in base campaign");
    }

    (loadedCampaign.recipients || []).forEach((r, index) => {
      const accountId =
        r.accountId || fromAccountIds[index % fromAccountIds.length];

      if (!senderRecipientMap[accountId]) {
        senderRecipientMap[accountId] = [];
      }

      senderRecipientMap[accountId].push(r.email);
    });

    const res = await fetch(`${API_BASE_URL}/api/campaigns/followup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({
        baseCampaignId: loadedCampaign.id,
        subjects,
        bodyHtml: buildFollowupWithSignature(),
        senderRecipientMap,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || "Follow-up failed");
    }

    // ✅ SUCCESS
    setModal({
      open: true,
      type: "success",
      message: "Follow-up campaign started successfully. Emails are now sending.",
    });
  } catch (err) {
    setModal({
      open: true,
      type: "error",
      message: err.message || "Something went wrong",
    });
  } finally {
    setSendingFollowup(false);
  }
};



  const froms = getFromEmails();
// Save email body
  const saveEmailBody = async () => {
  if (!loadedCampaign) return alert("Select campaign first");

  try {
    setSaving(true);
    setSaveMsg("");

    const res = await fetch(
      `${API_BASE_URL}/api/campaigns/${loadedCampaign.id}/followup-body`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          bodyHtml: followUpBody,
        }),
      }
    );

    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    setSaveMsg("Email body saved successfully ✅");
  } catch (err) {
    setSaveMsg("Failed to save ❌");
  } finally {
    setSaving(false);
  }
};

useEffect(() => {
  // Option 1: Use dedicated endpoint (if you add the backend method above)
  fetch(`${API_BASE_URL}/api/campaigns/for-followup`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    },
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("Campaigns available for follow-up:", data);
      setCampaigns(data.data || []);
    })
    .catch(console.error);
}, []);

  return (
    <div className="grid grid-cols-12 gap-6 p-6 bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 min-h-screen relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '6s'}}></div>
        <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-teal-200/20 rounded-full blur-3xl animate-pulse" style={{animationDuration: '8s', animationDelay: '2s'}}></div>
      </div>

      {/* Left */}
      <div className="col-span-8 space-y-6 relative z-10">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl">
                <Sparkles className="text-emerald-600" size={24} />
              </div>
              <CardTitle>Follow-up Campaign</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Campaign selector */}
            <div>
              <label className="text-sm font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-2 mb-3">
                <Target size={16} />
                Select Campaign
              </label>
              <select
                className="w-full border-2 border-emerald-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium hover:border-emerald-300 transition-colors bg-white"
                value={selectedCampaignId}
                onChange={(e) => handleSelectCampaign(e.target.value)}
              >
                <option value="">Choose campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Email header preview */}
            {loadedCampaign && (
              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-xl p-5 text-sm space-y-3">
                
                {/* From */}
                <div className="flex items-start gap-2">
                  <Mail size={16} className="text-emerald-600 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold text-emerald-900">From:</span> 
                    <span className="ml-2 text-slate-700">{getFromEmails()[0] || "—"}</span>
                    <p className="text-xs text-emerald-600 font-semibold mt-1">
                      Rotates between {getFromEmails().length} accounts
                    </p>
                  </div>
                </div>

                {/* Sent */}
                <div className="flex items-start gap-2">
                  <Calendar size={16} className="text-emerald-600 mt-0.5" />
                  <div>
                    <span className="font-bold text-emerald-900">Sent:</span> 
                    <span className="ml-2 text-slate-700">{new Date(loadedCampaign.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* To */}
                <div className="flex items-start gap-2">
                  <Users size={16} className="text-emerald-600 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold text-emerald-900">To:</span> 
                    <span className="ml-2 text-slate-700">{loadedCampaign.recipients?.[0]?.email || "—"}</span>
                    <p className="text-xs text-emerald-600 font-semibold mt-1">
                      Will send to total {loadedCampaign.recipients?.length || 0} recipients (distributed automatically)
                    </p>
                  </div>
                </div>

                {/* Subject */}
                <div className="flex items-start gap-2">
                  <Mail size={16} className="text-emerald-600 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold text-emerald-900">Subject:</span> 
                    <span className="ml-2 text-slate-700">{subjects[0]}</span>
                    <p className="text-xs text-emerald-600 font-semibold mt-1">
                      Rotates between {subjects.length} subject lines
                    </p>
                  </div>
                </div>
              </div>
            )}


            {/* Subjects */}
              {/* Subjects (Read-only from original campaign) */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide">Subject Lines (from original campaign)</h3>

              {subjects.map((sub, i) => (
                <div
                  key={i}
                  className="border-2 border-emerald-200 rounded-xl px-4 py-3 text-sm bg-white text-slate-800 font-medium hover:border-emerald-300 transition-colors"
                >
                  {sub}
                </div>
              ))}
            </div>


            {/* Pitch selector */}
            <div>
              <label className="text-sm font-bold text-emerald-800 uppercase tracking-wide mb-3 block">Select Pitch</label>
              <select
                className="w-full border-2 border-emerald-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium hover:border-emerald-300 transition-colors bg-white"
                value={selectedPitchId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedPitchId(id);

                  const pitch = pitches.find(p => String(p.id) === id);
                  if (!pitch) return;

                  setFollowUpBody(pitch.bodyHtml || "");
                }}
              >

                <option value="">Manual / Custom</option>
                {pitches.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>


            {/* Body */}
            <div>
              <label className="text-sm font-bold text-emerald-800 uppercase tracking-wide mb-3 block">Email Body</label>

              <div
                className="w-full border-2 border-emerald-200 rounded-xl px-5 py-4 text-sm min-h-[200px] bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 hover:border-emerald-300 transition-colors"
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setFollowUpBody(e.currentTarget.innerHTML)}
                dangerouslySetInnerHTML={{ __html: followUpBody }}
              />

            </div>


            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setPreview(!preview)}>
                <Eye className="w-5 h-5" /> Preview
              </Button>
              <Button
                onClick={createFollowUp}
                 disabled={sendingFollowup || !loadedCampaign || !selectedPitchId}

              >
                {sendingFollowup ? (
                  <span className="animate-pulse">Sending...</span>
                ) : (
                  <>
                    <Zap className="w-5 h-5" /> Create Follow-up
                  </>
                )}
              </Button>



            </div>
          </CardContent>
        </Card>

        {/* Preview panel */}
        {preview && loadedCampaign && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl">
                  <Eye className="text-emerald-600" size={20} />
                </div>
                <CardTitle>Email Preview</CardTitle>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 text-base text-black">

              {/* 1. FOLLOW-UP (top) */}
              <div className="border-2 border-emerald-200 rounded-xl p-5 bg-white shadow-sm">
                <div className="font-bold text-emerald-800 mb-3 uppercase tracking-wide text-sm">Follow-up</div>
                <div dangerouslySetInnerHTML={{ __html: buildFollowupWithSignature() }} />
              </div>

              {/* 2. THREAD HEADER (like Gmail) */}
              <div className="border-t-2 border-emerald-200 pt-5 text-sm space-y-2 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 rounded-xl border-2">
                <div className="font-bold text-emerald-900">From: <span className="font-normal text-slate-700">{froms[0] || "—"}</span></div>
                <div className="text-xs text-emerald-600 font-semibold">
                  Sending will rotate between:
                  <ul className="list-disc ml-5 mt-1">
                    {froms.map(f => <li key={f}>{f}</li>)}
                  </ul>
                </div>
                <div className="font-bold text-emerald-900">Sent: <span className="font-normal text-slate-700">{new Date(loadedCampaign.createdAt).toLocaleString()}</span></div>
                <div className="font-bold text-emerald-900">To: <span className="font-normal text-slate-700">{loadedCampaign.recipients?.[0]?.email || "—"}</span></div>
                <div className="text-xs text-emerald-600 font-semibold">
                  Will send to total {loadedCampaign.recipients?.length || 0} recipients (distributed automatically)
                </div>
                 
                <div className="font-bold text-emerald-900">Subject: <span className="font-normal text-slate-700">{subjects[0]}</span></div>
              </div>


              {/* 3. ORIGINAL CAMPAIGN (bottom) */}
              <div className="border-2 border-emerald-200 rounded-xl p-5 bg-white text-base text-black shadow-sm">
                <div className="font-bold text-emerald-800 mb-3 uppercase tracking-wide text-sm">Previous message</div>
                <div dangerouslySetInnerHTML={{ __html: originalBody }} />
              </div>


            </CardContent>
          </Card>
        )}

        
      </div>

      {/* Right summary */}
      <div className="col-span-4 relative z-10">
        <Card className="sticky top-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl">
                <Target className="text-emerald-600" size={18} />
              </div>
              <CardTitle className="text-base">Summary</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            {/* Campaign Name */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-200">
              <p className="text-xs text-emerald-700 font-bold uppercase tracking-wide mb-1.5">Campaign</p>
              <p className="font-bold text-slate-900 text-base">
                {loadedCampaign?.name || "Not selected"}
              </p>
            </div>

            {/* From Mail Accounts Count */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-200">
              <p className="text-xs text-emerald-700 font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Mail size={12} />
                From Mail Accounts
              </p>
              <p className="font-black text-slate-900 text-2xl">
                {getFromEmails().length}
              </p>
            </div>

            {/* Subjects Count */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-200">
              <p className="text-xs text-emerald-700 font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Target size={12} />
                Subjects
              </p>
              <p className="font-black text-slate-900 text-2xl">
                {subjects.length}
              </p>
            </div>

            {/* Recipients Count */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-200">
              <p className="text-xs text-emerald-700 font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <Users size={12} />
                Recipients
              </p>
              <p className="font-black text-slate-900 text-2xl">
                {loadedCampaign?.recipients?.length || 0}
              </p>
            </div>
          </CardContent>

        </Card>
      </div>

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-8 w-full max-w-md shadow-2xl space-y-5 border-2 border-emerald-200 transform scale-100 animate-in">
            
            <div className="flex items-center gap-3">
              {modal.type === "success" ? (
                <div className="p-3 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl">
                  <CheckCircle2 className="text-emerald-600" size={28} />
                </div>
              ) : (
                <div className="p-3 bg-gradient-to-br from-red-100 to-orange-100 rounded-xl">
                  <X className="text-red-600" size={28} />
                </div>
              )}
              <h2 className={`text-xl font-black ${
                modal.type === "success" ? "text-emerald-700" : "text-red-600"
              }`}>
                {modal.type === "success" ? "Success!" : "Error"}
              </h2>
            </div>

            <p className="text-base text-slate-700 font-medium leading-relaxed">
              {modal.message}
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setModal({ open: false, type: "", message: "" })}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-bold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 transform hover:scale-105 transition-all"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>

    
  );
}