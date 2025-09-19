export type ToastIntent = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  id?: string;
  message: string;
  intent?: ToastIntent;
  durationMs?: number;
  actions?: ToastAction[];
}

export interface Toast extends ToastOptions {
  id: string;
  intent: ToastIntent;
  durationMs: number;
}

export interface ToastAction {
  label: string;
  run: (toast: Toast) => void;
  dismissOnRun?: boolean;
  suppressTimer?: boolean;
  resumeAfterMs?: number;
}
