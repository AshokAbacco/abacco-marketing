// src/pages/crm/ContactDetail.jsx
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Mail, Phone, Globe, Linkedin, Building2, Pencil, Trash2, Plus, Ban, MapPin, Briefcase,
} from "lucide-react";
import { api } from "../utils/api";
import { useApiGet, formatDate, formatMoney, timeAgo, errMessage } from "./lib";
import { Card, Button, Avatar, LifecycleBadge, StageDot, Empty, ErrorText } from "./components/ui";
import { ContactFormModal, DealFormModal, TaskFormModal, NoteComposer } from "./components/forms";
import Timeline from "./components/Timeline";
import TaskList from "./components/TaskList";

function InfoRow({ icon, children }) {
  const Icon = icon;
  if (!children) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 min-w-0">
      <Icon size={15} className="text-slate-400 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApiGet(`/api/crm/contacts/${id}`);
  const stagesReq = useApiGet("/api/crm/stages");
  const [modal, setModal] = useState(null); // edit | deal | task
  const [timelineKey, setTimelineKey] = useState(0);

  const contact = data?.data;
  const refreshAll = () => { reload(); setTimelineKey((k) => k + 1); };

  const remove = async () => {
    if (!window.confirm(`Delete ${contact.displayName}? Notes and tasks are deleted too; deals and leads are kept.`)) return;
    try {
      await api.delete(`/api/crm/contacts/${contact.id}`);
      navigate("/crm/contacts");
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (error && !contact) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/crm/contacts" className="inline-flex items-center gap-1 text-sm text-sky-700 mb-4"><ArrowLeft size={16} /> Contacts</Link>
        <Card className="p-6"><ErrorText>{error}</ErrorText></Card>
      </div>
    );
  }
  if (!contact) return <Empty>{loading ? "Loading…" : "Not found"}</Empty>;

  const websiteHref = contact.website && (/^https?:\/\//i.test(contact.website) ? contact.website : `https://${contact.website}`);

  return (
    <div className="max-w-7xl mx-auto">
      <Link to="/crm/contacts" className="inline-flex items-center gap-1 text-sm text-sky-700 mb-4 hover:underline">
        <ArrowLeft size={16} /> Contacts
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left: profile ── */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Avatar name={contact.displayName} size={52} />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white break-words">{contact.displayName}</h1>
                {contact.jobTitle && <p className="text-sm text-slate-500">{contact.jobTitle}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <LifecycleBadge value={contact.lifecycle} />
                  {contact.category && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 capitalize">{contact.category}</span>
                  )}
                  {contact.tags?.map((t) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-xs">#{t}</span>
                  ))}
                </div>
              </div>
            </div>

            {contact.doNotContact && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700" role="status">
                <Ban size={16} className="shrink-0 mt-0.5" />
                <span>Do not contact — {contact.doNotContact.reason.replace(/_/g, " ")} since {formatDate(contact.doNotContact.since)}. Campaign emails to this address are skipped.</span>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <InfoRow icon={Mail}><a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a></InfoRow>
              <InfoRow icon={Phone}>{contact.phone && <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a>}</InfoRow>
              <InfoRow icon={Building2}>
                {contact.company && <Link to={`/crm/companies/${contact.company.id}`} className="text-sky-700 hover:underline">{contact.company.name}</Link>}
              </InfoRow>
              <InfoRow icon={MapPin}>{contact.country}</InfoRow>
              <InfoRow icon={Globe}>{websiteHref && <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="hover:underline">{contact.website}</a>}</InfoRow>
              <InfoRow icon={Linkedin}>{contact.linkedin && <a href={contact.linkedin} target="_blank" rel="noopener noreferrer" className="hover:underline">LinkedIn</a>}</InfoRow>
              <InfoRow icon={Briefcase}>Owner: {contact.owner?.name || "—"}</InfoRow>
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                <dt className="text-xs text-slate-500">Emails sent</dt>
                <dd className="text-lg font-bold">{contact.engagement.emailsSent}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                <dt className="text-xs text-slate-500">Replies</dt>
                <dd className="text-lg font-bold">{contact.engagement.replies}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2">
                <dt className="text-xs text-slate-500">Last activity</dt>
                <dd className="text-xs font-semibold mt-1.5">{timeAgo(contact.lastActivityAt)}</dd>
              </div>
            </dl>

            {contact.canEdit && (
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setModal("edit")}><Pencil size={15} /> Edit</Button>
                <Button variant="ghost" className="text-red-600" onClick={remove} aria-label="Delete contact"><Trash2 size={15} /></Button>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800 dark:text-white">Deals</h2>
              <Button variant="secondary" onClick={() => setModal("deal")}><Plus size={15} /> Deal</Button>
            </div>
            {!contact.deals.length && <Empty>No deals yet.</Empty>}
            <ul className="space-y-2">
              {contact.deals.map((d) => (
                <li key={d.id}>
                  <Link to={`/crm/deals?open=${d.id}`} className="block rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:border-sky-300">
                    <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{d.title}</p>
                    <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
                      <span className="inline-flex items-center gap-1.5"><StageDot color={d.stage?.color} />{d.stage?.name}</span>
                      <span className="font-semibold">{formatMoney(d.amount, d.currency)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {contact.leads.length > 0 && (
            <Card className="p-5">
              <h2 className="font-bold text-slate-800 dark:text-white mb-2">Leads</h2>
              <ul className="space-y-1 text-sm">
                {contact.leads.map((l) => (
                  <li key={l.id} className="flex justify-between gap-2">
                    <span className="truncate">{l.subject || `Lead #${l.id}`}</span>
                    <span className="text-slate-400 shrink-0">{formatDate(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ── Right: tasks + timeline ── */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800 dark:text-white">Open tasks</h2>
              <Button variant="secondary" onClick={() => setModal("task")}><Plus size={15} /> Task</Button>
            </div>
            <TaskList tasks={contact.tasks} onChanged={refreshAll} showContext={false} emptyText="Nothing to do for this contact." />
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-slate-800 dark:text-white mb-3">Add to timeline</h2>
            <NoteComposer target={{ contactId: contact.id }} onSaved={refreshAll} />
          </Card>

          <Card className="p-5">
            <h2 className="font-bold text-slate-800 dark:text-white mb-4">History</h2>
            <Timeline contactId={contact.id} refreshKey={timelineKey} />
          </Card>
        </div>
      </div>

      {modal === "edit" && (
        <ContactFormModal contact={contact} onClose={() => setModal(null)} onSaved={() => { setModal(null); refreshAll(); }} />
      )}
      {modal === "deal" && (
        <DealFormModal
          stages={stagesReq.data?.data || []}
          defaults={{
            contactId: contact.id, contactLabel: contact.displayName,
            companyId: contact.company?.id, companyLabel: contact.company?.name,
            title: contact.company?.name || contact.displayName,
          }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refreshAll(); }}
        />
      )}
      {modal === "task" && (
        <TaskFormModal
          defaults={{ contactId: contact.id, contextLabel: contact.displayName }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refreshAll(); }}
        />
      )}
    </div>
  );
}
