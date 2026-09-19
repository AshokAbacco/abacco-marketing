// src/pages/crm/Replies.jsx — triage campaign replies; admin sets reply automation.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Settings2, CheckCircle2, RotateCcw, Inbox, Bot } from "lucide-react";
import { api } from "../utils/api";
import { REPLY_CATEGORIES, useApiGet, formatDate, timeAgo, errMessage } from "./lib";
import {
  CrmTabs, PageTitle, Card, Button, Pager, Empty, ErrorText, CategoryBadge, Modal, inputClass,
} from "./components/ui";

function ReplyRow({ reply, highlighted, onChanged, id }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const patch = async (body) => {
    setBusy(true);
    setError("");
    try {
      await api.patch(`/api/crm/replies/${reply.id}`, body);
      onChanged();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li id={id} className={`p-4 flex flex-col md:flex-row gap-3 ${highlighted ? "bg-sky-50 dark:bg-sky-900/20" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {reply.contact ? (
            <Link to={`/crm/contacts/${reply.contact.id}`} className="font-semibold text-slate-800 dark:text-slate-100 hover:underline">
              {reply.contact.displayName}
            </Link>
          ) : (
            <span className="font-semibold text-slate-800 dark:text-slate-100">{reply.email}</span>
          )}
          {reply.contact?.company && <span className="text-sm text-slate-500">· {reply.contact.company}</span>}
          <CategoryBadge value={reply.category} />
          {reply.categorySource === "ai" && <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"><Bot size={12} /> AI</span>}
          {reply.reviewStatus === "pending" && (
            <Link to="/deliverability" className="text-xs font-semibold text-red-600 hover:underline">Removal request — review</Link>
          )}
        </div>
        <p className="text-sm text-slate-500 truncate mt-0.5">
          {reply.subject || "(no subject)"} · to {reply.accountEmail || "?"}
          {reply.campaign?.name ? ` · ${reply.campaign.name}` : ""}
        </p>
        {reply.snippet && (
          <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 break-words">
            “{reply.snippet}”
          </p>
        )}
        <p className="text-xs text-slate-400 mt-1" title={formatDate(reply.receivedAt, true)}>
          {timeAgo(reply.receivedAt)}
          {reply.contact?.owner ? ` · owner ${reply.contact.owner.name}` : ""}
          {reply.handledAt ? ` · handled ${timeAgo(reply.handledAt)}${reply.handledBy ? ` by ${reply.handledBy.name}` : ""}` : ""}
        </p>
        <ErrorText>{error}</ErrorText>
      </div>
      <div className="flex md:flex-col gap-2 shrink-0 md:w-44">
        <select
          value={reply.category || ""}
          disabled={busy}
          onChange={(e) => patch({ category: e.target.value })}
          className={inputClass}
          aria-label="Change category"
        >
          {!reply.category && <option value="">Unclassified</option>}
          {REPLY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <Link to="/inbox" className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
          <Inbox size={15} /> Open inbox
        </Link>
        {reply.handledAt ? (
          <Button variant="ghost" disabled={busy} onClick={() => patch({ handled: false })}><RotateCcw size={15} /> Reopen</Button>
        ) : (
          <Button disabled={busy} onClick={() => patch({ handled: true })}><CheckCircle2 size={15} /> Done</Button>
        )}
      </div>
    </li>
  );
}

function AutomationSettings({ onClose }) {
  const { data, error } = useApiGet("/api/crm/settings/reply-automation");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const settings = form || data?.data;
  const canEdit = data?.canEdit;
  const update = (patch) => setForm({ ...settings, ...patch });
  const updateRule = (cat, patch) =>
    setForm({ ...settings, rules: { ...settings.rules, [cat]: { ...settings.rules[cat], ...patch } } });

  const stageValue = (rule) => {
    if (rule.markLost) return "lost";
    if (rule.stageId) return String(rule.stageId);
    const byName = data?.stages.find((s) => s.name.toLowerCase() === String(rule.stageName || "").toLowerCase());
    return byName ? String(byName.id) : "";
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.put("/api/crm/settings/reply-automation", settings);
      setMsg("Saved.");
      setForm(null);
    } catch (err) {
      setMsg(errMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Reply automation" onClose={onClose} wide>
      <ErrorText>{error}</ErrorText>
      {!settings ? <Empty>Loading…</Empty> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            When someone replies to a campaign, the reply is classified and these actions run for the contact's owner.
            Deals only move <strong>forward</strong>; won and lost deals are never touched.
            {data.aiEnabled ? " AI classification is on for unclear replies." : " Classification uses keyword rules (AI is off)."}
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!canEdit} checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
              Automation on
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!canEdit} checked={settings.createDealIfMissing} onChange={(e) => update({ createDealIfMissing: e.target.checked })} />
              Create a deal when a positive reply has none
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left p-2">Reply type</th>
                  <th className="text-left p-2">Deal</th>
                  <th className="text-left p-2">Task for owner</th>
                  <th className="text-left p-2">Notify owner</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => {
                  const rule = settings.rules[c.value];
                  return (
                    <tr key={c.value} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="p-2"><CategoryBadge value={c.value} /></td>
                      <td className="p-2">
                        <select
                          disabled={!canEdit}
                          value={stageValue(rule)}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "lost") updateRule(c.value, { markLost: true, stageId: null, stageName: null });
                            else if (!v) updateRule(c.value, { markLost: false, stageId: null, stageName: null });
                            else updateRule(c.value, { markLost: false, stageId: Number(v), stageName: null });
                          }}
                          className={inputClass}
                          aria-label={`Deal action for ${c.label}`}
                        >
                          <option value="">Don't change</option>
                          {data.stages.filter((s) => s.kind === "open").map((s) => <option key={s.id} value={s.id}>Move to {s.name}</option>)}
                          <option value="lost">Mark deal lost</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" disabled={!canEdit} checked={rule.task} onChange={(e) => updateRule(c.value, { task: e.target.checked })} aria-label={`Create task for ${c.label}`} />
                          <input
                            type="number" min="0" max="720" disabled={!canEdit || !rule.task}
                            value={rule.taskDueHours}
                            onChange={(e) => updateRule(c.value, { taskDueHours: Number(e.target.value) })}
                            className={`${inputClass} w-20`} aria-label="Due in hours"
                          />
                          <span className="text-xs text-slate-500">h</span>
                        </div>
                      </td>
                      <td className="p-2">
                        <input type="checkbox" disabled={!canEdit} checked={rule.notify} onChange={(e) => updateRule(c.value, { notify: e.target.checked })} aria-label={`Notify for ${c.label}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {msg && <p className="text-sm text-slate-600" role="status">{msg}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            {canEdit && <Button onClick={save} disabled={saving || !form}>{saving ? "Saving…" : "Save"}</Button>}
          </div>
          {!canEdit && <p className="text-xs text-slate-500">Only Admin/HR can change these settings.</p>}
        </div>
      )}
    </Modal>
  );
}

export default function Replies() {
  const [params] = useSearchParams();
  const openId = Number(params.get("open")) || null;
  const [status, setStatus] = useState("unhandled");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("mine");
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const pageSize = 30;

  const { data, error, loading, reload } = useApiGet("/api/crm/replies", {
    status: openId && status === "unhandled" ? "all" : status,
    category: category || undefined,
    scope,
    page,
    pageSize,
  });

  useEffect(() => {
    if (!openId) return;
    const el = document.getElementById(`reply-${openId}`);
    el?.scrollIntoView({ block: "center" });
  }, [openId, data]);

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-6xl mx-auto">
      <CrmTabs />
      <PageTitle
        title="Replies"
        subtitle="Every reply to your campaigns, sorted by what the person wants."
        actions={<Button variant="secondary" onClick={() => setShowSettings(true)}><Settings2 size={16} /> Automation</Button>}
      />

      <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Category">
        <button type="button" role="tab" aria-selected={!category} onClick={() => { setPage(1); setCategory(""); }}
          className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${!category ? "bg-sky-600 text-white border-sky-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600"}`}>
          All <span className="opacity-70">{total}</span>
        </button>
        {REPLY_CATEGORIES.map((c) => (
          <button key={c.value} type="button" role="tab" aria-selected={category === c.value}
            onClick={() => { setPage(1); setCategory(c.value); }}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${category === c.value ? "bg-sky-600 text-white border-sky-600" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600"}`}>
            {c.label} <span className="opacity-70">{counts[c.value] || 0}</span>
          </button>
        ))}
      </div>

      <Card>
        <div className="p-3 flex flex-wrap gap-2 justify-between border-b border-slate-100 dark:border-slate-800">
          <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
            {[["unhandled", "To do"], ["handled", "Done"], ["all", "All"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => { setPage(1); setStatus(v); }}
                className={`px-3 py-1.5 ${status === v ? "bg-sky-600 text-white" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"}`}>
                {l}
              </button>
            ))}
          </div>
          {data?.canViewAll && (
            <select value={scope} onChange={(e) => { setPage(1); setScope(e.target.value); }} className={`${inputClass} w-auto`} aria-label="Whose replies">
              <option value="mine">My mailboxes</option>
              <option value="all">All mailboxes</option>
            </select>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        {!data && loading && <Empty>Loading…</Empty>}
        <ul className={`divide-y divide-slate-100 dark:divide-slate-800 ${loading ? "opacity-60" : ""}`}>
          {(data?.data || []).map((r) => (
            <ReplyRow key={r.id} id={`reply-${r.id}`} reply={r} highlighted={r.id === openId} onChanged={reload} />
          ))}
        </ul>
        {data && !data.data.length && (
          <Empty>{status === "unhandled" ? "No replies waiting. 🎉" : "No replies here."}</Empty>
        )}
        {data && <Pager page={page} pageSize={pageSize} total={data.pagination.total} onPage={setPage} />}
      </Card>

      {showSettings && <AutomationSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
