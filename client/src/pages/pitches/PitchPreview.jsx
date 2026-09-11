import React from 'react';
import { FileText, Mail } from 'lucide-react';

export default function PitchPreview({ pitch }) {
  if (!pitch) return null;

  return (
    <div className="space-y-6">
      {/* Pitch Name Card */}
      <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
            Pitch Name
          </h3>
        </div>
        <p className="text-xl font-bold text-slate-900 dark:text-white ml-13">
          {pitch.name}
        </p>
      </div>

      {/* Pitch Type Card */}
      <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
            Pitch Type
          </h3>
        </div>
        <div className="ml-13">
          <span
            className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${
              pitch.type === "followup"
                ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30"
                : "bg-gradient-to-r from-sky-500 to-blue-500 text-white shadow-lg shadow-sky-500/30"
            }`}
          >
            {pitch.type === "followup" ? "Follow Up" : "Fresh Pitch"}
          </span>
        </div>
      </div>

      {/* Email Body Card */}
      <div className="bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-4">
          Email Body Preview
        </h3>

        <div
          className="prose prose-slate dark:prose-invert max-w-none border border-sky-200 dark:border-sky-700 rounded-lg p-6 bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-900/10 dark:to-blue-900/10 shadow-inner"
          dangerouslySetInnerHTML={{ __html: pitch.bodyHtml }}
        />
      </div>

      {/* Info Note */}
      <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 border border-sky-200 dark:border-sky-800 rounded-xl p-4">
        <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
          💡 This is how your email pitch will appear when sent. Signature will be added automatically.
        </p>
      </div>
    </div>
  );
}