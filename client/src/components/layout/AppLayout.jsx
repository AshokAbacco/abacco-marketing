import TopNavbar from "./Sidebar";

export default function AppLayout({ children }) {
  return (
    <div className="min-h-screen bg-blue-50 dark:bg-slate-950">

      {/* Top Navigation Bar */}
      <TopNavbar />

      {/* Main Content - offset by navbar height */}
      <main className="pt-16 p-6 min-h-screen">
        {children}
      </main>

    </div>
  );
}