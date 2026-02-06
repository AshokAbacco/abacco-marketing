//src/pages/admin/Users.jsx
import { useEffect, useState } from "react";
import AddEmp from "./AddEmp";
import { api } from "../utils/api";
import { Users, UserCheck, UserX, Briefcase, Pencil, Trash2, Search, X,Eye, EyeOff } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPasswords, setShowPasswords] = useState({});

  const activeCount = users.filter((u) => u.isActive).length;
  const inactiveCount = users.filter((u) => !u.isActive).length;

  // Fetch Employees
  const fetchUsers = async () => {
    const res = await api.get(`${API_BASE_URL}/api/users/all`);
    setUsers(res.data);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Handle Edit
  const handleEdit = (user) => {
    setEditingUser(user);
    setOpen(true);
  };

  const handleDelete = async (userId, userName) => {
    if (window.confirm(`Are you sure you want to delete ${userName}?`)) {
      try {
        await api.delete(`${API_BASE_URL}/api/users/${userId}`);
        fetchUsers();
      } catch (error) {
        console.error("Error deleting employee:", error);
        alert(error.response?.data?.error || "Failed to delete employee");
      }
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      const res = await api.put(`${API_BASE_URL}/api/users/${id}/status`);

      // ✅ Update UI instantly
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, isActive: res.data.isActive } : u
        )
      );
    } catch (err) {
      console.log("Status update error:", err);
    }
  };

  // Close modal and reset editing state
  const handleClose = () => {
    setOpen(false);
    setEditingUser(null);
  };

  // ✅ Filter users based on search query
  const filteredUsers = users.filter((user) => {
    const query = searchQuery.toLowerCase();
    return (
      user.name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.empId?.toLowerCase().includes(query) ||
      user.jobRole?.toLowerCase().includes(query)
    );
  });


  return (
    <div className="p-6 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 min-h-screen">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-700 to-green-600 bg-clip-text text-transparent">
            Employee Management
          </h1>
          <p className="text-slate-600 mt-1">Manage your team members</p>
        </div>

        <button
          onClick={() => setOpen(true)}
          className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all duration-200 font-semibold"
        >
          + Add Employee
        </button>
      </div>

      {/* Modal */}
      {open && (
        <AddEmp
          onClose={handleClose}
          refreshUsers={fetchUsers}
          editingUser={editingUser}
        />
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-emerald-100 p-5 flex gap-4 items-center hover:shadow-xl transition-shadow duration-200">
          <div className="p-3 bg-gradient-to-br from-emerald-100 to-green-100 rounded-xl">
            <Users className="text-emerald-600" size={24} />
          </div>
          <div>
            <p className="text-slate-600 text-sm font-medium">Total Employees</p>
            <h2 className="text-3xl font-bold text-slate-800">{users.length}</h2>
          </div>
        </div>
 
        {/* Active */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-green-100 p-5 flex gap-4 items-center hover:shadow-xl transition-shadow duration-200">
          <div className="p-3 bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl">
            <UserCheck className="text-green-600" size={24} />
          </div>
          <div>
            <p className="text-slate-600 text-sm font-medium">Active</p>
            <h2 className="text-3xl font-bold text-slate-800">{activeCount}</h2>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-red-100 p-5 flex gap-4 items-center hover:shadow-xl transition-shadow duration-200">
          <div className="p-3 bg-gradient-to-br from-red-100 to-rose-100 rounded-xl">
            <UserX className="text-red-600" size={24} />
          </div>
          <div>
            <p className="text-slate-600 text-sm font-medium">Inactive</p>
            <h2 className="text-3xl font-bold text-slate-800">{inactiveCount}</h2>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-teal-100 p-5 flex gap-4 items-center hover:shadow-xl transition-shadow duration-200">
          <div className="p-3 bg-gradient-to-br from-teal-100 to-cyan-100 rounded-xl">
            <Briefcase className="text-teal-600" size={24} />
          </div>
          <div>
            <p className="text-slate-600 text-sm font-medium">Departments</p>
            <h2 className="text-3xl font-bold text-slate-800">3</h2>
          </div>
        </div>
      </div>

      {/* Employee Table */}
      <div className="bg-white/80 backdrop-blur-sm shadow-xl rounded-2xl overflow-hidden border border-emerald-100">
        
        <div className="p-6 border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-green-50">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <h2 className="text-xl font-bold text-slate-800">
              Employee List
            </h2>

            {/* Search Bar */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-emerald-500" />
              </div>
              <input
                type="text"
                placeholder="Search by name, email, ID, or role..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-10 py-2.5 w-full md:w-80 bg-white border-2 border-emerald-200 rounded-xl text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all duration-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-emerald-600 transition-colors"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gradient-to-r from-emerald-50 to-green-50 text-emerald-700 text-sm uppercase">
              <tr>
                <th className="p-4 font-semibold">Emp ID</th>
                <th className="p-4 font-semibold">Name</th>
                <th className="p-4 font-semibold">Email</th>
                <th className="p-4 font-semibold">Password</th>
                <th className="p-4 font-semibold">Role</th>
                <th className="p-4 font-semibold">Actions</th>
                <th className="p-4 font-semibold">Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredUsers.map((u, index) => (
                <tr
                  key={u.id}
                  className={`border-b border-emerald-50 hover:bg-emerald-50/50 transition-colors duration-150 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-emerald-50/20'
                  }`}
                >
                  <td className="p-4 font-semibold text-emerald-700">{u.empId}</td>
                  <td className="p-4 text-slate-800 font-medium">{u.name}</td>
                  <td className="p-4 text-slate-600">{u.email}</td>
                  <td className="p-4">
                  <div className="flex items-center gap-2">
                    {/* Hidden Password */}
                    <span className="font-mono text-sm text-slate-500 bg-slate-100 px-2 py-1 rounded">
                      {showPasswords[u.id] ? u.password : "••••••••"}
                    </span>

                    {/* Toggle Button */}
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords((prev) => ({
                          ...prev,
                          [u.id]: !prev[u.id],
                        }))
                      }
                      className="text-slate-500 hover:text-slate-800"
                    >
                      {showPasswords[u.id] ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </td>

                  <td className="p-4">
                    <span className="px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-100 to-green-100 text-emerald-700 text-sm font-semibold">
                      {u.jobRole}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(u)}
                        className="p-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-600 rounded-lg transition-all duration-200 hover:scale-110"
                        title="Edit"
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.name)}
                        className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-all duration-200 hover:scale-110"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => handleToggleStatus(u.id)}
                      className={`px-4 py-2 rounded-lg font-semibold transition-all duration-200 hover:scale-105 shadow-sm ${
                        u.isActive
                          ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:shadow-md hover:shadow-green-500/30"
                          : "bg-gradient-to-r from-red-500 to-rose-500 text-white hover:shadow-md hover:shadow-red-500/30"
                      }`}
                      title={`Click to set ${u.isActive ? 'Inactive' : 'Active'}`}
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center p-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mb-4">
              <Users className="text-emerald-600" size={32} />
            </div>
            <p className="text-slate-600 font-medium">
              {searchQuery ? "No employees found matching your search." : "No employees found."}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="mt-3 text-emerald-600 hover:text-emerald-700 font-semibold"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}