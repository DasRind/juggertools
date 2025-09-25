import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import type { SceneSnapshot } from '@juggertools/core-domain';
import {
  CanvasEngine,
  EngineViewport,
  PointerContext,
} from '@juggertools/core-engine';
import {
  IDENTITY_MATRIX,
  composeTransforms,
  matrixApplyToPoint,
  matrixMultiply,
  matrixScale,
  matrixTranslate,
} from '@juggertools/core-geometry';

const FIELD_VIEW_PADDING = 24;

@Component({
  standalone: true,
  selector: 'jugger-field',
  templateUrl: './jugger-field.component.html',
  styleUrl: './jugger-field.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class JuggerFieldComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() scene?: SceneSnapshot;
  @Input() flipHorizontal = false;
  @Input() rotateQuarterTurn = false;

  @Output() engineReady = new EventEmitter<CanvasEngine>();
  @Output() pointerDown = new EventEmitter<PointerContext>();
  @Output() pointerMove = new EventEmitter<PointerContext>();
  @Output() pointerUp = new EventEmitter<PointerContext>();
  @Output() pointerCancel = new EventEmitter<PointerContext>();
  @Output() viewportChange = new EventEmitter<EngineViewport>();

  @ViewChild('canvas', { static: true })
  private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  private engine?: CanvasEngine;
  private resizeObserver?: ResizeObserver;
  private pointerDisposers: Array<() => void> = [];
  private viewport: EngineViewport = { width: 0, height: 0 };

  constructor(
    private readonly ngZone: NgZone,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.ngZone.runOutsideAngular(() => {
      this.initializeEngine();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.engine) {
      return;
    }

    if (changes['scene']) {
      this.updateScene();
    }
    if (changes['flipHorizontal'] && !changes['flipHorizontal'].firstChange) {
      this.updateTransform();
    }
    if (
      changes['rotateQuarterTurn'] &&
      !changes['rotateQuarterTurn'].firstChange
    ) {
      this.updateTransform();
    }
  }

  ngOnDestroy(): void {
    this.pointerDisposers.forEach((dispose) => dispose());
    this.pointerDisposers = [];
    this.resizeObserver?.disconnect();
    this.engine?.destroy();
    this.engine = undefined;
  }

  private initializeEngine(): void {
    const canvas = this.canvasRef.nativeElement;
    const engine = new CanvasEngine(canvas);
    this.engine = engine;

    this.pointerDisposers = [
      engine.onPointer('down', (context) => this.pointerDown.emit(context)),
      engine.onPointer('move', (context) => this.pointerMove.emit(context)),
      engine.onPointer('up', (context) => this.pointerUp.emit(context)),
      engine.onPointer('cancel', (context) => this.pointerCancel.emit(context)),
    ];

    this.setupResizeObserver();
    this.viewport = this.measureViewport();
    if (this.viewport.width > 0 && this.viewport.height > 0) {
      engine.resize(this.viewport.width, this.viewport.height);
    }

    this.updateScene();

    this.engineReady.emit(engine);
    this.viewportChange.emit(this.viewport);
    this.updateTransform();
  }

  private setupResizeObserver(): void {
    const canvas = this.canvasRef.nativeElement;
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const width = entry.contentRect?.width ?? canvas.clientWidth;
      const height = entry.contentRect?.height ?? canvas.clientHeight;
      this.handleResize(width, height);
    });
    this.resizeObserver.observe(canvas);
  }

  private handleResize(width: number, height: number): void {
    if (!this.engine) {
      return;
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (safeWidth === this.viewport.width && safeHeight === this.viewport.height) {
      return;
    }
    this.viewport = { width: safeWidth, height: safeHeight };
    this.engine.resize(safeWidth, safeHeight);
    this.updateTransform();
    this.viewportChange.emit(this.viewport);
  }

  private measureViewport(): EngineViewport {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || canvas.width;
    const height = rect.height || canvas.clientHeight || canvas.height;
    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  }

  private updateScene(): void {
    if (!this.engine) {
      return;
    }
    this.engine.setScene(this.scene);
    this.updateTransform();
  }

  private updateTransform(): void {
    if (!this.engine) {
      return;
    }
    const scene = this.scene;
    if (!scene) {
      return;
    }
    if (this.viewport.width <= 0 || this.viewport.height <= 0) {
      return;
    }

    this.syncViewportSize();

    const { field, orientation } = scene.scene;

    const orientationTransform =
      orientation === 'portrait'
        ? matrixMultiply(
            matrixTranslate(field.height, 0),
            { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 }
          )
        : IDENTITY_MATRIX;

    let viewTransform = IDENTITY_MATRIX;
    let effectiveWidth =
      orientation === 'portrait' ? field.height : field.width;
    let effectiveHeight =
      orientation === 'portrait' ? field.width : field.height;

    if (this.rotateQuarterTurn) {
      const rotation = matrixMultiply(
        matrixTranslate(0, effectiveWidth),
        { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 }
      );
      viewTransform = matrixMultiply(rotation, viewTransform);
      const nextWidth = effectiveHeight;
      const nextHeight = effectiveWidth;
      effectiveWidth = nextWidth;
      effectiveHeight = nextHeight;
    }

    if (this.flipHorizontal) {
      const reflection = matrixMultiply(
        matrixTranslate(effectiveWidth, 0),
        matrixScale(-1, 1)
      );
      viewTransform = matrixMultiply(reflection, viewTransform);
    }

    const preTransform = matrixMultiply(viewTransform, orientationTransform);

    const corners = [
      { x: 0, y: 0 },
      { x: field.width, y: 0 },
      { x: field.width, y: field.height },
      { x: 0, y: field.height },
    ].map((point) => matrixApplyToPoint(preTransform, point));

    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);

    const padding = FIELD_VIEW_PADDING;
    const paddedWidth = Math.max(1, this.viewport.width - padding * 2);
    const paddedHeight = Math.max(1, this.viewport.height - padding * 2);
    const scale = Math.min(paddedWidth / contentWidth, paddedHeight / contentHeight);

    const transform = composeTransforms([
      matrixTranslate(
        padding + (paddedWidth - contentWidth * scale) / 2,
        padding + (paddedHeight - contentHeight * scale) / 2
      ),
      matrixScale(scale),
      matrixTranslate(-minX, -minY),
      preTransform,
    ]);

    this.engine.setTransform(transform);
    this.engine.draw();
  }

  private syncViewportSize(): void {
    if (!this.engine) {
      return;
    }
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || canvas.clientWidth || canvas.width));
    const height = Math.max(1, Math.floor(rect.height || canvas.clientHeight || canvas.height));
    if (width === this.viewport.width && height === this.viewport.height) {
      return;
    }
    this.viewport = { width, height };
    this.engine.resize(width, height);
    this.viewportChange.emit(this.viewport);
  }
}
