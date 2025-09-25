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
import {
  JuggerFieldComponent,
  ToastAction,
  ToastService,
  Toast,
} from '@juggertools/ui-angular';
import {
  DrawToolEvent,
  DrawToolId,
  DrawToolRegistry,
  SelectToolEventData,
  SelectTarget,
  LineToolEventData,
  LINE_HANDLE_RADIUS,
  getLineEndpoints,
} from '@juggertools/tools-draw';
import type {
  PointerContext,
  CanvasEngine,
  EngineViewport,
  RenderState,
} from '@juggertools/core-engine';
import {
  createSceneSnapshot,
  nowISO,
  Player,
  LineDrawing,
  ImageDrawing,
  ArrowDrawing,
  ConeDrawing,
  Drawing,
  SceneSnapshot,
  Team,
  Token,
} from '@juggertools/core-domain';
import {
  DEFAULT_FIELD_DIMENSIONS,
  JUGGER_FIELD_LAYOUT,
  buildFieldLinesFromLayout,
  FieldLayoutDefinition,
  FieldLayoutLineElement,
  FIELD_UNIT_WIDTH,
  FIELD_UNIT_HEIGHT,
} from './field-layout';
import { composeTacticsScreenshot } from '@juggertools/export-screenshot';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - gif-encoder-2 ships without TypeScript types
import GIFEncoder from 'gif-encoder-2';

try {
  Function(
    'if (typeof remaining === "undefined") { remaining = 0; }' +
      'if (typeof curPixel === "undefined") { curPixel = 0; }' +
      'if (typeof n_bits === "undefined") { n_bits = 0; }'
  )();
} catch {
  /* no-op */
}

const globalBuffer = globalThis as Record<string, unknown>;
if (typeof globalBuffer['Buffer'] === 'undefined') {
  globalBuffer['Buffer'] = {
    from(input: ArrayBufferLike | ArrayLike<number> | string) {
      if (typeof input === 'string') {
        return new TextEncoder().encode(input);
      }
      if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
      }
      if (ArrayBuffer.isView(input)) {
        const view = input as ArrayBufferView;
        return new Uint8Array(
          view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
        );
      }
      if (
        Array.isArray(input) ||
        typeof (input as { length?: number }).length === 'number'
      ) {
        return Uint8Array.from(Array.from(input as ArrayLike<number>));
      }
      throw new Error('Unsupported Buffer.from input in browser shim');
    },
  } as unknown as typeof Buffer;
}

interface SceneDeckEntry {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  snapshot: SceneSnapshot;
  previewDataUrl: string | null;
}

interface SceneHistoryState {
  undo: SceneSnapshot[];
  redo: SceneSnapshot[];
}

interface LegacyPersistedSession {
  scene: SceneSnapshot;
  fieldLayout: FieldLayoutDefinition;
  undoStack: SceneSnapshot[];
  redoStack: SceneSnapshot[];
  savedAt: string;
  isFieldFlipped?: boolean;
  isFieldRotated?: boolean;
}

type AnimationFormatId = 'webm' | 'mp4' | 'gif';

interface AnimationFormatOption {
  id: AnimationFormatId;
  label: string;
  extension: string;
  mimeCandidates: readonly string[];
  transparentHint?: string;
}

interface AnimationTimingOption {
  id: 'fast' | 'medium' | 'slow';
  label: string;
  durationMs: number;
}

interface AnimationExportProgress {
  phase: 'render' | 'encode';
  current: number;
  total: number;
  message: string;
}

interface SilentAudioTrackHandle {
  track: MediaStreamTrack;
  dispose: () => Promise<void> | void;
}

interface DragPayload {
  playerId: string;
  teamId: string;
}

interface PersistedSession {
  scenes: SceneDeckEntry[];
  activeSceneId: string;
  fieldLayout: FieldLayoutDefinition;
  history: Record<string, SceneHistoryState>;
  savedAt: string;
  isFieldFlipped?: boolean;
  isFieldRotated?: boolean;
}

const HISTORY_CAPACITY = 30;
const DEFAULT_TOAST_DURATION_MS = 4000;
const STORAGE_KEY = 'juggertools:tactics:session';
const VISUAL_SCALE = 5.4;
const TOKEN_RADIUS = 3.4 * VISUAL_SCALE;
const SELECTION_OUTLINE_EXTRA = 1.0 * VISUAL_SCALE;
const SELECTED_OUTLINE_COLOR = 'rgba(248, 208, 208, 1)';
const HOVER_OUTLINE_COLOR = 'rgba(215, 186, 186, 0.8)';
const JUGG_ID = 'jugg-token';
const JUGG_TEAM_ID = 'neutral-jugg';
const DEFAULT_JUGG_COLOR = '#facc15';
const DEFAULT_JUGG_STROKE = '#111827';
const JUGG_WIDTH = 3.2 * VISUAL_SCALE;
const JUGG_HEIGHT = 7.2 * VISUAL_SCALE;
const JUGG_CORNER_RATIO = 0.28;
const FIELD_SURFACE_COLOR = '#2ac88bff';
const DEFAULT_FIELD_LINE_COLOR = '#f8fafc';
const DEFAULT_FIELD_BOUNDARY_COLOR = '#000000';
const DEFAULT_FIELD_LINE_ALPHA = 0.55;
const EXPORT_PADDING = 0;
const EXPORT_DEVICE_PIXEL_RATIO = 1;
const SCENE_PREVIEW_WIDTH = 220;
const SCENE_PREVIEW_HEIGHT = 124;
const SCENE_PREVIEW_DEBOUNCE_MS = 180;
const SCENE_ANIMATION_FRAME_DURATION_MS = 1200;
const SCENE_ANIMATION_PRE_START_DELAY_MS = 160;
const SCENE_ANIMATION_FRAME_RATE = 30;
const THEME_STORAGE_KEY = 'juggertools:tactics:theme';

function cloneFieldLayout(
  layout: FieldLayoutDefinition
): FieldLayoutDefinition {
  return {
    dimensions: { ...layout.dimensions },
    elements: layout.elements.map((element) => {
      if (element.kind === 'line') {
        return {
          ...element,
          dash: element.dash ? [...element.dash] : undefined,
          points: element.points.map((point) => ({ ...point })),
        };
      }
      return {
        ...element,
        dash: element.dash ? [...element.dash] : undefined,
        center: { ...element.center },
      };
    }),
  };
}

interface SelectedStatus {
  type: 'token' | 'drawing';
  label: string;
  color: string | null;
  supportsColor: boolean;
  palette: readonly string[];
  drawingKind?: Drawing['kind'];
}

interface ToolStatus {
  kind: 'pen' | 'arrow' | 'eraser';
  label: string;
  color?: string;
  palette?: readonly string[];
  sizes?: ReadonlyArray<{ id: string; label: string; radius: number }>;
  selectedSize?: string;
}

