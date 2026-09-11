// FIXED: CampaignDetail.jsx - Follow-up creation and preview fixes
import React, { useEffect, useState } from "react";
import { Send, Plus, Trash2, Eye, Mail, Users, Target, Zap, CheckCircle2, Calendar, Sparkles, X, UserCog, Lock, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { useDailyLimit } from "./DailyLimitBanner";
import ShowsRecipients from "./ShowsRecipients";
import { useParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ------------------------------
// Enhanced UI components with blue theme
// ------------------------------
const Card = ({ children, className = "" }) => (
  <div className={`bg-white/80 backdrop-blur-sm border border-sky-200/50 rounded-2xl shadow-lg ${className}`}>{children}</div>
);

const CardHeader = ({ children }) => (
  <div className="px-6 py-5 border-b border-sky-100 bg-gradient-to-r from-sky-50 to-blue-50">{children}</div>
);

const CardTitle = ({ children, className = "" }) => (
  <h2 className={`text-xl font-bold text-sky-600 ${className}`}>{children}</h2>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`p-6 ${className}`}>{children}</div>
);

const Button = ({ children, className = "", variant = "default", size = "md", ...props }) => {
  const base = "inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all focus:outline-none transform hover:scale-105";
  const variants = {
    default: "bg-gradient-to-r from-sky-600 to-blue-600 text-white hover:shadow-lg shadow-sky-500/30",
    outline: "border-2 border-sky-200 text-sky-700 hover:bg-sky-50 hover:border-sky-300",
    ghost: "text-sky-600 hover:bg-sky-50",
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
  const [loadingCampaigns, setLoadingCampaigns] = useState(true); // ✅ PERF FIX: track loading state for dropdown
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
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [campaignData, setCampaignData] = useState(null);
  const [followupLevel, setFollowupLevel] = useState(1);
  // ⚡ Full list of SENT recipients for the selected campaign.
  // Loaded from /:id/recipients?status=sent, which is unpaginated and returns
  // only id/email/accountId/status. The list endpoints no longer embed
  // recipients at all, and /:id/view paginates them, so neither can be used
  // to build a follow-up without silently dropping people.
  const [allSentRecipients, setAllSentRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientsError, setRecipientsError] = useState("");
  const [campaignsHasMore, setCampaignsHasMore] = useState(false);
  const [campaignsTotal, setCampaignsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const { id } = useParams();

  // ── Daily limit ─────────────────────────────────────────────
  const dailyLimit = useDailyLimit();


  // ------------------------------
  // Fetch campaigns
  // ------------------------------
  const CAMPAIGN_PAGE_SIZE = 6;

  // Loads one page of eligible follow-up campaigns.
  // append=false → first page (replaces the list); append=true → Load More.
  const fetchCampaigns = async (level = 1, { append = false } = {}) => {
    const offset = append ? campaigns.length : 0;

    if (append) setLoadingMore(true);
    else setLoadingCampaigns(true);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/campaigns/for-followup?level=${level}` +
        `&limit=${CAMPAIGN_PAGE_SIZE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const items = data.success ? (data.data || []) : [];
      setCampaigns(prev => (append ? [...prev, ...items] : items));
      setCampaignsHasMore(Boolean(data.hasMore));
      setCampaignsTotal(data.total ?? items.length);
    } catch (err) {
      console.error("Failed to load follow-up campaigns", err);
      if (!append) {
        setCampaigns([]);
        setCampaignsHasMore(false);
        setCampaignsTotal(0);
      }
    } finally {
      if (append) setLoadingMore(false);
      else setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    // Switching level starts a fresh list.
    setCampaigns([]);
    setCampaignsHasMore(false);
    setCampaignsTotal(0);
    fetchCampaigns(followupLevel, { append: false });
  }, [followupLevel]);


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

  const handleSelectCampaign = async (id) => {
    setSelectedCampaignId(id);
    const campaign = campaigns.find((c) => String(c.id) === String(id));

    if (!campaign) {
      setLoadedCampaign(null);
      setAllSentRecipients([]);
      setOriginalBody("");
      return;
    }

    setLoadedCampaign(campaign);
    setAllSentRecipients([]);
    setOriginalBody("");

    try {
      const parsedSubjects = JSON.parse(campaign.subject || "[]");
      setSubjects(parsedSubjects.length ? parsedSubjects : [campaign.subject]);
    } catch {
      setSubjects([campaign.subject]);
    }

    const token = localStorage.getItem("token");
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    setLoadingRecipients(true);
    setRecipientsError("");
    try {
      // ⚡ One request instead of three. This used to be:
      //   GET /:id/view?pageSize=1                (parallel)
      //   GET /:id/recipients?status=sent          (parallel, but UNPAGINATED —
      //                                              every sent row, could be
      //                                              thousands, just to show 2
      //                                              addresses + a count)
      //   GET /:id/recipients/:recipientId/body    (only started AFTER the
      //                                              recipients call resolved —
      //                                              a fully sequential 3rd
      //                                              round trip)
      // /followup-preview does the equivalent work server-side with 3 tiny,
      // parallel DB queries (a COUNT + a take:3 findMany) and returns one
      // small payload — no large recipient list on this critical path.
      // The full unpaginated list (needed to build senderRecipientMap) is
      // now fetched lazily in createFollowUp, only when actually sending.
      const res = await fetch(
        `${API_BASE_URL}/api/campaigns/${campaign.id}/followup-preview`,
        auth
      );

      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "GET /api/campaigns/:id/followup-preview returned 404 — check campaigns.routes.js"
            : `Preview request failed (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to load preview");

      const { campaign: detailCampaign, sentCount, previewRecipients, previousBody } = json.data;

      setLoadedCampaign({ ...campaign, ...detailCampaign, sentCount });
      setAllSentRecipients(previewRecipients || []); // preview sample only (≤3) — NOT the full list
      setOriginalBody(previousBody || campaign.bodyHtml || "");
    } catch (err) {
      console.error("Failed to load campaign detail", err);
      setAllSentRecipients([]);
      setRecipientsError(err.message || "Could not load this campaign's recipients.");
    } finally {
      setLoadingRecipients(false);
    }
  };

  // Fetches the FULL unpaginated sent-recipient list (every row, with
  // accountId), needed only when actually sending a follow-up so we can
  // build senderRecipientMap. Kept out of handleSelectCampaign/preview so
  // opening the preview never pays for this.
  const fetchFullSentRecipients = async (campaignId) => {
    const token = localStorage.getItem("token");
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const res = await fetch(
      `${API_BASE_URL}/api/campaigns/${campaignId}/recipients?status=sent`,
      auth
    );
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? "GET /api/campaigns/:id/recipients returned 404 — check campaigns.routes.js"
          : `Recipient list request failed (HTTP ${res.status})`
      );
    }
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Failed to load recipients");
    return json.data || [];
  };

  // 🔥 FIX: Removed pitch requirement - users can now send custom follow-ups
  const createFollowUp = async () => {
    // ✅ FIXED: Only require campaign selection, not pitch
    if (!loadedCampaign) {
      setModal({
        open: true,
        type: "error",
        message: "Please select a campaign to send follow-up.",
      });
      return;
    }

    // Also ensure body is not empty (extra safety)
    const hasBody =
      followUpBody &&
      followUpBody.replace(/<[^>]*>/g, "").trim().length > 0;

    if (!hasBody) {
      setModal({
        open: true,
        type: "error",
        message: "Please write a follow-up message before sending.",
      });
      return;
    }

    // ── Daily-limit guard ────────────────────────────────────
    // sentCount rides on the campaign row and is known instantly — this no
    // longer depends on allSentRecipients, which now only holds a 3-row
    // preview sample, not the full list.
    const followUpRecipientCount = loadedCampaign?.sentCount ?? 0;

    if (loadingRecipients) {
      setModal({
        open: true,
        type: "error",
        message: "Still loading this campaign's address list — please wait a moment.",
      });
      return;
    }

    if (recipientsError) {
      setModal({
        open: true,
        type: "error",
        message: `Cannot send: the address list failed to load. ${recipientsError}`,
      });
      return;
    }

    if (followUpRecipientCount === 0) {
      setModal({
        open: true,
        type: "error",
        message: "This campaign has no successfully sent recipients to follow up with.",
      });
      return;
    }

    if (dailyLimit && followUpRecipientCount > dailyLimit.remaining) {
      setModal({
        open: true,
        type: "error",
        message: `⚠️ Daily quota exceeded. You only have ${dailyLimit.remaining.toLocaleString()} email credits remaining today (limit: ${dailyLimit.dailyLimit.toLocaleString()}/day). This follow-up needs ${followUpRecipientCount.toLocaleString()} recipients. Please try again tomorrow.`,
      });
      return;
    }
    // ─────────────────────────────────────────────────────────

    setSendingFollowup(true);

    try {
      const token = localStorage.getItem("token");

      // Get the from account IDs from the parent campaign
      let fromAccountIds = [];
      try {
        fromAccountIds = JSON.parse(loadedCampaign.fromAccountIds || "[]");
      } catch {
        fromAccountIds = [];
      }

      if (fromAccountIds.length === 0) {
        setModal({
          open: true,
          type: "error",
          message: "No sender accounts found in the original campaign.",
        });
        setSendingFollowup(false);
        return;
      }

      // Build senderRecipientMap - distribute ONLY completed (sent) recipients across sender accounts
     // ✅ CORRECT - keep each recipient with the account that originally sent to them
      // Fetched here (not on preview open) — this is the one place that
      // actually needs every sent row with its accountId.
      const recipients = await fetchFullSentRecipients(loadedCampaign.id);
      const senderRecipientMap = {};

      recipients.forEach((recipient) => {
        const accountId = recipient.accountId;  // ✅ use original sender account
        if (!accountId) return;
        if (!senderRecipientMap[accountId]) {
          senderRecipientMap[accountId] = [];
        }
        senderRecipientMap[accountId].push(recipient.email);
      });

      console.log("Creating follow-up with payload:", {
        baseCampaignId: loadedCampaign.id,
        subjects,
        bodyHtml: followUpBody,
        senderRecipientMap
      });

      // 1️⃣ Create follow-up campaign
      const res = await fetch(`${API_BASE_URL}/api/campaigns/followup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          baseCampaignId: loadedCampaign.id,
          subjects: subjects,
          bodyHtml: followUpBody,
          senderRecipientMap: senderRecipientMap,
        }),
      });

      const data = await res.json();
      console.log("Create follow-up response:", data);

      if (!data.success) {
        throw new Error(data.message || "Failed to create follow-up");
      }

      // 2️⃣ Send the created follow-up immediately
      const sendRes = await fetch(
        `${API_BASE_URL}/api/campaigns/followup/${data.data.id}/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const sendData = await sendRes.json();
      console.log("Send follow-up response:", sendData);

      if (!sendData.success) {
        throw new Error(sendData.message || "Failed to send follow-up campaign");
      }

      setModal({
        open: true,
        type: "success",
        message: "Follow-up campaign created and sent successfully!",
      });
      window.location.href = "/campaigns";

      // Reset form
      setFollowUpBody("");
      setSelectedPitchId("");
      setLoadedCampaign(null);
      setSelectedCampaignId("");
      setPreview(false);
      
      // Refresh campaigns list
      fetchCampaigns();

    } catch (err) {
      console.error("Follow-up error:", err);
      setModal({
        open: true,
        type: "error",
        message: err.message || "Failed to send follow-up. Please try again.",
      });
    } finally {
      setSendingFollowup(false);
    }
  };

  // Function to refresh campaign details after updating recipients
  const fetchCampaignDetails = async () => {
    if (!selectedCampaignId) return;
    
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${selectedCampaignId}/view`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();

      if (data.success) {
        setLoadedCampaign(prev => ({ ...prev, ...data.data.campaign }));
      }

      // The recipients modal can delete rows, so re-pull the full sent list.
      const recRes = await fetch(
        `${API_BASE_URL}/api/campaigns/${selectedCampaignId}/recipients?status=sent`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const recJson = await recRes.json();
      if (recJson.success) setAllSentRecipients(recJson.data || []);
    } catch (err) {
      console.error("Failed to refresh campaign details", err);
    }
  };

  const froms = getFromEmails();

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-sky-50 via-blue-50 to-cyan-50">
      {/* Animated background elements */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-sky-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-cyan-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>

      <div className="relative z-10 container mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12 space-y-3">
          <h1 className="text-5xl py-2 font-black text-transparent bg-clip-text bg-gradient-to-r from-sky-600 via-blue-600 to-cyan-600">
           Follow-up Campaign
          </h1>
          <p className="text-sky-700/80 text-lg font-medium max-w-2xl mx-auto">
            Create powerful follow-up messages to re-engage your audience
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Main Content */}
          <div className="col-span-8 space-y-6 relative z-10">
            {/* Campaign Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                      <Target className="text-sky-600" size={20} />
                    </div>
                    <CardTitle>Select Campaign</CardTitle>
                  </div>

                  {/* Follow-up Level Selector */}
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(level => (
                      <button
                        key={level}
                        onClick={() => {
                          setFollowupLevel(level);
                          setSelectedCampaignId("");
                          setLoadedCampaign(null);
                        }}
                        className={`px-3 py-2 text-xs font-bold rounded-xl border-2 transition-all transform hover:scale-105 ${
                          followupLevel === level
                            ? "bg-gradient-to-r from-sky-600 to-blue-600 text-white border-sky-600 shadow-lg shadow-sky-500/30"
                            : "border-sky-300 text-sky-700 hover:bg-sky-50"
                        }`}
                      >
                        {level === 1 ? "1st" : level === 2 ? "2nd" : level === 3 ? "3rd" : "4th"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => handleSelectCampaign(e.target.value)}
                  disabled={loadingCampaigns}
                  className="w-full px-5 py-3.5 border-2 border-sky-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all bg-white/80 text-slate-800 font-medium disabled:opacity-60 disabled:cursor-wait"
                >
                  {/* ✅ PERF FIX: Show "Loading…" immediately while API fetches */}
                  <option value="">
                    {loadingCampaigns ? "⏳ Loading campaigns…" : campaigns.length === 0 ? "-- No eligible campaigns --" : "-- Choose a campaign --"}
                  </option>
                  {!loadingCampaigns && campaigns.map((c) => {
                    const completedCount = c.sentCount ?? 0;
                    const ordinal = c.followupNumber === 2 ? "2nd" : c.followupNumber === 3 ? "3rd" : c.followupNumber === 4 ? "4th" : "1st";
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} — {ordinal} Follow-up ({completedCount} recipients)
                      </option>
                    );
                  })}
                </select>

                {/* Load More — the list is fetched 6 at a time. */}
                {!loadingCampaigns && campaigns.length > 0 && (
                  <div className="flex items-center justify-between gap-3 mt-3">
                    <span className="text-xs text-sky-700 font-semibold">
                      Showing {campaigns.length}
                      {campaignsTotal > 0 && ` of ${campaignsTotal}`} campaign
                      {campaignsTotal === 1 ? "" : "s"}
                    </span>

                    {campaignsHasMore && (
                      <button
                        type="button"
                        onClick={() => fetchCampaigns(followupLevel, { append: true })}
                        disabled={loadingMore}
                        className="px-4 py-2 text-xs font-bold rounded-lg border-2 border-sky-200 text-sky-700 hover:bg-sky-50 hover:border-sky-300 transition-all disabled:opacity-60 disabled:cursor-wait"
                      >
                        {loadingMore ? "Loading…" : "Load more"}
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pitch Selection (Optional) */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                    <Sparkles className="text-sky-600" size={20} />
                  </div>
                  <CardTitle>Select Follow-up Pitch (Optional)</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <select
                  value={selectedPitchId}
                  onChange={(e) => {
                    const pitchId = e.target.value;
                    setSelectedPitchId(pitchId);

                    if (pitchId) {
                      const pitch = pitches.find(p => String(p.id) === String(pitchId));
                      if (pitch) {
                        setFollowUpBody(pitch.bodyHtml || "");
                      }
                    }
                  }}
                  className="w-full px-5 py-3.5 border-2 border-sky-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all bg-white/80 text-slate-800 font-medium"
                >
                  <option value="">-- None (Custom Message) --</option>
                  {pitches.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>

            {/* Follow-up Editor */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                    <Mail className="text-sky-600" size={20} />
                  </div>
                  <CardTitle>Write Your Follow-up</CardTitle>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div
                  className="min-h-[300px] p-5 border-2 border-sky-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white/90 text-base text-black leading-relaxed"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => setFollowUpBody(e.currentTarget.innerHTML)}
                  dangerouslySetInnerHTML={{ __html: followUpBody }}
                />

                {/* ── Daily Limit Warning ──────────────────────────────── */}
                {(() => {
                  const recipientCount = loadedCampaign?.sentCount ?? 0;
                  const overLimit = dailyLimit && recipientCount > 0 && recipientCount > dailyLimit.remaining;
                  return overLimit ? (
                    <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mt-2">
                      <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-red-700">Daily Quota Exceeded</p>
                        <p className="text-xs text-red-600 mt-0.5 leading-relaxed">
                          You have only <strong>{dailyLimit.remaining.toLocaleString()}</strong> credits remaining today (out of{" "}
                          {dailyLimit.dailyLimit.toLocaleString()}). This follow-up needs{" "}
                          <strong>{recipientCount.toLocaleString()}</strong> recipients.
                          Please try again tomorrow.
                        </p>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setPreview(!preview)}>
                    <Eye className="w-5 h-5" /> Preview
                  </Button>
                  <Button
                    onClick={createFollowUp}
                    disabled={sendingFollowup || !loadedCampaign || loadingRecipients || !!recipientsError || (() => {
                      const cnt = loadedCampaign?.sentCount ?? 0;
                      return dailyLimit && cnt > dailyLimit.remaining;
                    })()}
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
                  <div className="p-2 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                    <Eye className="text-sky-600" size={20} />
                  </div>
                  <CardTitle>Email Preview</CardTitle>
                </div>
              </CardHeader>

              {/* 🔥 FIX: the recipient list + the previous-message body are
                  fetched AFTER loadedCampaign is set (see handleSelectCampaign),
                  so rendering this immediately showed "To: —" and a blank
                  "Previous message" box for a moment (or forever, if the
                  fetch failed). Block on loadingRecipients instead. */}
              {loadingRecipients ? (
                <CardContent>
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-sky-600">
                    <Loader2 className="animate-spin" size={28} />
                    <p className="text-sm font-semibold">Loading recipients &amp; previous message…</p>
                  </div>
                </CardContent>
              ) : recipientsError ? (
                <CardContent>
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4">
                    <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700 leading-relaxed">{recipientsError}</p>
                  </div>
                </CardContent>
              ) : (
              <CardContent className="space-y-6 text-base text-black">

                {/* 1. FOLLOW-UP (top) */}
                <div className="border-2 border-sky-200 rounded-xl p-5 bg-white shadow-sm">
                  <div className="font-bold text-sky-800 mb-3 uppercase tracking-wide text-sm">Follow-up</div>
                  <div dangerouslySetInnerHTML={{ __html: buildFollowupWithSignature() }} />
                </div>

                {/* 2. THREAD HEADER (like Gmail) */}
                <div className="border-t-2 border-sky-200 pt-5 text-sm space-y-2 bg-gradient-to-br from-sky-50 to-blue-50 p-5 rounded-xl border-2">
                  <div className="font-bold text-sky-900">From: <span className="font-normal text-slate-700">{froms[0] || "—"}</span></div>
                  <div className="text-xs text-sky-600 font-semibold">
                    Sending will rotate between:
                    <ul className="list-disc ml-5 mt-1">
                      {froms.map(f => <li key={f}>{f}</li>)}
                    </ul>
                  </div>
                  <div className="font-bold text-sky-900">Sent: <span className="font-normal text-slate-700">{new Date(loadedCampaign.createdAt).toLocaleString()}</span></div>

                  {/* 🔥 FIX: show the first 2 recipient emails (was only ever
                      showing allSentRecipients[0], and showed "—" while the
                      list was still loading). */}
                  <div className="font-bold text-sky-900">
                    To:{" "}
                    <span className="font-normal text-slate-700">
                      {allSentRecipients.length > 0
                        ? allSentRecipients.slice(0, 2).map(r => r.email).join(", ")
                        : "—"}
                      {(loadedCampaign?.sentCount ?? 0) > 2 && (
                        <span className="text-sky-500 font-semibold">
                          {" "}+{(loadedCampaign.sentCount) - 2} more
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="text-xs text-sky-600 font-semibold">
                    Will send to total {loadedCampaign?.sentCount ?? 0} recipients (distributed automatically)
                  </div>
                   
                  <div className="font-bold text-sky-900">Subject: <span className="font-normal text-slate-700">{subjects[0]}</span></div>
                </div>


                {/* 3. ORIGINAL CAMPAIGN (bottom) */}
                <div className="border-2 border-sky-200 rounded-xl p-5 bg-white text-base text-black shadow-sm">
                  <div className="font-bold text-sky-800 mb-3 uppercase tracking-wide text-sm">Previous message</div>
                  {originalBody ? (
                    <div dangerouslySetInnerHTML={{ __html: originalBody }} />
                  ) : (
                    <p className="text-sm text-slate-400 italic">
                      No previous message body found for this campaign.
                    </p>
                  )}
                </div>


              </CardContent>
              )}
            </Card>
          )}

          
        </div>

        {/* Right summary */}
        <div className="col-span-4 relative z-10">
          <Card className="sticky top-6">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                  <Target className="text-sky-600" size={18} />
                </div>
                <CardTitle className="text-base">Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              {/* Campaign Name */}
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 p-4 rounded-xl border border-sky-200">
                <p className="text-xs text-sky-700 font-bold uppercase tracking-wide mb-1.5">Campaign</p>
                <p className="font-bold text-slate-900 text-base">
                  {loadedCampaign?.name || "Not selected"}
                </p>
              </div>

              {/* From Mail Accounts Count */}
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 p-4 rounded-xl border border-sky-200">
                <p className="text-xs text-sky-700 font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <Mail size={12} />
                  From Mail Accounts
                </p>
                <p className="font-black text-slate-900 text-2xl">
                  {getFromEmails().length}
                </p>
              </div>


              {/* Subjects Count */}
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 p-4 rounded-xl border border-sky-200">
                <p className="text-xs text-sky-700 font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <Target size={12} />
                  Subjects
                </p>
                <p className="font-black text-slate-900 text-2xl">
                  {subjects.length}
                </p>
              </div>

              {/* Recipients Count */}
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 p-4 rounded-xl border border-sky-200">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-sky-700 font-bold uppercase tracking-wide flex items-center gap-1.5">
                    <Users size={12} />
                    Recipients
                  </p>
                  <p className="font-black text-slate-900 text-2xl">
                    {loadedCampaign?.sentCount ?? 0}
                  </p>
                </div>

                {/* The number above is instant — it rides on the campaign row.
                    Sending additionally needs every address, fetched separately;
                    report that separately rather than blocking the count. */}
                {loadingRecipients && (
                  <p className="text-xs text-sky-600 font-semibold animate-pulse">
                    Loading address list…
                  </p>
                )}
                {!loadingRecipients && recipientsError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mt-1">
                    <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-700 leading-relaxed break-words">
                      {recipientsError}
                    </p>
                  </div>
                )}
                {!loadingRecipients && !recipientsError && loadedCampaign &&
                  allSentRecipients.length > 0 &&
                  allSentRecipients.length !== (loadedCampaign.sentCount ?? 0) && (
                  <p className="text-xs text-slate-500 mt-1">
                    Showing {allSentRecipients.length} of {loadedCampaign.sentCount} for preview — the full list loads when you click Create Follow-up.
                  </p>
                )}
                
                {loadedCampaign && (
                  <button
                    onClick={() => setShowRecipientModal(true)}
                    className="w-full mt-2 px-4 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 text-white text-xs font-bold rounded-lg hover:shadow-lg hover:scale-105 transition-all flex items-center justify-center gap-2"
                  >
                    <UserCog size={14} />
                    Update Recipients
                  </button>
                )}
              </div>
            </CardContent>

          </Card>
        </div>

        {modal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-8 w-full max-w-md shadow-2xl space-y-5 border-2 border-sky-200 transform scale-100 animate-in">
              
              <div className="flex items-center gap-3">
                {modal.type === "success" ? (
                  <div className="p-3 bg-gradient-to-br from-sky-100 to-blue-100 rounded-xl">
                    <CheckCircle2 className="text-sky-600" size={28} />
                  </div>
                ) : (
                  <div className="p-3 bg-gradient-to-br from-red-100 to-orange-100 rounded-xl">
                    <X className="text-red-600" size={28} />
                  </div>
                )}
                <h2 className={`text-xl font-black ${
                  modal.type === "success" ? "text-sky-700" : "text-red-600"
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
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 text-white text-sm font-bold shadow-lg shadow-sky-500/30 hover:shadow-sky-500/50 transform hover:scale-105 transition-all"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}

        

      </div>

      {showRecipientModal && loadedCampaign && (
        <ShowsRecipients
          campaignId={selectedCampaignId}
          onClose={() => setShowRecipientModal(false)}
          onUpdated={() => {
            fetchCampaignDetails();
            setShowRecipientModal(false);
          }}
        />
      )}
    
      </div>
    </div>
  );
}