import {
  Search,
  Settings,
  HelpCircle,
  LogOut,
  Sun,
  Moon,
  Menu,
  Bell,
  User,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useNavigate } from "react-router-dom";

export default function Navbar({ setSidebarOpen }) {
  const [open, setOpen] = useState(false);
  const [userData, setUserData] = useState(null);
  const dropdownRef = useRef(null);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

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

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = () => {
    const confirmLogout = window.confirm("Are you sure you want to sign out?");

    if (!confirmLogout) return;

    // 🔴 Clear auth data
    localStorage.clear();
    sessionStorage.clear();

    // 🏠 Redirect to home
    navigate("/", { replace: true });
  };

  // ✅ Get user's initials for avatar
  const getInitials = (name) => {
    if (!name) return "U";
    const names = name.trim().split(" ");
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <header className="fixed top-16 md:top-0 left-16 md:left-16 group-hover:left-72 right-0 h-16 
      z-40 backdrop-blur-md bg-white/95 dark:bg-slate-900/95 
      border-b border-emerald-100 dark:border-emerald-900/50 
      shadow-sm shadow-emerald-500/5
      transition-all duration-300">
      <div className="h-full flex items-center justify-between px-6">

        {/* Left Section */}
        <div className="flex items-center gap-3">

          {/* Hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-slate-700 dark:text-slate-300 transition-colors"
          >
            <Menu size={22} />
          </button>

          {/* Mobile Brand */}
          <div className="flex items-center gap-2 md:hidden">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-green-600 text-white rounded-xl flex items-center justify-center font-bold shadow-lg shadow-emerald-500/30">
              A
            </div>
            <span className="font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
              Abacco CRM
            </span>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3 relative" ref={dropdownRef}>
          
          {/* Notifications */}
          <button className="relative p-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-slate-700 dark:text-slate-200 transition-all duration-200">
            <Bell size={20} />
            <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-900 animate-pulse"></span>
          </button>

          {/* Theme Toggle */}
          {/* <button
            onClick={toggleTheme}
            className="p-2 rounded-lg 
                      text-slate-700 dark:text-slate-200
                      hover:bg-emerald-100 dark:hover:bg-emerald-900/30
                      transition-all duration-200"
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button> */}

          {/* User Menu */}
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-3 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:shadow-md transition-all duration-200"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center text-white font-semibold shadow-md">
              {userData ? getInitials(userData.name) : <User size={18} />}
            </div>
            <div className="text-left text-sm leading-tight hidden sm:block">
              <p className="font-semibold text-slate-900 dark:text-white">
                {userData?.name || "User"}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {userData?.jobRole || "Employee"}
              </p>
            </div>
          </button>

          {/* Dropdown Menu */}
          {open && (
            <div className="absolute right-0 top-14 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-emerald-100 dark:border-emerald-900/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              
              {/* User Info Header */}
              <div className="bg-gradient-to-br from-emerald-500 via-green-600 to-emerald-700 text-white p-5 relative overflow-hidden">
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-bold border-2 border-white/30 shadow-lg text-lg">
                      {userData ? getInitials(userData.name) : <User size={24} />}
                    </div>
                    <div>
                      <p className="font-bold text-lg">{userData?.name || "User"}</p>
                      <p className="text-xs text-emerald-100">{userData?.jobRole || "Employee"}</p>
                    </div>
                  </div>
                  <p className="text-sm text-white/90">{userData?.email || "user@abacco.com"}</p>
                </div>
                {/* Decorative circles */}
                <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
                <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-green-400/20 rounded-full blur-2xl"></div>
              </div>

              {/* Menu Items */}
              <div className="p-2">
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all duration-200 group">
                  <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50 transition-colors">
                    <User size={16} />
                  </div>
                  <span>My Profile</span>
                </button>

                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all duration-200 group">
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
                    <Settings size={16} />
                  </div>
                  <span>Settings</span>
                </button>

                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm font-medium text-slate-700 dark:text-slate-300 transition-all duration-200 group">
                  <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors">
                    <HelpCircle size={16} />
                  </div>
                  <span>Help & Support</span>
                </button>

                <div className="my-2 border-t border-emerald-100 dark:border-emerald-900/50" />

                <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium text-red-600 dark:text-red-400 transition-all duration-200 group">
                  <div className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 group-hover:bg-red-200 dark:group-hover:bg-red-900/50 transition-colors">
                    <LogOut size={16} />
                  </div>
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}