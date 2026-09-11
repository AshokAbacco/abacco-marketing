import { Loader2, CheckCircle } from "lucide-react";

export default function SendReceiveModal({ progress, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-900 w-[420px] rounded-xl shadow-xl border dark:border-slate-800 p-6">
        
        <h2 className="text-lg font-semibold mb-4">
          Outlook Send/Receive Progress
        </h2>

        <p className="text-sm text-slate-500 mb-3">
          {progress < 100
            ? "Syncing email accounts..."
            : "All tasks completed successfully"}
        </p>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          {progress < 100 ? (
            <>
              <Loader2 className="animate-spin w-4 h-4" />
              Receiving mails...
            </>
          ) : (
            <>
              <CheckCircle className="text-blue-500 w-4 h-4" />
              Sync completed
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-right">
          <button
            onClick={onClose}
            disabled={progress < 100}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}