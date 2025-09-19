import { Injectable, computed, signal } from '@angular/core';
import type { Toast, ToastOptions } from './toast.types';

let toastSequence = 0;
const nextToastId = () => `toast-${Date.now()}-${toastSequence++}`;

function toToast(options: ToastOptions): Toast {
  const intent = options.intent ?? 'info';
  const durationMs =
    options.durationMs ?? (options.actions && options.actions.length > 0 ? 0 : 3000);
  const id = options.id ?? nextToastId();
  return {
    ...options,
    id,
    intent,
    durationMs,
  };
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly queue = signal<Toast[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeTimerToastId: string | null = null;

  readonly toast = computed(() => this.queue()[0] ?? null);

  show(options: ToastOptions): string {
    const toast = toToast(options);
    this.queue.update((current) => [...current, toast]);
    if (this.queue().length === 1) {
      this.startTimer(toast);
    }
    return toast.id;
  }

  dismiss(): void {
    const [current] = this.queue();
    if (current) {
      this.dismissById(current.id);
    }
  }

  dismissById(id: string): void {
    const queue = this.queue();
    const index = queue.findIndex((toast) => toast.id === id);
    if (index === -1) {
      return;
    }

    const nextQueue = [...queue];
    nextQueue.splice(index, 1);
    this.queue.set(nextQueue);

    if (this.activeTimerToastId === id) {
      this.stopTimer();
      const next = this.queue()[0];
      if (next) {
        this.startTimer(next);
      }
    }
  }

  pauseTimer(id: string): void {
    if (this.activeTimerToastId === id) {
      this.stopTimer();
      this.activeTimerToastId = id;
    }
  }
  resumeTimer(id: string, durationMs?: number): void {
    const queue = this.queue();
    const index = queue.findIndex((toast) => toast.id === id);
    if (index === -1) {
      return;
    }
    const toast = queue[index];
    const nextDuration = durationMs ?? toast.durationMs;
    const updated: Toast = { ...toast, durationMs: nextDuration };
    const nextQueue = [...queue];
    nextQueue[index] = updated;
    this.queue.set(nextQueue);
    if (index === 0) {
      this.startTimer(updated);
    }
  }


  clearAll(): void {
    this.stopTimer();
    this.activeTimerToastId = null;
    this.queue.set([]);
  }

  private startTimer(toast: Toast): void {
    if (toast.durationMs <= 0) {
      this.activeTimerToastId = toast.id;
      this.stopTimer();
      return;
    }
    this.stopTimer();
    this.activeTimerToastId = toast.id;
    this.timer = setTimeout(() => {
      if (this.activeTimerToastId === toast.id) {
        this.dismissById(toast.id);
      }
    }, toast.durationMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
