// client/src/pages/pitches/components/Modal.jsx
import React from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, size = "lg" }) {
  if (!open) return null;

  const sizes = {
    sm: "max-w-md",   // small (delete)
    md: "max-w-2xl",  // medium
    lg: "max-w-6xl",  // large (create, preview)
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className={`bg-white dark:bg-slate-800 w-full ${sizes[size]} max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl relative`}
      >
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}