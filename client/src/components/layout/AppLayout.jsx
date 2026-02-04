import { useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="min-h-screen flex bg-green-50 dark:bg-slate-950">

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        />
      )}

      {/* Sidebar controls expansion */}
      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        setExpanded={setExpanded}
      />

      <div className="flex-1 flex flex-col">

        <Navbar setSidebarOpen={setSidebarOpen} />

        <main
          className={`
            mt-16 p-6 min-h-screen
            transition-all duration-300
            ${expanded ? "ml-72" : "ml-16"}
          `}
        >
          {children}
        </main>

      </div>
    </div>
  );
}
