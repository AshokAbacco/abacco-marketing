// client/src/pages/pitches/PitchList.jsx
import React, { useState, useEffect } from "react";
import { Plus, Eye, Edit, Trash2, Search, Sparkles } from "lucide-react";

import Modal from "./components/Modal";
import CreatePitch from "./CreatePitch";
import PitchPreview from "./PitchPreview";

export default function PitchList() {
  const [pitches, setPitches] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedPitch, setSelectedPitch] = useState(null);
  const [editingPitch, setEditingPitch] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pitchToDelete, setPitchToDelete] = useState(null);

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

  const handleDelete = (pitch) => {
    setPitchToDelete(pitch);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!pitchToDelete) return;

    try {
      const token = localStorage.getItem("token");

      await fetch(`${API_BASE_URL}/api/pitches/${pitchToDelete.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      setPitches(prev => prev.filter(p => p.id !== pitchToDelete.id));
      setShowDeleteConfirm(false);
      setPitchToDelete(null);
    } catch {
      alert("Failed to delete");
    }
  };

  // Filter pitches based on search query
  const filteredPitches = pitches.filter(pitch =>
    pitch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pitch.bodyHtml.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    fetchPitches();
  }, []);

  const fetchPitches = async () => {
    try {
      const token = localStorage.getItem("token");

      const res = await fetch(`${API_BASE_URL}/api/pitches`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      if (data.success) {
        setPitches(data.data);
      }
    } catch (err) {
      console.error("Failed to load pitches", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* Header Section */}
      <div className="bg-blue/20 dark:bg-slate-800 border-b border-sky-50 dark:border-sky-900">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-sky-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-600 to-blue-600 bg-clip-text text-transparent">
                    Pitch Templates
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Create and manage reusable email templates for your outreach
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:from-sky-700 hover:to-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-sky-500/30 hover:shadow-xl hover:shadow-sky-500/40 transition-all duration-200 font-medium"
            >
              <Plus size={20} strokeWidth={2.5} />
              Create New Pitch
            </button>
          </div>

          {/* Search Bar */}
          <div className="flex gap-3 mt-6">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search pitches..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-sky-50 dark:bg-slate-700 border border-sky-200 dark:border-sky-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white dark:focus:bg-slate-600 transition-all text-slate-900 dark:text-white placeholder-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {filteredPitches.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-sky-200 dark:border-sky-900 p-12 text-center shadow-xl">
            <div className="w-20 h-20 bg-gradient-to-br from-sky-100 to-blue-100 dark:from-sky-900/20 dark:to-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-10 h-10 text-sky-600 dark:text-sky-400" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
              {searchQuery ? "No pitches found" : "No pitches yet"}
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              {searchQuery ? "Try adjusting your search query" : "Get started by creating your first pitch template"}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowCreate(true)}
                className="px-6 py-3 bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-xl hover:from-sky-700 hover:to-blue-700 inline-flex items-center gap-2 shadow-lg shadow-sky-500/30"
              >
                <Plus size={20} />
                Create Your First Pitch
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPitches.map((pitch) => (
              <div
                key={pitch.id}
                className="group bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-900 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:border-sky-300 dark:hover:border-sky-700 transition-all duration-300 hover:-translate-y-1 flex flex-col"
              >
                {/* Card Header */}
                <div className="p-6 border-b border-sky-100 dark:border-sky-900 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-bold text-slate-900 dark:text-white text-lg line-clamp-2 flex-1">
                      {pitch.name}
                    </h3>
                    <span
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${
                        pitch.type === "followup"
                          ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30"
                          : "bg-gradient-to-r from-sky-500 to-blue-500 text-white shadow-lg shadow-sky-500/30"
                      }`}
                    >
                      {pitch.type === "followup" ? "Follow Up" : "Fresh Pitch"}
                    </span>
                  </div>
                </div>

                {/* Card Body - Preview */}
                <div className="p-6 flex-1">
                  <div
                    className="text-sm text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: pitch.bodyHtml }}
                  />
                </div>

                {/* Card Footer - Actions */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-sky-100 dark:border-sky-900">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedPitch(pitch);
                        setShowPreview(true);
                      }}
                      className="flex-1 px-3 py-2.5 bg-white dark:bg-slate-700 hover:bg-sky-50 dark:hover:bg-sky-900/30 border border-sky-200 dark:border-sky-700 hover:border-sky-300 dark:hover:border-sky-600 rounded-lg transition-all group/btn flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
                      title="Preview"
                    >
                      <Eye size={16} className="text-sky-600 dark:text-sky-400 group-hover/btn:scale-110 transition-transform" />
                      <span className="group-hover/btn:text-sky-600 dark:group-hover/btn:text-sky-400">View</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingPitch(pitch);
                        setShowCreate(true);
                      }}
                      className="flex-1 px-3 py-2.5 bg-white dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-sky-200 dark:border-sky-700 hover:border-blue-300 dark:hover:border-blue-600 rounded-lg transition-all group/btn flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
                      title="Edit"
                    >
                      <Edit size={16} className="text-blue-600 dark:text-blue-400 group-hover/btn:scale-110 transition-transform" />
                      <span className="group-hover/btn:text-blue-600 dark:group-hover/btn:text-blue-400">Edit</span>
                    </button>

                    <button
                      onClick={() => handleDelete(pitch)}
                      className="flex-1 px-3 py-2.5 bg-white dark:bg-slate-700 hover:bg-red-50 dark:hover:bg-red-900/30 border border-sky-200 dark:border-sky-700 hover:border-red-300 dark:hover:border-red-600 rounded-lg transition-all group/btn flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
                      title="Delete"
                    >
                      <Trash2 size={16} className="text-red-600 dark:text-red-400 group-hover/btn:scale-110 transition-transform" />
                      <span className="group-hover/btn:text-red-600 dark:group-hover/btn:text-red-400">Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CREATE MODAL */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setEditingPitch(null);
        }}
        title={editingPitch ? "Edit Pitch" : "Create New Pitch"}
      >
        <CreatePitch
          pitch={editingPitch}
          onSaved={() => {
            fetchPitches();       // refresh list
            setShowCreate(false); // close modal
            setEditingPitch(null);
          }}
        />
      </Modal>

      {/* PREVIEW MODAL */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Pitch Preview"
      >
        <PitchPreview pitch={selectedPitch} />
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        open={showDeleteConfirm}
        size="sm"
        onClose={() => {
          setShowDeleteConfirm(false);
          setPitchToDelete(null);
        }}
        title="Delete Pitch"
      >
        <div className="max-w-md mx-auto">
          <div className="space-y-6">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <p className="text-sm text-red-700 dark:text-red-400">
                Are you sure you want to delete this pitch?
              </p>
              <p className="font-semibold text-red-900 dark:text-red-300 mt-1">
                {pitchToDelete?.name}
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setPitchToDelete(null);
                }}
                className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all"
              >
                Cancel
              </button>

              <button
                onClick={confirmDelete}
                className="px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-lg shadow-red-500/30 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}