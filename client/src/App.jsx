import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import Login from "./pages/auth/Login.jsx";

// Route-level code splitting: each page is downloaded only when visited,
// so the login screen and first page load far less JavaScript.
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const LeadsList = lazy(() => import("./pages/lead/LeadsList"));
const PitchList = lazy(() => import("./pages/pitches/PitchList"));
const CampaignList = lazy(() => import("./pages/campaigns/CampaignList"));
const AnalyticsDashboard = lazy(
  () => import("./pages/analytics/AnalyticsDashboard"),
);
const MainInbox = lazy(() => import("./pages/campaigns/MainInbox.jsx"));
const Users = lazy(() => import("./pages/admin/Users.jsx"));
const AdminDailyOverview = lazy(
  () => import("./pages/admin/AdmindailyLimits.jsx"),
);
const Deliverability = lazy(
  () => import("./pages/deliverability/Deliverability.jsx"),
);
const CrmContacts = lazy(() => import("./pages/crm/Contacts.jsx"));
const CrmContactDetail = lazy(() => import("./pages/crm/ContactDetail.jsx"));
const CrmCompanies = lazy(() => import("./pages/crm/Companies.jsx"));
const CrmCompanyDetail = lazy(() => import("./pages/crm/CompanyDetail.jsx"));
const CrmDeals = lazy(() => import("./pages/crm/Deals.jsx"));
const CrmTasks = lazy(() => import("./pages/crm/Tasks.jsx"));
const CrmReplies = lazy(() => import("./pages/crm/Replies.jsx"));
const CrmSequences = lazy(() => import("./pages/crm/Sequences.jsx"));

function PageLoader() {
  return (
    <div
      className="flex items-center justify-center h-[60vh]"
      role="status"
      aria-live="polite"
    >
      <div className="h-8 w-8 rounded-full border-4 border-sky-200 border-t-sky-500 animate-spin" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function readUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Role Guard ───────────────────────────────────────────────────────────────
// Redirects to /dashboard if the user's jobRole is not in `allowedRoles`.
// (The server enforces the same roles; this only hides the page.)
function RoleGuard({ allowedRoles, children }) {
  const user = readUser();
  if (!user) return <Navigate to="/login" replace />;
  const role = String(user?.jobRole || "")
    .toLowerCase()
    .trim();
  if (!allowedRoles.includes(role)) return <Navigate to="/dashboard" replace />;
  return children;
}

// Wraps a lazy page in the app layout; the layout (sidebar/navbar) renders
// immediately while the page chunk loads.
function Page({ children }) {
  return (
    <AppLayout>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </AppLayout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="/login" element={<Login />} />

      <Route
        path="/dashboard"
        element={
          <Page>
            <Dashboard />
          </Page>
        }
      />
      <Route
        path="/leads"
        element={
          <Page>
            <LeadsList />
          </Page>
        }
      />
      <Route
        path="/pitches"
        element={
          <Page>
            <PitchList />
          </Page>
        }
      />
      <Route
        path="/campaigns"
        element={
          <Page>
            <CampaignList />
          </Page>
        }
      />
      <Route
        path="/inbox"
        element={
          <Page>
            <MainInbox />
          </Page>
        }
      />
      <Route
        path="/analytics"
        element={
          <Page>
            <AnalyticsDashboard />
          </Page>
        }
      />
      {/* The old placeholder page is replaced by the real sequence builder. */}
      <Route
        path="/followups"
        element={<Navigate to="/crm/sequences" replace />}
      />

      {/* ── CRM ── */}
      <Route path="/crm" element={<Navigate to="/crm/contacts" replace />} />
      <Route
        path="/crm/contacts"
        element={
          <Page>
            <CrmContacts />
          </Page>
        }
      />
      <Route
        path="/crm/contacts/:id"
        element={
          <Page>
            <CrmContactDetail />
          </Page>
        }
      />
      <Route
        path="/crm/companies"
        element={
          <Page>
            <CrmCompanies />
          </Page>
        }
      />
      <Route
        path="/crm/companies/:id"
        element={
          <Page>
            <CrmCompanyDetail />
          </Page>
        }
      />
      <Route
        path="/crm/deals"
        element={
          <Page>
            <CrmDeals />
          </Page>
        }
      />
      <Route
        path="/crm/tasks"
        element={
          <Page>
            <CrmTasks />
          </Page>
        }
      />
      <Route
        path="/crm/replies"
        element={
          <Page>
            <CrmReplies />
          </Page>
        }
      />
      <Route
        path="/crm/sequences"
        element={
          <Page>
            <CrmSequences />
          </Page>
        }
      />

      {/* ── Protected: Admin & HR only (matches server-side requireAdmin) ── */}
      <Route
        path="/admin"
        element={
          <RoleGuard allowedRoles={["admin", "hr"]}>
            <Page>
              <Users />
            </Page>
          </RoleGuard>
        }
      />
      <Route
        path="/daily-overview"
        element={
          <RoleGuard allowedRoles={["admin", "hr"]}>
            <Page>
              <AdminDailyOverview />
            </Page>
          </RoleGuard>
        }
      />

      <Route
        path="/deliverability"
        element={
          <RoleGuard allowedRoles={["admin", "hr"]}>
            <Page>
              <Deliverability />
            </Page>
          </RoleGuard>
        }
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
