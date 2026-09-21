// src/pages/crm/components/forms.jsx — create/edit modals shared by CRM pages.
import { useEffect, useState } from "react";
import { api } from "../../utils/api";
import {
  CATEGORIES, LIFECYCLES, PRIORITIES, CURRENCIES,
  errMessage, toLocalInput, fromLocalInput, isAdminOrHr, useCrmUsers, useDebounced, currentUser,
} from "../lib";
import { Modal, Field, inputClass, Button, ErrorText, UserSelect } from "./ui";

/* ── Company picker (search-as-you-type) ─────────────────────────────── */
export function CompanyPicker({ value, valueLabel, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const debounced = useDebounced(query, 300);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api
      .get("/api/crm/companies", { params: { search: debounced || undefined, pageSize: 10, sort: "name" } })
      .then((r) => { if (!cancelled) setResults(r.data.data || []); })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [debounced, open]);

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center justify-between gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm">
          <span className="truncate">{valueLabel || `Company #${value}`}</span>
          <button type="button" className="text-xs text-sky-700 font-semibold" onClick={() => onChange(null, null)}>Change</button>
        </div>
      ) : (
        <input
          className={inputClass}
          placeholder="Search companies…"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {open && !value && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 dark:hover:bg-slate-700"
                onMouseDown={() => { onChange(c.id, c.name); setQuery(""); }}
              >
                {c.name} {c.domain && <span className="text-slate-400">· {c.domain}</span>}
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-2 text-sm text-slate-500">No companies found</li>}
        </ul>
      )}
    </div>
  );
}

/* ── Contact picker ───────────────────────────────────────────────────── */
export function ContactPicker({ value, valueLabel, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const debounced = useDebounced(query, 300);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api
      .get("/api/crm/contacts", { params: { search: debounced || undefined, pageSize: 10 } })
      .then((r) => { if (!cancelled) setResults(r.data.data || []); })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [debounced, open]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm">
        <span className="truncate">{valueLabel || `Contact #${value}`}</span>
        <button type="button" className="text-xs text-sky-700 font-semibold" onClick={() => onChange(null, null)}>Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        className={inputClass}
        placeholder="Search contacts by name or email…"
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 dark:hover:bg-slate-700"
                onMouseDown={() => { onChange(c.id, c.displayName, c.company); setQuery(""); }}
              >
                {c.displayName} <span className="text-slate-400">· {c.email}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-2 text-sm text-slate-500">No contacts found</li>}
        </ul>
      )}
    </div>
  );
}

