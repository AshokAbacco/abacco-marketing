// src/pages/crm/Contacts.jsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Ban } from "lucide-react";
import { LIFECYCLES, CATEGORIES, formatDate, timeAgo, useApiGet, useCrmUsers, useDebounced } from "./lib";
import { CrmTabs, PageTitle, Card, Button, Pager, Empty, LifecycleBadge, Avatar, inputClass, ErrorText } from "./components/ui";
import { ContactFormModal } from "./components/forms";

export default function Contacts() {
  const navigate = useNavigate();
  const users = useCrmUsers();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const pageSize = 25;

  const { data, loading, error } = useApiGet("/api/crm/contacts", {
    search: debounced || undefined,
    ownerId: owner || undefined,
    lifecycle: lifecycle || undefined,
    category: category || undefined,
    sort,
    page,
    pageSize,
  });
  const rows = data?.data || [];
  const resetPage = (setter) => (e) => { setPage(1); setter(e.target.value); };

  return (
    <div className="max-w-7xl mx-auto">
      <CrmTabs />
      <PageTitle
        title="Contacts"
        subtitle={data ? `${data.pagination.total.toLocaleString()} people` : " "}
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New contact</Button>}
      />

      <Card>
        <div className="p-4 grid grid-cols-1 md:grid-cols-5 gap-2 border-b border-slate-100 dark:border-slate-800">
          <div className="relative md:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              placeholder="Search name, email or company…"
              className={`${inputClass} pl-9`}
              aria-label="Search contacts"
            />
          </div>
          <select value={owner} onChange={resetPage(setOwner)} className={inputClass} aria-label="Owner">
            <option value="">All owners</option>
            <option value="me">Mine</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={lifecycle} onChange={resetPage(setLifecycle)} className={inputClass} aria-label="Lifecycle">
            <option value="">All stages</option>
            {LIFECYCLES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <div className="flex gap-2">
            <select value={category} onChange={resetPage(setCategory)} className={inputClass} aria-label="Category">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={sort} onChange={resetPage(setSort)} className={inputClass} aria-label="Sort">
              <option value="updated">Recently updated</option>
              <option value="lastActivity">Last activity</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {error && <div className="p-4"><ErrorText>{error}</ErrorText></div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Stage</th>
                <th className="text-left p-3">Owner</th>
                <th className="text-right p-3">Open deals</th>
                <th className="text-left p-3">Last activity</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-60" : ""}>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-sky-50/50 dark:hover:bg-slate-800/40 cursor-pointer"
                  onClick={() => navigate(`/crm/contacts/${c.id}`)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.displayName} />
                      <div className="min-w-0">
                        <Link to={`/crm/contacts/${c.id}`} className="font-semibold text-slate-800 dark:text-slate-100 hover:underline" onClick={(e) => e.stopPropagation()}>
                          {c.displayName}
                        </Link>
                        <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                          {c.email}
                          {c.doNotContact && <Ban size={12} className="text-red-500" aria-label="Do not contact" />}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-slate-600 dark:text-slate-300">
                    {c.company ? (
                      <Link to={`/crm/companies/${c.company.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{c.company.name}</Link>
                    ) : "—"}
                  </td>
                  <td className="p-3"><LifecycleBadge value={c.lifecycle} /></td>
                  <td className="p-3 text-slate-600 dark:text-slate-300">{c.owner?.name || "—"}</td>
                  <td className="p-3 text-right">{c.openDeals || "—"}</td>
                  <td className="p-3 text-slate-500" title={formatDate(c.lastActivityAt, true)}>{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—"}</td>
                </tr>
              ))}
              {!loading && !rows.length && (
                <tr><td colSpan={6}><Empty>No contacts match. Leads you save from the inbox and people who reply to campaigns appear here automatically.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && !data && <Empty>Loading…</Empty>}
        {data && <Pager page={page} pageSize={pageSize} total={data.pagination.total} onPage={setPage} />}
      </Card>

      {creating && (
        <ContactFormModal
          onClose={() => setCreating(false)}
          onSaved={(c) => { setCreating(false); navigate(`/crm/contacts/${c.id}`); }}
        />
      )}
    </div>
  );
}
