import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    service = new ToastService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    service.clearAll();
  });

  it('shows and auto-dismisses a toast', () => {
    const id = service.show({ message: 'Hello', durationMs: 1000, intent: 'success' });
    expect(service.toast()?.id).toBe(id);

    jest.advanceTimersByTime(1000);
    expect(service.toast()).toBeNull();
  });

  it('queues multiple toasts and handles sequential dismissal', () => {
    service.show({ message: 'First', durationMs: 500 });
    const secondId = service.show({ message: 'Second', durationMs: 500 });

    expect(service.toast()?.message).toBe('First');

    jest.advanceTimersByTime(500);
    expect(service.toast()?.message).toBe('Second');

    service.dismissById(secondId);
    expect(service.toast()).toBeNull();
  });

  it('persists toasts with actions until explicitly dismissed', () => {
    const id = service.show({
      message: 'Restore session',
      actions: [{ label: 'Ok', run: () => undefined } as any],
    });

    jest.advanceTimersByTime(5000);
    expect(service.toast()?.id).toBe(id);

    service.dismiss();
    expect(service.toast()).toBeNull();
  });

  it('allows timer suppression through pause and resume', () => {
    const id = service.show({ message: 'Timed', durationMs: 1000 });
    expect(service.toast()?.id).toBe(id);
    service.pauseTimer(id);
    jest.advanceTimersByTime(5000);
    expect(service.toast()?.id).toBe(id);
    service.resumeTimer(id, 500);
    jest.advanceTimersByTime(500);
    expect(service.toast()).toBeNull();
  });
});
