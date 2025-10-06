import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { JuggerFieldComponent, PopupComponent } from '@juggertools/ui-angular';
import { TacticsStateService } from '../core/tactics-state.service';

@Component({
  selector: 'tactics-workspace',
  standalone: true,
  imports: [CommonModule, JuggerFieldComponent, PopupComponent],
  templateUrl: './tactics-workspace.component.html',
  styleUrls: ['./tactics-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TacticsWorkspaceComponent {
  readonly state = inject(TacticsStateService);
  readonly donateImagePath = signal('./donate.png');
  readonly showPopup = signal(false);

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
