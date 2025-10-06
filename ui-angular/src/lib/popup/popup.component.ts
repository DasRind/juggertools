import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

@Component({
  selector: 'app-popup',
  standalone: true,
  templateUrl: './popup.component.html',
  styleUrls: ['./popup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PopupComponent {
  readonly show = model.required<boolean>({ alias: 'showPopup' });
  readonly donateImagePath = input.required<string>();

  close(): void {
    this.show.set(false);
  }

  dismissForever(): void {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('app-popup-dismissed', 'true');
      } catch (error) {
        console.warn('Popup preference could not be stored', error);
      }
    }
    this.show.set(false);
  }
}
