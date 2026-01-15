import { AlertTriangle } from 'lucide-react';

interface ErrorDisplayProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorDisplay({
  message = 'Failed to load data. Please check that the backend server is running.',
  onRetry
}: ErrorDisplayProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-bgBase text-textMain">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <AlertTriangle size={48} className="text-red-400 opacity-80" />
        <h2 className="text-lg font-semibold text-textMain">Connection Error</h2>
        <p className="text-sm text-textMuted leading-relaxed">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 px-6 py-2 bg-accent hover:bg-accentHover text-white rounded-md font-medium text-sm transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
