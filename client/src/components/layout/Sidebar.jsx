// TopNavbar.jsx - Converted from Sidebar to Top Navigation Bar
import React from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Mail,
  Megaphone,
  Shield,
  FileText,
  Sparkles,
  BarChart3,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Folder,
} from "lucide-react";
import { api } from "../../pages/utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const navigationItems = [
  { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  // "Inbox" is handled separately with a group dropdown
  { name: "Campaigns", icon: Megaphone, path: "/campaigns" },
  { name: "Pitches", icon: FileText, path: "/pitches" },
  { name: "Analytics", icon: BarChart3, path: "/analytics" },
  { name: "Daily Overview", icon: BarChart3, path: "/daily-overview" },
  { name: "Admin", icon: Shield, path: "/admin" },
];

export default function TopNavbar() {
  const [userData, setUserData] = useState(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showInboxDropdown, setShowInboxDropdown] = useState(false);
  const [accountGroups, setAccountGroups] = useState([]);
  const inboxDropdownRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const isInboxActive = location.pathname.startsWith("/inbox");

  // Fetch account groups for inbox dropdown
  const fetchGroups = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/account-groups`);
      const data = Array.isArray(res.data?.data) ? res.data.data : [];
      setAccountGroups(data);
    } catch (err) {
      console.error("Failed to fetch groups for navbar:", err);
    }
  };

  // Fetch user data from localStorage on mount
  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      try {
        const parsedUser = JSON.parse(user);
        setUserData(parsedUser);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
    fetchGroups();
  }, []);

  // Re-fetch groups whenever we navigate to inbox (groups may have changed)
  useEffect(() => {
    if (isInboxActive) fetchGroups();
  }, [location.pathname]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest("#user-menu-container")) {
        setShowUserMenu(false);
      }
      if (inboxDropdownRef.current && !inboxDropdownRef.current.contains(e.target)) {
        setShowInboxDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get user's initials for avatar
  const getInitials = (name) => {
    if (!name) return "U";
    const names = name.trim().split(" ");
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  // Check if user is admin
  const isAdmin = () => {
    if (!userData || !userData.jobRole) return false;
    const role = String(userData.jobRole).toLowerCase().trim();
    return role === "admin";
  };

  // Check if user is admin or HR
  const isHROrAdmin = () => {
    if (!userData || !userData.jobRole) return false;
    const role = String(userData.jobRole).toLowerCase().trim();
    return role === "admin" || role === "hr";
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setShowLogoutModal(false);
    navigate("/");
  };

  const filteredNavItems = navigationItems.filter((item) => {
    if (item.name === "Admin") return isAdmin();
    if (item.name === "Daily Overview") return isHROrAdmin();
    return true;
  });

  return (
    <>
      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all">
            {/* Modal Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <LogOut className="text-red-600 dark:text-red-400" size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  Logout Confirmation
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Are you sure you want to leave?
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              You will be logged out of your account and redirected to the login page.
            </p>

            {/* Modal Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/30 transition-all"
              >
                Confirm Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-blue-50 border-b border-sky-200 shadow-sm">
        <div className="flex items-center h-full px-4 gap-4">

          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0 mr-4">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 via-blue-600 to-sky-700 text-white flex items-center justify-center font-bold shadow-lg shadow-sky-500/50 ring-2 ring-sky-400/20">
              <Sparkles size={20} strokeWidth={2.5} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent leading-tight">
                Abacco Marketing
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
                Marketing Intelligence
              </p>
            </div>
          </div>

          {/* Spacer - pushes nav + user menu to the right */}
          <div className="flex-1" />

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-1">
            {filteredNavItems.map((item) => (
              <React.Fragment key={item.name}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap
                    ${
                      isActive
                        ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/40"
                        : "text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600 dark:hover:text-sky-400"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                      <span className="font-semibold">{item.name}</span>
                    </>
                  )}
                </NavLink>

                {/* Inbox dropdown inserted right after Dashboard */}
                {item.name === "Dashboard" && (
                  <div className="relative" ref={inboxDropdownRef}>
              <button
                onClick={() => {
                  setShowInboxDropdown((prev) => !prev);
                  if (!showInboxDropdown) fetchGroups();
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap
                  ${
                    isInboxActive
                      ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/40"
                      : "text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600 dark:hover:text-sky-400"
                  }`}
              >
                <Mail size={16} strokeWidth={isInboxActive ? 2.5 : 2} />
                <span className="font-semibold">Inbox</span>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${showInboxDropdown ? "rotate-180" : ""}`}
                />
              </button>

              {showInboxDropdown && (
                <div className="absolute left-0 top-full mt-2 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-sky-100 dark:border-sky-900/50 overflow-hidden z-50">
                  <div className="px-3 py-2 border-b border-sky-100 dark:border-sky-900/50">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Select Group
                    </p>
                  </div>

                  {accountGroups.length > 0 && (
                    <div>
                      {accountGroups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => {
                            navigate(`/inbox?groupId=${group.id}`);
                            setShowInboxDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: group.color || "#10b981" }}
                          >
                            <Folder className="w-3.5 h-3.5 text-white" />
                          </div>
                          <span className="truncate">{group.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* All Accounts — always last */}
                  <div className="border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={() => {
                        navigate("/inbox");
                        setShowInboxDropdown(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-3.5 h-3.5 text-white" />
                      </div>
                      <span>All Accounts</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
                )}
              </React.Fragment>
            ))}
          </nav>

          {/* User Menu */}
          <div className="relative shrink-0" id="user-menu-container">
            <button
              onClick={() => setShowUserMenu((prev) => !prev)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all duration-200"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-md shrink-0">
                <span className="text-xs font-bold text-white">
                  {userData ? getInitials(userData.name) : "U"}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 leading-tight">
                  {userData?.name || "User"}
                </p>
                <p className="text-[10px] text-sky-600 dark:text-sky-400 font-medium leading-tight">
                  {userData?.jobRole || "Role"}
                </p>
              </div>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform duration-200 hidden sm:block ${showUserMenu ? "rotate-180" : ""}`}
              />
            </button>

            {/* Dropdown */}
            {showUserMenu && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-sky-100 dark:border-sky-900/50 overflow-hidden z-50">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-sky-100 dark:border-sky-900/50">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {userData?.name || "User"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {userData?.email || "user@abacco.com"}
                  </p>
                  <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400">
                    {userData?.jobRole || "Role"}
                  </span>
                </div>

                {/* Logout */}
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowLogoutModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut size={16} strokeWidth={2} />
                  Logout
                </button>
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="lg:hidden p-2 rounded-xl hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
          >
            {mobileMenuOpen ? (
              <X size={20} className="text-slate-600 dark:text-slate-400" />
            ) : (
              <Menu size={20} className="text-slate-600 dark:text-slate-400" />
            )}
          </button>
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-sky-100 dark:border-sky-900/50 bg-white dark:bg-slate-900 px-4 py-3 space-y-1 shadow-lg">
            {filteredNavItems.map((item) => (
              <React.Fragment key={item.name}>
                <NavLink
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                    ${
                      isActive
                        ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/30"
                        : "text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 hover:text-sky-600"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                      {item.name}
                    </>
                  )}
                </NavLink>

                {/* Inbox section in mobile — right after Dashboard */}
                {item.name === "Dashboard" && (
                  <div>
                    <button
                      onClick={() => { navigate("/inbox"); setMobileMenuOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                        ${isInboxActive && !location.search ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md" : "text-slate-600 hover:bg-sky-50 hover:text-sky-600"}`}
                    >
                      <Mail size={18} />
                      Inbox
                    </button>
                    {accountGroups.map((group) => (
                      <button
                        key={group.id}
                        onClick={() => { navigate(`/inbox?groupId=${group.id}`); setMobileMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-sky-50 hover:text-sky-600 transition-all duration-200"
                      >
                        <div
                          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: group.color || "#10b981" }}
                        >
                          <Folder size={12} className="text-white" />
                        </div>
                        {group.name}
                      </button>
                    ))}
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </header>
    </>
  );
}