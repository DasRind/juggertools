import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SceneSnapshot } from '@juggertools/core-domain';
import {
  CanvasEngine,
  PointerContext,
  PointerEventType,
  LayerId,
} from '@juggertools/core-engine';

@Component({
  selector: 'jugger-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './jugger-field.component.html',
  styleUrls: ['./jugger-field.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JuggerFieldComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: false })
  scene?: SceneSnapshot;

  @Input({ required: false })
  devicePixelRatio?: number;

  @Input({ required: false })
  layers?: LayerId[];

  @Output()
  readonly engineReady = new EventEmitter<CanvasEngine>();

  @Output()
  readonly pointerDown = new EventEmitter<PointerContext>();

  @Output()
  readonly pointerMove = new EventEmitter<PointerContext>();

  @Output()
  readonly pointerUp = new EventEmitter<PointerContext>();

  @Output()
  readonly pointerCancel = new EventEmitter<PointerContext>();

  @ViewChild('fieldCanvas', { static: true })
  private readonly canvasRef?: ElementRef<HTMLCanvasElement>;

  private engine?: CanvasEngine;
  private pointerDisposers: Array<() => void> = [];
  private resizeObserver?: ResizeObserver;
  private readonly resizeListener = () => this.syncCanvasSize();

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    private readonly ngZone: NgZone,
  ) {}

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.setupEngine());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['scene'] && this.engine) {
      this.ngZone.runOutsideAngular(() => this.engine?.setScene(this.scene));
    }
  }

  ngOnDestroy(): void {
    this.pointerDisposers.forEach((dispose) => dispose());
    this.pointerDisposers = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener('resize', this.resizeListener);
    this.engine?.destroy();
    this.engine = undefined;
  }

  private setupEngine(): void {
    if (this.engine || !this.canvasRef) {
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    const engine = new CanvasEngine(canvas, {
      devicePixelRatio: this.devicePixelRatio,
      layers: this.layers,
    });

    if (this.scene) {
      engine.setScene(this.scene);
    }

    this.engine = engine;
    this.registerPointerForwarding(engine);
    this.engineReady.emit(engine);
    this.syncCanvasSize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        this.syncCanvasSize(entry.contentRect.width, entry.contentRect.height);
      });
      this.resizeObserver.observe(this.host.nativeElement);
    } else {
      window.addEventListener('resize', this.resizeListener, { passive: true });
    }
  }

  private registerPointerForwarding(engine: CanvasEngine): void {
    const forward = (type: PointerEventType, emitter: EventEmitter<PointerContext>) =>
      engine.onPointer(type, (context) => {
        this.ngZone.run(() => emitter.emit(context));
      });

    this.pointerDisposers.push(
      forward('down', this.pointerDown),
      forward('move', this.pointerMove),
      forward('up', this.pointerUp),
      forward('cancel', this.pointerCancel),
    );
  }

  private syncCanvasSize(fallbackWidth?: number, fallbackHeight?: number): void {
    if (!this.engine || !this.canvasRef) {
      return;
    }

    const hostElement = this.host.nativeElement;
    const width = fallbackWidth ?? hostElement.clientWidth;
    const height = fallbackHeight ?? hostElement.clientHeight;

    if (width > 0 && height > 0) {
      this.engine.resize(width, height);
      return;
    }

    const rect = hostElement.getBoundingClientRect();
    const computedWidth = rect.width || fallbackWidth || 640;
    const computedHeight = rect.height || fallbackHeight || 360;
    this.engine.resize(computedWidth, computedHeight);
  }
}
