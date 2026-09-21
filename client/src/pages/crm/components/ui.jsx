// src/pages/crm/components/ui.jsx — small shared UI pieces for CRM pages.
import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Users,
  Building2,
  KanbanSquare,
  CheckSquare,
  MessageSquareReply,
  Workflow,
} from "lucide-react";
import { LIFECYCLES, REPLY_CATEGORIES } from "../lib";

export function CrmTabs() {
  const tabs = [
    { to: "/crm/contacts", label: "Contacts", icon: Users },
    { to: "/crm/companies", label: "Companies", icon: Building2 },
    { to: "/crm/deals", label: "Deals", icon: KanbanSquare },
    { to: "/crm/tasks", label: "Tasks", icon: CheckSquare },
    { to: "/crm/replies", label: "Replies", icon: MessageSquareReply },
    { to: "/crm/sequences", label: "Follow-up sequences", icon: Workflow },
  ];
  return (
    <nav className="flex gap-2 overflow-x-auto mb-5" aria-label="CRM sections">
      {tabs.map((t) => {
        const TabIcon = t.icon;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `inline-flex items-center gap-1.5 px-4 py-2 mt-5 rounded-xl text-sm font-semibold whitespace-nowrap border ${
                isActive
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`
            }
          >
            <TabIcon size={16} />
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function PageTitle({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }) {
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({ variant = "primary", className = "", ...props }) {
  const styles = {
    primary: "bg-sky-600 text-white hover:bg-sky-700",
    secondary:
      "bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost:
      "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Modal({ title, onClose, children, wide = false }) {
  const panel = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector("input, select, textarea")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        className={`relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-inherit rounded-t-2xl">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-slate-400 mt-1">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p className="text-sm text-red-600" role="alert">
      {children}
    </p>
  );
}

export function Avatar({ name, size = 32 }) {
  const initials = String(name || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-sky-100 text-sky-700 font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}

const LIFECYCLE_STYLE = {
  lead: "bg-slate-100 text-slate-700 border-slate-200",
  prospect: "bg-sky-50 text-sky-700 border-sky-200",
  customer: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost: "bg-red-50 text-red-700 border-red-200",
};

export function LifecycleBadge({ value }) {
  const label = LIFECYCLES.find((l) => l.value === value)?.label || value;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${LIFECYCLE_STYLE[value] || LIFECYCLE_STYLE.lead}`}
    >
      {label}
    </span>
  );
}

export function StageDot({ color }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color || "#94a3b8" }}
    />
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 p-3 text-sm text-slate-600 dark:text-slate-300">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="p-8 text-center text-sm text-slate-500">{children}</p>;
}

export function UserSelect({
  users,
  value,
  onChange,
  includeAll = false,
  allLabel = "Everyone",
  id,
}) {
  return (
    <select
      id={id}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      {includeAll && <option value="">{allLabel}</option>}
      {!includeAll && !value && <option value="">Select…</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

export function CategoryBadge({ value }) {
  const cat = REPLY_CATEGORIES.find((c) => c.value === value);
  if (!cat)
    return (
      <span className="px-2 py-0.5 rounded-full border text-xs font-semibold bg-slate-50 text-slate-500 border-slate-200">
        Unclassified
      </span>
    );
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${cat.style}`}
    >
      {cat.label}
    </span>
  );
}
