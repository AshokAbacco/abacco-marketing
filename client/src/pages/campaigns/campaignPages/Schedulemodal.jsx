// src/pages/campaigns/campaignPages/Schedulemodal.jsx
//  Campaign View Modal: Displays campaign recipients, stats, and from-mails in a modal with tabs.

import React, { useEffect, useState, useMemo, useRef } from "react";
import { X, Loader2, Users, CheckCircle, Clock, AlertCircle, Copy, Check, Mail, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ✅ PERF FIX: Virtual list renders only ~20 visible rows instead of ALL rows.
const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 20;

function VirtualEmailTable({ allEmails, processingEmails, completedEmails, failedEmails }) {
  const maxRows = Math.max(allEmails.length, processingEmails.length, completedEmails.length, failedEmails.length);
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(maxRows, startIndex + VISIBLE_ROWS + 4);
  const visibleRows = Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i);

  return (
    <div
      ref={containerRef}
      className="border border-gray-300 rounded-lg overflow-auto bg-white"
      style={{ maxHeight: `${ROW_HEIGHT * VISIBLE_ROWS}px` }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* Fixed headers */}
      <div className="grid grid-cols-3 sticky top-0 z-10">
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Total Recipients {allEmails.length}</div>
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Processing {processingEmails.length}</div>
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Completed {completedEmails.length}</div>
      </div>

      {/* Virtual scroll body */}
      <div style={{ height: `${maxRows * ROW_HEIGHT}px`, position: "relative" }}>
        <div style={{ position: "absolute", top: `${startIndex * ROW_HEIGHT}px`, width: "100%" }}>
          {visibleRows.map(rowIndex => (
            <div key={rowIndex} className="grid grid-cols-3" style={{ height: ROW_HEIGHT }}>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{allEmails[rowIndex] || ''}</div>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{processingEmails[rowIndex] || ''}</div>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{completedEmails[rowIndex] || ''}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── From Mails & Subjects Tab ────────────────────────────────────────────────
const FROM_MAILS_PAGE_SIZE = 10;

// Extracts every unique from-email from all possible locations in the campaign object
function extractFromEmails(campaign) {
  const set = new Set();

  // ── From each recipient: check every plausible field name ──
  campaign.recipients?.forEach(r => {
    const candidates = [
      r.sentFromEmail,
      r.fromEmail,
      r.assignedFromEmail,
      r.senderEmail,
      r.fromAddress,
      r.assignedEmail,
    ];
    candidates.forEach(v => { if (v && typeof v === 'string') set.add(v.trim()); });
  });

  // ── Campaign-level arrays ──
  const arrayFields = [
    campaign.fromAccounts,    // [{email, …}]
    campaign.fromEmails,      // ['email@…']
    campaign.senderAccounts,
    campaign.emailAccounts,
    campaign.accounts,
  ];
  arrayFields.forEach(arr => {
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      if (!item) return;
      if (typeof item === 'string') { set.add(item.trim()); return; }
      const e = item.email || item.fromEmail || item.senderEmail || item.address || item.emailAddress;
      if (e && typeof e === 'string') set.add(e.trim());
    });
  });

  // ── Campaign-level plain string fields ──
  ['fromEmail', 'senderEmail', 'fromAddress'].forEach(key => {
    if (campaign[key] && typeof campaign[key] === 'string') set.add(campaign[key].trim());
  });

  return [...set];
}

function FromMailsTab({ campaign }) {
  const [copiedItem, setCopiedItem] = useState(null);
  // const [page, setPage] = useState(0);

  const fromEmailsList = useMemo(() => extractFromEmails(campaign), [campaign]);

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(key);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch {}
  };

  const copyAll = () => copyText(fromEmailsList.join('\n'), 'all-from');

  // ── Pagination ──────────────────────────────────────────────────────────────
  // const totalPages    = Math.max(Math.ceil(fromEmailsList.length / FROM_MAILS_PAGE_SIZE), 1);
  // const safePage      = Math.min(page, totalPages - 1);
  // const startIdx      = safePage * FROM_MAILS_PAGE_SIZE;
  // const pagedEmails   = fromEmailsList.slice(startIdx, startIdx + FROM_MAILS_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 bg-emerald-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Mail className="text-emerald-600" size={15} />
            <span className="text-sm font-bold text-emerald-800">From Mails</span>
            <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {fromEmailsList.length}
            </span>
          </div>
          {fromEmailsList.length > 0 && (
            <button
              onClick={copyAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {copiedItem === 'all-from' ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy All</>}
            </button>
          )}
        </div>

        {/* ── Rows ── */}
         {/* ── Rows ── */}
          {fromEmailsList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Mail className="text-gray-300 mb-3" size={36} />
              <p className="text-sm text-gray-400 font-medium">No from emails found</p>
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto border-t">
              {[
                ...fromEmailsList,
                ...Array(3).fill(null) // 👈 ADD 3 EMPTY ROWS
              ].map((email, i) => {
                const isEmpty = !email;

                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-5 py-3 border-b border-gray-100 ${
                      i % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                    }`}
                  >
                    {/* Index */}
                    <span className="text-xs text-gray-400 w-6 text-right flex-shrink-0">
                      {i + 1}
                    </span>

                    {isEmpty ? (
                      // 🔲 EMPTY ROW
                      <div className="flex-1 h-5 bg-gray-100 rounded"></div>
                    ) : (
                      <>
                        {/* Avatar */}
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                          <span className="text-white text-xs font-bold">
                            {email.charAt(0).toUpperCase()}
                          </span>
                        </div>

                        {/* Email */}
                        <span className="text-sm text-gray-800 flex-1 truncate">
                          {email}
                        </span>

                        {/* Copy button */}
                        <button
                          onClick={() => copyText(email, `from-${i}`)}
                          className="flex-shrink-0 p-1.5 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        >
                          {copiedItem === `from-${i}` ? (
                            <Check size={13} className="text-emerald-600" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        {/* ── Pagination footer ── */}
        {/* {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-t border-gray-200">
            <span className="text-xs text-gray-500">
              Showing{' '}
              <span className="font-semibold text-gray-700">
                {startIdx + 1}–{Math.min(startIdx + FROM_MAILS_PAGE_SIZE, fromEmailsList.length)}
              </span>
              {' '}of{' '}
              <span className="font-semibold text-gray-700">{fromEmailsList.length}</span> emails
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: totalPages }).map((_, pi) => (
                <button
                  key={pi}
                  onClick={() => setPage(pi)}
                  className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
                    pi === safePage ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {pi + 1}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={safePage === totalPages - 1}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )} */}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function CampaignView({ campaignId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);
  const [activeTab, setActiveTab] = useState("recipients"); // "recipients" | "frommails"

  useEffect(() => {
    if (campaignId) {
      fetchCampaign();
    }
  }, [campaignId]);

  const fetchCampaign = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`${API_BASE_URL}/api/campaigns/${campaignId}/view`);
      if (res.data.success) {
        setData(res.data.data);
      } else {
        setError("Failed to load campaign data");
      }
    } catch (error) {
      console.error("Failed to fetch campaign:", error);
      setError(error.response?.data?.message || "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const copyEmails = async (emails, section) => {
    try {
      await navigator.clipboard.writeText(emails.join('\n'));
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {}
  };

  const getRecipientsByStatus = (status) => {
    if (!data?.campaign?.recipients) return [];
    return data.campaign.recipients.filter(r => {
      if (status === 'completed') return r.status === 'sent' || r.status === 'completed';
      if (status === 'processing') return r.status === 'pending' || r.status === 'processing';
      if (status === 'failed') return r.status === 'failed' || r.status === 'error';
      return false;
    });
  };

  if (!campaignId) return null;

  const allEmails        = data ? data.campaign.recipients.map(r => r.email) : [];
  const processingEmails = data ? getRecipientsByStatus('processing').map(r => r.email) : [];
  const completedEmails  = data ? getRecipientsByStatus('completed').map(r => r.email) : [];
  const failedEmails     = data ? getRecipientsByStatus('failed').map(r => r.email) : [];



  // From mails count for badge — uses same extractFromEmails helper as FromMailsTab
  const fromMailsCount = data ? extractFromEmails(data.campaign).length : 0;

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white w-full max-w-5xl mt-20 max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl relative animate-fadeIn mx-auto">

        {loading ? (
          <div className="flex flex-col items-center justify-center p-16">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur-xl opacity-30"></div>
              <Loader2 className="relative animate-spin text-emerald-600 mb-4" size={48} />
            </div>
            <p className="text-gray-600 font-medium mt-4">Loading campaign details...</p>
          </div>
        ) : error ? (
          <div className="p-16 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <AlertCircle className="text-red-600" size={32} />
            </div>
            <p className="text-red-600 text-lg font-semibold mb-6">{error}</p>
            <button
              onClick={fetchCampaign}
              className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl hover:from-emerald-700 hover:to-green-700 font-semibold shadow-lg shadow-emerald-500/30 transition-all transform hover:scale-105"
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="sticky top-0 bg-gradient-to-r from-emerald-50 via-teal-50 to-green-50 border-b border-emerald-200/50 px-8 py-6 flex items-start justify-between">
              <div className="flex-1 pr-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">{data.campaign.name}</h2>
                <p className="text-sm text-gray-600">Campaign Recipients & Statistics</p>
              </div>
              <button
                onClick={onClose}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-full p-2 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            {/* ── Scrollable Body ─────────────────────────────────── */}
            <div className="overflow-y-auto max-h-[calc(90vh-140px)] p-8">

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-100 rounded-lg"><Users className="text-blue-600" size={20} /></div>
                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Total</span>
                  </div>
                  <p className="text-3xl font-black text-blue-900">{data.stats.total}</p>
                  <p className="text-xs text-blue-600 mt-1">Recipients</p>
                </div>

                <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-5 border border-yellow-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-yellow-100 rounded-lg"><Clock className="text-yellow-600" size={20} /></div>
                    <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Processing</span>
                  </div>
                  <p className="text-3xl font-black text-yellow-900">{data.stats.processing}</p>
                  <p className="text-xs text-yellow-600 mt-1">In Queue</p>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-5 border border-emerald-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-100 rounded-lg"><CheckCircle className="text-emerald-600" size={20} /></div>
                    <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Completed</span>
                  </div>
                  <p className="text-3xl font-black text-emerald-900">{data.stats.completed}</p>
                  <p className="text-xs text-emerald-600 mt-1">Sent Successfully</p>
                </div>

                {data.stats.failed > 0 && (
                  <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-xl p-5 border border-red-200/50 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-red-100 rounded-lg"><AlertCircle className="text-red-600" size={20} /></div>
                      <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Failed</span>
                    </div>
                    <p className="text-3xl font-black text-red-900">{data.stats.failed}</p>
                    <p className="text-xs text-red-600 mt-1">Errors</p>
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-700 font-medium">
                  Total Recipients <span className="font-bold text-blue-600">{data.stats.total}</span>,{" "}
                  Processing count <span className="font-bold text-yellow-600">{data.stats.processing}</span>,{" "}
                  Completed - <span className="font-bold text-emerald-600">{data.stats.completed}</span>
                  {data.stats.failed > 0 && (
                    <>, Failed - <span className="font-bold text-red-600">{data.stats.failed}</span></>
                  )}
                </p>
              </div>

              {/* ── Tabs ───────────────────────────────────────────── */}
              <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
                {/* Tab 1: Total Recipients */}
                <button
                  onClick={() => setActiveTab("recipients")}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === "recipients"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Users size={15} />
                  Total Recipients
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === "recipients" ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-500"
                  }`}>
                    {data.stats.total}
                  </span>
                </button>

                {/* Tab 2: From Mails */}
                <button
                  onClick={() => setActiveTab("frommails")}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === "frommails"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  <Mail size={15} />
                  From Mails
                  {fromMailsCount > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                      activeTab === "frommails" ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"
                    }`}>
                      {fromMailsCount}
                    </span>
                  )}
                </button>
              </div>

              {/* ── Tab Panels ─────────────────────────────────────── */}
              {activeTab === "recipients" && (
                <div className="space-y-6">
                  {data.campaign.recipients && data.campaign.recipients.length > 0 ? (
                    <div>
                      {/* Header + Copy Buttons */}
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-gray-900">
                          Total Recipients {data.stats.total}
                        </h3>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => copyEmails(allEmails, 'all')}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          >
                            {copiedSection === 'all' ? <><Check size={16} /><span>Copied!</span></> : (
                              <><Copy size={16} /><span>Copy All</span>
                                <span className="bg-blue-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">{allEmails.length}</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => copyEmails(processingEmails, 'processing')}
                            className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          >
                            {copiedSection === 'processing' ? <><Check size={16} /><span>Copied!</span></> : (
                              <><Copy size={16} /><span>Copy Processing</span>
                                <span className="bg-yellow-700 text-white text-xs font-bold px-2 py-0.5 rounded-full">{processingEmails.length}</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => copyEmails(completedEmails, 'completed')}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          >
                            {copiedSection === 'completed' ? <><Check size={16} /><span>Copied!</span></> : (
                              <><Copy size={16} /><span>Copy Completed</span>
                                <span className="bg-emerald-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">{completedEmails.length}</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => copyEmails(failedEmails, 'failed')}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          >
                            {copiedSection === 'failed' ? <><Check size={16} /><span>Copied!</span></> : (
                              <><Copy size={16} /><span>Copy Failed</span>
                                <span className="bg-red-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">{failedEmails.length}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <VirtualEmailTable
                        allEmails={allEmails}
                        processingEmails={processingEmails}
                        completedEmails={completedEmails}
                        failedEmails={failedEmails}
                      />

                      {/* Legend */}
                      <div className="flex items-center gap-6 mt-4 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <span className="text-xs font-medium text-gray-600">Total: {allEmails.length}</span>
                        </div>
                        {processingEmails.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <span className="text-xs font-medium text-gray-600">Processing: {processingEmails.length}</span>
                          </div>
                        )}
                        {completedEmails.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                            <span className="text-xs font-medium text-gray-600">Completed: {completedEmails.length}</span>
                          </div>
                        )}
                        {failedEmails.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <span className="text-xs font-medium text-gray-600">Failed: {failedEmails.length}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                      <Users className="mx-auto text-gray-400 mb-3" size={48} />
                      <p className="text-gray-500 font-medium">No recipients found</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "frommails" && (
                <FromMailsTab campaign={data.campaign} />
              )}

            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}