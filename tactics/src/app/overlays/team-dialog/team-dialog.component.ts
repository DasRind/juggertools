import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TacticsStateService } from '../../core/tactics-state.service';

@Component({
  selector: 'tactics-team-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './team-dialog.component.html',
  styleUrl: './team-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamDialogComponent {
  readonly state = inject(TacticsStateService);
}
