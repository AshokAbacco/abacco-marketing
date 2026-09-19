// src/pages/crm/Companies.jsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useApiGet, useDebounced, formatMoney } from "./lib";
import { CrmTabs, PageTitle, Card, Button, Pager, Empty, inputClass, ErrorText } from "./components/ui";
import { CompanyFormModal } from "./components/forms";

export default function Companies() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const pageSize = 25;
  const { data, loading, error } = useApiGet("/api/crm/companies", {
    search: debounced || undefined, ownerId: owner || undefined, page, pageSize,
  });
  const rows = data?.data || [];

  return (
    <div className="max-w-7xl mx-auto">
      <CrmTabs />
      <PageTitle
        title="Companies"
        subtitle={data ? `${data.pagination.total.toLocaleString()} companies` : " "}
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New company</Button>}
      />
      <Card>
        <div className="p-4 flex flex-wrap gap-2 border-b border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              placeholder="Search name or domain…" className={`${inputClass} pl-9`} aria-label="Search companies" />
          </div>
          <select value={owner} onChange={(e) => { setPage(1); setOwner(e.target.value); }} className={`${inputClass} w-auto`} aria-label="Owner">
            <option value="">All owners</option>
            <option value="me">Mine</option>
          </select>
        </div>
        {error && <div className="p-4"><ErrorText>{error}</ErrorText></div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Industry</th>
                <th className="text-left p-3">Country</th>
                <th className="text-right p-3">Contacts</th>
                <th className="text-right p-3">Open deals</th>
                <th className="text-left p-3">Owner</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-60" : ""}>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/crm/companies/${c.id}`)}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-sky-50/50 dark:hover:bg-slate-800/40 cursor-pointer">
                  <td className="p-3">
                    <Link to={`/crm/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-slate-800 dark:text-slate-100 hover:underline">{c.name}</Link>
                    {c.domain && <p className="text-xs text-slate-500">{c.domain}</p>}
                  </td>
                  <td className="p-3 text-slate-600 dark:text-slate-300">{c.industry || "—"}</td>
                  <td className="p-3 text-slate-600 dark:text-slate-300">{c.country || "—"}</td>
                  <td className="p-3 text-right">{c.contactCount}</td>
                  <td className="p-3 text-right">
                    {c.openDeals ? <>{c.openDeals} <span className="text-slate-400">· {formatMoney(c.openDealValue)}</span></> : "—"}
                  </td>
                  <td className="p-3 text-slate-600 dark:text-slate-300">{c.owner?.name || "—"}</td>
                </tr>
              ))}
              {!loading && !rows.length && <tr><td colSpan={6}><Empty>No companies yet. They are created automatically from business email domains.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} pageSize={pageSize} total={data.pagination.total} onPage={setPage} />}
      </Card>
      {creating && (
        <CompanyFormModal onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); navigate(`/crm/companies/${c.id}`); }} />
      )}
    </div>
  );
}
