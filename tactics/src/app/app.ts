import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { JuggerFieldComponent, ToastAction, ToastService, Toast } from '@juggertools/ui-angular';
import {
  DrawToolEvent,
  DrawToolId,
  DrawToolRegistry,
  SelectToolEventData,
} from '@juggertools/tools-draw';
import type { PointerContext, CanvasEngine, RenderState } from '@juggertools/core-engine';
import {
  createSceneSnapshot,
  nowISO,
  Player,
  SceneSnapshot,
  Team,
} from '@juggertools/core-domain';
import { composeTacticsScreenshot } from '@juggertools/export-screenshot';

interface DragPayload {
  playerId: string;
  teamId: string;
}

interface PersistedSession {
  scene: SceneSnapshot;
  undoStack: SceneSnapshot[];
  redoStack: SceneSnapshot[];
  savedAt: string;
}

const HISTORY_CAPACITY = 30;
const DEFAULT_TOAST_DURATION_MS = 4000;
const STORAGE_KEY = 'juggertools:tactics:session';

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, JuggerFieldComponent],
})
export class App implements OnDestroy {
  private readonly toastService = inject(ToastService);

  readonly leftTeam: Team = {
    id: 'team-left',
    name: 'Red Ravens',
    color: '#f94144',
    players: [
      { id: 'left-1', name: 'Aileen Sparks', role: 'Runner', number: '7' },
      { id: 'left-2', name: 'Mika Storm', role: 'Chain', number: '3' },
      { id: 'left-3', name: 'Robin Vale', role: 'Brace', number: '5' },
      { id: 'left-4', name: 'Kai Ember', role: 'Quick', number: '12' },
      { id: 'left-5', name: 'Suri Onyx', role: 'Support', number: '9' },
      { id: 'left-6', name: 'Nova Blaze', role: 'Flex', number: '4' },
    ],
  };

  readonly rightTeam: Team = {
    id: 'team-right',
    name: 'Azure Titans',
    color: '#277da1',
    players: [
      { id: 'right-1', name: 'Luca Frost', role: 'Runner', number: '21' },
      { id: 'right-2', name: 'Ivy Quill', role: 'Chain', number: '11' },
      { id: 'right-3', name: 'Dax Flint', role: 'Brace', number: '8' },
      { id: 'right-4', name: 'Rowan Haze', role: 'Quick', number: '6' },
      { id: 'right-5', name: 'Vera Sol', role: 'Support', number: '14' },
      { id: 'right-6', name: 'Olen Tide', role: 'Flex', number: '2' },
    ],
  };

  private readonly sceneSnapshot = signal(
    createSceneSnapshot({
      id: 'scene-demo',
      field: {
        width: 80,
        height: 50,
        lines: [
          { kind: 'center', x1: 40, y1: 0, x2: 40, y2: 50 },
          { kind: 'zone', x1: 0, y1: 10, x2: 80, y2: 10 },
          { kind: 'zone', x1: 0, y1: 40, x2: 80, y2: 40 },
        ],
      },
      leftTeam: this.leftTeam,
      rightTeam: this.rightTeam,
    }),
  );

  private engine?: CanvasEngine;
  private layerDisposers: Array<() => void> = [];
  private readonly undoStack: SceneSnapshot[] = [];
  private readonly redoStack: SceneSnapshot[] = [];
  private pendingSession: PersistedSession | null = null;

  readonly historyCapacity = HISTORY_CAPACITY;
  readonly undoDepth = signal(0);
  readonly redoDepth = signal(0);
  readonly canUndo = computed(() => this.undoDepth() > 0);
  readonly canRedo = computed(() => this.redoDepth() > 0);
  readonly undoFill = computed(() => Math.min(1, this.undoDepth() / this.historyCapacity) * 100);
  readonly redoFill = computed(() => Math.min(1, this.redoDepth() / this.historyCapacity) * 100);

  readonly hoveredTokenId = signal<string | null>(null);
  readonly selectedTokenId = signal<string | null>(null);
  readonly isDraggingToken = signal<boolean>(false);

  readonly toast = this.toastService.toast;

  private readonly applySceneUpdate = (mutator: (scene: SceneSnapshot) => SceneSnapshot) => {
    this.sceneSnapshot.update((snapshot) => {
      const before = this.cloneSnapshot(snapshot);
      this.pushUndo(before);

      const next = mutator(snapshot);
      const withTimestamp: SceneSnapshot = {
        ...next,
        scene: {
          ...next.scene,
          lastUpdatedAt: nowISO(),
        },
      };
      return withTimestamp;
    });
    this.persistState();
  };

