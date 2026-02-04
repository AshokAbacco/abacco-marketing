// src/

import React, { useState, useEffect } from "react";
import { api } from "../../utils/api"; 

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function AddAccountManager({ onClose, onAccountAdded }) {
  const [accounts, setAccounts] = useState([]);
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
  const [showSuccessMessage, setShowSuccessMessage] = useState("");
  const [error, setError] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [help, setHelp] = useState(null);

  // 🔥 NEW: State for editing sender name
  const [editingSenderName, setEditingSenderName] = useState(null);
  const [tempSenderName, setTempSenderName] = useState("");

  useEffect(() => {
    fetchAccounts();
  }, []);

const fetchAccounts = async () => {
  setLoadingAccounts(true);
  setError(null);

  try {
    const res = await api.get(`${API_BASE_URL}/api/accounts`);

    if (res.data?.success && Array.isArray(res.data.data)) {
      setAccounts(res.data.data);
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
  setLoading(true);

  try {
    const formData = {
      ...form,
      imapUser: form.imapUser || form.email,
      smtpUser: form.smtpUser || form.email,
    };

    console.log("Sending:", formData); // 🔥 debug

    const res = await api.post(`${API_BASE_URL}/api/accounts`, formData);

    console.log("Success:", res.data);

    onClose();
  } catch (err) {
    console.error("❌ Full error:", err.response?.data || err.message);
    setError(err.response?.data?.error || "Failed to add account");
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

  const confirmLogout = (id) => {
    setAccountToLogout(id);
    setShowLogoutConfirm(true);
  };

const logoutAccount = async () => {
  if (!accountToLogout) return;
  setLoading(true);

  try {
    const token = localStorage.getItem("token");

    // ✅ Only call the real backend route
    await api.delete(`${API_BASE_URL}/api/accounts/${accountToLogout}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

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
    setShowSuccessMessage("✅ Account deleted successfully!");

    setTimeout(async () => {
      await fetchAccounts();
      setShowSuccessMessage("");
    }, 1500);
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

          {/* 🔥 NEW: List accounts with editable sender name */}
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-2">Your Accounts</h3>
            {accounts.length === 0 ? (
              <div className="text-gray-400">No accounts configured.</div>
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
                      <div className="font-medium">{acc.email}</div>
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmLogout(acc.id);
                      }}
                      className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                    >
                      Logout
                    </button>
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
                Sender Name (Optional)
              </label>
              <input
                type="text"
                value={form.senderName}
                onChange={(e) =>
                  setForm({ ...form, senderName: e.target.value })
                }
                placeholder="Sender Name"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
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
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-md hover:from-emerald-700 hover:to-green-700"
                disabled={loading}
              >
                {loading ? "Adding..." : "Add Account"}
              </button>
            </div>
          </form>

          {/* Logout confirmation modal */}
          {showLogoutConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-700 p-6 rounded-xl">
                <h3 className="text-lg font-bold mb-4">Confirm Logout</h3>
                <p className="mb-6">
                  Are you sure you want to logout this email account?
                </p>
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => setShowLogoutConfirm(false)}
                    className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500"
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