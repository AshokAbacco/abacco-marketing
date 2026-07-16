// src/

import React, { useState, useEffect } from "react";
import { api } from "../../utils/api"; 

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function AddAccountManager({ onClose, onAccountAdded, pendingGroup }) {
  const [accounts, setAccounts] = useState([]);
  const [totalCount, setTotalCount] = useState(0); // ✅ Total accounts (unfiltered) for limit tracking
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [form, setForm] = useState({
    userId: 1,
    email: "",
    provider: "gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapUser: "",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpUser: "",
    encryptedPass: "",
    authType: "password",
    senderName: "", // 🔥 NEW: Sender Name Field
  });

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [accountToLogout, setAccountToLogout] = useState(null);
  const [loading, setLoading] = useState(false);

  // 🗑️ NEW: Tracks a same-email account that's still being permanently
  // deleted in the background, so we can show progress instead of a
  // generic "Account already exists" error.
  const [deletingInfo, setDeletingInfo] = useState(null); // { email, progress, remainingTime, ... } | null
  const [showSuccessMessage, setShowSuccessMessage] = useState("");
  const [error, setError] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [help, setHelp] = useState(null);

  // 🔥 NEW: State for editing sender name
  const [editingSenderName, setEditingSenderName] = useState(null);
  const [tempSenderName, setTempSenderName] = useState("");

  // ✏️ Edit account modal state
  const [editingAccount, setEditingAccount] = useState(null); // account object being edited
  const [editForm, setEditForm] = useState({ senderName: "", newPassword: "", confirmPassword: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showEditPassword, setShowEditPassword] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  // 🗑️ NEW: While an account with this email is still being permanently
  // deleted in the background, poll for progress every 3s. Once it
  // finishes, deleting:false comes back and we clear the block so the
  // user can submit the form again.
  useEffect(() => {
    if (!deletingInfo?.email) return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get(
          `${API_BASE_URL}/api/accounts/delete-status/${encodeURIComponent(deletingInfo.email)}`
        );
        const data = res.data;

        if (!data?.deleting) {
          clearInterval(interval);
          setDeletingInfo(null);
          setShowSuccessMessage("✅ That email address is free — you can add it again now.");
          setTimeout(() => setShowSuccessMessage(""), 4000);
          return;
        }

        setDeletingInfo((prev) => ({
          ...prev,
          progress: data.progress ?? prev.progress,
          remainingTime: data.remainingTime ?? prev.remainingTime,
          totalEmails: data.totalEmails ?? prev.totalEmails,
          deletedEmails: data.deletedEmails ?? prev.deletedEmails,
        }));
      } catch (err) {
        // Transient poll failure — just try again on the next tick.
        console.warn("delete-status poll failed:", err.message);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [deletingInfo?.email]);

const fetchAccounts = async () => {
  setLoadingAccounts(true);
  setError(null);

  try {
    // Always fetch all accounts, then filter client-side by groupId.
    // This is a reliable safety net in case the backend ignores ?groupId param.
    const res = await api.get(`${API_BASE_URL}/api/accounts`);

    if (res.data?.success && Array.isArray(res.data.data)) {
      const all = res.data.data;

      // ✅ Always track the TOTAL count (before group filtering) for limit enforcement
      setTotalCount(all.length);

      if (pendingGroup?.groupId) {
        // ✅ Show accounts for this group  +  ungrouped accounts (no groupId)
        // Ungrouped accounts appear in every group with an "Ungrouped" badge
        const filtered = all.filter(
          (acc) =>
            String(acc.groupId) === String(pendingGroup.groupId) || // this group
            !acc.groupId                                             // ungrouped
        );
        setAccounts(filtered);
      } else {
        // No group context — show all
        setAccounts(all);
      }
    } else {
      console.warn("Unexpected API response:", res.data);
      setAccounts([]);
    }
  } catch (err) {
    console.error("Failed to load accounts:", err);

    if (err.response?.status === 401) {
      setError("Session expired. Please login again.");
    } else {
      setError("Failed to fetch accounts");
    }

    setAccounts([]);
  } finally {
    setLoadingAccounts(false);
  }
};


const addAccount = async (e) => {
  e.preventDefault();
  setError(null);
  setDeletingInfo(null);
  setLoading(true);

  try {
    const formData = {
      ...form,
      imapUser: form.imapUser || form.email,
      smtpUser: form.smtpUser || form.email,
      ...(pendingGroup?.groupId ? { groupId: pendingGroup.groupId } : {}), // ✅ NEW
    };

    console.log("Sending:", formData); // 🔥 debug

    const res = await api.post(`${API_BASE_URL}/api/accounts`, formData);

    console.log("Success:", res.data);

    onClose();
  } catch (err) {
    console.error("❌ Full error:", err.response?.data || err.message);

    // 🗑️ NEW: Same email is still being permanently deleted in the
    // background — show progress instead of a plain error, and start
    // polling for completion.
    if (err.response?.status === 409 && err.response?.data?.deleting) {
      const d = err.response.data;
      setDeletingInfo({
        email: formData.email,
        progress: d.progress || 0,
        remainingTime: d.remainingTime,
        totalEmails: d.totalEmails || 0,
        deletedEmails: d.deletedEmails || 0,
      });
    } else {
      setError(err.response?.data?.error || "Failed to add account");
    }
  } finally {
    setLoading(false);
  }
};


  // 🔥 NEW: Update sender name for existing account
  const updateSenderName = async (accountId, newName) => {
    try {
      const res = await api.patch(
        `${API_BASE_URL}/api/accounts/${accountId}/sender-name`,
        {
          senderName: newName.trim(),
        }
      );

      if (res.data.success) {
        // Update local state
        setAccounts((prev) =>
          prev.map((acc) =>
            acc.id === accountId ? { ...acc, senderName: newName.trim() } : acc
          )
        );
        setShowSuccessMessage("✅ Sender name updated!");
        setTimeout(() => setShowSuccessMessage(""), 2000);
      }
    } catch (err) {
      console.error("Failed to update sender name:", err);
      setError("Failed to update sender name");
    }
  };

  // ✏️ Open edit modal pre-filled with account data
  const openEditModal = (e, acc) => {
    e.stopPropagation();
    setEditingAccount(acc);
    setEditForm({ senderName: acc.senderName || "", newPassword: "", confirmPassword: "" });
    setEditError(null);
    setShowEditPassword(false);
  };

  // ✏️ Save changes (password and/or sender name)
  const saveAccountEdit = async () => {
    setEditError(null);

    if (editForm.newPassword && editForm.newPassword !== editForm.confirmPassword) {
      setEditError("Passwords do not match.");
      return;
    }

    setEditLoading(true);
    try {
      // Update sender name if changed
      if (editForm.senderName.trim() !== (editingAccount.senderName || "")) {
        await api.patch(`${API_BASE_URL}/api/accounts/${editingAccount.id}/sender-name`, {
          senderName: editForm.senderName.trim(),
        });
      }

      // Update password if provided
      if (editForm.newPassword) {
        await api.patch(`${API_BASE_URL}/api/accounts/${editingAccount.id}/app-password`, {
          newPassword: editForm.newPassword,
        });
      }

      // Refresh account list
      await fetchAccounts();
      setShowSuccessMessage("✅ Account updated successfully!");
      setTimeout(() => setShowSuccessMessage(""), 2500);
      setEditingAccount(null);
    } catch (err) {
      console.error("Edit error:", err);
      setEditError(err.response?.data?.error || "Failed to update account.");
    } finally {
      setEditLoading(false);
    }
  };

  const confirmLogout = (id) => {
    setAccountToLogout(id);
    setShowLogoutConfirm(true);
  };

const logoutAccount = async () => {
  if (!accountToLogout) return;
  setLoading(true);

  try {
    // api utility already attaches the Authorization header — no need to add it manually
    await api.delete(`${API_BASE_URL}/api/accounts/${accountToLogout}`);

    // Update UI immediately
    const updatedAccounts = accounts.filter((a) => a.id !== accountToLogout);
    setAccounts(updatedAccounts);

    if (selectedAccountId === accountToLogout) {
      if (updatedAccounts.length > 0) {
        setSelectedAccountId(updatedAccounts[0].id);
      } else {
        setSelectedAccountId(null);
      }
    }

    setShowLogoutConfirm(false);
    setAccountToLogout(null);
    // The DELETE call above now returns almost instantly — the account row
    // was just soft-deleted (hidden from the UI immediately). Permanent
    // deletion of its emails/attachments/conversations continues in the
    // background on the server, even if this tab is closed.
    setShowSuccessMessage("✅ Account removed successfully. Background cleanup has started.");

    setTimeout(async () => {
      await fetchAccounts();
      setShowSuccessMessage("");
    }, 2000);
  } catch (err) {
    console.error("Delete error:", err.response?.data || err.message);
    setError(err.response?.data?.error || "❌ Failed to delete account");
  } finally {
    setLoading(false);
  }
};


  const handleAccountSelect = (acc) => {
    setSelectedAccountId(acc.id);
  };

  const handleEmailChange = (e) => {
    const email = e.target.value;
    setForm({ ...form, email, imapUser: email, smtpUser: email });
  };

  const handleProviderChange = (e) => {
    const provider = e.target.value;
    let newForm = { ...form, provider };

    switch (provider) {
      case "gmail":
      case "gsuite":
        newForm.imapHost = "imap.gmail.com";
        newForm.imapPort = 993;
        newForm.smtpHost = "smtp.gmail.com";
        newForm.smtpPort = 587;
        break;

      case "zoho":
        newForm.imapHost = "imappro.zoho.in";
        newForm.imapPort = 993;
        newForm.smtpHost = "smtppro.zoho.in";
        newForm.smtpPort = 587;
        break;

      case "redff":
        newForm.imapHost = "imap.rediffmailpro.com";
        newForm.imapPort = 993;
        newForm.smtpHost = "smtp.rediffmailpro.com";
        newForm.smtpPort = 587;
        newForm.imapUser = form.email;
        newForm.smtpUser = form.email;
        break;

      case "amazon":
        newForm.imapHost = "imap.mail.us-east-1.awsapps.com";
        newForm.imapPort = 993;
        newForm.smtpHost = "smtp.mail.us-east-1.awsapps.com";
        newForm.smtpPort = 465;
        newForm.imapUser = form.email;
        newForm.smtpUser = form.email;
        break;




      default:
        newForm.imapHost = "";
        newForm.imapPort = 993;
        newForm.smtpHost = "";
        newForm.smtpPort = 587;
    }

    setForm(newForm);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-900">
              Add Email Account
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-slate-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* ✅ Group banner — shows which group this account will be added to */}
          {pendingGroup && (
            <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <p className="text-sm text-emerald-700">
                Adding to group: <span className="font-bold">{pendingGroup.groupName}</span>
              </p>
            </div>
          )}

          {/* ✅ Account limit warnings */}
          {totalCount >= 80 ? (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-300 rounded-xl flex items-start gap-3">
              <span className="text-red-500 text-lg mt-0.5">🚫</span>
              <div>
                <p className="text-sm font-semibold text-red-700">Account Limit Reached</p>
                <p className="text-xs text-red-600 mt-0.5">
                  You have reached the maximum limit of <strong>80 email accounts</strong>. Please remove an existing account to add a new one.
                </p>
              </div>
            </div>
          ) : totalCount >= 70 ? (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
              <span className="text-amber-500 text-lg mt-0.5">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-700">Approaching Account Limit</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  You have used <strong>{totalCount} of 80</strong> accounts. Only <strong>{80 - totalCount}</strong> account{80 - totalCount === 1 ? "" : "s"} remaining.
                </p>
              </div>
            </div>
          ) : null}

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}

              {suggestion && (
                <div className="mt-3 p-2 bg-yellow-100 rounded text-black">
                  <div className="font-bold mb-1">Suggested Settings:</div>
                  <div>IMAP Host: {suggestion.imapHost}</div>
                  <div>IMAP Port: {suggestion.imapPort}</div>
                  <div>SMTP Host: {suggestion.smtpHost}</div>
                  <div>SMTP Port: {suggestion.smtpPort}</div>

                  <button
                    className="mt-2 px-3 py-1 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded text-sm"
                    onClick={() => {
                      setForm({
                        ...form,
                        imapHost: suggestion.imapHost,
                        imapPort: suggestion.imapPort,
                        smtpHost: suggestion.smtpHost,
                        smtpPort: suggestion.smtpPort,
                      });
                    }}
                  >
                    Use These Settings
                  </button>
                </div>
              )}

              {help && (
                <div
                  className="mt-3 p-3 bg-yellow-100 rounded text-black text-sm"
                  dangerouslySetInnerHTML={{ __html: help }}
                />
              )}
            </div>
          )}

          {showSuccessMessage && (
            <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
              {showSuccessMessage}
            </div>
          )}

          {/* 🗑️ NEW: Background deletion in progress for this email */}
          {deletingInfo && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-xl">
              <p className="text-sm font-semibold text-amber-800 mb-1">
                This email account is currently being permanently deleted.
              </p>
              <p className="text-xs text-amber-700 mb-3">
                Please wait until deletion finishes before adding{" "}
                <strong>{deletingInfo.email}</strong> again.
              </p>

              <div className="w-full h-3 bg-amber-100 rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, deletingInfo.progress))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-amber-700">
                <span>{deletingInfo.progress}%</span>
                {deletingInfo.remainingTime && (
                  <span>Remaining time: {deletingInfo.remainingTime}</span>
                )}
              </div>

              {deletingInfo.totalEmails > 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  {deletingInfo.deletedEmails} / {deletingInfo.totalEmails} emails cleaned up
                </p>
              )}
            </div>
          )}

          {/* 🔥 NEW: List accounts with editable sender name */}
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-2">
              {pendingGroup
                ? `Accounts in "${pendingGroup.groupName}"`
                : "Your Accounts"}
            </h3>
            {loadingAccounts ? (
              <div className="text-gray-400 text-sm py-2">Loading accounts…</div>
            ) : accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                <div className="text-2xl mb-2">📭</div>
                <p className="text-sm font-semibold text-slate-600 mb-1">
                  {pendingGroup
                    ? `No accounts in "${pendingGroup.groupName}" yet`
                    : "No accounts configured"}
                </p>
                <p className="text-xs text-slate-400">
                  {pendingGroup
                    ? "Use the form below to add your first account to this group."
                    : "Add an email account using the form below."}
                </p>
              </div>
            ) : (
              accounts.map((acc) => (
                <div
                  key={acc.id}
                  onClick={() => handleAccountSelect(acc)}
                  className={`border p-3 rounded mb-2 cursor-pointer ${
                    selectedAccountId === acc.id
                      ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-500"
                      : "bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium">{acc.email}</div>
                        {/* ✅ Show "Ungrouped" badge if account has no group */}
                        {!acc.groupId && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                            📁 Ungrouped
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        {acc.provider} · {acc.imapHost}:{acc.imapPort}
                      </div>

                      {/* 🔥 NEW: Sender Name Display/Edit */}
                      <div className="mt-2">
                        {editingSenderName === acc.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={tempSenderName}
                              onChange={(e) =>
                                setTempSenderName(e.target.value)
                              }
                              placeholder="Enter your name"
                              className="flex-1 px-2 py-1 border border-emerald-300 rounded text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSenderName(acc.id, tempSenderName);
                                setEditingSenderName(null);
                              }}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                            >
                              Save
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSenderName(null);
                              }}
                              className="px-3 py-1 bg-gray-400 text-white rounded text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">
                              📝 Sender Name:{" "}
                              <span className="font-semibold text-emerald-600">
                                {acc.senderName || "Not set"}
                              </span>
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingSenderName(acc.id);
                                setTempSenderName(acc.senderName || "");
                              }}
                              className="text-xs text-emerald-600 hover:underline"
                            >
                              {acc.senderName ? "Edit" : "Set Name"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={(e) => openEditModal(e, acc)}
                        className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmLogout(acc.id);
                        }}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Logout
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={addAccount} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Provider
              </label>
              <select
                value={form.provider}
                onChange={handleProviderChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="gmail">Gmail</option>
                <option value="gsuite">G Suite</option>
                <option value="redff">Rediff Mail</option>
                <option value="amazon">Amazon WorkMail</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Authentication
              </label>
              <select
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="password">App Password</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={form.email}
                onChange={handleEmailChange}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>

            {/* 🔥 NEW: Sender Name Field in Creation Form */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Sender Name
              </label>
              <input
                type="text"
                value={form.senderName}
                onChange={(e) =>
                  setForm({ ...form, senderName: e.target.value })
                }
                placeholder="Sender Name"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                This name will appear in email templates and signatures
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  IMAP Host
                </label>
                <input
                  type="text"
                  value={form.imapHost}
                  onChange={(e) =>
                    setForm({ ...form, imapHost: e.target.value })
                  }
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  IMAP Port
                </label>
                <input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) =>
                    setForm({ ...form, imapPort: parseInt(e.target.value) })
                  }
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                IMAP Username
              </label>
              <input
                type="text"
                value={form.imapUser}
                onChange={(e) => setForm({ ...form, imapUser: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  SMTP Host
                </label>
                <input
                  type="text"
                  value={form.smtpHost}
                  onChange={(e) =>
                    setForm({ ...form, smtpHost: e.target.value })
                  }
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  SMTP Port
                </label>
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) =>
                    setForm({ ...form, smtpPort: parseInt(e.target.value) })
                  }
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                SMTP Username
              </label>
              <input
                type="text"
                value={form.smtpUser}
                onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                App Password
              </label>
              <input
                type="password"
                value={form.encryptedPass}
                onChange={(e) =>
                  setForm({ ...form, encryptedPass: e.target.value })
                }
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                {form.provider === "zoho" && (
                  <>
                    Zoho requires an <b>App Password</b>, not your normal
                    mailbox password.
                  </>
                )}
                {form.provider === "bluehost" && (
                  <>
                    Bluehost (Titan Mail) may require an App Password from your
                    hosting panel.
                  </>
                )}
                {(form.provider === "gmail" || form.provider === "gsuite") && (
                  <>Gmail requires an App Password if 2FA is enabled.</>
                )}
                {form.provider === "redff" && (
                  <>RedFF uses your normal email password (no app password needed).</>
                )}


              </p>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-slate-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-md hover:from-emerald-700 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading || totalCount >= 80}
              >
                {loading ? "Adding..." : totalCount >= 80 ? "Limit Reached (80/80)" : "Add Account"}
              </button>
            </div>
          </form>

          {/* ✏️ Edit Account Modal */}
          {editingAccount && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div className="flex justify-between items-center mb-5">
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Edit Account</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{editingAccount.email}</p>
                  </div>
                  <button
                    onClick={() => setEditingAccount(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {editError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-300 text-red-700 rounded-lg text-sm">
                    {editError}
                  </div>
                )}

                <div className="space-y-4">
                  {/* Sender Name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Sender Name
                    </label>
                    <input
                      type="text"
                      value={editForm.senderName}
                      onChange={(e) => setEditForm({ ...editForm, senderName: e.target.value })}
                      placeholder="e.g. John from Acme"
                      className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">This name appears in outgoing emails.</p>
                  </div>

                  {/* New App Password */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      New App Password
                    </label>
                    <div className="relative">
                      <input
                        type={showEditPassword ? "text" : "password"}
                        value={editForm.newPassword}
                        onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                        placeholder="Leave blank to keep current password"
                        className="w-full p-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword(!showEditPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                      >
                        {showEditPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {editingAccount.provider === "gmail" || editingAccount.provider === "gsuite"
                        ? "Gmail requires an App Password if 2FA is enabled."
                        : editingAccount.provider === "zoho"
                        ? "Zoho requires an App Password from your Zoho settings."
                        : "Enter the app-specific password from your email provider."}
                    </p>
                  </div>

                  {/* Confirm New Password */}
                  {editForm.newPassword && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Confirm New Password
                      </label>
                      <input
                        type={showEditPassword ? "text" : "password"}
                        value={editForm.confirmPassword}
                        onChange={(e) => setEditForm({ ...editForm, confirmPassword: e.target.value })}
                        placeholder="Re-enter new password"
                        className={`w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-emerald-400 text-sm ${
                          editForm.confirmPassword && editForm.newPassword !== editForm.confirmPassword
                            ? "border-red-400 bg-red-50"
                            : "border-gray-300"
                        }`}
                      />
                      {editForm.confirmPassword && editForm.newPassword !== editForm.confirmPassword && (
                        <p className="text-xs text-red-500 mt-1">Passwords do not match.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => setEditingAccount(null)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-slate-600 hover:bg-gray-50 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveAccountEdit}
                    disabled={editLoading || (editForm.newPassword && editForm.newPassword !== editForm.confirmPassword)}
                    className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg hover:from-emerald-700 hover:to-green-700 text-sm disabled:opacity-50"
                  >
                    {editLoading ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Logout confirmation modal */}
          {showLogoutConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-100 p-6 rounded-xl">
                <h3 className="text-lg font-bold mb-4">Confirm Logout</h3>
                <p className="mb-6">
                  Are you sure you want to logout this email account?
                </p>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowLogoutConfirm(false)}
                    className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={logoutAccount}
                    className="px-4 py-2 bg-red-600 rounded hover:bg-red-500"
                    disabled={loading}
                  >
                    {loading ? "Logging out..." : "Logout"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}