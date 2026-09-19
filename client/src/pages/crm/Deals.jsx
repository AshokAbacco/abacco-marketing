// src/pages/crm/Deals.jsx — Kanban pipeline.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus, Search, Settings2, X, Pencil, Trash2, ArrowUp, ArrowDown, Calendar, User, Building2, CheckSquare,
} from "lucide-react";
import { api } from "../utils/api";
import { useApiGet, useCrmUsers, useDebounced, formatMoney, formatDate, errMessage, isAdminOrHr } from "./lib";
import { CrmTabs, PageTitle, Card, Button, Empty, ErrorText, StageDot, inputClass, Modal, Field } from "./components/ui";
import { DealFormModal, TaskFormModal, NoteComposer } from "./components/forms";
import TaskList from "./components/TaskList";

/* ── Card ─────────────────────────────────────────────────────────────── */
function DealCard({ deal, onOpen, onDragStart, dragging }) {
  return (
    <button
      type="button"
      draggable={deal.canEdit}
      onDragStart={(e) => onDragStart(e, deal)}
      onClick={() => onOpen(deal.id)}
      className={`w-full text-left rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 shadow-sm hover:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 ${dragging ? "opacity-40" : ""} ${deal.canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 break-words">{deal.title}</p>
      {(deal.contact || deal.company) && (
        <p className="text-xs text-slate-500 mt-0.5 truncate">
          {deal.company?.name}{deal.company && deal.contact ? " · " : ""}{deal.contact?.displayName}
        </p>
      )}
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="font-bold text-slate-700 dark:text-slate-200">{deal.amount !== null ? formatMoney(deal.amount, deal.currency) : ""}</span>
        <span className="text-slate-400 truncate max-w-[50%]">{deal.owner?.name}</span>
      </div>
      {deal.openTasks > 0 && (
        <p className={`mt-1.5 text-xs inline-flex items-center gap-1 ${deal.nextTaskDueAt && new Date(deal.nextTaskDueAt) < new Date() ? "text-red-600 font-semibold" : "text-slate-500"}`}>
          <CheckSquare size={12} /> {deal.openTasks} task{deal.openTasks > 1 ? "s" : ""}
          {deal.nextTaskDueAt ? ` · next ${formatDate(deal.nextTaskDueAt)}` : ""}
        </p>
      )}
    </button>
  );
}

/* ── Column ───────────────────────────────────────────────────────────── */
function Column({ stage, draggingId, onOpen, onDragStart, onDrop, onAdd }) {
  const [over, setOver] = useState(false);
  const [dropIndex, setDropIndex] = useState(null);

  const indexFromEvent = (e) => {
    const cards = [...e.currentTarget.querySelectorAll("[data-card]")];
    const y = e.clientY;
    const idx = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return idx === -1 ? cards.length : idx;
  };

  return (
    <section
      aria-label={`${stage.name} stage`}
      className={`flex flex-col w-72 shrink-0 rounded-2xl ${over ? "bg-sky-50 dark:bg-slate-800/60 ring-2 ring-sky-300" : "bg-slate-100/70 dark:bg-slate-900"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); setDropIndex(indexFromEvent(e)); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setOver(false); setDropIndex(null); } }}
      onDrop={(e) => {
        e.preventDefault();
        const idx = indexFromEvent(e);
        setOver(false);
        setDropIndex(null);
        onDrop(stage, idx);
      }}
    >
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-sm text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 min-w-0">
            <StageDot color={stage.color} /><span className="truncate">{stage.name}</span>
            <span className="text-slate-400 font-medium">{stage.count}</span>
          </h2>
          <button type="button" onClick={() => onAdd(stage)} className="p-1 rounded-lg text-slate-500 hover:bg-white dark:hover:bg-slate-800" aria-label={`Add deal to ${stage.name}`}>
            <Plus size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 h-4">
          {stage.totals.map((t) => formatMoney(t.amount, t.currency)).join(" + ")}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-2 min-h-[120px] max-h-[calc(100vh-300px)]">
        {stage.deals.map((d, i) => (
          <div key={d.id} data-card>
            {over && dropIndex === i && <div className="h-1 rounded bg-sky-400 mb-2" />}
            <DealCard deal={d} onOpen={onOpen} onDragStart={onDragStart} dragging={draggingId === d.id} />
          </div>
        ))}
        {over && dropIndex === stage.deals.length && <div className="h-1 rounded bg-sky-400" />}
        {stage.count > stage.deals.length && (
          <p className="text-xs text-center text-slate-500 pt-1">+{stage.count - stage.deals.length} more — use search to narrow</p>
        )}
        {!stage.deals.length && !over && <p className="text-xs text-center text-slate-400 pt-6">Drop deals here</p>}
      </div>
    </section>
  );
}

