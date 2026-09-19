// src/pages/crm/CompanyDetail.jsx
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Globe, Phone, MapPin, Pencil, Trash2, Plus } from "lucide-react";
import { api } from "../utils/api";
import { useApiGet, formatDate, formatMoney, timeAgo, errMessage } from "./lib";
import { Card, Button, Avatar, LifecycleBadge, StageDot, Empty, ErrorText } from "./components/ui";
import { CompanyFormModal, DealFormModal, NoteComposer } from "./components/forms";

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApiGet(`/api/crm/companies/${id}`);
  const stagesReq = useApiGet("/api/crm/stages");
  const [modal, setModal] = useState(null);
  const company = data?.data;

  const remove = async () => {
    if (!window.confirm(`Delete ${company.name}? Its contacts and deals are kept but unlinked.`)) return;
    try {
      await api.delete(`/api/crm/companies/${company.id}`);
      navigate("/crm/companies");
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (error && !company) {
    return <div className="max-w-3xl mx-auto"><Card className="p-6"><ErrorText>{error}</ErrorText></Card></div>;
  }
  if (!company) return <Empty>{loading ? "Loading…" : "Not found"}</Empty>;
  const href = company.website && (/^https?:\/\//i.test(company.website) ? company.website : `https://${company.website}`);

  return (
    <div className="max-w-7xl mx-auto">
      <Link to="/crm/companies" className="inline-flex items-center gap-1 text-sm text-sky-700 mb-4 hover:underline">
        <ArrowLeft size={16} /> Companies
      </Link>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Avatar name={company.name} size={48} />
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white break-words">{company.name}</h1>
                <p className="text-sm text-slate-500">{company.industry || company.domain || ""}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              {href && <p className="flex items-center gap-2"><Globe size={15} className="text-slate-400" /><a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{company.website}</a></p>}
              {company.phone && <p className="flex items-center gap-2"><Phone size={15} className="text-slate-400" />{company.phone}</p>}
              {company.country && <p className="flex items-center gap-2"><MapPin size={15} className="text-slate-400" />{company.country}</p>}
              <p>Owner: {company.owner?.name || "—"}</p>
              {company.size && <p>Size: {company.size}</p>}
            </div>
            {company.notes && <p className="mt-3 text-sm whitespace-pre-wrap text-slate-600 dark:text-slate-300">{company.notes}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2"><dt className="text-xs text-slate-500">Contacts</dt><dd className="text-lg font-bold">{company.contactCount}</dd></div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2"><dt className="text-xs text-slate-500">Open pipeline</dt><dd className="text-sm font-bold mt-1">{formatMoney(company.openDealValue)}</dd></div>
            </dl>
            {company.canEdit && (
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setModal("edit")}><Pencil size={15} /> Edit</Button>
                <Button variant="ghost" className="text-red-600" onClick={remove} aria-label="Delete company"><Trash2 size={15} /></Button>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-bold mb-3 text-slate-800 dark:text-white">Add note</h2>
            <NoteComposer target={{ companyId: company.id }} onSaved={reload} />
            <ul className="mt-4 space-y-3">
              {company.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="font-semibold text-slate-700 dark:text-slate-200 capitalize">{a.title || a.type}</p>
                  {a.body && <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{a.body}</p>}
                  <p className="text-xs text-slate-400">{a.user?.name ? `${a.user.name} · ` : ""}{formatDate(a.occurredAt, true)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <Card>
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-bold text-slate-800 dark:text-white">People ({company.contacts.length})</h2>
            </div>
            {!company.contacts.length && <Empty>No contacts linked yet.</Empty>}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {company.contacts.map((c) => (
                <li key={c.id}>
                  <Link to={`/crm/contacts/${c.id}`} className="flex items-center gap-3 p-3 hover:bg-sky-50/50 dark:hover:bg-slate-800/40">
                    <Avatar name={c.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{c.displayName}</p>
                      <p className="text-xs text-slate-500 truncate">{c.jobTitle ? `${c.jobTitle} · ` : ""}{c.email}</p>
                    </div>
                    <LifecycleBadge value={c.lifecycle} />
                    <span className="hidden sm:block text-xs text-slate-400 w-24 text-right">{timeAgo(c.lastActivityAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-bold text-slate-800 dark:text-white">Deals</h2>
              <Button variant="secondary" onClick={() => setModal("deal")}><Plus size={15} /> Deal</Button>
            </div>
            {!company.deals.length && <Empty>No deals yet.</Empty>}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {company.deals.map((d) => (
                <li key={d.id}>
                  <Link to={`/crm/deals?open=${d.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-sky-50/50 dark:hover:bg-slate-800/40">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{d.title}</p>
                      <p className="text-xs text-slate-500 inline-flex items-center gap-1.5"><StageDot color={d.stage?.color} />{d.stage?.name} · {d.owner?.name}</p>
                    </div>
                    <span className="text-sm font-semibold">{formatMoney(d.amount, d.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {modal === "edit" && (
        <CompanyFormModal company={company} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} />
      )}
      {modal === "deal" && (
        <DealFormModal
          stages={stagesReq.data?.data || []}
          defaults={{ companyId: company.id, companyLabel: company.name, title: company.name }}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload(); }}
        />
      )}
    </div>
  );
}
