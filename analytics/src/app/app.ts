import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toast, ToastAction, ToastService } from '@juggertools/ui-angular';
import {
  createEmptyLineup,
  createGameRecord,
  createTurn,
  nowISO,
  GameRecord,
  PlayerRef,
  TeamRef,
} from '@juggertools/core-domain';
import type { AnalyticsSession } from './types/analytics-session';
import { ensureSessionIndexes } from './utils/session-index';
import { RecorderSessionStore } from './data/recorder-session.store';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class App implements OnDestroy {
  private readonly toastService = inject(ToastService);
  private readonly sessionStore = inject(RecorderSessionStore);

  private readonly state = signal<AnalyticsSession>(this.buildSession([]));
  private pendingSession: AnalyticsSession | null = null;

  readonly games = computed(() => this.state().games);
  readonly gameCount = computed(() => this.games().length);
  readonly lastSavedAt = computed(() => this.state().savedAt);
  readonly toast = this.toastService.toast;

  constructor() {
    void this.loadPersistedSession();
  }

  ngOnDestroy(): void {
    this.toastService.clearAll();
  }

  addSampleGame(): void {
    const leftTeam: TeamRef = { id: 'team-left', name: 'Red Ravens', color: '#f94144' };
    const rightTeam: TeamRef = { id: 'team-right', name: 'Azure Titans', color: '#277da1' };

    const leftPlayers: PlayerRef[] = [
      { id: 'left-1', teamId: leftTeam.id, name: 'Aileen Sparks', role: 'Runner', number: '7' },
      { id: 'left-2', teamId: leftTeam.id, name: 'Mika Storm', role: 'Chain', number: '3' },
      { id: 'left-3', teamId: leftTeam.id, name: 'Robin Vale', role: 'Brace', number: '5' },
      { id: 'left-4', teamId: leftTeam.id, name: 'Kai Ember', role: 'Quick', number: '12' },
      { id: 'left-5', teamId: leftTeam.id, name: 'Suri Onyx', role: 'Support', number: '9' },
    ];

    const rightPlayers: PlayerRef[] = [
      { id: 'right-1', teamId: rightTeam.id, name: 'Luca Frost', role: 'Runner', number: '21' },
      { id: 'right-2', teamId: rightTeam.id, name: 'Ivy Quill', role: 'Chain', number: '11' },
      { id: 'right-3', teamId: rightTeam.id, name: 'Dax Flint', role: 'Brace', number: '8' },
      { id: 'right-4', teamId: rightTeam.id, name: 'Rowan Haze', role: 'Quick', number: '6' },
      { id: 'right-5', teamId: rightTeam.id, name: 'Vera Sol', role: 'Support', number: '14' },
    ];

    const lineup = createEmptyLineup();
    lineup.left = leftPlayers.map((player) => ({ playerId: player.id }));
    lineup.right = rightPlayers.map((player) => ({ playerId: player.id }));

    const turn = createTurn({
      id: `turn-${Date.now()}`,
      index: 0,
      lineup,
      outcome: 'leftWin',
      notes: 'Sample opener',
    });

    const game = createGameRecord({
      id: `game-${Date.now()}`,
      left: leftTeam,
      right: rightTeam,
      players: [...leftPlayers, ...rightPlayers],
      turns: [turn],
      meta: { createdAt: nowISO(), version: '1.0.0' },
    });

    const nextGames = [game, ...this.state().games];
    this.commitSession(nextGames);
    this.toastService.show({ message: 'Spiel gespeichert ✅', intent: 'success' });
  }

  removeGame(game: GameRecord): void {
    const nextGames = this.state().games.filter((g) => g.id !== game.id);
    this.commitSession(nextGames);
  }

  clearAll(): void {
    this.commitSession([]);
    this.toastService.show({ message: 'Alle Daten gelöscht', intent: 'warning' });
  }

  onToastAction(toast: Toast, action: ToastAction): void {
    const shouldDismiss = action.dismissOnRun !== false;
    try {
      if (action.suppressTimer) {
        this.toastService.pauseTimer(toast.id);
      }
      action.run(toast);
    } finally {
      if (shouldDismiss) {
        this.toastService.dismissById(toast.id);
      } else if (action.resumeAfterMs !== undefined) {
        this.toastService.resumeTimer(toast.id, action.resumeAfterMs);
      }
    }
  }

  private async loadPersistedSession(): Promise<void> {
    const session = await this.sessionStore.load();
    if (!session) {
      return;
    }
    this.pendingSession = session;
    const savedDate = new Date(session.savedAt);
    const label = Number.isNaN(savedDate.getTime())
      ? 'Letzte Sitzung'
      : `Sitzung vom ${savedDate.toLocaleString()}`;
    this.toastService.show({
      message: `${label} wiederherstellen?`,
      intent: 'info',
      durationMs: 0,
      actions: [
        {
          label: 'Wiederherstellen',
          run: (_toast) => this.restorePersistedSession(),
        },
        {
          label: 'Verwerfen',
          run: (_toast) => this.discardPersistedSession(),
        },
        {
          label: 'Später',
          dismissOnRun: false,
          suppressTimer: true,
          resumeAfterMs: 10000,
          run: () => undefined,
        },
      ],
    });
  }

  private restorePersistedSession(): void {
    if (!this.pendingSession) {
      return;
    }
    const session = ensureSessionIndexes(this.pendingSession);
    this.pendingSession = null;
    this.state.set(session);
    void this.sessionStore.save(session);
    this.toastService.show({ message: 'Sitzung wiederhergestellt ✅', intent: 'success' });
  }

  private discardPersistedSession(): void {
    this.pendingSession = null;
    void this.sessionStore.clear();
    this.toastService.dismiss();
  }

  private commitSession(games: GameRecord[]): void {
    const session = this.buildSession(games);
    this.state.set(session);
    void this.sessionStore.save(session);
  }

  private buildSession(games: GameRecord[]): AnalyticsSession {
    return ensureSessionIndexes({
      games,
      savedAt: nowISO(),
      teamIndex: {},
      playerIndex: {},
    });
  }
}
