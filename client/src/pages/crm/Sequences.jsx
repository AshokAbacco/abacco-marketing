// src/pages/crm/Sequences.jsx — automatic follow-ups.
import { useState } from "react";
import { Plus, Play, Pause, Archive, Trash2, ArrowUp, ArrowDown, X, Pencil, Info } from "lucide-react";
import { api } from "../utils/api";
import { useApiGet, formatDate, errMessage } from "./lib";
import {
  CrmTabs, PageTitle, Card, Button, Empty, ErrorText, Modal, Field, inputClass, Pager,
} from "./components/ui";

const STATUS_STYLE = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  archived: "bg-slate-50 text-slate-500 border-slate-200",
};

const PEOPLE_LABELS = {
  active: "In progress",
  completed: "All steps sent",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
  stopped: "Stopped",
};

const MERGE_HELP = "{{firstName|there}}, {{company}}, {{fullName}}, {{jobTitle}}, {{country}}";

function StatusBadge({ status }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold capitalize ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>{status}</span>;
}

/* ── Editor ───────────────────────────────────────────────────────────── */
function SequenceEditor({ sequence, onClose, onSaved }) {
  const editing = Boolean(sequence);
  const candidates = useApiGet(editing ? null : "/api/automation/sequences/candidates");
  const [name, setName] = useState(sequence?.name || "");
  const [campaignId, setCampaignId] = useState("");
  const [steps, setSteps] = useState(
    sequence?.steps?.map((s) => ({ delayDays: s.delayDays, bodyHtml: s.bodyHtml })) || [
      { delayDays: 3, bodyHtml: "<p>Hi {{firstName|there}},</p><p>Just following up on my email below — would this be of interest to {{company|your team}}?</p>" },
    ]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const setStep = (i, patch) => setSteps((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveStep = (i, dir) => setSteps((list) => {
    const copy = [...list];
    [copy[i], copy[i + dir]] = [copy[i + dir], copy[i]];
    return copy;
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = { name, steps: steps.map((s) => ({ delayDays: Number(s.delayDays), bodyHtml: s.bodyHtml })) };
    try {
      if (editing) await api.put(`/api/automation/sequences/${sequence.id}`, payload);
      else await api.post("/api/automation/sequences", { ...payload, campaignId: Number(campaignId) });
      onSaved();
    } catch (err) {
      setError(errMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const cumulativeDays = steps.reduce((acc, s) => [...acc, (acc.at(-1) || 0) + (Number(s.delayDays) || 0)], []);
  return (
    <Modal title={editing ? "Edit sequence" : "New follow-up sequence"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {!editing && (
          <Field label="Base campaign *" hint="People who received this campaign are enrolled automatically.">
            <select required value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={inputClass}>
              <option value="">Select a campaign…</option>
              {(candidates.data?.data || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.status} · {formatDate(c.createdAt)}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={120} placeholder="e.g. Expo 2026 follow-ups" /></Field>

        <div className="rounded-lg bg-sky-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 flex gap-2">
          <Info size={16} className="shrink-0 text-sky-600" />
          <span>
            Each step is sent as a reply in the same thread (“Re: original subject”) from the mailbox that sent the original.
            Anyone who replies, bounces or unsubscribes is stopped automatically. Personalise with {MERGE_HELP}.
          </span>
        </div>

        <ol className="space-y-3">
          {steps.map((s, i) => {
            const totalDays = cumulativeDays[i];
            return (
              <li key={i} className="border border-slate-200 dark:border-slate-700 rounded-xl p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-bold text-sm text-slate-700 dark:text-slate-200">Step {i + 1}</span>
                  <span className="text-sm text-slate-500">if no reply after</span>
                  <input
                    type="number" min="1" max="90" required value={s.delayDays}
                    onChange={(e) => setStep(i, { delayDays: e.target.value })}
                    className={`${inputClass} w-20`} aria-label={`Step ${i + 1} wait days`}
                  />
                  <span className="text-sm text-slate-500">days <span className="text-slate-400">(day {totalDays} overall)</span></span>
                  <div className="ml-auto flex gap-1">
                    <button type="button" disabled={i === 0} onClick={() => moveStep(i, -1)} className="p-1 disabled:opacity-30" aria-label="Move step up"><ArrowUp size={16} /></button>
                    <button type="button" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)} className="p-1 disabled:opacity-30" aria-label="Move step down"><ArrowDown size={16} /></button>
                    <button type="button" disabled={steps.length === 1} onClick={() => setSteps((l) => l.filter((_, j) => j !== i))} className="p-1 text-red-600 disabled:opacity-30" aria-label="Remove step"><Trash2 size={16} /></button>
                  </div>
                </div>
                <textarea
                  required rows={5} value={s.bodyHtml}
                  onChange={(e) => setStep(i, { bodyHtml: e.target.value })}
                  className={`${inputClass} font-mono text-xs`}
                  aria-label={`Step ${i + 1} message (HTML)`}
                />
              </li>
            );
          })}
        </ol>
        {steps.length < 10 && (
          <Button variant="secondary" onClick={() => setSteps((l) => [...l, { delayDays: 4, bodyHtml: "<p>Hi {{firstName|there}},</p><p></p>" }])}>
            <Plus size={15} /> Add step
          </Button>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create (as draft)"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Detail panel ─────────────────────────────────────────────────────── */
function SequencePanel({ id, onClose, onChanged }) {
  const { data, error, reload } = useApiGet(`/api/automation/sequences/${id}`);
  const [peopleStatus, setPeopleStatus] = useState("");
  const [page, setPage] = useState(1);
  const people = useApiGet(`/api/automation/sequences/${id}/enrollments`, { status: peopleStatus || undefined, page, pageSize: 50 });
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const seq = data?.data;

  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg("");
    try {
      await api.post(`/api/automation/sequences/${id}/${action}`);
      reload();
      people.reload();
      onChanged();
    } catch (err) {
      setMsg(errMessage(err));
    }
  };

  const stopPerson = async (row) => {
    try {
      await api.post(`/api/automation/enrollments/${row.id}/stop`);
      people.reload();
      reload();
    } catch (err) {
      setMsg(errMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Sequence details">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-inherit z-10">
          <h2 className="font-bold text-lg truncate text-slate-900 dark:text-white">{seq?.name || "Sequence"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        {error && !seq && <div className="p-4"><ErrorText>{error}</ErrorText></div>}
        {!seq && !error && <Empty>Loading…</Empty>}
        {seq && (
          <div className="p-4 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={seq.status} />
              <span className="text-sm text-slate-500">Base campaign: <strong>{seq.campaign?.name}</strong> ({seq.baseSent} sent)</span>
              {seq.lastRunAt && <span className="text-xs text-slate-400">· last run {formatDate(seq.lastRunAt, true)}</span>}
            </div>
            {seq.canEdit && seq.status !== "archived" && (
              <div className="flex flex-wrap gap-2">
                {seq.status !== "active" && <Button onClick={() => act("activate", "Start sending follow-ups automatically?")}><Play size={15} /> Activate</Button>}
                {seq.status === "active" && <Button variant="secondary" onClick={() => act("pause")}><Pause size={15} /> Pause</Button>}
                <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit steps</Button>
                <Button variant="ghost" className="text-red-600" onClick={() => act("archive", "Archive this sequence? Everyone still in progress will be stopped.")}>
                  <Archive size={15} /> Archive
                </Button>
              </div>
            )}
            <ErrorText>{msg}</ErrorText>

            <div>
              <h3 className="font-bold mb-2 text-slate-800 dark:text-white">Steps</h3>
              <ol className="space-y-2">
                {seq.steps.map((s) => {
                  const st = seq.stats?.steps?.[s.position] || {};
                  return (
                    <li key={s.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span className="font-semibold">Step {s.position} · after {s.delayDays} day{s.delayDays > 1 ? "s" : ""}</span>
                        <span className="text-slate-500">
                          {st.sent || 0} sent · {st.queued || 0} queued · {st.replied || 0} replied · {st.skipped || 0} skipped
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded p-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words">
                        {s.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="font-bold text-slate-800 dark:text-white">People ({seq.stats?.total || 0})</h3>
                <select value={peopleStatus} onChange={(e) => { setPage(1); setPeopleStatus(e.target.value); }} className={`${inputClass} w-auto`} aria-label="Filter people">
                  <option value="">All</option>
                  {Object.entries(PEOPLE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>{l} ({seq.stats?.people?.[k] || 0})</option>
                  ))}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="text-left p-2">Email</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-right p-2">Steps sent</th>
                      <th className="text-left p-2">Next</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(people.data?.data || []).map((p) => (
                      <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 break-all">{p.email}</td>
                        <td className="p-2" title={p.stoppedReason || ""}>{PEOPLE_LABELS[p.status] || p.status}</td>
                        <td className="p-2 text-right">{p.stepsSent}/{seq.steps.length}</td>
                        <td className="p-2 text-slate-500">{p.nextDueAt ? formatDate(p.nextDueAt, true) : "—"}</td>
                        <td className="p-2 text-right">
                          {seq.canEdit && p.status === "active" && (
                            <button type="button" onClick={() => stopPerson(p)} className="text-xs font-semibold text-red-600 hover:underline">Stop</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {people.data && !people.data.data.length && (
                <Empty>{seq.status === "draft" ? "People are enrolled once the sequence is activated." : "Nobody here."}</Empty>
              )}
              {people.data && <Pager page={page} pageSize={50} total={people.data.pagination.total} onPage={setPage} />}
            </div>
          </div>
        )}
      </aside>
      {editing && seq && (
        <SequenceEditor
          sequence={seq}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); onChanged(); }}
        />
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function Sequences() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, loading, reload } = useApiGet("/api/automation/sequences", { status: showArchived ? "archived" : undefined });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const rows = data?.data || [];

  return (
    <div className="max-w-6xl mx-auto">
      <CrmTabs />
      <PageTitle
        title="Follow-up sequences"
        subtitle="Send follow-ups automatically to people who haven't replied."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Show current" : "Show archived"}</Button>
            <Button onClick={() => setCreating(true)}><Plus size={16} /> New sequence</Button>
          </>
        }
      />
      <ErrorText>{error}</ErrorText>
      {!data && loading && <Empty>Loading…</Empty>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((s) => {
          const p = s.stats?.people || {};
          return (
            <Card key={s.id} className="p-4">
              <button type="button" onClick={() => setOpenId(s.id)} className="w-full text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-bold text-slate-800 dark:text-white truncate">{s.name}</h2>
                    <p className="text-sm text-slate-500 truncate">{s.campaign?.name} · {s.stepCount} step{s.stepCount === 1 ? "" : "s"} · {s.owner?.name}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                <dl className="grid grid-cols-4 gap-2 mt-3 text-center">
                  {[["In progress", p.active], ["Replied", p.replied], ["Finished", p.completed], ["Stopped", (p.bounced || 0) + (p.unsubscribed || 0) + (p.stopped || 0)]].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                      <dt className="text-[11px] text-slate-500">{l}</dt>
                      <dd className="font-bold">{v || 0}</dd>
                    </div>
                  ))}
                </dl>
              </button>
            </Card>
          );
        })}
      </div>
      {data && !rows.length && (
        <Card className="p-8 text-center">
          <p className="text-slate-600 dark:text-slate-300">
            {showArchived ? "No archived sequences." : "No sequences yet. Pick a sent campaign and add one or more follow-up steps — they go out automatically to everyone who hasn't replied."}
          </p>
        </Card>
      )}
      {creating && <SequenceEditor onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {openId && <SequencePanel id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
