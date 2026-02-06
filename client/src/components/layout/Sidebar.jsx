// Sidebar.jsx - Responsive and Interactive Sidebar Component
import { NavLink } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  Mail,
  Megaphone,
  LineChart,
  Shield,
  Repeat,
  X,
  Sparkles,
} from "lucide-react";

const navigationItems = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Leads", path: "/leads", icon: Users },
  { name: "Pitches", path: "/pitches", icon: Mail },
  { name: "Inbox", path: "/inbox", icon: Megaphone },
  { name: "Campaigns", path: "/campaigns", icon: Repeat },
  { name: "Analytics", path: "/analytics", icon: LineChart },
  { name: "Admin", path: "/admin", icon: Shield },
];

export default function Sidebar({ sidebarOpen, setSidebarOpen, setExpanded }) {
  const [userData, setUserData] = useState(null);

  // ✅ Fetch user data from localStorage on component mount
  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      try {
        setUserData(JSON.parse(user));
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  // ✅ Get user's initials for avatar
  const getInitials = (name) => {
    if (!name) return "U";
    const names = name.trim().split(" ");
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden transition-opacity"
        />
      )}

      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="
          group fixed top-0 left-0 h-screen
          w-20 hover:w-64
          bg-gradient-to-b from-white via-emerald-50/30 to-green-50/30 
          dark:from-slate-900 dark:via-emerald-950/20 dark:to-green-950/20
          border-r border-emerald-100 dark:border-emerald-900/50
          transition-all duration-300 ease-in-out
          z-50 overflow-hidden
          shadow-xl shadow-emerald-500/5
        "
      >
        <div className="flex flex-col h-full p-4">

          {/* Close button (mobile) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden self-end p-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <X size={20} className="text-slate-600 dark:text-slate-400" />
          </button>

          {/* Brand */}
          <div className="mb-8 flex items-center gap-3">
            <div className="min-w-[40px] h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 via-green-600 to-emerald-700 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/50 ring-2 ring-emerald-400/20">
              <Sparkles size={24} strokeWidth={2.5} />
            </div>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              <h1 className="text-base font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                Abacco Marketing
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Marketing Intelligence</p>
            </div>
          </div>

          {/* Navigation */}
          {/* Navigation */}
        <nav className="flex-1 overflow-y-auto">
          <div className="space-y-1.5">
            {/* ✅ Filter menu items based on role */}
            {navigationItems
              .filter((item) => {
                // If user is NOT admin, hide Admin tab
                if (item.name === "Admin" && userData?.jobRole !== "Admin") {
                  return false;
                }
                return true;
              })
              .map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `
                    flex items-center gap-3
                    px-3 py-3 rounded-xl text-sm font-medium 
                    transition-all duration-200
                    relative overflow-hidden
                    ${
                      isActive
                        ? "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/40 scale-100"
                        : "text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 hover:scale-105"
                    }
                  `
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r-full" />
                      )}

                      {/* Icon */}
                      <div className="min-w-[20px] flex justify-center">
                        <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                      </div>

                      {/* Label */}
                      <span
                        className="
                          whitespace-nowrap
                          opacity-0 group-hover:opacity-100
                          transition-opacity duration-200
                          font-semibold
                        "
                      >
                        {item.name}
                      </span>
                    </>
                  )}
                </NavLink>
              ))}
          </div>
        </nav>


          {/* Footer - user section */}
          <div className="pt-4 mt-4 border-t border-emerald-200 dark:border-emerald-900/50">
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all duration-200 cursor-pointer">
              <div className="min-w-[30px] h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                <span className="text-sm font-bold text-white">
                  {userData ? getInitials(userData.name) : "U"}
                </span>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {userData?.name || "User"}
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {userData?.email || "user@abacco.com"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative element */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/10 to-green-500/10 rounded-full blur-3xl -z-10" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-gradient-to-tr from-green-500/10 to-emerald-500/10 rounded-full blur-3xl -z-10" />
      </aside>
    </>
  );
}