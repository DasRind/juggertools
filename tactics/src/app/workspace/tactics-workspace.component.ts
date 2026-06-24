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

const MOBILE_MAX_WIDTH = 960;
const ROTATION_LOCK_MAX_WIDTH = 500;

@Component({
  selector: 'tactics-workspace',
  standalone: true,
  imports: [CommonModule, JuggerFieldComponent, PopupComponent],
  templateUrl: './tactics-workspace.component.html',
  styleUrls: ['./tactics-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.theme-dark]': 'state.isDarkMode()',
    '[class.theme-light]': '!state.isDarkMode()',
    '[class.layout-mobile]': 'isMobileLayout()',
    '[class.layout-desktop]': '!isMobileLayout()',
  },
})
export class TacticsWorkspaceComponent {
  readonly state = inject(TacticsStateService);
  readonly donateImagePath = signal('./donate.png');
  readonly showPopup = signal(false);
  readonly isMobileLayout = signal(false);
  readonly isRotationLocked = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private previousDesktopRotation = this.state.isFieldRotated();

  constructor() {
    this.setupDonationReminder();
    this.setupResponsiveLayout();
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

  private setupResponsiveLayout(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const handleViewportChange = () => {
      const width = window.innerWidth ?? MOBILE_MAX_WIDTH + 1;
      const height = window.innerHeight ?? MOBILE_MAX_WIDTH + 1;
      const orientationIsPortrait = height >= width;
      const shouldUseMobileLayout =
        width <= MOBILE_MAX_WIDTH ||
        (orientationIsPortrait && height <= MOBILE_MAX_WIDTH);
      const wasMobileLayout = this.isMobileLayout();
      const lockRotation = width <= ROTATION_LOCK_MAX_WIDTH;
      const wasRotationLocked = this.isRotationLocked();

      if (lockRotation !== wasRotationLocked) {
        this.isRotationLocked.set(lockRotation);
      }

      if (shouldUseMobileLayout && !wasMobileLayout) {
        this.previousDesktopRotation = this.state.isFieldRotated();
      }

      if (shouldUseMobileLayout) {
        if ((lockRotation || !wasMobileLayout) && !this.state.isFieldRotated()) {
          this.state.toggleFieldRotation();
        }
      } else if (wasMobileLayout) {
        if (this.state.isFieldRotated() !== this.previousDesktopRotation) {
          this.state.toggleFieldRotation();
        }
      }

      if (shouldUseMobileLayout !== wasMobileLayout) {
        this.isMobileLayout.set(shouldUseMobileLayout);
      }
    };

    handleViewportChange();

    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleViewportChange);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
    });
  }

  readonly toolIconMap: Record<string, string> = {
    select: 'assets/tools/selectToolTransparent.png',
    pen: 'assets/tools/penToolTransparent.png',
    eraser: 'assets/tools/deleteToolTransparent.png',
    line: 'assets/tools/lineToolTransparent.png',
    arrow: 'assets/tools/arrowToolTransparent.png',
    cone: 'assets/tools/areaToolTransparent.png',
  };

  readonly toolIconPath = (toolId: string): string =>
    this.toolIconMap[toolId] ?? this.toolIconMap['select'];
}
