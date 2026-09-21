// src/pages/crm/components/TaskList.jsx — task rows with complete/edit/delete.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Pencil, Trash2, AlertCircle, Flag } from "lucide-react";
import { api } from "../../utils/api";
import { errMessage, formatDate } from "../lib";
import { Empty } from "./ui";
import { TaskFormModal } from "./forms";

export default function TaskList({ tasks, onChanged, showContext = true, emptyText = "No tasks." }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);

  const toggle = async (t) => {
    setBusy(t.id);
    try {
      await api.patch(`/api/crm/tasks/${t.id}/complete`, { done: t.status !== "done" });
      onChanged();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    try {
      await api.delete(`/api/crm/tasks/${t.id}`);
      onChanged();
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (!tasks?.length) return <Empty>{emptyText}</Empty>;

  return (
    <>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-3 py-3 px-1">
            <button
              type="button"
              disabled={busy === t.id || t.canEdit === false}
              onClick={() => toggle(t)}
              className="mt-0.5 text-slate-400 hover:text-emerald-600 disabled:opacity-50"
              aria-label={t.status === "done" ? "Mark as not done" : "Mark as done"}
            >
              {t.status === "done" ? <CheckCircle2 size={20} className="text-emerald-600" /> : <Circle size={20} />}
            </button>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${t.status === "done" ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"}`}>
                {t.priority === "high" && <Flag size={13} className="inline text-red-500 mr-1" aria-label="High priority" />}
                {t.title}
              </p>
              {t.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1">
                {t.dueAt && (
                  <span className={t.overdue ? "text-red-600 font-semibold inline-flex items-center gap-1" : ""}>
                    {t.overdue && <AlertCircle size={12} />}Due {formatDate(t.dueAt, true)}
                  </span>
                )}
                {t.assignedTo && <span>· {t.assignedTo.name}</span>}
                {showContext && t.contact && (
                  <Link to={`/crm/contacts/${t.contact.id}`} className="text-sky-700 hover:underline">· {t.contact.displayName}</Link>
                )}
                {showContext && t.deal && <span>· {t.deal.title}</span>}
                {t.status === "done" && t.completedAt && <span>· done {formatDate(t.completedAt, true)}</span>}
              </div>
            </div>
            {t.canEdit !== false && (
              <div className="flex gap-1 shrink-0">
                <button type="button" onClick={() => setEditing(t)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Edit task">
                  <Pencil size={15} />
                </button>
                <button type="button" onClick={() => remove(t)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" aria-label="Delete task">
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <TaskFormModal
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </>
  );
}