interface ExportResolutionOption {
  id: string;
  label: string;
  width: number;
  height: number;
}

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    class: 'app-shell',
    '[class.theme-dark]': 'isDarkMode()',
  },
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
        width: DEFAULT_FIELD_DIMENSIONS.width,
        height: DEFAULT_FIELD_DIMENSIONS.height,
        lines: buildFieldLinesFromLayout(JUGGER_FIELD_LAYOUT),
      },
      leftTeam: this.leftTeam,
      rightTeam: this.rightTeam,
    })
  );

  private readonly sceneDeck = signal<SceneDeckEntry[]>([
    this.createSceneDeckEntry(this.sceneSnapshot(), {
      label: 'Szene 1',
    }),
  ]);

  private readonly activeSceneId = signal<string>(
    this.sceneSnapshot().scene.id
  );

  private engine?: CanvasEngine;
  private readonly imageCache = new Map<
    string,
    { src: string; image: HTMLImageElement }
  >();
  private layerDisposers: Array<() => void> = [];
  private readonly sceneHistories = new Map<string, SceneHistoryState>([
    [this.sceneSnapshot().scene.id, { undo: [], redo: [] }],
  ]);
  private readonly pendingPreviewTimers = new Map<string, number>();
  private sceneLabelCounter = 1;
  private isHistoryBatchActive = false;
  private pendingHistorySnapshot: SceneSnapshot | null = null;
  private pendingHistoryDirty = false;
  private hasDeferredPersist = false;
  private lastSelectionKey: string | null = null;
  private pendingSession: PersistedSession | null = null;
  readonly historyCapacity = HISTORY_CAPACITY;
  readonly undoDepth = signal(0);
  readonly redoDepth = signal(0);
  readonly canUndo = computed(() => this.undoDepth() > 0);
  readonly canRedo = computed(() => this.redoDepth() > 0);
  readonly undoFill = computed(
    () => Math.min(1, this.undoDepth() / this.historyCapacity) * 100
  );
  readonly redoFill = computed(
    () => Math.min(1, this.redoDepth() / this.historyCapacity) * 100
  );

  readonly scenes = computed(() => this.sceneDeck());
  readonly activeSceneIdValue = computed(() => this.activeSceneId());
  readonly canExportAnimation = computed(() => this.sceneDeck().length > 0);
  readonly isDarkMode = signal(this.readInitialTheme());
  readonly themeToggleLabel = computed(() =>
    this.isDarkMode() ? 'Helles Design' : 'Dunkles Design'
  );

  private readonly syncThemeEffect = effect(() => {
    const dark = this.isDarkMode();
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('theme-dark', dark);
      document.documentElement.classList.toggle('theme-light', !dark);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
      } catch {
        /* ignore persistence issues */
      }
    }
  });
  readonly animationFormats: readonly AnimationFormatOption[] = [
    {
      id: 'webm',
      label: 'WebM (VP9)',
      extension: 'webm',
      mimeCandidates: [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ],
      transparentHint:
        'Transparenz wird mit VP9 unterstützt, Browser-Support variiert.',
    },
    {
      id: 'mp4',
      label: 'MP4 (H.264)',
      extension: 'mp4',
      mimeCandidates: [
        'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
        'video/mp4;codecs="avc1.4d401f,mp4a.40.2"',
        'video/mp4',
      ],
      transparentHint:
        'MP4 unterstützt keine Transparenz – Hintergrund wird opak. Export nutzt Baseline H.264, AAC und 30 FPS.',
    },
    {
      id: 'gif',
      label: 'GIF',
      extension: 'gif',
      mimeCandidates: ['image/gif'],
      transparentHint:
        'GIF erlaubt nur 1-bit Transparenz; feine Alpha-Effekte gehen verloren.',
    },
  ] as const;
  readonly selectedAnimationFormat =
    signal<AnimationFormatOption['id']>('webm');
  readonly animationDurations: readonly AnimationTimingOption[] = [
    { id: 'fast', label: '0,5 Sekunden', durationMs: 500 },
    { id: 'medium', label: '1,0 Sekunde', durationMs: 1000 },
    { id: 'slow', label: '2,0 Sekunden', durationMs: 2000 },
  ] as const;
  readonly selectedAnimationDuration =
    signal<AnimationTimingOption['id']>('medium');
  readonly isAnimationExporting = signal(false);
  readonly animationProgress = signal<AnimationExportProgress | null>(null);

  readonly penColors = [
    '#f8fafc',
    '#ef4444',
    '#f97316',
    '#facc15',
    '#22c55e',
    '#38bdf8',
    '#6366f1',
    '#a855f7',
  ];
  readonly selectedPenColor = signal<string>(this.penColors[1]);

  readonly arrowColors = [
    '#facc15',
    '#f97316',
    '#fb7185',
    '#38bdf8',
    '#6366f1',
    '#22c55e',
    '#f8fafc',
    '#1f2937',
  ];
  readonly selectedArrowColor = signal<string>(this.arrowColors[0]);

  readonly juggColors = [
    '#facc15',
    '#fcd34d',
    '#fef08a',
    '#fde68a',
    '#fbbf24',
    '#eab308',
    '#f97316',
    '#a16207',
    '#0ea5e9',
    '#10b981',
  ] as const;

  readonly exportResolutions: readonly ExportResolutionOption[] = [
    { id: 'sd', label: 'SD (1280×720)', width: 1280, height: 720 },
    { id: 'hd', label: 'HD (1600×900)', width: 1600, height: 900 },
    { id: 'wqhd', label: 'WQHD (2560×1440)', width: 2560, height: 1440 },
    { id: '4k', label: '4K (3840×2160)', width: 3840, height: 2160 },
  ] as const;

  readonly selectedExportResolution = signal(
    this.exportResolutions[1]?.id ?? 'hd'
  );

  readonly eraserSizes = [
    { id: 'small', label: 'Fein', radius: 2.6 * VISUAL_SCALE },
    { id: 'medium', label: 'Mittel', radius: 3.6 * VISUAL_SCALE },
    { id: 'large', label: 'Groß', radius: 5.2 * VISUAL_SCALE },
  ] as const;
  readonly selectedEraserSize =
    signal<(typeof this.eraserSizes)[number]['id']>('medium');

  readonly fieldSurfaceColor = signal<string>(FIELD_SURFACE_COLOR);
  readonly fieldLineColor = signal<string>(DEFAULT_FIELD_LINE_COLOR);
  readonly fieldBoundaryColor = signal<string>(DEFAULT_FIELD_BOUNDARY_COLOR);
  readonly showFieldSettings = signal<boolean>(false);

  readonly hoveredTarget = signal<SelectTarget | null>(null);
  readonly selectedTarget = signal<SelectTarget | null>(null);
  readonly activeDrawingHandle = signal<{
    drawingId: string;
    handle: 'start' | 'end';
  } | null>(null);
  readonly isDraggingToken = signal<boolean>(false);
  readonly isDraggingDrawing = signal<boolean>(false);

  readonly hoveredTokenId = computed(() => {
    const target = this.hoveredTarget();
    return target?.type === 'token' ? target.id : null;
  });

  readonly selectedTokenId = computed(() => {
    const target = this.selectedTarget();
    return target?.type === 'token' ? target.id : null;
  });

  readonly selectedDrawingId = computed(() => {
    const target = this.selectedTarget();
    return target?.type === 'drawing' ? target.id : null;
  });

  readonly hoveredDrawingId = computed(() => {
    const target = this.hoveredTarget();
    return target?.type === 'drawing' ? target.id : null;
  });

  readonly hoveredLineHandle = computed(() => {
    const target = this.hoveredTarget();
    return target?.type === 'drawing' && target.handle ? target : null;
  });

  readonly activeLineHandle = computed(() => this.activeDrawingHandle());

  readonly toast = this.toastService.toast;

  private readonly applySceneUpdate = (
    mutator: (scene: SceneSnapshot) => SceneSnapshot
  ) => {
    this.sceneSnapshot.update((snapshot) => {
      const before = this.cloneSnapshot(snapshot);
      this.recordHistorySnapshot(before);

      const next = mutator(snapshot);
      const withTimestamp: SceneSnapshot = {
        ...next,
        scene: {
          ...next.scene,
          lastUpdatedAt: nowISO(),
        },
      };
      this.engine?.setScene(withTimestamp);
      return withTimestamp;
    });
    this.markHistoryPersistNeeded();
  };

  private syncSceneToEngine(engine: CanvasEngine): void {
    this.handleViewportChange(engine.getViewport());
  }

  private beginHistoryBatch(): void {
    if (this.isHistoryBatchActive) {
      this.commitHistoryBatch();
    }
    this.isHistoryBatchActive = true;
    this.pendingHistorySnapshot = null;
    this.pendingHistoryDirty = false;
    this.hasDeferredPersist = false;
  }

  private commitHistoryBatch(): void {
    if (!this.isHistoryBatchActive) {
      return;
    }
    this.isHistoryBatchActive = false;
    if (this.pendingHistoryDirty && this.pendingHistorySnapshot) {
      this.pushUndo(this.pendingHistorySnapshot);
      this.persistState();
    } else if (this.hasDeferredPersist) {
      this.persistState();
    }
    this.pendingHistorySnapshot = null;
    this.pendingHistoryDirty = false;
    this.hasDeferredPersist = false;
  }

  private recordHistorySnapshot(snapshot: SceneSnapshot): void {
    if (this.isHistoryBatchActive) {
      if (!this.pendingHistorySnapshot) {
        this.pendingHistorySnapshot = snapshot;
      }
      this.pendingHistoryDirty = true;
      return;
    }
    this.pushUndo(snapshot);
  }

  private markHistoryPersistNeeded(): void {
    if (this.isHistoryBatchActive) {
      this.hasDeferredPersist = true;
      return;
    }
    this.persistState();
  }

  private readonly toolRegistry = new DrawToolRegistry({
    onEvent: (event) => this.handleToolEvent(event),
    applySceneUpdate: this.applySceneUpdate,
  });

  private readonly syncSceneDeckEffect = effect(() => {
    const activeId = this.activeSceneId();
    const snapshot = this.sceneSnapshot();
    this.sceneDeck.update((entries) => {
      const index = entries.findIndex((entry) => entry.id === activeId);
      if (index < 0) {
        return entries;
      }
      const nextEntries = entries.slice();
      nextEntries[index] = {
        ...entries[index],
        snapshot: this.cloneSnapshot(snapshot),
        updatedAt: snapshot.scene.lastUpdatedAt ?? nowISO(),
      };
      return nextEntries;
    });
    this.scheduleScenePreview(activeId, snapshot);
  });

  readonly tools = this.toolRegistry.listTools();
  readonly toolShortcuts = this.tools.map((tool, index) => ({
    ...tool,
    shortcut: `${index + 1}`,
  }));
  readonly selectedTool = signal<DrawToolId>(this.tools[0]?.id ?? 'select');
  readonly fieldLayout = signal<FieldLayoutDefinition>(
    cloneFieldLayout(JUGGER_FIELD_LAYOUT)
  );
  readonly isFieldFlipped = signal(false);
  readonly isFieldRotated = signal(false);
  readonly fieldAspectRatio = computed(() => {
    const snapshot = this.scene();
    const orientation = snapshot.scene.orientation ?? 'landscape';
    let width =
      orientation === 'portrait'
        ? snapshot.scene.field.height
        : snapshot.scene.field.width;
    let height =
      orientation === 'portrait'
        ? snapshot.scene.field.width
        : snapshot.scene.field.height;

    if (!Number.isFinite(width) || width <= 0) {
      width = 40;
    }
    if (!Number.isFinite(height) || height <= 0) {
      height = 20;
    }

    if (this.isFieldRotated()) {
      const nextWidth = height;
      height = width;
      width = nextWidth;
    }

    return `${width} / ${height}`;
  });
  readonly lastPointerEvent = signal<string | null>(null);
  readonly eraserPreview = signal<{ x: number; y: number } | null>(null);
  readonly colorMenuContext = signal<
    { kind: 'selection' } | { kind: 'tool'; tool: 'pen' | 'arrow' } | null
  >(null);

  readonly leftPlayers = computed(() => this.leftTeam.players);
  readonly rightPlayers = computed(() => this.rightTeam.players);
  readonly scene = computed(() => this.sceneSnapshot());
  readonly selectedToken = computed(() => {
    const id = this.selectedTokenId();
    if (!id) {
      return null;
    }
    return this.scene().scene.tokens.find((token) => token.id === id) ?? null;
  });
  readonly selectedDrawing = computed(() => {
    const id = this.selectedDrawingId();
    if (!id) {
      return null;
    }
    return (
      this.scene().scene.drawings.find((drawing) => drawing.id === id) ?? null
    );
  });
  readonly hasJugg = computed(() =>
    this.scene().scene.tokens.some((token) => token.id === JUGG_ID)
  );
  readonly selectedStatus = computed(() => this.computeSelectedStatus());
  readonly toolStatus = computed<ToolStatus | null>(() => {
    const tool = this.selectedTool();
    if (tool === 'pen') {
      return {
        kind: 'pen',
        label: 'Stift',
        color: this.selectedPenColor(),
        palette: this.penColors,
      };
    }
    if (tool === 'arrow') {
      return {
        kind: 'arrow',
        label: 'Pfeil',
        color: this.selectedArrowColor(),
        palette: this.arrowColors,
      };
    }
    if (tool === 'eraser') {
      return {
        kind: 'eraser',
        label: 'Radierer',
        sizes: this.eraserSizes,
        selectedSize: this.selectedEraserSize(),
      };
    }
    return null;
  });
  readonly isSelectionColorMenuOpen = computed(
    () => this.colorMenuContext()?.kind === 'selection'
  );
  readonly openToolColorMenu = computed<('pen' | 'arrow') | null>(() => {
    const ctx = this.colorMenuContext();
    return ctx?.kind === 'tool' ? ctx.tool : null;
  });
  readonly showPlayerNames = signal(true);
  readonly showStartingPositions = signal(true);
  readonly playerNameToggleLabel = computed(() =>
    this.showPlayerNames() ? 'Eingeblendet' : 'Ausgeblendet'
  );
  readonly startingPositionsToggleLabel = computed(() =>
    this.showStartingPositions() ? 'An' : 'Aus'
  );

  constructor() {
    this.toolRegistry.setActiveTool(this.selectedTool());
    this.applyPenConfiguration();
    this.applyArrowConfiguration();
    this.applyEraserConfiguration();
    effect(() => {
      this.toolRegistry.updateScene(this.scene());
    });
    effect(() => {
      const normalized = this.normalizeTarget(this.selectedTarget());
      const context = this.colorMenuContext();
      const key = normalized
        ? `${normalized.type}:${normalized.id ?? ''}`
        : null;
      if (context?.kind === 'selection' && key !== this.lastSelectionKey) {
        this.colorMenuContext.set(null);
      }
      this.lastSelectionKey = key;
    });
    effect(() => {
      const tool = this.selectedTool();
      const context = this.colorMenuContext();
      if (context?.kind === 'tool' && context.tool !== tool) {
        this.colorMenuContext.set(null);
      }
    });
    effect(() => {
      // Track hovered target / tool changes to keep cursor in sync.
      this.hoveredTarget();
      this.selectedTool();
      queueMicrotask(() => this.updateCanvasCursor());
    });
    this.loadPersistedSession();
  }

  ngOnDestroy(): void {
    this.cleanupLayers();
    this.toolRegistry.attachEngine(undefined);
    if (typeof window !== 'undefined') {
      this.pendingPreviewTimers.forEach((handle) =>
        window.clearTimeout(handle)
      );
    }
    this.pendingPreviewTimers.clear();
  }

  selectTool(toolId: DrawToolId): void {
    this.selectedTool.set(toolId);
    this.toolRegistry.setActiveTool(toolId);
    if (toolId === 'pen') {
      this.applyPenConfiguration();
    }
    if (toolId === 'arrow') {
      this.applyArrowConfiguration();
    }
    if (toolId === 'eraser') {
      this.applyEraserConfiguration();
    }
    if (toolId !== 'eraser' && this.eraserPreview()) {
      this.eraserPreview.set(null);
      this.engine?.draw();
    }
    this.updateCanvasCursor();
  }

  selectPenColor(color: string): void {
    this.selectedPenColor.set(color);
    this.applyPenConfiguration();
  }

  selectArrowColor(color: string): void {
    this.selectedArrowColor.set(color);
    this.applyArrowConfiguration();
    if (this.selectedTool() === 'arrow') {
      this.engine?.draw();
    }
  }

  addScene(): void {
    const source = this.cloneSnapshot(this.sceneSnapshot());
    const newId = this.createSceneId();
    const timestamp = nowISO();
    source.scene = {
      ...source.scene,
      id: newId,
      lastUpdatedAt: timestamp,
    };
    const label = this.nextSceneLabel();
    const entry = this.createSceneDeckEntry(source, {
      idOverride: newId,
      label,
    });
    this.sceneDeck.update((entries) => [...entries, entry]);
    this.sceneHistories.set(newId, { undo: [], redo: [] });
    this.activeSceneId.set(newId);
    this.sceneSnapshot.set(source);
    this.toolRegistry.updateScene(source);
    this.engine?.setScene(source);
    this.undoDepth.set(0);
    this.redoDepth.set(0);
    this.hoveredTarget.set(null);
    this.selectedTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.colorMenuContext.set(null);
    this.scheduleScenePreview(newId, source);
    this.persistState();
  }

  activateScene(sceneId: string): void {
    if (sceneId === this.activeSceneId()) {
      return;
    }
    const entry = this.sceneDeck().find(
      (candidate) => candidate.id === sceneId
    );
    if (!entry) {
      return;
    }
    this.activeSceneId.set(sceneId);
    const snapshot = this.cloneSnapshot(entry.snapshot);
    this.sceneSnapshot.set(snapshot);
    this.toolRegistry.updateScene(snapshot);
    this.engine?.setScene(snapshot);
    const history = this.getActiveHistory();
    this.undoDepth.set(history.undo.length);
    this.redoDepth.set(history.redo.length);
    this.hoveredTarget.set(null);
    this.selectedTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.colorMenuContext.set(null);
    if (!entry.previewDataUrl) {
      this.scheduleScenePreview(sceneId, snapshot);
    }
    this.persistState();
  }

  trackScene(_index: number, entry: SceneDeckEntry): string {
    return entry.id;
  }

  selectEraserSize(sizeId: string): void {
    const option = this.eraserSizes.find(({ id }) => id === sizeId);
    if (!option) {
      return;
    }
    this.selectedEraserSize.set(option.id);
    this.applyEraserConfiguration();
    if (this.selectedTool() === 'eraser') {
      this.engine?.draw();
    }
  }

  toggleColorMenu(context: 'selection' | 'pen' | 'arrow'): void {
    const current = this.colorMenuContext();
    if (context === 'selection') {
      const status = this.selectedStatus();
      if (!status?.supportsColor) {
        return;
      }
      this.colorMenuContext.set(
        current?.kind === 'selection' ? null : { kind: 'selection' }
      );
      return;
    }
    const tool = context;
    if (current?.kind === 'tool' && current.tool === tool) {
      this.colorMenuContext.set(null);
      return;
    }
    this.colorMenuContext.set({ kind: 'tool', tool });
  }

  applySelectedColor(color: string): void {
    this.updateSelectedColor(color);
  }

  applyToolColor(tool: 'pen' | 'arrow', color: string): void {
    const normalized = this.normalizeColor(color);
    if (!normalized) {
      return;
    }
    if (tool === 'pen') {
      if (this.colorsEqual(this.selectedPenColor(), normalized)) {
        return;
      }
      this.selectedPenColor.set(normalized);
      this.applyPenConfiguration();
    } else {
      if (this.colorsEqual(this.selectedArrowColor(), normalized)) {
        return;
      }
      this.selectedArrowColor.set(normalized);
      this.applyArrowConfiguration();
    }

    const drawing = this.selectedDrawing();
    if (drawing && drawing.kind === tool) {
      this.updateSelectedColor(normalized);
    }

    if (this.selectedTool() === tool) {
      this.engine?.draw();
    }
  }

  applyCustomColor(event: Event, context: 'selection' | 'pen' | 'arrow'): void {
    const input = event.target as HTMLInputElement | null;
    const value = input?.value;
    if (!value) {
      return;
    }
    if (context === 'selection') {
      this.applySelectedColor(value);
    } else {
      this.applyToolColor(context, value);
    }
  }

  deleteSelectedElement(): void {
    const rawTarget = this.selectedTarget();
    if (!rawTarget) {
      return;
    }
    const target = this.normalizeTarget(rawTarget);
    if (!target) {
      return;
    }
    const snapshot = this.scene();
    if (target.type === 'token') {
      const exists = snapshot.scene.tokens.some(
        (token) => token.id === target.id
      );
      if (!exists) {
        return;
      }
      this.applySceneUpdate((state) => ({
        ...state,
        scene: {
          ...state.scene,
          tokens: state.scene.tokens.filter((token) => token.id !== target.id),
        },
      }));
    } else {
      const exists = snapshot.scene.drawings.some(
        (drawing) => drawing.id === target.id
      );
      if (!exists) {
        return;
      }
      this.applySceneUpdate((state) => ({
        ...state,
        scene: {
          ...state.scene,
          drawings: state.scene.drawings.filter(
            (drawing) => drawing.id !== target.id
          ),
        },
      }));
    }
    this.selectedTarget.set(null);
    this.hoveredTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.colorMenuContext.set(null);
    this.engine?.draw();
  }

  triggerImportJson(input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  importJson(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = reader.result;
        if (typeof raw !== 'string') {
          throw new Error('Ungültige Datei');
        }
        const payload = JSON.parse(raw) as {
          scene?: SceneSnapshot;
          fieldLayout?: FieldLayoutDefinition;
          selectedTool?: DrawToolId;
          isFieldFlipped?: boolean;
          isFieldRotated?: boolean;
        };
        if (!payload || typeof payload !== 'object' || !payload.scene) {
          throw new Error('Ungültiges JSON');
        }

        const importedScene = this.cloneSnapshot(payload.scene);
        this.sceneSnapshot.set(importedScene);
        this.toolRegistry.updateScene(importedScene);

        const nextLayout = payload.fieldLayout
          ? cloneFieldLayout(payload.fieldLayout)
          : this.fieldLayout();
        this.applyFieldLayout(nextLayout, {
          rebuildLines: Boolean(payload.fieldLayout),
        });

        if (payload.selectedTool) {
          this.selectTool(payload.selectedTool);
        }

        if (typeof payload.isFieldFlipped === 'boolean') {
          this.isFieldFlipped.set(payload.isFieldFlipped);
        } else {
          this.isFieldFlipped.set(false);
        }

        if (typeof payload.isFieldRotated === 'boolean') {
          this.isFieldRotated.set(payload.isFieldRotated);
        } else {
          this.isFieldRotated.set(false);
        }

        this.hoveredTarget.set(null);
        this.selectedTarget.set(null);
        this.activeDrawingHandle.set(null);
        this.isDraggingToken.set(false);
        this.isDraggingDrawing.set(false);
        this.colorMenuContext.set(null);
        this.resetHistoryForScene(this.activeSceneId());
        this.persistState();
        this.toastService.show({
          message: 'JSON importiert ✅',
          intent: 'success',
          durationMs: DEFAULT_TOAST_DURATION_MS,
        });
      } catch (error) {
        console.error('JSON import failed', error);
        this.toastService.show({
          message: 'JSON Import fehlgeschlagen',
          intent: 'error',
          durationMs: DEFAULT_TOAST_DURATION_MS,
        });
      } finally {
        if (input) {
          input.value = '';
        }
      }
    };
    reader.readAsText(file);
  }

  private applyPenConfiguration(): void {
    this.toolRegistry.configureTool('pen', { color: this.selectedPenColor() });
  }

  private applyArrowConfiguration(): void {
    this.toolRegistry.configureTool('arrow', {
      color: this.selectedArrowColor(),
    });
  }

  private applyEraserConfiguration(): void {
    this.toolRegistry.configureTool('eraser', {
      radius: this.getEraserRadius(this.selectedEraserSize()),
    });
  }

  private getEraserRadius(
    sizeId: (typeof this.eraserSizes)[number]['id']
  ): number {
    return (
      this.eraserSizes.find((option) => option.id === sizeId)?.radius ?? 3.6
    );
  }

  undo(): void {
    this.commitHistoryBatch();
    const history = this.getActiveHistory();
    const previous = history.undo.pop();
    if (!previous) {
      return;
    }
    this.undoDepth.set(history.undo.length);

    const current = this.cloneSnapshot(this.sceneSnapshot());
    history.redo.push(current);
    this.trimHistory(history.redo);
    this.sceneSnapshot.set(previous);
    this.redoDepth.set(history.redo.length);
    this.toolRegistry.updateScene(previous);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.hoveredTarget.set(null);
    this.selectedTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.persistState();
  }

  redo(): void {
    this.commitHistoryBatch();
    const history = this.getActiveHistory();
    const next = history.redo.pop();
    if (!next) {
      return;
    }
    this.redoDepth.set(history.redo.length);

    const current = this.cloneSnapshot(this.sceneSnapshot());
    this.pushUndo(current, { resetRedo: false });
    this.sceneSnapshot.set(next);
    this.toolRegistry.updateScene(next);
    this.hoveredTarget.set(null);
    this.selectedTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.persistState();
  }

  togglePlayerNames(): void {
    this.showPlayerNames.update((value) => !value);
    this.engine?.draw();
  }

  toggleStartingPositions(): void {
    this.showStartingPositions.update((value) => !value);
    this.engine?.draw();
  }

  toggleFieldSettings(): void {
    this.showFieldSettings.update((value) => !value);
  }

  toggleTheme(): void {
    this.isDarkMode.update((value) => !value);
  }

  updateFieldSurfaceColor(color: string): void {
    const normalized = this.normalizeColor(color);
    if (!normalized) {
      return;
    }
    this.fieldSurfaceColor.set(normalized);
    this.engine?.draw();
  }

  updateFieldLineColor(color: string): void {
    const normalized = this.normalizeColor(color);
    if (!normalized) {
      return;
    }
    this.fieldLineColor.set(normalized);
    this.engine?.draw();
  }

  updateFieldBoundaryColor(color: string): void {
    const normalized = this.normalizeColor(color);
    if (!normalized) {
      return;
    }
    this.fieldBoundaryColor.set(normalized);
    this.engine?.draw();
  }

  toggleFieldFlip(): void {
    this.isFieldFlipped.update((value) => !value);
  }

  toggleFieldRotation(): void {
    this.isFieldRotated.update((value) => !value);
  }

  setExportResolution(optionId: string): void {
    if (optionId === this.selectedExportResolution()) {
      return;
    }
    const option = this.exportResolutions.find(
      (entry) => entry.id === optionId
    );
    if (!option) {
      return;
    }
    this.selectedExportResolution.set(option.id);
  }

  setAnimationFormat(formatId: string): void {
    if (formatId === this.selectedAnimationFormat()) {
      return;
    }
    const option = this.animationFormats.find(
      (candidate) => candidate.id === formatId
    );
    if (!option) {
      return;
    }
    this.selectedAnimationFormat.set(option.id);
  }

  setAnimationDuration(durationId: string): void {
    if (durationId === this.selectedAnimationDuration()) {
      return;
    }
    const option = this.animationDurations.find(
      (candidate) => candidate.id === durationId
    );
    if (!option) {
      return;
    }
    this.selectedAnimationDuration.set(option.id);
  }

  spawnJugg(): void {
    this.applySceneUpdate((state) => {
      const field = state.scene.field;
      const centerX = field.width / 2;
      const centerY = field.height / 2;
      const tokens = state.scene.tokens;
      const existingIndex = tokens.findIndex((token) => token.id === JUGG_ID);
      if (existingIndex >= 0) {
        const nextTokens = tokens.map((token, index): Token => {
          if (index !== existingIndex) {
            return token;
          }
          return {
            ...token,
            teamId: JUGG_TEAM_ID,
            shape: 'rectangle' as const,
            width: JUGG_WIDTH,
            height: JUGG_HEIGHT,
            color: token.color ?? DEFAULT_JUGG_COLOR,
            x: centerX,
            y: centerY,
          };
        });
        return {
          ...state,
          scene: {
            ...state.scene,
            tokens: nextTokens,
          },
        };
      }
      const created = {
        id: JUGG_ID,
        teamId: JUGG_TEAM_ID,
        x: centerX,
        y: centerY,
        color: DEFAULT_JUGG_COLOR,
        shape: 'rectangle' as const,
        width: JUGG_WIDTH,
        height: JUGG_HEIGHT,
        label: 'Jugg',
      } satisfies Token;
      return {
        ...state,
        scene: {
          ...state.scene,
          tokens: [...state.scene.tokens, created],
        },
      };
    });

    this.selectTool('select');
    this.selectedTarget.set({ type: 'token', id: JUGG_ID });
    this.engine?.draw();
  }

  private async composeSceneBlob(
    scene: SceneSnapshot,
    resolution: ExportResolutionOption
  ): Promise<{ blob: Blob; width: number; height: number }> {
    const snapshot = this.cloneSnapshot(scene);
    const layout = cloneFieldLayout(this.fieldLayout());
    const surfaceColor = this.fieldSurfaceColor();
    const lineStrokeColor = this.resolveLineStrokeColor();
    const boundaryColor = this.fieldBoundaryColor();
    const boundaryElement = layout.elements.find(
      (element): element is FieldLayoutLineElement =>
        element.kind === 'line' && Boolean(element.closePath)
    );
    const boundaryWidth = boundaryElement?.strokeWidth ?? 6;

    layout.elements = layout.elements.map((element) => {
      if (element.kind === 'line') {
        const stroke = element.closePath ? boundaryColor : lineStrokeColor;
        return { ...element, stroke };
      }
      if (element.kind === 'circle') {
        return { ...element, stroke: lineStrokeColor };
      }
      return element;
    });

    const rotated = this.isFieldRotated();
    const orientation = snapshot.scene.orientation ?? 'landscape';
    let fieldWidth =
      orientation === 'portrait'
        ? snapshot.scene.field.height
        : snapshot.scene.field.width;
    let fieldHeight =
      orientation === 'portrait'
        ? snapshot.scene.field.width
        : snapshot.scene.field.height;
    if (rotated) {
      const nextWidth = fieldHeight;
      fieldHeight = fieldWidth;
      fieldWidth = nextWidth;
    }

    const aspect = fieldWidth / fieldHeight;
    const maxWidth = rotated ? resolution.height : resolution.width;
    const maxHeight = rotated ? resolution.width : resolution.height;

    let exportWidth = Math.round(maxWidth);
    let exportHeight = Math.round(exportWidth / aspect);
    if (exportHeight > maxHeight) {
      exportHeight = Math.round(maxHeight);
      exportWidth = Math.round(exportHeight * aspect);
    }

    const blob = await composeTacticsScreenshot({
      scene: snapshot,
      width: exportWidth,
      height: exportHeight,
      padding: EXPORT_PADDING,
      background: 'transparent',
      devicePixelRatio: EXPORT_DEVICE_PIXEL_RATIO,
      fieldLayout: layout,
      fieldStyle: {
        background: { kind: 'solid', color: surfaceColor },
        surfaceColor,
        lineColor: lineStrokeColor,
        boundary: {
          stroke: boundaryColor,
          width: boundaryWidth,
        },
      },
      fieldLayoutIsNormalized: true,
      includeTeamPanels: false,
      rotateQuarterTurn: rotated,
    });

    return { blob, width: exportWidth, height: exportHeight };
  }

  private resolveSupportedMimeType(
    candidates: readonly string[]
  ): string | null {
    if (!candidates.length) {
      return null;
    }
    if (typeof MediaRecorder === 'undefined') {
      return null;
    }
    if (typeof MediaRecorder.isTypeSupported !== 'function') {
      return candidates[0] ?? null;
    }
    return (
      candidates.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate)
      ) ?? null
    );
  }

  private async exportAnimationViaMediaRecorder(params: {
    option: AnimationFormatOption;
    mimeType: string;
    scenes: SceneDeckEntry[];
    frameDuration: number;
    includeSilentAudio?: boolean;
  }): Promise<void> {
    const {
      option,
      mimeType,
      scenes,
      frameDuration,
      includeSilentAudio = false,
    } = params;
    const resolution = this.resolveExportResolution(
      this.selectedExportResolution()
    );

    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    canvas.style.top = '-9999px';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      canvas.remove();
      this.toastService.show({
        message: 'Canvas Kontext nicht verfügbar',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
      return;
    }

    const cleanupCanvas = () => {
      canvas.remove();
    };

    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let recorderStopped: Promise<void> | null = null;
    const chunks: Blob[] = [];
    let audioHandle: SilentAudioTrackHandle | null = null;

    let renderedScenes: Array<{ bitmap: ImageBitmap }> = [];
    let canvasDims: { width: number; height: number } | null = null;
    try {
      for (let index = 0; index < scenes.length; index += 1) {
        const render = await this.composeSceneBlob(
          scenes[index].snapshot,
          resolution
        );
        if (!canvasDims) {
          canvasDims = { width: render.width, height: render.height };
        }
        const bitmap = await createImageBitmap(render.blob);
        renderedScenes.push({ bitmap });
        this.animationProgress.set({
          phase: 'render',
          current: index + 1,
          total: scenes.length,
          message: `Szene ${index + 1} vorbereitet`,
        });
      }

      if (!canvasDims || renderedScenes.length === 0) {
        throw new Error('Keine Szenen zum Export vorhanden');
      }

      canvas.width = canvasDims.width;
      canvas.height = canvasDims.height;
      const frameIntervalMs = 1000 / SCENE_ANIMATION_FRAME_RATE;

      stream = canvas.captureStream(SCENE_ANIMATION_FRAME_RATE);
      const canvasTrack = stream.getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame?: () => void;
      };
      if (includeSilentAudio) {
        audioHandle = this.createSilentAudioTrack();
        if (audioHandle?.track) {
          stream.addTrack(audioHandle.track);
        }
      }
      const recorderOptions: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond: 4_000_000,
        audioBitsPerSecond: includeSilentAudio ? 128_000 : undefined,
      };
      recorder = new MediaRecorder(stream, recorderOptions);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorderStopped = new Promise<void>((resolve, reject) => {
        recorder!.onstop = () => resolve();
        recorder!.onerror = (event: Event & { error?: unknown }) => {
          const error = event.error;
          reject(error instanceof Error ? error : new Error('Recorder Fehler'));
        };
      });

      recorder.start();
      await this.delay(SCENE_ANIMATION_PRE_START_DELAY_MS);
      const framesForScene = (duration: number) =>
        Math.max(
          1,
          Math.round(Math.max(duration, frameIntervalMs) / frameIntervalMs)
        );

      for (let index = 0; index < renderedScenes.length; index += 1) {
        const sceneFrame = renderedScenes[index];
        this.animationProgress.set({
          phase: 'render',
          current: index + 1,
          total: scenes.length,
          message: `Szene ${index + 1} bereit`,
        });

        const durationForScene = frameDuration;
        const frameCount = framesForScene(durationForScene);
        let elapsedMs = 0;
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(sceneFrame.bitmap, 0, 0, canvas.width, canvas.height);
          if (canvasTrack?.requestFrame) {
            try {
              canvasTrack.requestFrame();
            } catch {
              /* ignore */
            }
          }

          const targetElapsed = Math.min(
            durationForScene,
            Math.round((frameIndex + 1) * frameIntervalMs)
          );
          const waitMs = Math.max(1, targetElapsed - elapsedMs);
          elapsedMs = targetElapsed;
          await this.delay(waitMs);
        }

        this.animationProgress.set({
          phase: 'render',
          current: index + 1,
          total: scenes.length,
          message: `Szene ${index + 1} abgeschlossen`,
        });
      }

      recorder.stop();
      await recorderStopped;

      if (!chunks.length) {
        throw new Error('Keine Videodaten erstellt');
      }

      this.animationProgress.set({
        phase: 'encode',
        current: scenes.length,
        total: scenes.length,
        message: 'Video finalisieren …',
      });

      const animationBlob = new Blob(chunks, { type: mimeType });
      this.triggerDownload(
        animationBlob,
        `${this.buildExportBasename(option)}.${option.extension}`
      );

      const baseMessage = `Animation exportiert (${option.label}) ✅`;
      const message = option.transparentHint ? `${baseMessage}` : baseMessage;
      this.toastService.show({
        message,
        intent: 'success',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    } catch (error) {
      console.error('Animation export failed', error);
      this.toastService.show({
        message: 'Animation Export fehlgeschlagen',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    } finally {
      if (recorder && recorder.state === 'recording') {
        try {
          recorder.stop();
          if (recorderStopped) {
            await recorderStopped.catch(() => undefined);
          }
        } catch (stopError) {
          console.warn('Recorder konnte nicht gestoppt werden', stopError);
        }
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioHandle) {
        try {
          stream?.removeTrack(audioHandle.track);
        } catch {
          /* ignore */
        }
        await audioHandle.dispose();
      }
      cleanupCanvas();
      renderedScenes.forEach((frame) => frame.bitmap.close());
      renderedScenes = [];
    }

    return;
  }

  private async exportAnimationAsGif(params: {
    option: AnimationFormatOption;
    scenes: SceneDeckEntry[];
    frameDuration: number;
  }): Promise<void> {
    const { option, scenes, frameDuration } = params;
    const resolution = this.resolveExportResolution(
      this.selectedExportResolution()
    );

    const renderedFrames: Array<{
      imageData: ImageData;
    }> = [];
    let targetWidth = 0;
    let targetHeight = 0;

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const render = await this.composeSceneBlob(scene.snapshot, resolution);
      targetWidth = render.width;
      targetHeight = render.height;
      const imageData = await this.blobToImageData(
        render.blob,
        render.width,
        render.height
      );
      renderedFrames.push({ imageData });
      this.animationProgress.set({
        phase: 'render',
        current: index + 1,
        total: scenes.length,
        message: `Szene ${index + 1} vorbereitet`,
      });
    }

    this.animationProgress.set({
      phase: 'encode',
      current: 0,
      total: scenes.length,
      message: 'GIF encodieren …',
    });

    // GIFEncoder constructor signature: (width, height, algorithm?, useTypedArray?)
    const encoder = new (GIFEncoder as any)(
      targetWidth,
      targetHeight,
      'neuquant',
      true
    );
    encoder.start();
    if (typeof encoder.setRepeat === 'function') {
      encoder.setRepeat(0);
    }
    if (typeof encoder.setDelay === 'function') {
      encoder.setDelay(frameDuration);
    }
    if (typeof encoder.setTransparent === 'function') {
      encoder.setTransparent(0x00000000);
    }
    if (typeof encoder.setQuality === 'function') {
      encoder.setQuality(10);
    }

    renderedFrames.forEach((frame, index) => {
      encoder.addFrame(frame.imageData.data);
      this.animationProgress.set({
        phase: 'encode',
        current: index + 1,
        total: renderedFrames.length,
        message: `Frame ${index + 1} von ${renderedFrames.length}`,
      });
    });
    encoder.finish();

    const rawData =
      encoder.out && typeof encoder.out.getData === 'function'
        ? encoder.out.getData()
        : null;
    const buffer: Uint8Array = rawData
      ? rawData instanceof Uint8Array
        ? rawData
        : new Uint8Array(Array.from(rawData as ArrayLike<number>))
      : new Uint8Array();
    if (!buffer.length) {
      throw new Error('GIF Encoding lieferte keine Daten');
    }

    const blob = new Blob([buffer as unknown as BlobPart], {
      type: option.mimeCandidates[0] ?? 'image/gif',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jugger-tactics-animation-${Date.now()}.${
      option.extension
    }`;
    link.click();
    URL.revokeObjectURL(url);

    const baseMessage = `Animation exportiert (${option.label}) ✅`;
    const message = option.transparentHint
      ? `${baseMessage}\n${option.transparentHint}`
      : baseMessage;
    this.toastService.show({
      message,
      intent: 'success',
      durationMs: DEFAULT_TOAST_DURATION_MS,
    });
  }

  async exportScreenshot(): Promise<void> {
    try {
      const resolution = this.resolveExportResolution(
        this.selectedExportResolution()
      );
      const { blob } = await this.composeSceneBlob(
        this.sceneSnapshot(),
        resolution
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jugger-tactics-${resolution.id}-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);

      this.toastService.show({
        message: `PNG exportiert (${resolution.label}) ✅`,
        intent: 'success',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    } catch (error) {
      console.error('Screenshot export failed', error);
      this.toastService.show({
        message: 'Screenshot export fehlgeschlagen',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    }
  }

  async exportAnimation(): Promise<void> {
    if (this.isAnimationExporting()) {
      return;
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      this.toastService.show({
        message: 'Animation Export ist nur im Browser verfügbar',
        intent: 'warning',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
      return;
    }

    const scenes = [...this.sceneDeck()];
    if (scenes.length === 0) {
      this.toastService.show({
        message: 'Keine Szenen zum Export vorhanden',
        intent: 'warning',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      this.toastService.show({
        message: 'Animation Export wird von diesem Browser nicht unterstützt',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
      return;
    }

    const option = this.animationFormats.find(
      (candidate) => candidate.id === this.selectedAnimationFormat()
    );
    if (!option) {
      this.toastService.show({
        message: 'Unbekanntes Zielformat',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
      return;
    }

    const frameDuration = this.resolveAnimationFrameDuration();

    this.isAnimationExporting.set(true);
    this.animationProgress.set({
      phase: 'render',
      current: 0,
      total: scenes.length,
      message: 'Szenen vorbereiten …',
    });

    try {
      if (option.id === 'gif') {
        await this.exportAnimationAsGif({ option, scenes, frameDuration });
      } else {
        const mimeType = this.resolveSupportedMimeType(option.mimeCandidates);
        if (!mimeType) {
          this.toastService.show({
            message: `${option.label} wird von diesem Browser nicht unterstützt`,
            intent: 'error',
            durationMs: DEFAULT_TOAST_DURATION_MS,
          });
          return;
        }
        await this.exportAnimationViaMediaRecorder({
          option,
          mimeType,
          scenes,
          frameDuration,
          includeSilentAudio: option.id === 'mp4',
        });
      }
    } finally {
      this.isAnimationExporting.set(false);
      this.animationProgress.set(null);
    }
  }

  private resolveAnimationFrameDuration(): number {
    const option = this.animationDurations.find(
      (candidate) => candidate.id === this.selectedAnimationDuration()
    );
    return option?.durationMs ?? SCENE_ANIMATION_FRAME_DURATION_MS;
  }

  private async blobToImageData(
    blob: Blob,
    width: number,
    height: number
  ): Promise<ImageData> {
    const bitmap = await createImageBitmap(blob);
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) {
          throw new Error('OffscreenCanvas Kontext nicht verfügbar');
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        throw new Error('Canvas Kontext nicht verfügbar');
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      return ctx.getImageData(0, 0, width, height);
    } finally {
      bitmap.close();
    }
  }

  exportJson(): void {
    try {
      const scene = this.cloneSnapshot(this.sceneSnapshot());
      const payload = {
        exportedAt: nowISO(),
        scene,
        fieldLayout: cloneFieldLayout(this.fieldLayout()),
        selectedTool: this.selectedTool(),
        isFieldFlipped: this.isFieldFlipped(),
        isFieldRotated: this.isFieldRotated(),
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `jugger-tactics-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);

      this.toastService.show({
        message: 'JSON exportiert ✅',
        intent: 'success',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    } catch (error) {
      console.error('JSON export failed', error);
      this.toastService.show({
        message: 'JSON Export fehlgeschlagen',
        intent: 'error',
        durationMs: DEFAULT_TOAST_DURATION_MS,
      });
    }
  }

  handleEngineReady(engine: CanvasEngine): void {
    this.cleanupLayers();
    this.engine = engine;
    this.toolRegistry.attachEngine(engine);
    this.syncSceneToEngine(engine);
    this.layerDisposers = [
      engine.registerLayerRenderer('background', (ctx, state) =>
        this.renderFieldBackground(ctx, state)
      ),
      engine.registerLayerRenderer('drawings', (ctx, state) =>
        this.renderDrawings(ctx, state)
      ),
      engine.registerLayerRenderer('tokens', (ctx, state) =>
        this.renderTokens(ctx, state)
      ),
      engine.registerLayerRenderer('overlay', (ctx, state) =>
        this.renderOverlay(ctx, state)
      ),
    ];
    engine.draw();
    this.updateCanvasCursor();
  }

  handleViewportChange(_viewport: EngineViewport): void {
    if (!this.engine) {
      return;
    }
    this.engine.draw();
    this.updateCanvasCursor();
  }

  handlePointer(context: PointerContext): void {
    const currentTool = this.selectedTool();
    if (currentTool === 'eraser') {
      if (context.type === 'move' || context.type === 'down') {
        this.eraserPreview.set({
          x: context.fieldPoint.x,
          y: context.fieldPoint.y,
        });
        this.engine?.draw();
      } else if (context.type === 'cancel') {
        this.eraserPreview.set(null);
        this.engine?.draw();
      }
    } else if (this.eraserPreview()) {
      this.eraserPreview.set(null);
      this.engine?.draw();
    }

    if (context.type === 'down') {
      this.beginHistoryBatch();
    }
    this.toolRegistry.handlePointer(context);
    if (
      currentTool === 'eraser' &&
      (context.type === 'up' || context.type === 'cancel')
    ) {
      this.eraserPreview.set({
        x: context.fieldPoint.x,
        y: context.fieldPoint.y,
      });
      this.engine?.draw();
    }
    if (context.type === 'up' || context.type === 'cancel') {
      this.commitHistoryBatch();
    }
    this.updateCanvasCursor();
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
    if (!event.dataTransfer) {
      return;
    }

    if (this.handleImageFileDrop(event)) {
      return;
    }
    if (!this.engine) {
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
      const existingIndex = tokens.findIndex(
        (token) => token.playerId === payload?.playerId
      );
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
      const target: SelectTarget = { type: 'token', id: createdTokenId };
      this.selectedTarget.set(target);
      this.hoveredTarget.set(target);
      this.selectTool('select');
    }
  }

  private handleImageFileDrop(event: DragEvent): boolean {
    if (!this.engine || !event.dataTransfer) {
      return false;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    const imageFile = files.find((file) => file.type.startsWith('image/'));
    if (!imageFile) {
      return false;
    }

    const clientPoint = { x: event.clientX, y: event.clientY };
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        this.insertImageDrawing(result, clientPoint);
      }
    };
    reader.readAsDataURL(imageFile);
    return true;
  }

  private insertImageDrawing(
    src: string,
    clientPoint: { x: number; y: number }
  ): void {
    if (!this.engine) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      const fieldPoint = this.engine?.screenToField(
        clientPoint.x,
        clientPoint.y
      );
      if (!fieldPoint) {
        return;
      }
      const field = this.scene().scene.field;
      const { width, height } = this.computeImageDimensions(
        image.naturalWidth,
        image.naturalHeight,
        field.width,
        field.height
      );
      const x = this.clamp(
        fieldPoint.x - width / 2,
        0,
        Math.max(0, field.width - width)
      );
      const y = this.clamp(
        fieldPoint.y - height / 2,
        0,
        Math.max(0, field.height - height)
      );
      const drawingId = this.createDrawingId('image');
      const timestamp = nowISO();
      const drawing: ImageDrawing = {
        id: drawingId,
        kind: 'image',
        x,
        y,
        width,
        height,
        src,
        opacity: 1,
        meta: { createdAt: timestamp, updatedAt: timestamp },
      };

      this.imageCache.set(drawingId, { src, image });
      this.applySceneUpdate((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: [...snapshot.scene.drawings, drawing],
        },
      }));
      const target: SelectTarget = { type: 'drawing', id: drawingId };
      this.selectedTarget.set(target);
      this.hoveredTarget.set(target);
      this.selectTool('select');
      this.engine?.draw();
    };
    image.onerror = () => {
      console.warn('Dropped image could not be loaded.');
    };
    image.src = src;
  }

  playerTokenId(player: Player): string | undefined {
    return this.scene().scene.tokens.find(
      (token) => token.playerId === player.id
    )?.id;
  }

  handleToolEvent(event: DrawToolEvent): void {
    const { fieldPoint, type } = event.context;
    const fragments = [
      event.toolId,
      type,
      `@ ${fieldPoint.x.toFixed(1)}, ${fieldPoint.y.toFixed(1)}`,
    ];

    const dataKind = (event.data as { kind?: string } | undefined)?.kind;

    if (dataKind === 'select' && event.data) {
      const selectData = event.data as SelectToolEventData;
      this.consumeSelectEvent(selectData);
      fragments.push('· Auswahl');
      if (selectData.target) {
        fragments.push(`· ${this.describeTarget(selectData.target)}`);
      }
    } else if (event.toolId === 'select' && event.data) {
      const data = event.data as SelectToolEventData;
      this.consumeSelectEvent(data);
      fragments.push(`· ${data.kind}`);
      if (data.target) {
        fragments.push(`· ${this.describeTarget(data.target)}`);
      }
    } else if (event.toolId === 'line' && event.data) {
      const data = event.data as LineToolEventData;
      fragments.push(`· ${data.kind}`);
      if (data.kind === 'line-end') {
        const target: SelectTarget = { type: 'drawing', id: data.drawingId };
        this.selectedTarget.set(target);
        this.hoveredTarget.set(null);
        this.isDraggingDrawing.set(false);
        this.activeDrawingHandle.set(null);
        this.bringDrawingToFront(data.drawingId);
      }
    } else if (event.data) {
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
    const target = event.target ?? null;
    switch (event.kind) {
      case 'hover':
        this.hoveredTarget.set(target);
        break;
      case 'select': {
        const normalized = this.normalizeTarget(target);
        this.selectedTarget.set(normalized);
        this.hoveredTarget.set(target ?? null);
        if (!normalized) {
          this.isDraggingToken.set(false);
          this.isDraggingDrawing.set(false);
          this.activeDrawingHandle.set(null);
        }
        if (normalized?.type === 'drawing') {
          this.bringDrawingToFront(normalized.id);
        } else if (normalized?.type === 'token') {
          this.bringTokenToFront(normalized.id);
        }
        break;
      }
      case 'drag': {
        this.hoveredTarget.set(target);
        if (target?.type === 'token') {
          this.isDraggingToken.set(true);
          this.isDraggingDrawing.set(false);
          this.activeDrawingHandle.set(null);
        } else if (target?.type === 'drawing') {
          this.isDraggingToken.set(false);
          this.isDraggingDrawing.set(true);
          this.activeDrawingHandle.set(
            target.handle
              ? { drawingId: target.id, handle: target.handle }
              : null
          );
        }
        break;
      }
      case 'release':
        if (target?.type === 'token') {
          this.isDraggingToken.set(false);
        }
        if (target?.type === 'drawing') {
          this.isDraggingDrawing.set(false);
          this.activeDrawingHandle.set(null);
        }
        break;
    }
    this.engine?.draw();
  }

  private computeSelectedStatus(): SelectedStatus | null {
    const rawTarget = this.selectedTarget();
    if (!rawTarget) {
      return null;
    }
    const target = this.normalizeTarget(rawTarget);
    if (!target) {
      return null;
    }
    const snapshot = this.scene();
    if (target.type === 'token') {
      const token = snapshot.scene.tokens.find(
        (entry) => entry.id === target.id
      );
      if (!token) {
        return null;
      }
      const isJugg = token.id === JUGG_ID || token.shape === 'rectangle';
      const color = this.getTokenFillColor(token);
      if (isJugg) {
        return {
          type: 'token',
          label: 'Jugg',
          color,
          supportsColor: true,
          palette: this.juggColors,
        };
      }
      const player = [...this.leftTeam.players, ...this.rightTeam.players].find(
        (p) => p.id === token.playerId
      );
      const label = player
        ? `${player.name}${player.number ? ` #${player.number}` : ''}`
        : `Token ${token.id}`;
      return {
        type: 'token',
        label,
        color,
        supportsColor: false,
        palette: [],
      };
    }

    const drawing = snapshot.scene.drawings.find(
      (entry) => entry.id === target.id
    );
    if (!drawing) {
      return null;
    }

    let rawColor: string | null = null;
    let supportsColor = false;
    if (
      drawing.kind === 'line' ||
      drawing.kind === 'pen' ||
      drawing.kind === 'arrow'
    ) {
      rawColor = drawing.stroke;
      supportsColor = true;
    } else if (drawing.kind === 'cone') {
      rawColor = drawing.fill;
      supportsColor = true;
    }

    const color = this.getDisplayColor(rawColor);

    return {
      type: 'drawing',
      drawingKind: drawing.kind,
      label: this.describeDrawingLabel(drawing),
      color,
      supportsColor,
      palette: supportsColor ? this.getPaletteForDrawing(drawing.kind) : [],
    };
  }

  private normalizeTarget(target: SelectTarget | null): SelectTarget | null {
    if (!target) {
      return null;
    }
    if (target.type === 'drawing' && target.handle) {
      return { type: 'drawing', id: target.id };
    }
    return target;
  }

  private updateSelectedColor(color: string): void {
    const normalized = this.normalizeColor(color);
    if (!normalized) {
      return;
    }
    const target = this.normalizeTarget(this.selectedTarget());
    if (!target) {
      return;
    }
    if (target.type === 'token') {
      this.applySceneUpdate((state) => ({
        ...state,
        scene: {
          ...state.scene,
          tokens: state.scene.tokens.map((token) => {
            if (token.id !== target.id) {
              return token;
            }
            return {
              ...token,
              color: normalized,
            };
          }),
        },
      }));
      this.engine?.draw();
      return;
    }
    const drawing = this.selectedDrawing();
    if (!drawing) {
      return;
    }
    const currentColor =
      drawing.kind === 'cone'
        ? drawing.fill
        : 'stroke' in drawing
        ? drawing.stroke
        : null;
    if (this.colorsEqual(currentColor, normalized)) {
      return;
    }

    const timestamp = nowISO();
    this.applySceneUpdate((state) => ({
      ...state,
      scene: {
        ...state.scene,
        drawings: state.scene.drawings.map((item) => {
          if (item.id !== drawing.id) {
            return item;
          }
          if (item.kind === 'cone') {
            return {
              ...item,
              fill: normalized,
              meta: {
                createdAt: item.meta?.createdAt ?? timestamp,
                updatedAt: timestamp,
              },
            };
          }
          if (
            item.kind === 'line' ||
            item.kind === 'pen' ||
            item.kind === 'arrow'
          ) {
            return {
              ...item,
              stroke: normalized,
              meta: {
                createdAt: item.meta?.createdAt ?? timestamp,
                updatedAt: timestamp,
              },
            };
          }
          return item;
        }),
      },
    }));

    if (drawing.kind === 'pen') {
      this.selectedPenColor.set(normalized);
      this.applyPenConfiguration();
    } else if (drawing.kind === 'arrow') {
      this.selectedArrowColor.set(normalized);
      this.applyArrowConfiguration();
    } else if (drawing.kind === 'line') {
      this.toolRegistry.configureTool('line', { color: normalized });
    }
    this.engine?.draw();
  }

  private describeDrawingLabel(drawing: Drawing): string {
    switch (drawing.kind) {
      case 'line':
        return 'Linie';
      case 'pen':
        return 'Freihand';
      case 'arrow':
        return 'Pfeil';
      case 'cone':
        return 'Zone';
      case 'image':
        return 'Bild';
      default:
        return 'Element';
    }
  }

  private getPaletteForDrawing(kind: Drawing['kind']): readonly string[] {
    switch (kind) {
      case 'arrow':
        return this.arrowColors;
      case 'line':
      case 'pen':
      case 'cone':
        return this.penColors;
      default:
        return this.penColors;
    }
  }

  private normalizeColor(color: string): string | null {
    const trimmed = color?.trim();
    return trimmed ? trimmed : null;
  }

  private colorsEqual(a: string | null | undefined, b: string): boolean {
    if (!a) {
      return false;
    }
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  private getDisplayColor(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
      return trimmed;
    }
    const rgbaMatch = trimmed.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i
    );
    if (rgbaMatch) {
      const [r, g, b] = rgbaMatch
        .slice(1, 4)
        .map((component) => Math.max(0, Math.min(255, Number(component))));
      return `#${this.componentToHex(r)}${this.componentToHex(
        g
      )}${this.componentToHex(b)}`;
    }
    return trimmed;
  }

  private componentToHex(value: number): string {
    return value.toString(16).padStart(2, '0');
  }

  private resolveLineStrokeColor(): string {
    const base = this.fieldLineColor();
    const rgb = this.hexToRgb(base);
    if (!rgb) {
      return base;
    }
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${DEFAULT_FIELD_LINE_ALPHA})`;
  }

  private hexToRgb(color: string): { r: number; g: number; b: number } | null {
    const normalized = this.normalizeColor(color);
    if (!normalized || !normalized.startsWith('#')) {
      return null;
    }
    let hex = normalized.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((char) => char + char)
        .join('');
    }
    if (hex.length !== 6) {
      return null;
    }
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return { r, g, b };
  }

  private describeTarget(target: SelectTarget): string {
    if (target.type === 'token') {
      return `token:${target.id}`;
    }
    if (target.handle) {
      return `line:${target.id}:${target.handle}`;
    }
    return `line:${target.id}`;
  }

  private applyFieldLayout(
    layout: FieldLayoutDefinition,
    options?: { rebuildLines?: boolean }
  ): void {
    const clonedLayout = cloneFieldLayout(layout);
    this.fieldLayout.set(clonedLayout);
    const rebuildLines = options?.rebuildLines !== false;
    this.sceneSnapshot.update((snapshot) => {
      const nextField = {
        ...snapshot.scene.field,
        width: DEFAULT_FIELD_DIMENSIONS.width,
        height: DEFAULT_FIELD_DIMENSIONS.height,
        lines: rebuildLines
          ? buildFieldLinesFromLayout(clonedLayout)
          : snapshot.scene.field.lines,
      };
      return {
        ...snapshot,
        scene: {
          ...snapshot.scene,
          field: nextField,
        },
      };
    });
    this.toolRegistry.updateScene(this.sceneSnapshot());
    if (this.engine) {
      this.engine.setScene(this.sceneSnapshot());
    }
    this.engine?.draw();
    this.updateCanvasCursor();
  }

  private updateCanvasCursor(): void {
    const canvas = this.engine?.canvas;
    if (!canvas) {
      return;
    }
    canvas.style.cursor = this.resolveCursor(
      this.selectedTool(),
      this.hoveredTarget()
    );
  }

  private resolveCursor(tool: DrawToolId, hover: SelectTarget | null): string {
    if (hover) {
      return 'pointer';
    }
    switch (tool) {
      case 'pen':
      case 'line':
      case 'arrow':
      case 'cone':
        return 'crosshair';
      case 'eraser':
        return 'cell';
      default:
        return 'default';
    }
  }

  private resolveExportResolution(id: string): ExportResolutionOption {
    return (
      this.exportResolutions.find((option) => option.id === id) ??
      this.exportResolutions[1] ??
      this.exportResolutions[0]
    );
  }

  private renderFieldBackground(
    ctx: CanvasRenderingContext2D,
    state: RenderState
  ): void {
    const scene = state.scene;
    if (!scene) {
      return;
    }
    const layout = this.fieldLayout();
    if (!layout) {
      return;
    }

    const field = scene.scene.field;
    const layoutWidth = layout.dimensions.width || FIELD_UNIT_WIDTH || 1;
    const layoutHeight = layout.dimensions.height || FIELD_UNIT_HEIGHT || 1;
    const scaleX = field.width / layoutWidth;
    const scaleY = field.height / layoutHeight;
    const strokeScale = Math.min(scaleX, scaleY);
    const surfaceColor = this.fieldSurfaceColor();
    const lineStroke = this.resolveLineStrokeColor();
    const boundaryColor = this.fieldBoundaryColor();

    const boundary = layout.elements.find(
      (element): element is FieldLayoutLineElement =>
        element.kind === 'line' && Boolean(element.closePath)
    );

    if (boundary && boundary.points.length >= 3) {
      ctx.save();
      ctx.fillStyle = surfaceColor;
      ctx.beginPath();
      boundary.points.forEach((point, index) => {
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.5, strokeScale * 1);
      ctx.strokeStyle = boundaryColor;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    layout.elements.forEach((element) => {
      if (boundary && element === boundary) {
        return;
      }
      if (element.kind === 'line') {
        ctx.save();
        if (element.opacity !== undefined) {
          ctx.globalAlpha = element.opacity;
        }
        ctx.strokeStyle = lineStroke;
        ctx.lineWidth = (element.strokeWidth ?? 0.6) * strokeScale;
        ctx.setLineDash(
          element.dash?.map((segment) => segment * strokeScale) ?? []
        );
        ctx.beginPath();
        element.points.forEach((point, index) => {
          const x = point.x * scaleX;
          const y = point.y * scaleY;
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        if (element.closePath) {
          ctx.closePath();
        }
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (element.kind === 'circle') {
        ctx.save();
        if (element.opacity !== undefined) {
          ctx.globalAlpha = element.opacity;
        }
        const radiusScale = Math.min(scaleX, scaleY);
        ctx.strokeStyle = lineStroke;
        ctx.lineWidth = (element.strokeWidth ?? 0.6) * radiusScale;
        ctx.setLineDash(
          element.dash?.map((segment) => segment * radiusScale) ?? []
        );
        const radius = element.radius * radiusScale;
        const centerX = element.center.x * scaleX;
        const centerY = element.center.y * scaleY;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.restore();
  }

  private reorderScene(
    mutator: (scene: SceneSnapshot) => SceneSnapshot | null
  ): void {
    const current = this.sceneSnapshot();
    const next = mutator(current);
    if (!next) {
      return;
    }
    this.sceneSnapshot.set(next);
    this.toolRegistry.updateScene(next);
    if (this.engine) {
      this.engine.setScene(next);
      this.engine.draw();
    }
    this.persistState();
  }

  private bringDrawingToFront(drawingId: string): void {
    this.reorderScene((snapshot) => {
      const index = snapshot.scene.drawings.findIndex(
        (drawing) => drawing.id === drawingId
      );
      if (index < 0 || index === snapshot.scene.drawings.length - 1) {
        return null;
      }
      const drawings = [...snapshot.scene.drawings];
      const [entry] = drawings.splice(index, 1);
      drawings.push(entry);
      return {
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings,
          lastUpdatedAt: nowISO(),
        },
      };
    });
  }

  private bringTokenToFront(tokenId: string): void {
    this.reorderScene((snapshot) => {
      const index = snapshot.scene.tokens.findIndex(
        (token) => token.id === tokenId
      );
      if (index < 0 || index === snapshot.scene.tokens.length - 1) {
        return null;
      }
      const tokens = [...snapshot.scene.tokens];
      const [entry] = tokens.splice(index, 1);
      tokens.push(entry);
      return {
        ...snapshot,
        scene: {
          ...snapshot.scene,
          tokens,
          lastUpdatedAt: nowISO(),
        },
      };
    });
  }

  private renderDrawings(
    ctx: CanvasRenderingContext2D,
    state: RenderState
  ): void {
    const snapshot = state.scene;
    if (!snapshot) {
      return;
    }
    const hoveredDrawingId = this.hoveredDrawingId();
    const selectedDrawingId = this.selectedDrawingId();
    const hoveredHandle = this.hoveredLineHandle();
    const activeHandle = this.activeLineHandle();
    const isDraggingDrawing = this.isDraggingDrawing();
    const drawings = [...snapshot.scene.drawings];
    const drawingPriority = (drawing: Drawing): number => {
      let value = 0;
      if (drawing.id === selectedDrawingId) {
        value += 4;
      }
      if (isDraggingDrawing && drawing.id === selectedDrawingId) {
        value += 8;
      }
      return value;
    };
    drawings.sort((a, b) => drawingPriority(a) - drawingPriority(b));

    drawings.forEach((drawing) => {
      if (drawing.kind === 'image') {
        this.renderImageDrawing(ctx, drawing, {
          isSelected: drawing.id === selectedDrawingId,
          isHovered: drawing.id === hoveredDrawingId,
          isDragging: isDraggingDrawing && drawing.id === selectedDrawingId,
        });
        return;
      }
      if (drawing.kind === 'line') {
        this.renderLineDrawing(ctx, drawing, {
          isSelected: drawing.id === selectedDrawingId,
          isHovered: drawing.id === hoveredDrawingId,
          hoveredHandle,
          activeHandle,
          isDragging: isDraggingDrawing && drawing.id === selectedDrawingId,
        });
        return;
      }
      if (drawing.kind === 'pen') {
        this.renderPenDrawing(ctx, drawing, {
          isSelected: drawing.id === selectedDrawingId,
          isHovered: drawing.id === hoveredDrawingId,
          isDragging: isDraggingDrawing && drawing.id === selectedDrawingId,
        });
        return;
      }

      if (drawing.kind === 'arrow') {
        this.renderArrowDrawing(ctx, drawing, {
          isSelected: drawing.id === selectedDrawingId,
          isHovered: drawing.id === hoveredDrawingId,
          hoveredHandle,
          activeHandle,
          isDragging: isDraggingDrawing && drawing.id === selectedDrawingId,
        });
        return;
      }

      if (drawing.kind === 'cone') {
        this.renderConeDrawing(ctx, drawing, {
          isSelected: drawing.id === selectedDrawingId,
          isHovered: drawing.id === hoveredDrawingId,
          isDragging: isDraggingDrawing && drawing.id === selectedDrawingId,
        });
      }
    });
  }

  private renderLineDrawing(
    ctx: CanvasRenderingContext2D,
    drawing: LineDrawing,
    options: {
      isSelected: boolean;
      isHovered: boolean;
      hoveredHandle: SelectTarget | null;
      activeHandle: { drawingId: string; handle: 'start' | 'end' } | null;
      isDragging: boolean;
    }
  ): void {
    if (drawing.points.length < 2) {
      return;
    }

    if (options.isHovered || options.isSelected || options.isDragging) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle =
        options.isSelected || options.isDragging
          ? SELECTED_OUTLINE_COLOR
          : HOVER_OUTLINE_COLOR;
      ctx.lineWidth =
        drawing.width +
        (options.isSelected || options.isDragging
          ? SELECTION_OUTLINE_EXTRA * 1.2
          : SELECTION_OUTLINE_EXTRA * 0.9);
      this.traceLinePath(ctx, drawing.points);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = drawing.stroke;
    ctx.lineWidth = drawing.width;
    this.traceLinePath(ctx, drawing.points);
    ctx.stroke();
    ctx.restore();

    if (!options.isSelected) {
      return;
    }

    const hoveredHandleId =
      options.hoveredHandle?.type === 'drawing' &&
      options.hoveredHandle.id === drawing.id
        ? options.hoveredHandle.handle ?? null
        : null;
    const activeHandleId =
      options.activeHandle?.drawingId === drawing.id
        ? options.activeHandle.handle
        : null;

    this.drawLineHandles(ctx, drawing, hoveredHandleId, activeHandleId);
  }

  private renderPenDrawing(
    ctx: CanvasRenderingContext2D,
    drawing: Drawing & { kind: 'pen' },
    options: {
      isSelected: boolean;
      isHovered: boolean;
      isDragging: boolean;
    }
  ): void {
    if (drawing.points.length < 2) {
      return;
    }

    if (options.isHovered || options.isSelected || options.isDragging) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle =
        options.isSelected || options.isDragging
          ? SELECTED_OUTLINE_COLOR
          : HOVER_OUTLINE_COLOR;
      ctx.lineWidth =
        drawing.width +
        (options.isSelected || options.isDragging
          ? SELECTION_OUTLINE_EXTRA * 1.2
          : SELECTION_OUTLINE_EXTRA * 0.9);
      this.traceLinePath(ctx, drawing.points);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = drawing.stroke;
    ctx.lineWidth = drawing.width;
    this.traceLinePath(ctx, drawing.points);
    ctx.stroke();
    ctx.restore();
  }

  private renderArrowDrawing(
    ctx: CanvasRenderingContext2D,
    drawing: ArrowDrawing,
    options: {
      isSelected: boolean;
      isHovered: boolean;
      hoveredHandle: SelectTarget | null;
      activeHandle: { drawingId: string; handle: 'start' | 'end' } | null;
      isDragging: boolean;
    }
  ): void {
    const direction = {
      x: drawing.to.x - drawing.from.x,
      y: drawing.to.y - drawing.from.y,
    };
    const length = Math.max(0.001, Math.hypot(direction.x, direction.y));
    const unit = { x: direction.x / length, y: direction.y / length };
    const angle = Math.atan2(direction.y, direction.x);
    const maxHead = drawing.width * 3.6;
    const headLength = Math.min(length, maxHead);
    const shaftEnd = {
      x: drawing.to.x - unit.x * headLength,
      y: drawing.to.y - unit.y * headLength,
    };
    const shaftPoints = [drawing.from, shaftEnd];

    if (options.isHovered || options.isSelected || options.isDragging) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle =
        options.isSelected || options.isDragging
          ? SELECTED_OUTLINE_COLOR
          : HOVER_OUTLINE_COLOR;
      ctx.lineWidth =
        drawing.width +
        (options.isSelected || options.isDragging
          ? SELECTION_OUTLINE_EXTRA * 1.2
          : SELECTION_OUTLINE_EXTRA * 0.9);
      this.traceLinePath(ctx, shaftPoints);
      ctx.stroke();

      ctx.beginPath();
      const headLeft = {
        x: drawing.to.x - headLength * Math.cos(angle - Math.PI / 6),
        y: drawing.to.y - headLength * Math.sin(angle - Math.PI / 6),
      };
      const headRight = {
        x: drawing.to.x - headLength * Math.cos(angle + Math.PI / 6),
        y: drawing.to.y - headLength * Math.sin(angle + Math.PI / 6),
      };
      ctx.moveTo(drawing.to.x, drawing.to.y);
      ctx.lineTo(headLeft.x, headLeft.y);
      ctx.lineTo(headRight.x, headRight.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = drawing.stroke;
    ctx.lineWidth = drawing.width;
    ctx.beginPath();
    ctx.moveTo(drawing.from.x, drawing.from.y);
    ctx.lineTo(shaftEnd.x, shaftEnd.y);
    ctx.stroke();
    this.drawArrowHead(ctx, shaftEnd, drawing.to, maxHead);
    ctx.restore();

    if (!options.isSelected) {
      return;
    }

    const hoveredHandleId =
      options.hoveredHandle?.type === 'drawing' &&
      options.hoveredHandle.id === drawing.id
        ? options.hoveredHandle.handle ?? null
        : null;
    const activeHandleId =
      options.activeHandle?.drawingId === drawing.id
        ? options.activeHandle.handle
        : null;

    this.drawHandle(
      ctx,
      drawing.from,
      hoveredHandleId === 'start',
      activeHandleId === 'start'
    );
    this.drawHandle(
      ctx,
      drawing.to,
      hoveredHandleId === 'end',
      activeHandleId === 'end'
    );
  }

  private renderConeDrawing(
    ctx: CanvasRenderingContext2D,
    drawing: ConeDrawing,
    options: { isSelected: boolean; isHovered: boolean; isDragging: boolean }
  ): void {
    ctx.save();
    ctx.fillStyle = drawing.fill;
    ctx.beginPath();
    ctx.arc(drawing.at.x, drawing.at.y, drawing.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (options.isHovered || options.isSelected || options.isDragging) {
      ctx.save();
      ctx.lineWidth = options.isSelected
        ? SELECTION_OUTLINE_EXTRA * 0.4
        : SELECTION_OUTLINE_EXTRA * 0.3;
      ctx.strokeStyle = options.isSelected
        ? 'rgba(34, 197, 94, 0.75)'
        : 'rgba(148, 163, 184, 0.6)';
      ctx.setLineDash(options.isDragging ? [1.8, 1.2] : [2.6, 1.6]);
      ctx.beginPath();
      ctx.arc(
        drawing.at.x,
        drawing.at.y,
        drawing.radius + SELECTION_OUTLINE_EXTRA * 0.5,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderImageDrawing(
    ctx: CanvasRenderingContext2D,
    drawing: ImageDrawing,
    options: { isSelected: boolean; isHovered: boolean; isDragging: boolean }
  ): void {
    const resource = this.getImageResource(drawing);
    if (resource) {
      ctx.save();
      ctx.globalAlpha = drawing.opacity ?? 1;
      ctx.drawImage(
        resource,
        drawing.x,
        drawing.y,
        drawing.width,
        drawing.height
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
      ctx.fillRect(drawing.x, drawing.y, drawing.width, drawing.height);
      ctx.restore();
    }

    if (options.isHovered || options.isSelected || options.isDragging) {
      ctx.save();
      ctx.lineWidth = options.isSelected
        ? SELECTION_OUTLINE_EXTRA * 0.35
        : SELECTION_OUTLINE_EXTRA * 0.25;
      ctx.strokeStyle = options.isSelected
        ? 'rgba(34, 197, 94, 0.75)'
        : 'rgba(148, 163, 184, 0.65)';
      ctx.setLineDash(options.isDragging ? [1.8, 1.2] : [2.6, 1.6]);
      ctx.strokeRect(
        drawing.x - SELECTION_OUTLINE_EXTRA * 0.35,
        drawing.y - SELECTION_OUTLINE_EXTRA * 0.35,
        drawing.width + SELECTION_OUTLINE_EXTRA * 0.7,
        drawing.height + SELECTION_OUTLINE_EXTRA * 0.7
      );
      ctx.restore();
    }
  }

  private getImageResource(drawing: ImageDrawing): HTMLImageElement | null {
    const cached = this.imageCache.get(drawing.id);
    if (cached && cached.src === drawing.src) {
      const { image } = cached;
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        return image;
      }
      return null;
    }

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const entry = this.imageCache.get(drawing.id);
      if (!entry || entry.image !== image) {
        return;
      }
      this.engine?.draw();
    };
    image.onerror = () => {
      const entry = this.imageCache.get(drawing.id);
      if (entry && entry.image === image) {
        this.imageCache.delete(drawing.id);
      }
    };
    image.src = drawing.src;
    this.imageCache.set(drawing.id, { src: drawing.src, image });
    return null;
  }

  private traceLinePath(
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>
  ): void {
    if (points.length === 0) {
      return;
    }
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
  }

  private drawLineHandles(
    ctx: CanvasRenderingContext2D,
    drawing: LineDrawing,
    hoveredHandle: 'start' | 'end' | null,
    activeHandle: 'start' | 'end' | null
  ): void {
    const { start, end } = getLineEndpoints(drawing.points);
    this.drawHandle(
      ctx,
      start,
      hoveredHandle === 'start',
      activeHandle === 'start'
    );
    this.drawHandle(ctx, end, hoveredHandle === 'end', activeHandle === 'end');
  }

  private drawHandle(
    ctx: CanvasRenderingContext2D,
    point: { x: number; y: number },
    isHovered: boolean,
    isActive: boolean
  ): void {
    ctx.save();
    ctx.beginPath();
    const radius = LINE_HANDLE_RADIUS;
    const fillStyle = isActive
      ? 'rgba(34, 197, 94, 0.65)'
      : isHovered
      ? 'rgba(14, 165, 233, 0.45)'
      : 'rgba(148, 163, 184, 0.35)';
    const strokeStyle = isActive
      ? 'rgba(22, 163, 74, 0.9)'
      : isHovered
      ? 'rgba(14, 165, 233, 0.8)'
      : 'rgba(148, 163, 184, 0.85)';
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 0.55;
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private renderTokens(
    ctx: CanvasRenderingContext2D,
    state: RenderState
  ): void {
    const snapshot = state.scene;
    if (!snapshot) {
      return;
    }
    const hovered = this.hoveredTokenId();
    const selected = this.selectedTokenId();
    const isDragging = this.isDraggingToken();
    const showNames = this.showPlayerNames();

    const tokens = [...snapshot.scene.tokens];
    const tokenPriority = (token: Token): number => {
      let value = 0;
      if (token.id === selected) {
        value += 4;
      }
      if (isDragging && token.id === selected) {
        value += 8;
      }
      return value;
    };
    tokens.sort((a, b) => tokenPriority(a) - tokenPriority(b));

    tokens.forEach((token) => {
      const fillColor = this.getTokenFillColor(token);
      const isJugg = token.id === JUGG_ID || token.shape === 'rectangle';
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.3)';
      ctx.shadowBlur = 2.8;
      ctx.fillStyle = fillColor;

      if (isJugg) {
        const width = token.width ?? JUGG_WIDTH;
        const height = token.height ?? JUGG_HEIGHT;
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const rectX = token.x - halfWidth;
        const rectY = token.y - halfHeight;
        const radius = this.getJuggCornerRadius(width, height);
        this.traceRoundedRect(ctx, rectX, rectY, width, height, radius);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = DEFAULT_JUGG_STROKE;
        ctx.stroke();

        if (token.id === hovered || token.id === selected) {
          ctx.save();
          ctx.lineWidth =
            token.id === selected
              ? SELECTION_OUTLINE_EXTRA * 0.3
              : SELECTION_OUTLINE_EXTRA * 0.2;
          ctx.strokeStyle =
            token.id === selected ? '#10b981' : 'rgba(148, 163, 184, 0.55)';
          const padding = 1.5;
          const outlineWidth = width + padding * 2;
          const outlineHeight = height + padding * 2;
          const outlineRadius = this.getJuggCornerRadius(
            outlineWidth,
            outlineHeight
          );
          this.traceRoundedRect(
            ctx,
            rectX - padding,
            rectY - padding,
            outlineWidth,
            outlineHeight,
            outlineRadius
          );
          ctx.stroke();
          ctx.restore();
        }

        if (isDragging && token.id === selected) {
          ctx.save();
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.setLineDash([1.2, 1.2]);
          ctx.lineWidth = SELECTION_OUTLINE_EXTRA * 0.2;
          const padding = 3;
          const outlineWidth = width + padding * 2;
          const outlineHeight = height + padding * 2;
          const outlineRadius = this.getJuggCornerRadius(
            outlineWidth,
            outlineHeight
          );
          this.traceRoundedRect(
            ctx,
            rectX - padding,
            rectY - padding,
            outlineWidth,
            outlineHeight,
            outlineRadius
          );
          ctx.stroke();
          ctx.restore();
        }
      } else {
        ctx.beginPath();
        ctx.arc(token.x, token.y, TOKEN_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        if (token.id === hovered || token.id === selected) {
          ctx.shadowColor = 'transparent';
          ctx.lineWidth =
            token.id === selected
              ? SELECTION_OUTLINE_EXTRA * 0.35
              : SELECTION_OUTLINE_EXTRA * 0.25;
          ctx.strokeStyle =
            token.id === selected ? '#10b981' : 'rgba(148, 163, 184, 0.55)';
          ctx.stroke();
        }

        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#1f2937';
        ctx.font = `${TOKEN_RADIUS * 0.8}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getTokenLabel(token.playerId), token.x, token.y);

        if (showNames) {
          const playerName = this.getPlayerName(token.playerId);
          if (playerName) {
            ctx.fillStyle = '#0f172a';
            ctx.font = `${TOKEN_RADIUS * 0.65}px Inter, sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(playerName, token.x, token.y + TOKEN_RADIUS + 0.8);
          }
        }

        if (isDragging && token.id === selected) {
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.setLineDash([1.2, 1.2]);
          ctx.lineWidth = SELECTION_OUTLINE_EXTRA * 0.25;
          ctx.beginPath();
          ctx.arc(token.x, token.y, TOKEN_RADIUS + 1.1, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  private renderOverlay(
    ctx: CanvasRenderingContext2D,
    _state: RenderState
  ): void {
    if (this.selectedTool() !== 'eraser') {
      return;
    }
    const preview = this.eraserPreview();
    if (!preview) {
      return;
    }
    const radius = this.getEraserRadius(this.selectedEraserSize());
    ctx.save();
    ctx.setLineDash([1.8, 1.6]);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.beginPath();
    ctx.arc(preview.x, preview.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawArrowHead(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    size: number
  ): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.max(0.001, Math.hypot(to.x - from.x, to.y - from.y));
    const head = Math.min(length, size);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
      to.x - head * Math.cos(angle - Math.PI / 6),
      to.y - head * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      to.x - head * Math.cos(angle + Math.PI / 6),
      to.y - head * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle ?? '#facc15';
    ctx.fill();
  }

  private traceRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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

  private getJuggCornerRadius(width: number, height: number): number {
    return Math.min(width, height) * JUGG_CORNER_RATIO;
  }

  private getTokenFillColor(token: Token): string {
    if (token.color) {
      return token.color;
    }
    if (token.id === JUGG_ID || token.shape === 'rectangle') {
      return DEFAULT_JUGG_COLOR;
    }
    return this.getTeamColor(token.teamId) ?? '#f8fafc';
  }

  private getTokenLabel(playerId: string | undefined): string {
    if (!playerId) {
      return '?';
    }
    const player = [...this.leftTeam.players, ...this.rightTeam.players].find(
      (p) => p.id === playerId
    );
    return player?.number ?? player?.name.charAt(0) ?? '?';
  }

  private getPlayerName(playerId: string | undefined): string | null {
    if (!playerId) {
      return null;
    }
    const player = [...this.leftTeam.players, ...this.rightTeam.players].find(
      (p) => p.id === playerId
    );
    return player?.name ?? null;
  }

  private cleanupLayers(): void {
    this.layerDisposers.forEach((dispose) => dispose());
    this.layerDisposers = [];
  }

  private createTokenId(playerId: string): string {
    return `token-${playerId}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
  }

  private createDrawingId(kind: string): string {
    return `${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private computeImageDimensions(
    naturalWidth: number,
    naturalHeight: number,
    fieldWidth: number,
    fieldHeight: number
  ): { width: number; height: number } {
    const aspect =
      naturalHeight === 0 ? 1 : Math.max(0.1, naturalWidth / naturalHeight);
    const baseWidth = fieldWidth * 0.22;
    const maxWidth = fieldWidth * 0.6;
    const maxHeight = fieldHeight * 0.7;

    let width = Math.min(baseWidth, maxWidth);
    let height = width / aspect;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }
    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspect;
    }
    if (width > fieldWidth) {
      width = fieldWidth;
      height = width / aspect;
    }
    if (height > fieldHeight) {
      height = fieldHeight;
      width = height * aspect;
    }

    return { width, height };
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
      return min;
    }
    if (max < min) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private createSceneId(): string {
    return `scene-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private nextSceneLabel(): string {
    this.sceneLabelCounter += 1;
    return `Szene ${this.sceneLabelCounter}`;
  }

  private createSceneDeckEntry(
    scene: SceneSnapshot,
    options: {
      label?: string;
      idOverride?: string;
      createdAt?: string;
      updatedAt?: string;
      previewDataUrl?: string | null;
    } = {}
  ): SceneDeckEntry {
    const snapshot = this.cloneSnapshot(scene);
    const id = options.idOverride ?? snapshot.scene.id ?? this.createSceneId();
    if (snapshot.scene.id !== id) {
      snapshot.scene = {
        ...snapshot.scene,
        id,
      };
    }
    const timestamp = snapshot.scene.lastUpdatedAt ?? nowISO();
    return {
      id,
      label: options.label ?? this.nextSceneLabel(),
      createdAt: options.createdAt ?? timestamp,
      updatedAt: options.updatedAt ?? timestamp,
      snapshot,
      previewDataUrl: options.previewDataUrl ?? null,
    };
  }

  private ensureHistory(sceneId: string): SceneHistoryState {
    let entry = this.sceneHistories.get(sceneId);
    if (!entry) {
      entry = { undo: [], redo: [] };
      this.sceneHistories.set(sceneId, entry);
    }
    return entry;
  }

  private getActiveHistory(): SceneHistoryState {
    return this.ensureHistory(this.activeSceneId());
  }

  private resetHistoryForScene(sceneId: string): void {
    const history = this.ensureHistory(sceneId);
    history.undo.length = 0;
    history.redo.length = 0;
    if (sceneId === this.activeSceneId()) {
      this.undoDepth.set(0);
      this.redoDepth.set(0);
    }
  }

  private scheduleScenePreview(sceneId: string, snapshot: SceneSnapshot): void {
    if (typeof window === 'undefined') {
      return;
    }
    const existingHandle = this.pendingPreviewTimers.get(sceneId);
    if (existingHandle) {
      window.clearTimeout(existingHandle);
    }
    const snapshotCopy = this.cloneSnapshot(snapshot);
    const expectedTimestamp = snapshotCopy.scene.lastUpdatedAt;
    const handle = window.setTimeout(async () => {
      this.pendingPreviewTimers.delete(sceneId);
      const dataUrl = await this.renderScenePreview(snapshotCopy);
      this.sceneDeck.update((entries) => {
        const index = entries.findIndex((entry) => entry.id === sceneId);
        if (index < 0) {
          return entries;
        }
        const currentEntry = entries[index];
        const currentTimestamp = currentEntry.snapshot.scene.lastUpdatedAt;
        if (expectedTimestamp && currentTimestamp !== expectedTimestamp) {
          return entries;
        }
        if (currentEntry.previewDataUrl === dataUrl) {
          return entries;
        }
        const nextEntries = entries.slice();
        nextEntries[index] = {
          ...currentEntry,
          previewDataUrl: dataUrl,
        };
        return nextEntries;
      });
    }, SCENE_PREVIEW_DEBOUNCE_MS);
    this.pendingPreviewTimers.set(sceneId, handle);
  }

  private async renderScenePreview(
    snapshot: SceneSnapshot
  ): Promise<string | null> {
    try {
      const blob = await composeTacticsScreenshot({
        scene: snapshot,
        leftTeam: snapshot.leftTeam,
        rightTeam: snapshot.rightTeam,
        width: SCENE_PREVIEW_WIDTH,
        height: SCENE_PREVIEW_HEIGHT,
        padding: 16,
        includeTeamPanels: false,
        devicePixelRatio: EXPORT_DEVICE_PIXEL_RATIO,
      });
      return await this.blobToDataUrl(blob);
    } catch (error) {
      console.warn('Rendering scene preview failed', error);
      return null;
    }
  }

  private async blobToDataUrl(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Konnte Vorschaudaten nicht lesen'));
        }
      };
      reader.onerror = () => {
        reject(
          reader.error ?? new Error('Konnte Vorschaudaten nicht erstellen')
        );
      };
      reader.readAsDataURL(blob);
    });
  }

  private createSilentAudioTrack(): SilentAudioTrackHandle | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const AudioContextCtor = (window.AudioContext ||
      (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AudioContextCtor) {
      return null;
    }
    const audioContext = new AudioContextCtor();
    const destination = audioContext.createMediaStreamDestination();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    const [track] = destination.stream.getAudioTracks();
    if (!track) {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
      destination.disconnect?.();
      audioContext.close();
      return null;
    }
    const dispose = async () => {
      try {
        oscillator.stop();
      } catch {
        /* ignore */
      }
      oscillator.disconnect();
      gain.disconnect();
      destination.disconnect?.();
      await audioContext.close().catch(() => undefined);
    };
    return { track, dispose };
  }

  private async waitFrames(
    durationMs: number,
    frameIntervalMs: number
  ): Promise<void> {
    const frames = Math.max(1, Math.round(durationMs / frameIntervalMs));
    let remaining = durationMs;
    for (let i = 0; i < frames; i += 1) {
      const step =
        i === frames - 1
          ? Math.max(1, Math.round(remaining))
          : Math.max(1, Math.round(remaining / (frames - i)));
      await this.delay(step);
      remaining -= step;
    }
  }

  private async paintBlobOnCanvas(
    ctx: CanvasRenderingContext2D,
    blob: Blob,
    width: number,
    height: number
  ): Promise<void> {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return;
    }

    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          resolve();
        };
        image.onerror = () =>
          reject(new Error('Bild konnte nicht geladen werden'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async delay(ms: number): Promise<void> {
    return await new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private buildExportBasename(option: AnimationFormatOption): string {
    const prefix = 'jugger-tactics-animation';
    const suffix = option.id.replace(/[^a-z0-9]+/gi, '-');
    return `${prefix}-${suffix}-${Date.now()}`;
  }

  private pushUndo(
    snapshot: SceneSnapshot,
    options: { resetRedo?: boolean } = {}
  ): void {
    const { resetRedo = true } = options;
    const history = this.getActiveHistory();
    history.undo.push(snapshot);
    this.trimHistory(history.undo);
    this.undoDepth.set(history.undo.length);
    if (resetRedo) {
      history.redo.length = 0;
      this.redoDepth.set(0);
    }
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
      const scenes = this.sceneDeck().map((entry) => ({
        ...entry,
        snapshot: this.cloneSnapshot(entry.snapshot),
      }));
      const history: Record<string, SceneHistoryState> = {};
      this.sceneHistories.forEach((value, key) => {
        history[key] = {
          undo: value.undo.map((snap) => this.cloneSnapshot(snap)),
          redo: value.redo.map((snap) => this.cloneSnapshot(snap)),
        };
      });

      const payload: PersistedSession = {
        scenes,
        activeSceneId: this.activeSceneId(),
        fieldLayout: cloneFieldLayout(this.fieldLayout()),
        history,
        savedAt: nowISO(),
        isFieldFlipped: this.isFieldFlipped(),
        isFieldRotated: this.isFieldRotated(),
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
      const parsed = JSON.parse(raw) as
        | PersistedSession
        | (PersistedSession & LegacyPersistedSession)
        | LegacyPersistedSession
        | null;

      let session: PersistedSession | null = null;
      if (parsed && Array.isArray((parsed as PersistedSession).scenes)) {
        const sceneEntries = (parsed as PersistedSession).scenes
          .map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
              return null;
            }
            const snapshot =
              (entry as SceneDeckEntry).snapshot ??
              (entry as unknown as { scene?: SceneSnapshot }).scene;
            if (!snapshot) {
              return null;
            }
            const idCandidate = entry.id ?? snapshot.scene?.id;
            return this.createSceneDeckEntry(snapshot, {
              idOverride: idCandidate ?? this.createSceneId(),
              label: entry.label ?? `Szene ${index + 1}`,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              previewDataUrl: entry.previewDataUrl ?? null,
            });
          })
          .filter((value): value is SceneDeckEntry => Boolean(value));

        if (sceneEntries.length > 0) {
          const historyEntries = (parsed as PersistedSession).history ?? {};
          const history: Record<string, SceneHistoryState> = {};
          sceneEntries.forEach((scene) => {
            const entry = historyEntries[scene.id];
            history[scene.id] = {
              undo: (entry?.undo ?? []).map((snap) => this.cloneSnapshot(snap)),
              redo: (entry?.redo ?? []).map((snap) => this.cloneSnapshot(snap)),
            };
          });

          const activeSceneId = sceneEntries.some(
            (entry) => entry.id === (parsed as PersistedSession).activeSceneId
          )
            ? (parsed as PersistedSession).activeSceneId
            : sceneEntries[0].id;

          session = {
            scenes: sceneEntries,
            activeSceneId,
            fieldLayout: cloneFieldLayout(
              (parsed as PersistedSession).fieldLayout ?? JUGGER_FIELD_LAYOUT
            ),
            history,
            savedAt: parsed?.savedAt ?? nowISO(),
            isFieldFlipped: parsed?.isFieldFlipped,
            isFieldRotated: parsed?.isFieldRotated,
          };
        }
      } else if (parsed && (parsed as LegacyPersistedSession).scene) {
        const legacy = parsed as LegacyPersistedSession;
        const snapshot = this.cloneSnapshot(legacy.scene);
        const id = snapshot.scene.id ?? this.createSceneId();
        if (snapshot.scene.id !== id) {
          snapshot.scene = { ...snapshot.scene, id };
        }
        const sceneEntry = this.createSceneDeckEntry(snapshot, {
          idOverride: id,
          label: 'Szene 1',
          previewDataUrl: null,
        });
        session = {
          scenes: [sceneEntry],
          activeSceneId: id,
          fieldLayout: cloneFieldLayout(
            legacy.fieldLayout ?? JUGGER_FIELD_LAYOUT
          ),
          history: {
            [id]: {
              undo: (legacy.undoStack ?? []).map((snap) =>
                this.cloneSnapshot(snap)
              ),
              redo: (legacy.redoStack ?? []).map((snap) =>
                this.cloneSnapshot(snap)
              ),
            },
          },
          savedAt: legacy.savedAt ?? nowISO(),
          isFieldFlipped: legacy.isFieldFlipped,
          isFieldRotated: legacy.isFieldRotated,
        };
      }

      if (!session) {
        return;
      }

      this.pendingSession = session;
      const date = new Date(session.savedAt);
      const label = Number.isNaN(date.getTime())
        ? 'Letzte Session'
        : `Session vom ${date.toLocaleString()}`;
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
    const sanitizedScenes = session.scenes.map((entry) =>
      this.createSceneDeckEntry(entry.snapshot, {
        idOverride: entry.id,
        label: entry.label,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        previewDataUrl: entry.previewDataUrl,
      })
    );

    if (sanitizedScenes.length === 0) {
      return;
    }

    const activeSceneId = sanitizedScenes.some(
      (entry) => entry.id === session.activeSceneId
    )
      ? session.activeSceneId
      : sanitizedScenes[0].id;

    this.sceneDeck.set(sanitizedScenes);
    this.activeSceneId.set(activeSceneId);

    const labelMax = sanitizedScenes.reduce((max, entry) => {
      const match = /([0-9]+)/.exec(entry.label ?? '');
      if (!match) {
        return max;
      }
      const numeric = Number.parseInt(match[1], 10);
      return Number.isNaN(numeric) ? max : Math.max(max, numeric);
    }, sanitizedScenes.length);
    this.sceneLabelCounter = Math.max(1, labelMax);

    if (typeof window !== 'undefined') {
      this.pendingPreviewTimers.forEach((handle) =>
        window.clearTimeout(handle)
      );
    }
    this.pendingPreviewTimers.clear();

    const activeEntry =
      sanitizedScenes.find((entry) => entry.id === activeSceneId) ??
      sanitizedScenes[0];
    const activeSnapshot = this.cloneSnapshot(activeEntry.snapshot);
    this.sceneSnapshot.set(activeSnapshot);
    this.toolRegistry.updateScene(activeSnapshot);

    this.sceneHistories.clear();
    sanitizedScenes.forEach((entry) => {
      const state = session.history[entry.id];
      this.sceneHistories.set(entry.id, {
        undo: (state?.undo ?? []).map((snap) => this.cloneSnapshot(snap)),
        redo: (state?.redo ?? []).map((snap) => this.cloneSnapshot(snap)),
      });
    });

    const activeHistory = this.getActiveHistory();
    this.undoDepth.set(activeHistory.undo.length);
    this.redoDepth.set(activeHistory.redo.length);

    this.applyFieldLayout(session.fieldLayout ?? JUGGER_FIELD_LAYOUT, {
      rebuildLines: false,
    });
    this.isFieldFlipped.set(Boolean(session.isFieldFlipped));
    this.isFieldRotated.set(Boolean(session.isFieldRotated));
    this.hoveredTarget.set(null);
    this.selectedTarget.set(null);
    this.activeDrawingHandle.set(null);
    this.isDraggingToken.set(false);
    this.isDraggingDrawing.set(false);
    this.colorMenuContext.set(null);

    sanitizedScenes.forEach((entry) => {
      if (!entry.previewDataUrl) {
        this.scheduleScenePreview(entry.id, entry.snapshot);
      }
    });

    this.persistState();
    this.toastService.show({
      message: 'Session wiederhergestellt ✅',
      intent: 'success',
      durationMs: DEFAULT_TOAST_DURATION_MS,
    });
  }

  private discardPersistedSession(): void {
    this.pendingSession = null;
    if (this.supportsStorage()) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private readInitialTheme(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark') {
        return true;
      }
      if (stored === 'light') {
        return false;
      }
    } catch {
      /* ignore storage access */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
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
    if (event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z') {
        event.preventDefault();
        event.shiftKey ? this.redo() : this.undo();
      } else if (key === 'y') {
        event.preventDefault();
        this.redo();
      }
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const shortcut = event.key;
      const tool = this.toolShortcuts.find(
        (candidate) => candidate.shortcut === shortcut
      );
      if (tool) {
        event.preventDefault();
        this.selectTool(tool.id);
      }
    }
  }
}
