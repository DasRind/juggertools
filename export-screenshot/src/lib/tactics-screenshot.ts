import type { SceneSnapshot, Team } from '@juggertools/core-domain';

export interface TacticsScreenshotOptions {
  scene: SceneSnapshot;
  leftTeam: Team;
  rightTeam: Team;
  width?: number;
  height?: number;
  padding?: number;
  background?: string;
  devicePixelRatio?: number;
}

export async function composeTacticsScreenshot(options: TacticsScreenshotOptions): Promise<Blob> {
  const {
    scene,
    leftTeam,
    rightTeam,
    width = 1600,
    height = 900,
    padding = 32,
    background = '#050d1f',
    devicePixelRatio = globalThis.devicePixelRatio ?? 1,
  } = options;

  const dpr = Math.max(1, devicePixelRatio);
  const { canvas, ctx } = createCanvas(width, height, dpr);
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable for screenshot composition.');
  }

  ctx.scale(dpr, dpr);
  paintBackground(ctx, width, height, background);

  const leftPanelWidth = Math.max(240, width * 0.2);
  const rightPanelWidth = leftPanelWidth;
  const fieldArea = {
    x: padding + leftPanelWidth,
    y: padding,
    width: width - leftPanelWidth - rightPanelWidth - padding * 2,
    height: height - padding * 2,
  };

  paintTeamPanel(ctx, {
    x: padding,
    y: padding,
    width: leftPanelWidth - padding * 0.5,
    height: height - padding * 2,
    team: leftTeam,
    align: 'left',
  });

  paintTeamPanel(ctx, {
    x: width - padding - (rightPanelWidth - padding * 0.5),
    y: padding,
    width: rightPanelWidth - padding * 0.5,
    height: height - padding * 2,
    team: rightTeam,
    align: 'right',
  });

  paintScene(ctx, fieldArea, scene);

  return await canvasToBlob(canvas);
}

function createCanvas(width: number, height: number, dpr: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width * dpr, height * dpr);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  throw new Error('No canvas implementation available.');
}

async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  }

  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Unable to convert canvas to blob.'));
      }
    }, 'image/png');
  });
}

function paintBackground(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, background: string): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, '#0b1f3c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

interface TeamPanelOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  team: Team;
  align: 'left' | 'right';
}

function paintTeamPanel(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, options: TeamPanelOptions): void {
  const { x, y, width, height, team, align } = options;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(15, 25, 48, 0.85)';
  roundRect(ctx, 0, 0, width, height, 18);
  ctx.fill();

  ctx.fillStyle = team.color ?? '#ffffff';
  ctx.font = '28px Inter, sans-serif';
  ctx.textAlign = align === 'left' ? 'left' : 'right';
  ctx.textBaseline = 'top';
  const titleX = align === 'left' ? 24 : width - 24;
  ctx.fillText(team.name, titleX, 24);

  ctx.font = '16px Inter, sans-serif';
  ctx.fillStyle = 'rgba(148, 178, 230, 0.85)';
  ctx.fillText(`Roster (${team.players.length})`, titleX, 62);

  const rowHeight = 32;
  const startY = 108;
  ctx.font = '16px Inter, sans-serif';
  ctx.fillStyle = '#e5ecff';

  team.players.forEach((player, index) => {
    const rowY = startY + index * rowHeight;
    ctx.fillStyle = index % 2 === 0 ? 'rgba(27, 44, 82, 0.55)' : 'rgba(27, 44, 82, 0.35)';
    roundRect(ctx, 16, rowY - 4, width - 32, rowHeight - 4, 10);
    ctx.fill();

    ctx.fillStyle = '#82d9ff';
    ctx.textAlign = align === 'left' ? 'left' : 'right';
    const numberX = align === 'left' ? 32 : width - 32;
    ctx.fillText(player.number ?? '—', numberX, rowY);

    ctx.fillStyle = '#e8f3ff';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, width / 2, rowY);

    ctx.fillStyle = '#9fb1d9';
    ctx.textAlign = align === 'left' ? 'right' : 'left';
    const roleX = align === 'left' ? width - 32 : 32;
    ctx.fillText(player.role ?? '', roleX, rowY);
  });
  ctx.restore();
}

function paintScene(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  area: { x: number; y: number; width: number; height: number },
  snapshot: SceneSnapshot,
): void {
  const field = snapshot.scene.field;
  const scale = Math.min(area.width / field.width, area.height / field.height);
  const offsetX = area.x + (area.width - field.width * scale) / 2;
  const offsetY = area.y + (area.height - field.height * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  paintField(ctx, snapshot);
  paintDrawings(ctx, snapshot.scene.drawings);
  paintTokens(ctx, snapshot.scene.tokens, snapshot);

  ctx.restore();
}

function paintField(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, snapshot: SceneSnapshot): void {
  const { field } = snapshot.scene;
  ctx.save();
  ctx.fillStyle = '#061225';
  ctx.fillRect(0, 0, field.width, field.height);

  const zoneGradient = ctx.createLinearGradient(0, 0, 0, field.height);
  zoneGradient.addColorStop(0, 'rgba(35, 67, 120, 0.45)');
  zoneGradient.addColorStop(0.5, 'rgba(12, 24, 48, 0.2)');
  zoneGradient.addColorStop(1, 'rgba(35, 67, 120, 0.45)');
  ctx.fillStyle = zoneGradient;
  ctx.fillRect(0, 0, field.width, field.height);

  ctx.strokeStyle = '#123062';
  ctx.lineWidth = 0.35;
  field.lines?.forEach((line) => {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  });

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([1.5, 1.5]);
  ctx.beginPath();
  ctx.arc(field.width / 2, field.height / 2, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function paintDrawings(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, drawings: SceneSnapshot['scene']['drawings']): void {
  drawings.forEach((drawing) => {
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
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(drawing.from.x, drawing.from.y);
      ctx.lineTo(drawing.to.x, drawing.to.y);
      ctx.stroke();
      drawArrowHead(ctx, drawing.from, drawing.to, drawing.width * 3.2);
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

function paintTokens(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  tokens: SceneSnapshot['scene']['tokens'],
  snapshot: SceneSnapshot,
): void {
  const colorByTeam = new Map<string, string>();
  colorByTeam.set(snapshot.leftTeam.id, snapshot.leftTeam.color ?? '#f87171');
  colorByTeam.set(snapshot.rightTeam.id, snapshot.rightTeam.color ?? '#60a5fa');

  tokens.forEach((token) => {
    const color = colorByTeam.get(token.teamId) ?? '#f8fafc';
    ctx.save();
    ctx.shadowColor = 'rgba(5, 10, 20, 0.55)';
    ctx.shadowBlur = 2.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(token.x, token.y, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 0.2;
    ctx.stroke();

    ctx.fillStyle = '#061225';
    ctx.font = '1.6px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = token.label ?? token.playerId?.slice(0, 2)?.toUpperCase() ?? '•';
    ctx.fillText(label, token.x, token.y);
    ctx.restore();
  });
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
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
