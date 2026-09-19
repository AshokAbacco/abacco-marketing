// src/pages/crm/components/Timeline.jsx — contact history (paged).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  StickyNote,
  Phone,
  Users,
  Mail,
  MailCheck,
  MailX,
  Reply,
  Ban,
  ArrowRightLeft,
  CheckCircle2,
  Sparkles,
  UserCog,
  Trash2,
  FileText,
} from "lucide-react";
import { api } from "../../utils/api";
import { errMessage, formatDate } from "../lib";
import { Button, ErrorText, Empty, CategoryBadge } from "./ui";

const ICONS = {
  note: [StickyNote, "bg-amber-100 text-amber-700"],
  call: [Phone, "bg-emerald-100 text-emerald-700"],
  meeting: [Users, "bg-violet-100 text-violet-700"],
  email: [Mail, "bg-sky-100 text-sky-700"],
  email_sent: [MailCheck, "bg-sky-100 text-sky-700"],
  email_reply: [Reply, "bg-emerald-100 text-emerald-700"],
  removal_request: [Ban, "bg-red-100 text-red-700"],
  bounce: [MailX, "bg-red-100 text-red-700"],
  suppressed: [Ban, "bg-red-100 text-red-700"],
  stage_change: [ArrowRightLeft, "bg-indigo-100 text-indigo-700"],
  status_change: [ArrowRightLeft, "bg-indigo-100 text-indigo-700"],
  owner_change: [UserCog, "bg-slate-100 text-slate-700"],
  task_completed: [CheckCircle2, "bg-emerald-100 text-emerald-700"],
  lead_created: [FileText, "bg-sky-100 text-sky-700"],
  created: [Sparkles, "bg-slate-100 text-slate-700"],
};

const LABELS = {
  note: "Note",
  call: "Call",
  meeting: "Meeting",
  email: "Email (logged)",
  email_sent: "Campaign email sent",
  email_reply: "Replied",
  removal_request: "Asked to be removed",
  bounce: "Bounced",
  suppressed: "Do not contact",
};

function describe(item) {
  if (item.kind === "activity")
    return { key: item.type, label: LABELS[item.type] || null };
  return { key: item.kind, label: LABELS[item.kind] || item.kind };
}

export default function Timeline({ contactId, refreshKey }) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [state, setState] = useState({ key: null, error: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [localKey, setLocalKey] = useState(0);
  const loadKey = `${contactId}:${refreshKey}:${localKey}`;

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/crm/contacts/${contactId}/timeline`, { params: { limit: 30 } })
      .then((r) => {
        if (cancelled) return;
        setItems(r.data.data);
        setNext(r.data.nextBefore);
        setState({ key: loadKey, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setState({ key: loadKey, error: errMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, loadKey]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const r = await api.get(`/api/crm/contacts/${contactId}/timeline`, {
        params: { limit: 30, before: next },
      });
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...r.data.data.filter((i) => !seen.has(i.key))];
      });
      setNext(r.data.nextBefore);
    } catch (err) {
      setState((s) => ({ ...s, error: errMessage(err) }));
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await api.delete(`/api/crm/activities/${item.id}`);
      setLocalKey((k) => k + 1);
    } catch (err) {
      alert(errMessage(err));
    }
  };

  if (state.key !== loadKey && !items.length)
    return <Empty>Loading history…</Empty>;

  return (
    <div>
      <ErrorText>{state.error}</ErrorText>
      {!items.length && <Empty>No history yet.</Empty>}
      <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-3">
        {items.map((item) => {
          const { key, label } = describe(item);
          const [Icon, tone] = ICONS[key] || ICONS.created;
          return (
            <li key={item.key} className="ml-6 mb-5">
              <span
                className={`absolute -left-3.5 flex items-center justify-center w-7 h-7 rounded-full ring-4 ring-white dark:ring-slate-900 ${tone}`}
              >
                <Icon size={14} />
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {label && (
                    <span className="text-slate-500 font-medium">
                      {label}
                      {item.title ? ": " : ""}
                    </span>
                  )}
                  {item.title}
                </p>
                <time className="text-xs text-slate-400" dateTime={item.at}>
                  {formatDate(item.at, true)}
                </time>
              </div>
              {item.body && (
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
                  {item.body}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {item.kind === "email_reply" && item.category && (
                  <CategoryBadge value={item.category} />
                )}
                {item.user && <span>by {item.user.name}</span>}
                {item.from && <span>from {item.from}</span>}
                {item.campaign && (
                  <span>
                    · campaign {item.campaign.name || `#${item.campaign.id}`}
                  </span>
                )}
                {item.kind === "email_sent" && item.replied && (
                  <span className="text-emerald-600 font-semibold">
                    · replied
                  </span>
                )}
                {item.kind === "email_sent" && item.bounced && (
                  <span className="text-red-600 font-semibold">
                    · {item.bounced} bounce
                  </span>
                )}
                {item.conversationId && (
                  <Link to="/inbox" className="text-sky-700 hover:underline">
                    · open inbox
                  </Link>
                )}
                {item.canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {next && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show older"}
          </Button>
        </div>
      )}
    </div>
  );
}