/* ── Deal side panel ──────────────────────────────────────────────────── */
function DealPanel({ dealId, stages, onClose, onChanged }) {
  const { data, error, reload } = useApiGet(`/api/crm/deals/${dealId}`);
  const [modal, setModal] = useState(null);
  const deal = data?.data;
  const refresh = () => { reload(); onChanged(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !modal) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, modal]);

  const remove = async () => {
    if (!window.confirm(`Delete deal "${deal.title}"?`)) return;
    try {
      await api.delete(`/api/crm/deals/${deal.id}`);
      onChanged();
      onClose();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  const changeStage = async (stageId) => {
    const stage = stages.find((s) => s.id === Number(stageId));
    let lostReason;
    if (stage?.kind === "lost") lostReason = window.prompt("Why was this deal lost? (optional)") || undefined;
    try {
      await api.patch(`/api/crm/deals/${deal.id}/move`, { stageId: Number(stageId), lostReason });
      refresh();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Deal details">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-inherit z-10">
          <h2 className="font-bold text-lg text-slate-900 dark:text-white truncate">{deal?.title || "Deal"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        {error && !deal && <div className="p-4"><ErrorText>{error}</ErrorText></div>}
        {!deal && !error && <Empty>Loading…</Empty>}
        {deal && (
          <div className="p-4 space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Value</p>
                <p className="text-xl font-bold">{formatMoney(deal.amount, deal.currency)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Stage</p>
                {deal.canEdit ? (
                  <select value={deal.stageId} onChange={(e) => changeStage(e.target.value)} className={inputClass} aria-label="Stage">
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <p className="font-semibold inline-flex items-center gap-1.5"><StageDot color={deal.stage?.color} />{deal.stage?.name}</p>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><User size={14} />{deal.owner?.name}</p>
              <p className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><Calendar size={14} />Close {formatDate(deal.expectedCloseAt)}</p>
              {deal.contact && (
                <p className="col-span-2 flex items-center gap-1.5">
                  <User size={14} className="text-slate-400" />
                  <Link to={`/crm/contacts/${deal.contact.id}`} className="text-sky-700 hover:underline">{deal.contact.displayName}</Link>
                  <span className="text-slate-400 truncate">{deal.contact.email}</span>
                </p>
              )}
              {deal.company && (
                <p className="col-span-2 flex items-center gap-1.5">
                  <Building2 size={14} className="text-slate-400" />
                  <Link to={`/crm/companies/${deal.company.id}`} className="text-sky-700 hover:underline">{deal.company.name}</Link>
                </p>
              )}
              {deal.status !== "open" && (
                <p className={`col-span-2 text-sm font-semibold ${deal.status === "won" ? "text-emerald-600" : "text-red-600"}`}>
                  {deal.status === "won" ? "Won" : "Lost"} {formatDate(deal.closedAt)}{deal.lostReason ? ` — ${deal.lostReason}` : ""}
                </p>
              )}
            </div>

            {deal.canEdit && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setModal("edit")}><Pencil size={15} /> Edit</Button>
                <Button variant="ghost" className="text-red-600" onClick={remove}><Trash2 size={15} /> Delete</Button>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 dark:text-white">Tasks</h3>
                <Button variant="secondary" onClick={() => setModal("task")}><Plus size={15} /> Task</Button>
              </div>
              <TaskList tasks={deal.tasks} onChanged={refresh} showContext={false} emptyText="No tasks for this deal." />
            </div>

            <div>
              <h3 className="font-bold text-slate-800 dark:text-white mb-2">Add note</h3>
              <NoteComposer target={{ dealId: deal.id }} onSaved={refresh} />
            </div>

            <div>
              <h3 className="font-bold text-slate-800 dark:text-white mb-2">Activity</h3>
              {!deal.activities.length && <Empty>No activity yet.</Empty>}
              <ul className="space-y-3">
                {deal.activities.map((a) => (
                  <li key={a.id} className="text-sm border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">{a.title || a.type}</p>
                    {a.body && <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">{a.body}</p>}
                    <p className="text-xs text-slate-400">{a.user?.name ? `${a.user.name} · ` : ""}{formatDate(a.occurredAt, true)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
      {modal === "edit" && deal && (
        <DealFormModal deal={deal} stages={stages} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} />
      )}
      {modal === "task" && deal && (
        <TaskFormModal
          defaults={{ dealId: deal.id, contactId: deal.contactId, contextLabel: deal.title }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Stage settings (Admin/HR) ────────────────────────────────────────── */
function StageSettings({ onClose, onChanged }) {
  const { data, error, reload } = useApiGet("/api/crm/stages");
  const [draft, setDraft] = useState({ name: "", kind: "open", color: "#0ea5e9", probability: 20 });
  const [msg, setMsg] = useState("");
  const stages = data?.data || [];
  const done = () => { reload(); onChanged(); };

  const act = async (fn) => {
    setMsg("");
    try {
      await fn();
      done();
    } catch (err) {
      setMsg(errMessage(err));
    }
  };

  const move = (idx, dir) => act(() => {
    const ids = stages.map((s) => s.id);
    const j = idx + dir;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    return api.put("/api/crm/stages/reorder", { ids });
  });

  return (
    <Modal title="Pipeline stages" onClose={onClose} wide>
      <ErrorText>{error || msg}</ErrorText>
      <ul className="space-y-2 mb-5">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
            <input type="color" value={s.color} aria-label={`${s.name} colour`}
              onChange={(e) => act(() => api.put(`/api/crm/stages/${s.id}`, { color: e.target.value }))}
              className="w-8 h-8 rounded border-0 bg-transparent" />
            <input defaultValue={s.name} aria-label="Stage name"
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && act(() => api.put(`/api/crm/stages/${s.id}`, { name: e.target.value }))}
              className={`${inputClass} flex-1 min-w-[120px]`} />
            <select value={s.kind} aria-label="Stage type"
              onChange={(e) => act(() => api.put(`/api/crm/stages/${s.id}`, { kind: e.target.value }))}
              className={`${inputClass} w-24`}>
              <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
            </select>
            <label className="text-xs flex items-center gap-1">
              <input type="radio" name="defaultStage" checked={s.isDefault}
                onChange={() => act(() => api.put(`/api/crm/stages/${s.id}`, { isDefault: true }))} />
              Default
            </label>
            <span className="text-xs text-slate-400 w-16 text-right">{s.dealCount} deals</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 disabled:opacity-30" aria-label="Move up"><ArrowUp size={16} /></button>
            <button type="button" disabled={i === stages.length - 1} onClick={() => move(i, 1)} className="p-1 disabled:opacity-30" aria-label="Move down"><ArrowDown size={16} /></button>
            <button type="button" onClick={() => window.confirm(`Remove stage "${s.name}"?`) && act(() => api.delete(`/api/crm/stages/${s.id}`))}
              className="p-1 text-red-600" aria-label={`Remove ${s.name}`}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await api.post("/api/crm/stages", draft);
            setDraft((d) => ({ ...d, name: "" }));
          });
        }}
        className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end"
      >
        <div className="sm:col-span-2"><Field label="New stage"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} maxLength={50} /></Field></div>
        <Field label="Type">
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={inputClass}>
            <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
          </select>
        </Field>
        <Button type="submit"><Plus size={15} /> Add stage</Button>
      </form>
      <p className="text-xs text-slate-500 mt-3">A stage can only be removed when it has no deals. New stages are added at the end — use the arrows to reorder.</p>
    </Modal>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function Deals() {
  const users = useCrmUsers();
  const [params, setParams] = useSearchParams();
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const { data, error, loading, reload } = useApiGet("/api/crm/deals/board", {
    ownerId: owner || undefined, search: debounced || undefined,
  });
  const [columns, setColumns] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [createIn, setCreateIn] = useState(null);
  const [showStages, setShowStages] = useState(false);
  const [moveError, setMoveError] = useState("");
  const openId = Number(params.get("open")) || null;

  // Local copy for optimistic drag-and-drop; replaced whenever the server responds.
  const board = columns?.source === data ? columns.list : data?.data || [];
  const stages = useMemo(
    () => (data?.data || []).map((col) => {
      const stage = { ...col };
      delete stage.deals;
      return stage;
    }),
    [data]
  );
  const setBoard = (list) => setColumns({ source: data, list });

  const openDeal = useCallback((id) => setParams((p) => { const n = new URLSearchParams(p); n.set("open", id); return n; }), [setParams]);
  const closeDeal = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete("open"); return n; }), [setParams]);

  const onDragStart = (e, deal) => {
    if (!deal.canEdit) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(deal.id));
    setDragging(deal);
  };

  const onDrop = async (stage, index) => {
    const deal = dragging;
    setDragging(null);
    if (!deal) return;
    setMoveError("");

    // Build the new column order locally.
    const without = board.map((col) => ({ ...col, deals: col.deals.filter((d) => d.id !== deal.id) }));
    const target = without.find((c) => c.id === stage.id);
    const sourceCol = board.find((c) => c.deals.some((d) => d.id === deal.id));
    const oldIndex = sourceCol?.deals.findIndex((d) => d.id === deal.id) ?? -1;
    let insertAt = index;
    if (sourceCol?.id === stage.id && oldIndex !== -1 && oldIndex < index) insertAt -= 1;
    if (sourceCol?.id === stage.id && insertAt === oldIndex) return;

    const above = target.deals[insertAt - 1] || null;
    const below = target.deals[insertAt] || null;

    let lostReason;
    if (stage.kind === "lost" && sourceCol?.id !== stage.id) {
      lostReason = window.prompt("Why was this deal lost? (optional)");
      if (lostReason === null) return; // cancelled
    }

    target.deals.splice(insertAt, 0, { ...deal, stageId: stage.id, status: stage.kind });
    for (const col of without) {
      if (col.id === stage.id && sourceCol?.id !== stage.id) col.count += 1;
      if (col.id === sourceCol?.id && sourceCol.id !== stage.id) col.count -= 1;
    }
    setBoard(without);

    try {
      await api.patch(`/api/crm/deals/${deal.id}/move`, {
        stageId: stage.id,
        beforeId: above?.id,
        afterId: below?.id,
        lostReason: lostReason || undefined,
      });
    } catch (err) {
      setMoveError(errMessage(err, "Could not move the deal"));
    } finally {
      reload();
    }
  };

  const pipelineTotal = useMemo(() => {
    const sums = {};
    for (const col of data?.data || []) {
      if (col.kind !== "open") continue;
      for (const t of col.totals) sums[t.currency] = (sums[t.currency] || 0) + t.amount;
    }
    return Object.entries(sums).map(([cur, amt]) => formatMoney(amt, cur)).join(" + ") || formatMoney(0);
  }, [data]);

  return (
    <div className="max-w-[100rem] mx-auto">
      <CrmTabs />
      <PageTitle
        title="Deals"
        subtitle={data ? `Open pipeline: ${pipelineTotal}` : " "}
        actions={
          <>
            {data?.canManageStages && isAdminOrHr() && (
              <Button variant="secondary" onClick={() => setShowStages(true)}><Settings2 size={16} /> Stages</Button>
            )}
            <Button onClick={() => setCreateIn(stages.find((s) => s.isDefault) || stages[0] || {})}><Plus size={16} /> New deal</Button>
          </>
        }
      />
      <Card className="p-3 mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals, contacts, companies…"
            className={`${inputClass} pl-9`} aria-label="Search deals" />
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={`${inputClass} w-auto`} aria-label="Owner">
          <option value="">All owners</option>
          <option value="me">My deals</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Card>

      <ErrorText>{error || moveError}</ErrorText>
      {!data && loading && <Empty>Loading pipeline…</Empty>}

      <div className={`flex gap-3 overflow-x-auto pb-4 ${loading && data ? "opacity-80" : ""}`}>
        {board.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            draggingId={dragging?.id}
            onOpen={openDeal}
            onDragStart={onDragStart}
            onDrop={onDrop}
            onAdd={setCreateIn}
          />
        ))}
      </div>
      <p className="text-xs text-slate-500">Drag cards between columns to change their stage. Only the deal owner or Admin/HR can move a deal.</p>

      {openId && <DealPanel dealId={openId} stages={stages} onClose={closeDeal} onChanged={reload} />}
      {createIn && (
        <DealFormModal
          stages={stages}
          defaults={{ stageId: createIn.id }}
          onClose={() => setCreateIn(null)}
          onSaved={(d) => { setCreateIn(null); reload(); openDeal(d.id); }}
        />
      )}
      {showStages && <StageSettings onClose={() => setShowStages(false)} onChanged={reload} />}
    </div>
  );
}
