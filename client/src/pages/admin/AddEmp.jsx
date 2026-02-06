import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { api } from "../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function AddEmp({ onClose, refreshUsers, editingUser }) {
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [password, setPassword] = useState("");

  // If editing, populate fields
  useEffect(() => {
    if (editingUser) {
      setEmpId(editingUser.empId || "");
      setName(editingUser.name || "");
      setEmail(editingUser.email || "");
      setJobRole(editingUser.jobRole || "");
      // Password is not populated for security reasons
    }
  }, [editingUser]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      if (editingUser) {
        // Update existing user
        const updateData = {
          empId,
          name,
          email,
          jobRole,
        };

        // Only include password if it's been entered
        if (password.trim()) {
          updateData.password = password;
        }

        await api.put(`${API_BASE_URL}/api/users/${editingUser.id}`, updateData);
      } else {
        // Create new user
        await api.post(`${API_BASE_URL}/api/users/register`, {
          empId,
          name,
          email,
          jobRole,
          password,
        });
      }

      refreshUsers();
      onClose();
    } catch (error) {
      console.error("Error saving employee:", error);
      alert(error.response?.data?.error || "Failed to save employee");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-center">

      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-xl p-6 z-50">

        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-bold">
            {editingUser ? "Edit Employee" : "Add Employee"}
          </h2>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-200"
          >
            <X />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">

          <input
            placeholder="Employee ID"
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            className="w-full p-3 border rounded-xl"
            required
          />

          <input
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 border rounded-xl"
            required
          />

          <input
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 border rounded-xl"
            required
            type="email"
          />

          {/* Password Field */}
          <div>
            <input
              type="password"
              placeholder={editingUser ? "Password (leave blank to keep current)" : "Password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border rounded-xl"
              required={!editingUser}
            />
            {editingUser && (
              <p className="text-xs text-gray-500 mt-1 ml-1">
                Leave blank to keep current password
              </p>
            )}
          </div>
            {/* Job Role Dropdown */}
            <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                Job Role
            </label>

            <select
                value={jobRole}
                onChange={(e) => setJobRole(e.target.value)}
                className="w-full p-3  border rounded-xl bg-white focus:ring-2 focus:ring-green-500"
                required
            >
                <option value="">Select Role</option>
                <option value="Employee">Employee</option>
                <option value="HR">HR</option>
                <option value="Admin">Admin</option>
            </select>
            </div>


          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 border rounded-xl hover:bg-gray-100"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl"
            >
              {editingUser ? "Update" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}