import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import {  } from "react-router-dom";

import Dashboard from "./pages/dashboard/Dashboard";
import LeadsList from "./pages/lead/LeadsList";
import PitchList from "./pages/pitches/PitchList";
import CampaignList from "./pages/campaigns/CampaignList";
import AnalyticsDashboard from "./pages/analytics/AnalyticsDashboard";
import FollowUpRules from "./pages/followup/FollowUpRules";
import MainInbox from "./pages/campaigns/MainInbox.jsx";
import Login from "./pages/auth/Login.jsx";
import Users from "./pages/admin/Users.jsx";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" />} />

      <Route path="/dashboard" element={<AppLayout><Dashboard /></AppLayout>} />
      <Route path="/leads" element={<AppLayout><LeadsList /></AppLayout>} />
      <Route path="/pitches" element={<AppLayout><PitchList /></AppLayout>} />

      <Route path="/campaigns" element={<AppLayout><CampaignList /></AppLayout>} />
      <Route path="/inbox" element={<AppLayout><MainInbox /></AppLayout>} />
      <Route path="/admin" element={<AppLayout><Users /></AppLayout>} />


      <Route path="/analytics" element={<AppLayout><AnalyticsDashboard /></AppLayout>} />
      <Route path="/login" element={<Login />} />
      <Route path="/followups" element={<AppLayout><FollowUpRules /></AppLayout>} />
    </Routes>
  );
}