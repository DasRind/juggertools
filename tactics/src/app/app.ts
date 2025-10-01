import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  inject,
} from '@angular/core';
import { SiteHeaderComponent } from './layout/site-header/site-header.component';
import { TacticsWorkspaceComponent } from './workspace/tactics-workspace.component';
import { TeamDialogComponent } from './overlays/team-dialog/team-dialog.component';
import { PompfenPickerComponent } from './overlays/pompfen-picker/pompfen-picker.component';
import { ToastHostComponent } from './overlays/toast-host/toast-host.component';
import { TacticsStateService } from './core/tactics-state.service';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'app-shell',
    '[class.theme-dark]': 'state.isDarkMode()',
  },
  imports: [
    SiteHeaderComponent,
    TacticsWorkspaceComponent,
    TeamDialogComponent,
    PompfenPickerComponent,
    ToastHostComponent,
  ],
})
export class App implements OnDestroy {
  readonly state = inject(TacticsStateService);

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    this.state.handleKeyboard(event);
  }

  ngOnDestroy(): void {
    this.state.destroy();
  }
}