/* ── Contact ──────────────────────────────────────────────────────────── */
export function ContactFormModal({ contact, onClose, onSaved }) {
  const editing = Boolean(contact);
  const users = useCrmUsers();
  const admin = isAdminOrHr();
  const [form, setForm] = useState(() => ({
    email: contact?.email || "",
    firstName: contact?.firstName || "",
    lastName: contact?.lastName || "",
    phone: contact?.phone || "",
    jobTitle: contact?.jobTitle || "",
    country: contact?.country || "",
    website: contact?.website || "",
    linkedin: contact?.linkedin || "",
    category: contact?.category || "",
    lifecycle: contact?.lifecycle || "lead",
    tags: (contact?.tags || []).join(", "),
    companyId: contact?.company?.id || contact?.companyId || null,
    companyName: contact?.company?.name || "",
    ownerId: contact?.ownerId || currentUser()?.id || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      firstName: form.firstName, lastName: form.lastName, phone: form.phone, jobTitle: form.jobTitle,
      country: form.country, website: form.website, linkedin: form.linkedin,
      category: form.category || null, lifecycle: form.lifecycle,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      companyId: form.companyId,
    };
    if (form.ownerId && (admin || !editing) && form.ownerId !== contact?.ownerId) payload.ownerId = form.ownerId;
    try {
      const res = editing
        ? await api.put(`/api/crm/contacts/${contact.id}`, payload)
        : await api.post("/api/crm/contacts", { ...payload, email: form.email });
      onSaved(res.data.data);
    } catch (err) {
      setError(errMessage(err, "Could not save the contact"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? "Edit contact" : "New contact"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Field label="Email *">
            <input type="email" required disabled={editing} value={form.email} onChange={set("email")} className={inputClass} />
          </Field>
        </div>
        <Field label="First name"><input value={form.firstName} onChange={set("firstName")} className={inputClass} maxLength={100} /></Field>
        <Field label="Last name"><input value={form.lastName} onChange={set("lastName")} className={inputClass} maxLength={100} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={set("phone")} className={inputClass} maxLength={50} /></Field>
        <Field label="Job title"><input value={form.jobTitle} onChange={set("jobTitle")} className={inputClass} maxLength={150} /></Field>
        <div className="sm:col-span-2">
          <Field label="Company">
            <CompanyPicker
              value={form.companyId}
              valueLabel={form.companyName}
              onChange={(id, name) => setForm((f) => ({ ...f, companyId: id, companyName: name || "" }))}
            />
          </Field>
        </div>
        <Field label="Country"><input value={form.country} onChange={set("country")} className={inputClass} maxLength={100} /></Field>
        <Field label="Website"><input value={form.website} onChange={set("website")} className={inputClass} maxLength={300} /></Field>
        <Field label="LinkedIn"><input value={form.linkedin} onChange={set("linkedin")} className={inputClass} maxLength={300} /></Field>
        <Field label="Category">
          <select value={form.category} onChange={set("category")} className={inputClass}>
            <option value="">—</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Lifecycle">
          <select value={form.lifecycle} onChange={set("lifecycle")} className={inputClass}>
            {LIFECYCLES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Field>
        <Field label="Owner" hint={!admin && editing ? "Only Admin/HR can reassign" : undefined}>
          <UserSelect users={users} value={form.ownerId} onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Tags" hint="Comma separated, e.g. expo-2026, hot">
            <input value={form.tags} onChange={set("tags")} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2 flex flex-col gap-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create contact"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ── Company ──────────────────────────────────────────────────────────── */
export function CompanyFormModal({ company, onClose, onSaved }) {
  const editing = Boolean(company);
  const users = useCrmUsers();
  const admin = isAdminOrHr();
  const [form, setForm] = useState(() => ({
    name: company?.name || "", domain: company?.domain || "", website: company?.website || "",
    industry: company?.industry || "", country: company?.country || "", phone: company?.phone || "",
    size: company?.size || "", notes: company?.notes || "", ownerId: company?.ownerId || currentUser()?.id || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = { ...form };
    if (!admin || payload.ownerId === company?.ownerId) delete payload.ownerId;
    try {
      const res = editing
        ? await api.put(`/api/crm/companies/${company.id}`, payload)
        : await api.post("/api/crm/companies", payload);
      onSaved(res.data.data);
    } catch (err) {
      setError(errMessage(err, "Could not save the company"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? "Edit company" : "New company"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Field label="Name *"><input required value={form.name} onChange={set("name")} className={inputClass} maxLength={200} /></Field></div>
        <Field label="Domain" hint="acme.com — used to match contacts"><input value={form.domain} onChange={set("domain")} className={inputClass} /></Field>
        <Field label="Website"><input value={form.website} onChange={set("website")} className={inputClass} /></Field>
        <Field label="Industry"><input value={form.industry} onChange={set("industry")} className={inputClass} /></Field>
        <Field label="Country"><input value={form.country} onChange={set("country")} className={inputClass} /></Field>
        <Field label="Phone"><input value={form.phone} onChange={set("phone")} className={inputClass} /></Field>
        <Field label="Size"><input value={form.size} onChange={set("size")} className={inputClass} placeholder="e.g. 50-200" /></Field>
        {admin && (
          <Field label="Owner"><UserSelect users={users} value={form.ownerId} onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))} /></Field>
        )}
        <div className="sm:col-span-2"><Field label="Notes"><textarea rows={3} value={form.notes} onChange={set("notes")} className={inputClass} /></Field></div>
        <div className="sm:col-span-2 flex flex-col gap-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create company"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ── Deal ─────────────────────────────────────────────────────────────── */
export function DealFormModal({ deal, stages, defaults = {}, onClose, onSaved }) {
  const editing = Boolean(deal);
  const users = useCrmUsers();
  const admin = isAdminOrHr();
  const openStages = (stages || []).filter((s) => !s.archived);
  const [form, setForm] = useState(() => ({
    title: deal?.title || defaults.title || "",
    amount: deal?.amount ?? "",
    currency: deal?.currency || "USD",
    stageId: deal?.stageId || defaults.stageId || openStages.find((s) => s.isDefault)?.id || openStages[0]?.id || "",
    expectedCloseAt: deal?.expectedCloseAt ? String(deal.expectedCloseAt).slice(0, 10) : "",
    contactId: deal?.contactId || defaults.contactId || null,
    contactLabel: deal?.contact?.displayName || defaults.contactLabel || "",
    companyId: deal?.companyId || defaults.companyId || null,
    companyLabel: deal?.company?.name || defaults.companyLabel || "",
    ownerId: deal?.ownerId || currentUser()?.id || "",
    lostReason: deal?.lostReason || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const selectedStage = openStages.find((s) => String(s.id) === String(form.stageId));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      title: form.title,
      amount: form.amount === "" ? null : Number(form.amount),
      currency: form.currency,
      stageId: Number(form.stageId),
      expectedCloseAt: form.expectedCloseAt ? new Date(`${form.expectedCloseAt}T12:00:00`).toISOString() : null,
      contactId: form.contactId,
      companyId: form.companyId,
    };
    if (selectedStage?.kind === "lost") payload.lostReason = form.lostReason;
    if (admin && form.ownerId && form.ownerId !== deal?.ownerId) payload.ownerId = form.ownerId;
    try {
      const res = editing
        ? await api.put(`/api/crm/deals/${deal.id}`, payload)
        : await api.post("/api/crm/deals", payload);
      onSaved(res.data.data);
    } catch (err) {
      setError(errMessage(err, "Could not save the deal"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? "Edit deal" : "New deal"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Field label="Title *"><input required value={form.title} onChange={set("title")} className={inputClass} maxLength={200} /></Field></div>
        <Field label="Amount"><input type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} className={inputClass} /></Field>
        <Field label="Currency">
          <select value={form.currency} onChange={set("currency")} className={inputClass}>
            {[...new Set([form.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select value={form.stageId} onChange={set("stageId")} className={inputClass}>
            {openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Expected close"><input type="date" value={form.expectedCloseAt} onChange={set("expectedCloseAt")} className={inputClass} /></Field>
        {selectedStage?.kind === "lost" && (
          <div className="sm:col-span-2"><Field label="Lost reason"><input value={form.lostReason} onChange={set("lostReason")} className={inputClass} maxLength={300} /></Field></div>
        )}
        <div className="sm:col-span-2">
          <Field label="Contact">
            <ContactPicker
              value={form.contactId}
              valueLabel={form.contactLabel}
              onChange={(id, label, company) => setForm((f) => ({
                ...f, contactId: id, contactLabel: label || "",
                ...(id && company && !f.companyId ? { companyId: company.id, companyLabel: company.name } : {}),
              }))}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Company">
            <CompanyPicker
              value={form.companyId}
              valueLabel={form.companyLabel}
              onChange={(id, name) => setForm((f) => ({ ...f, companyId: id, companyLabel: name || "" }))}
            />
          </Field>
        </div>
        {admin && (
          <Field label="Owner"><UserSelect users={users} value={form.ownerId} onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))} /></Field>
        )}
        <div className="sm:col-span-2 flex flex-col gap-2">
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create deal"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ── Task ─────────────────────────────────────────────────────────────── */
const REMINDER_OPTIONS = [
  { value: "due", label: "At due time", minutes: 0 },
  { value: "15", label: "15 minutes before", minutes: 15 },
  { value: "60", label: "1 hour before", minutes: 60 },
  { value: "1440", label: "1 day before", minutes: 1440 },
  { value: "none", label: "No reminder" },
];

export function TaskFormModal({ task, defaults = {}, onClose, onSaved }) {
  const editing = Boolean(task);
  const users = useCrmUsers();
  const [form, setForm] = useState(() => ({
    title: task?.title || "",
    description: task?.description || "",
    dueAt: toLocalInput(task?.dueAt) || "",
    reminder: task ? (task.remindAt ? "custom" : "none") : "due",
    priority: task?.priority || "normal",
    assignedToId: task?.assignedToId || currentUser()?.id || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const dueIso = fromLocalInput(form.dueAt);
    const payload = {
      title: form.title,
      description: form.description,
      priority: form.priority,
      dueAt: dueIso,
      assignedToId: form.assignedToId || undefined,
    };
    const opt = REMINDER_OPTIONS.find((o) => o.value === form.reminder);
    if (form.reminder === "none") payload.remindAt = null;
    else if (opt && dueIso) payload.remindAt = new Date(new Date(dueIso).getTime() - opt.minutes * 60_000).toISOString();
    if (!editing) {
      if (defaults.contactId) payload.contactId = defaults.contactId;
      if (defaults.dealId) payload.dealId = defaults.dealId;
    }
    try {
      const res = editing
        ? await api.put(`/api/crm/tasks/${task.id}`, payload)
        : await api.post("/api/crm/tasks", payload);
      onSaved(res.data.data);
    } catch (err) {
      setError(errMessage(err, "Could not save the task"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? "Edit task" : "New task"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {defaults.contextLabel && <p className="text-sm text-slate-500">For: <strong>{defaults.contextLabel}</strong></p>}
        <Field label="Task *"><input required value={form.title} onChange={set("title")} className={inputClass} maxLength={200} placeholder="e.g. Call back about pricing" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Due"><input type="datetime-local" value={form.dueAt} onChange={set("dueAt")} className={inputClass} /></Field>
          <Field label="Reminder">
            <select value={form.reminder} onChange={set("reminder")} className={inputClass} disabled={!form.dueAt && form.reminder !== "none"}>
              {form.reminder === "custom" && <option value="custom">Keep current reminder</option>}
              {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={set("priority")} className={inputClass}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Assigned to">
            <UserSelect users={users} value={form.assignedToId} onChange={(v) => setForm((f) => ({ ...f, assignedToId: v }))} />
          </Field>
        </div>
        <Field label="Details"><textarea rows={3} value={form.description} onChange={set("description")} className={inputClass} /></Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save" : "Create task"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Note / call / meeting composer ──────────────────────────────────── */
export function NoteComposer({ target, onSaved }) {
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/api/crm/activities", { type, body, ...target });
      setBody("");
      onSaved();
    } catch (err) {
      setError(errMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-1" role="radiogroup" aria-label="Entry type">
        {[["note", "Note"], ["call", "Call"], ["meeting", "Meeting"], ["email", "Email (manual)"]].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${type === v ? "bg-sky-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
            {l}
          </button>
        ))}
      </div>
      <textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={inputClass}
        placeholder={type === "call" ? "What was discussed on the call?" : type === "meeting" ? "Meeting notes…" : "Write a note…"}
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !body.trim()}>{saving ? "Saving…" : "Add to timeline"}</Button>
      </div>
    </form>
  );
}
