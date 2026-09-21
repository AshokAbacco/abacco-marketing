// src/components/layout/NotificationBell.jsx — in-app notifications (task reminders, assignments).
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "../../pages/utils/api";
import { startVisiblePolling } from "../../pages/utils/polling";

const POLL_MS = 60_000;

function timeAgo(value) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    const load = () =>
      api.get("/api/crm/notifications", { params: { limit: 15 } })
        .then((r) => {
          setItems(r.data.data || []);
          setUnread(r.data.unread || 0);
        })
        .catch(() => {});
    return startVisiblePolling(load, POLL_MS, { immediate: true });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (body) => {
    try {
      await api.post("/api/crm/notifications/read", body);
    } catch {
      /* non-critical */
    }
  };

  const openItem = (n) => {
    if (!n.readAt) {
      markRead({ ids: [n.id] });
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const readAll = () => {
    markRead({ all: true });
    setItems((list) => list.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    setUnread(0);
  };

  return (
    <div className="relative shrink-0" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-900/20 text-slate-600 dark:text-slate-300"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-sky-100 dark:border-slate-700 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-700">
            <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-sky-50 dark:hover:bg-slate-700 ${n.readAt ? "" : "bg-sky-50/60 dark:bg-sky-900/20"}`}
                >
                  <p className={`text-sm ${n.readAt ? "text-slate-600 dark:text-slate-300" : "font-semibold text-slate-800 dark:text-white"}`}>{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500 truncate">{n.body}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
