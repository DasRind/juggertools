import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JuggerFieldComponent } from './jugger-field.component';
import { createSceneSnapshot, Team } from '@juggertools/core-domain';

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [
        {
          contentRect: { width: 640, height: 360 },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe('JuggerFieldComponent', () => {
  let fixture: ComponentFixture<JuggerFieldComponent>;
  let component: JuggerFieldComponent;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
  });

  beforeEach(async () => {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    (globalThis as any).cancelAnimationFrame = () => {};

    if (typeof (globalThis as any).PointerEvent === 'undefined') {
      (globalThis as any).PointerEvent = MouseEvent as unknown as typeof PointerEvent;
    }

    (globalThis as any).ResizeObserver = ResizeObserverStub;

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => ({
        setTransform: jest.fn(),
        clearRect: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
      } as unknown as CanvasRenderingContext2D)),
    });

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        left: 0,
        top: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

    await TestBed.configureTestingModule({
      imports: [JuggerFieldComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JuggerFieldComponent);
    component = fixture.componentInstance;

    const host = fixture.nativeElement as HTMLElement;
    host.style.width = '640px';
    host.style.height = '360px';
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    });
  });

  it('emits engineReady once the canvas engine is initialised', () => {
    const left: Team = { id: 'left', name: 'Red Ravens', color: '#f94144', players: [] };
    const right: Team = { id: 'right', name: 'Blue Barrage', color: '#277da1', players: [] };
    component.scene = createSceneSnapshot({
      id: 'scene-1',
      field: { width: 80, height: 50 },
      leftTeam: left,
      rightTeam: right,
    });

    const engineSpy = jest.fn();
    component.engineReady.subscribe(engineSpy);

    fixture.detectChanges();

    expect(engineSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards pointer events', () => {
    const pointerDownSpy = jest.fn();
    component.pointerDown.subscribe(pointerDownSpy);

    fixture.detectChanges();

    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;

    const event = new PointerEvent('pointerdown', {
      clientX: 100,
      clientY: 150,
      buttons: 1,
    });

    canvas.dispatchEvent(event);

    expect(pointerDownSpy).toHaveBeenCalledTimes(1);
    const context = pointerDownSpy.mock.calls[0][0];
    expect(context.type).toBe('down');
    expect(context.canvasPoint).toEqual({ x: 100, y: 150 });
  });
});
