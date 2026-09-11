import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { api } from "../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const PRESET_LOCATIONS = ["Bengaluru", "Anantapur"];

export default function AddEmp({ onClose, refreshUsers, editingUser }) {
  const [empId, setEmpId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [password, setPassword] = useState("");
  const [locationOption, setLocationOption] = useState(""); // dropdown value
  const [customLocation, setCustomLocation] = useState(""); // manual input value

  // If editing, populate fields
  useEffect(() => {
    if (editingUser) {
      setEmpId(editingUser.empId || "");
      setName(editingUser.name || "");
      setEmail(editingUser.email || "");
      setJobRole(editingUser.jobRole || "");

      const savedLocation = editingUser.location || "";
      if (PRESET_LOCATIONS.includes(savedLocation)) {
        setLocationOption(savedLocation);
        setCustomLocation("");
      } else if (savedLocation) {
        setLocationOption("custom");
        setCustomLocation(savedLocation);
      } else {
        setLocationOption("");
        setCustomLocation("");
      }
    }
  }, [editingUser]);

  // Derive final location value
  const finalLocation = locationOption === "custom" ? customLocation : locationOption;

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!finalLocation.trim()) {
      alert("Please select or enter a location.");
      return;
    }

    try {
      if (editingUser) {
        const updateData = {
          empId,
          name,
          email,
          jobRole,
          location: finalLocation,
        };
        if (password.trim()) {
          updateData.password = password;
        }
        await api.put(`${API_BASE_URL}/api/users/${editingUser.id}`, updateData);
      } else {
        await api.post(`${API_BASE_URL}/api/users/register`, {
          empId,
          name,
          email,
          jobRole,
          location: finalLocation,
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
              className="w-full p-3 border rounded-xl bg-white focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Role</option>
              <option value="Employee">Employee</option>
              <option value="HR">HR</option>
              <option value="Admin">Admin</option>
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <select
              value={locationOption}
              onChange={(e) => {
                setLocationOption(e.target.value);
                if (e.target.value !== "custom") setCustomLocation("");
              }}
              className="w-full p-3 border rounded-xl bg-white focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select Location</option>
              <option value="Bengaluru">Bengaluru</option>
              <option value="Anantapur">Anantapur</option>
              <option value="custom">Custom (Enter manually)</option>
            </select>

            {/* Custom location text input — shown only when "custom" is selected */}
            {locationOption === "custom" && (
              <input
                placeholder="Enter location name"
                value={customLocation}
                onChange={(e) => setCustomLocation(e.target.value)}
                className="w-full p-3 border rounded-xl mt-2 focus:ring-2 focus:ring-blue-500"
                required
                autoFocus
              />
            )}
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
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            >
              {editingUser ? "Update" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}