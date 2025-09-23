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
  fitSceneToViewport,
} from '@juggertools/core-engine';
import {
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

    const base = fitSceneToViewport(scene, this.viewport, {
      padding: FIELD_VIEW_PADDING,
    });
    if (this.flipHorizontal) {
      const fieldWidth = scene.scene.field.width;
      const reflection = matrixMultiply(
        matrixTranslate(fieldWidth, 0),
        matrixScale(-1, 1)
      );
      this.engine.setTransform(matrixMultiply(base, reflection));
    } else {
      this.engine.setTransform(base);
    }
    this.engine.draw();
  }
}
