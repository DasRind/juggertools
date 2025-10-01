import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TacticsStateService } from '../../core/tactics-state.service';

@Component({
  selector: 'tactics-pompfen-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pompfen-picker.component.html',
  styleUrl: './pompfen-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PompfenPickerComponent {
  readonly state = inject(TacticsStateService);
}
