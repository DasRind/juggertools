import {
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PopupComponent } from '@juggertools/ui-angular';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, PopupComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('randomizerJuggerLineup');
  protected readonly donateImagePath = signal('./donate.png');
  protected readonly showPopup = signal(false);

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.setupDonationReminder();
  }

  private setupDonationReminder(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const reminderIntervalMs = 15 * 60 * 1000;
    const intervalId = window.setInterval(() => {
      if (!this.isPopupSuppressed()) {
        this.showPopup.set(true);
      }
    }, reminderIntervalMs);

    this.destroyRef.onDestroy(() => window.clearInterval(intervalId));
  }

  private isPopupSuppressed(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return window.localStorage.getItem('app-popup-dismissed') === 'true';
    } catch (error) {
      console.warn('Popup preference unavailable', error);
      return false;
    }
  }
}
