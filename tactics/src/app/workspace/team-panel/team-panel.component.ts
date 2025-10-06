import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { TeamSide } from '@juggertools/core-domain';
import { TacticsStateService } from '../../core/tactics-state.service';

@Component({
  selector: 'tactics-team-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './team-panel.component.html',
  styleUrl: './team-panel.component.scss',
})
export class TeamPanelComponent {
  @Input({ required: true }) side!: TeamSide;
  readonly state = inject(TacticsStateService);

  get panelId(): string {
    return `${this.side}-team-panel`;
  }

  teamConfig() {
    return this.side === 'left'
      ? this.state.leftTeamConfig()
      : this.state.rightTeamConfig();
  }

  teamDomain() {
    return this.side === 'left'
      ? this.state.leftTeam()
      : this.state.rightTeam();
  }

  teamNameDraft() {
    return this.state.teamNameDraft()[this.side];
  }

  draftPlayer() {
    return this.state.draftPlayers()[this.side];
  }

  players() {
    return this.side === 'left'
      ? this.state.leftPlayers()
      : this.state.rightPlayers();
  }

  isEditingName(): boolean {
    return this.state.editingTeamName() === this.side;
  }

  isPanelCollapsed(): boolean {
    return this.state.isTeamPanelCollapsed(this.side);
  }

  isEditingPlayer(playerId: string): boolean {
    const current = this.state.editingPlayer();
    return (
      !!current && current.side === this.side && current.playerId === playerId
    );
  }

  playerTokenId(player: { id: string }): string | null {
    return this.state.playerTokenId(player) ?? null;
  }
}
