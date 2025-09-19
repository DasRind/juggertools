const createMockContext = () => ({
  scale: jest.fn(),
  fillRect: jest.fn(),
  createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  save: jest.fn(),
  restore: jest.fn(),
  translate: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  fill: jest.fn(),
  arc: jest.fn(),
  closePath: jest.fn(),
  fillText: jest.fn(),
  quadraticCurveTo: jest.fn(),
  setLineDash: jest.fn(),
  font: '',
  lineJoin: '',
  lineCap: '',
  lineWidth: 0,
  strokeStyle: '',
  fillStyle: '',
  shadowColor: '',
  shadowBlur: 0,
  textAlign: '',
  textBaseline: '',
});

import { createSceneSnapshot, Team } from '@juggertools/core-domain';
import { composeTacticsScreenshot } from './tactics-screenshot';

describe('composeTacticsScreenshot', () => {
  beforeAll(() => {
    (HTMLCanvasElement.prototype as any).toBlob = function toBlob(callback: BlobCallback, type?: string) {
      const data = (this as HTMLCanvasElement).toDataURL(type);
      const byteString = atob(data.split(',')[1] ?? '');
      const buffer = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) {
        buffer[i] = byteString.charCodeAt(i);
      }
      callback(new Blob([buffer], { type: type ?? 'image/png' }));
    };
    (HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,' + btoa('mock');
  });

  beforeEach(() => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      createMockContext() as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a PNG blob for the given scene', async () => {
    const leftTeam: Team = { id: 'left', name: 'Left', color: '#f00', players: [] };
    const rightTeam: Team = { id: 'right', name: 'Right', color: '#0f0', players: [] };
    const scene = createSceneSnapshot({
      id: 'scene-test',
      field: { width: 80, height: 50 },
      leftTeam,
      rightTeam,
    });

    const blob = await composeTacticsScreenshot({ scene, leftTeam, rightTeam, width: 800, height: 600 });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
