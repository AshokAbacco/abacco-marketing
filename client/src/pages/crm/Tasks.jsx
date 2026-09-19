// src/pages/crm/Tasks.jsx — my tasks (Admin/HR can view anyone's).
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useApiGet, useCrmUsers, isAdminOrHr } from "./lib";
import { CrmTabs, PageTitle, Card, Button, Pager, ErrorText, Empty, inputClass } from "./components/ui";
import { TaskFormModal } from "./components/forms";
import TaskList from "./components/TaskList";

const VIEWS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "open", label: "All open" },
  { id: "done", label: "Done" },
];

export default function Tasks() {
  const admin = isAdminOrHr();
  const users = useCrmUsers();
  const [view, setView] = useState("today");
  const [assignee, setAssignee] = useState("me");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);
  const pageSize = 50;

  const { data, error, loading, reload } = useApiGet("/api/crm/tasks", { view, assignee, page, pageSize, tz });
  const counts = data?.counts;

  return (
    <div className="max-w-5xl mx-auto">
      <CrmTabs />
      <PageTitle
        title="Tasks"
        subtitle={counts ? `${counts.overdue} overdue · ${counts.today} due today · ${counts.open} open` : " "}
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New task</Button>}
      />
      <Card>
        <div className="p-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {VIEWS.map((v) => {
              const badge = v.id === "overdue" ? counts?.overdue : v.id === "today" ? counts?.today : null;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  onClick={() => { setPage(1); setView(v.id); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${view === v.id ? "bg-sky-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                >
                  {v.label}
                  {badge > 0 && (
                    <span className={`ml-1.5 px-1.5 rounded-full text-xs ${v.id === "overdue" ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700"}`}>{badge}</span>
                  )}
                </button>
              );
            })}
          </div>
          {admin && (
            <select value={assignee} onChange={(e) => { setPage(1); setAssignee(e.target.value); }} className={`${inputClass} w-auto`} aria-label="Assignee">
              <option value="me">My tasks</option>
              <option value="all">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </div>
        <div className="px-4">
          <ErrorText>{error}</ErrorText>
          {!data && loading ? (
            <Empty>Loading…</Empty>
          ) : (
            <div className={loading ? "opacity-60" : ""}>
              <TaskList
                tasks={data?.data || []}
                onChanged={reload}
                emptyText={view === "overdue" ? "Nothing overdue. 🎉" : view === "today" ? "Nothing due today." : "No tasks here."}
              />
            </div>
          )}
        </div>
        {data && <Pager page={page} pageSize={pageSize} total={data.pagination.total} onPage={setPage} />}
      </Card>
      {creating && (
        <TaskFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      )}
    </div>
  );
}
