import { Package } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message = 'Loading...' }: LoadingSpinnerProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-bgBase text-textMain">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin">
          <Package size={32} className="text-accent" />
        </div>
        <span className="text-sm text-textMuted">{message}</span>
      </div>
    </div>
  );
}
