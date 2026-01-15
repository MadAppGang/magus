import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface ProgressEvent {
  operation: string;
  percent: number;
  status: string;
  cancellable?: boolean;
}

export interface ProgressState {
  operation: string;
  percent: number;
  status: string;
  cancellable: boolean;
}

export function useProgress(operation?: string) {
  const [progress, setProgress] = useState<ProgressState | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<ProgressEvent>("sidecar-progress", (event) => {
        const data = event.payload;

        if (!operation || data.operation === operation) {
          setProgress({
            operation: data.operation,
            percent: data.percent,
            status: data.status,
            cancellable: data.cancellable ?? false,
          });

          if (data.percent >= 100) {
            setTimeout(() => setProgress(null), 2000);
          }
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [operation]);

  return progress;
}
