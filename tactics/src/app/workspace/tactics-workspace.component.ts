import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { JuggerFieldComponent } from '@juggertools/ui-angular';
import { TacticsStateService } from '../core/tactics-state.service';

@Component({
  selector: 'tactics-workspace',
  standalone: true,
  imports: [CommonModule, JuggerFieldComponent],
  templateUrl: './tactics-workspace.component.html',
  styleUrl: './tactics-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TacticsWorkspaceComponent {
  readonly state = inject(TacticsStateService);
}