  private readonly toolRegistry = new DrawToolRegistry({
    onEvent: (event) => this.handleToolEvent(event),
    applySceneUpdate: this.applySceneUpdate,
  });

  readonly tools = this.toolRegistry.listTools();
  readonly selectedTool = signal<DrawToolId>(this.tools[0]?.id ?? 'select');
  readonly lastPointerEvent = signal<string | null>(null);

  readonly leftPlayers = computed(() => this.leftTeam.players);
  readonly rightPlayers = computed(() => this.rightTeam.players);
  readonly scene = computed(() => this.sceneSnapshot());

  constructor() {
    this.toolRegistry.setActiveTool(this.selectedTool());
    effect(() => {
      this.toolRegistry.updateScene(this.scene());
    });
    this.loadPersistedSession();
  }

  ngOnDestroy(): void {
    this.cleanupLayers();
    this.toolRegistry.attachEngine(undefined);
  }

  selectTool(toolId: DrawToolId): void {
    this.selectedTool.set(toolId);
    this.toolRegistry.setActiveTool(toolId);
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) {
      return;
    }
    this.undoDepth.set(this.undoStack.length);

    const current = this.cloneSnapshot(this.sceneSnapshot());
    this.redoStack.push(current);
    this.trimHistory(this.redoStack);
    this.sceneSnapshot.set(previous);
    this.redoDepth.set(this.redoStack.length);
    this.toolRegistry.updateScene(previous);
    this.isDraggingToken.set(false);
    this.hoveredTokenId.set(null);
    this.selectedTokenId.set(null);
    this.persistState();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) {
      return;
    }
    this.redoDepth.set(this.redoStack.length);

    const current = this.cloneSnapshot(this.sceneSnapshot());
    this.pushUndo(current);
    this.sceneSnapshot.set(next);
    this.toolRegistry.updateScene(next);
    this.persistState();
  }

  async exportScreenshot(): Promise<void> {
    try {
      const start = performance.now();
      const blob = await composeTacticsScreenshot({
        scene: this.sceneSnapshot(),
        leftTeam: this.leftTeam,
        rightTeam: this.rightTeam,
        width: 1600,
        height: 900,
      });
      const durationMs = performance.now() - start;
      const seconds = durationMs / 1000;
      const intent = durationMs <= 2000 ? 'success' : 'warning';
      const message = `PNG export in ${seconds.toFixed(2)}s${intent === 'success' ? ' ✅' : ' ⚠️ (>2s)'}`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jugger-tactics-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);

      this.toastService.show({ message, intent, durationMs: DEFAULT_TOAST_DURATION_MS });
    } catch (error) {
      console.error('Screenshot export failed', error);
      this.toastService.show({ message: 'Screenshot export fehlgeschlagen', intent: 'error', durationMs: DEFAULT_TOAST_DURATION_MS });
    }
  }

  handleEngineReady(engine: CanvasEngine): void {
    this.cleanupLayers();
    this.engine = engine;
    this.toolRegistry.attachEngine(engine);
    this.layerDisposers = [
      engine.registerLayerRenderer('background', (ctx, state) => this.renderField(ctx, state)),
      engine.registerLayerRenderer('drawings', (ctx, state) => this.renderDrawings(ctx, state)),
      engine.registerLayerRenderer('tokens', (ctx, state) => this.renderTokens(ctx, state)),
    ];
  }

  handlePointer(context: PointerContext): void {
    this.toolRegistry.handlePointer(context);
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDragStart(event: DragEvent, player: Player, team: Team): void {
    if (!event.dataTransfer) {
      return;
    }
    const payload: DragPayload = { playerId: player.id, teamId: team.id };
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
  }

  handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (!this.engine || !event.dataTransfer) {
      return;
    }
    const raw = event.dataTransfer.getData('application/json');
    if (!raw) {
      return;
    }
    let payload: DragPayload | undefined;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }
    if (!payload) {
      return;
    }

    const fieldPoint = this.engine.screenToField(event.clientX, event.clientY);
    let createdTokenId: string | undefined;

    this.applySceneUpdate((snapshot) => {
      const tokens = snapshot.scene.tokens.slice();
      const existingIndex = tokens.findIndex((token) => token.playerId === payload?.playerId);
      if (existingIndex >= 0) {
        tokens[existingIndex] = {
          ...tokens[existingIndex],
          x: fieldPoint.x,
          y: fieldPoint.y,
        };
        createdTokenId = tokens[existingIndex].id;
      } else {
        createdTokenId = this.createTokenId(payload.playerId);
        tokens.push({
          id: createdTokenId,
          teamId: payload.teamId,
          playerId: payload.playerId,
          x: fieldPoint.x,
          y: fieldPoint.y,
        });
      }

      return {
        ...snapshot,
        scene: {
          ...snapshot.scene,
          tokens,
        },
      };
    });

    if (createdTokenId) {
      this.selectedTokenId.set(createdTokenId);
      this.hoveredTokenId.set(createdTokenId);
      this.selectTool('select');
    }
  }

  playerTokenId(player: Player): string | undefined {
    return this.scene().scene.tokens.find((token) => token.playerId === player.id)?.id;
  }

  handleToolEvent(event: DrawToolEvent): void {
    const { fieldPoint, type } = event.context;
    const fragments = [event.toolId, type, `@ ${fieldPoint.x.toFixed(1)}, ${fieldPoint.y.toFixed(1)}`];

    if (event.toolId === 'select' && event.data) {
      this.consumeSelectEvent(event.data as SelectToolEventData);
      fragments.push(`· ${(event.data as SelectToolEventData).kind}`);
    }

    if (event.toolId !== 'select' && event.data) {
      fragments.push(`· ${(event.data as { kind?: string }).kind ?? ''}`);
    }

    this.lastPointerEvent.set(fragments.join(' '));
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

  private consumeSelectEvent(event: SelectToolEventData): void {
    switch (event.kind) {
      case 'hover':
        this.hoveredTokenId.set(event.tokenId ?? null);
        break;
      case 'select':
        this.selectedTokenId.set(event.tokenId ?? null);
        break;
      case 'drag':
        this.isDraggingToken.set(true);
        this.selectedTokenId.set(event.tokenId);
        break;
      case 'release':
        this.isDraggingToken.set(false);
        break;
    }
  }

  private renderField(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const snapshot = state.scene;
    if (!snapshot) {
      return;
    }
    const { field } = snapshot.scene;
    ctx.save();
    ctx.fillStyle = '#061225';
    ctx.fillRect(0, 0, field.width, field.height);

    const gradient = ctx.createLinearGradient(0, 0, 0, field.height);
    gradient.addColorStop(0, 'rgba(24, 46, 84, 0.35)');
    gradient.addColorStop(0.5, 'rgba(15, 28, 52, 0.15)');
    gradient.addColorStop(1, 'rgba(24, 46, 84, 0.35)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, field.width, field.height);

    ctx.strokeStyle = '#123062';
    ctx.lineWidth = 0.35;
    field.lines?.forEach((line) => {
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.stroke();
    });

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath();
    ctx.arc(field.width / 2, field.height / 2, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private renderDrawings(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const snapshot = state.scene;
    if (!snapshot) {
      return;
    }
    snapshot.scene.drawings.forEach((drawing) => {
      if (drawing.kind === 'pen' && drawing.points.length > 1) {
        ctx.save();
        ctx.strokeStyle = drawing.stroke;
        ctx.lineWidth = drawing.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        drawing.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (drawing.kind === 'arrow') {
        ctx.save();
        ctx.strokeStyle = drawing.stroke;
        ctx.lineWidth = drawing.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(drawing.from.x, drawing.from.y);
        ctx.lineTo(drawing.to.x, drawing.to.y);
        ctx.stroke();
        this.drawArrowHead(ctx, drawing.from, drawing.to, drawing.width * 3.6);
        ctx.restore();
        return;
      }

      if (drawing.kind === 'cone') {
        ctx.save();
        ctx.fillStyle = drawing.fill;
        ctx.beginPath();
        ctx.arc(drawing.at.x, drawing.at.y, drawing.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }

  private renderTokens(ctx: CanvasRenderingContext2D, state: RenderState): void {
    const snapshot = state.scene;
    if (!snapshot) {
      return;
    }
    const hovered = this.hoveredTokenId();
    const selected = this.selectedTokenId();
    const isDragging = this.isDraggingToken();

    snapshot.scene.tokens.forEach((token) => {
      const teamColor = this.getTeamColor(token.teamId);
      ctx.save();
      ctx.shadowColor = 'rgba(8, 12, 24, 0.55)';
      ctx.shadowBlur = 2.6;
      ctx.fillStyle = teamColor ?? '#f8fafc';
      ctx.beginPath();
      ctx.arc(token.x, token.y, 2.2, 0, Math.PI * 2);
      ctx.fill();

      if (token.id === hovered || token.id === selected) {
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = token.id === selected ? 0.6 : 0.4;
        ctx.strokeStyle = token.id === selected ? '#facc15' : 'rgba(148, 163, 184, 0.75)';
        ctx.stroke();
      }

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#061225';
      ctx.font = '1.5px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.getTokenLabel(token.playerId), token.x, token.y);

      if (isDragging && token.id === selected) {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
        ctx.setLineDash([1.2, 1.2]);
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.arc(token.x, token.y, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  private drawArrowHead(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    size: number,
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.max(0.001, Math.hypot(to.x - from.x, to.y - from.y));
    const head = Math.min(length * 0.4, size);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle ?? '#facc15';
    ctx.fill();
  }

  private getTeamColor(teamId: string): string | undefined {
    if (teamId === this.leftTeam.id) {
      return this.leftTeam.color;
    }
    if (teamId === this.rightTeam.id) {
      return this.rightTeam.color;
    }
    return undefined;
  }

  private getTokenLabel(playerId: string | undefined): string {
    if (!playerId) {
      return '?';
    }
    const player = [...this.leftTeam.players, ...this.rightTeam.players].find((p) => p.id === playerId);
    return player?.number ?? player?.name.charAt(0) ?? '?';
  }

  private cleanupLayers(): void {
    this.layerDisposers.forEach((dispose) => dispose());
    this.layerDisposers = [];
  }

  private createTokenId(playerId: string): string {
    return `token-${playerId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private pushUndo(snapshot: SceneSnapshot): void {
    this.undoStack.push(snapshot);
    this.trimHistory(this.undoStack);
    this.undoDepth.set(this.undoStack.length);
    this.redoStack.length = 0;
    this.redoDepth.set(0);
  }

  private trimHistory(stack: SceneSnapshot[]): void {
    if (stack.length > this.historyCapacity) {
      stack.splice(0, stack.length - this.historyCapacity);
    }
  }

  private cloneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
    if (typeof structuredClone === 'function') {
      return structuredClone(snapshot);
    }
    return JSON.parse(JSON.stringify(snapshot)) as SceneSnapshot;
  }

  private persistState(): void {
    if (!this.supportsStorage()) {
      return;
    }
    try {
      const payload: PersistedSession = {
        scene: this.cloneSnapshot(this.sceneSnapshot()),
        undoStack: this.undoStack.map((snap) => this.cloneSnapshot(snap)),
        redoStack: this.redoStack.map((snap) => this.cloneSnapshot(snap)),
        savedAt: nowISO(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Persisting tactics session failed', error);
    }
  }

  private loadPersistedSession(): void {
    if (!this.supportsStorage()) {
      return;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedSession;
      if (!parsed || !parsed.scene) {
        return;
      }
      this.pendingSession = parsed;
      const date = new Date(parsed.savedAt);
      const label = Number.isNaN(date.getTime()) ? 'Letzte Session' : `Session vom ${date.toLocaleString()}`;
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
    } catch (error) {
      console.warn('Failed to parse persisted tactics session', error);
      this.discardPersistedSession();
    }
  }

  private restorePersistedSession(): void {
    if (!this.pendingSession) {
      return;
    }
    const session = this.pendingSession;
    this.pendingSession = null;
    this.sceneSnapshot.set(session.scene);
    this.undoStack.splice(0, this.undoStack.length, ...session.undoStack.map((snap) => this.cloneSnapshot(snap)));
    this.redoStack.splice(0, this.redoStack.length, ...session.redoStack.map((snap) => this.cloneSnapshot(snap)));
    this.undoDepth.set(this.undoStack.length);
    this.redoDepth.set(this.redoStack.length);
    this.toolRegistry.updateScene(session.scene);
    this.persistState();
    this.toastService.show({ message: 'Session wiederhergestellt ✅', intent: 'success', durationMs: DEFAULT_TOAST_DURATION_MS });
  }

  private discardPersistedSession(): void {
    this.pendingSession = null;
    if (this.supportsStorage()) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private supportsStorage(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (key === 'y') {
      event.preventDefault();
      this.redo();
    }
  }
}
