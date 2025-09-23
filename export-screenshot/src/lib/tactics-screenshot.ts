import type { SceneSnapshot, Team, Token } from '@juggertools/core-domain';

const APP_VISUAL_SCALE = 5.4;
const APP_TOKEN_RADIUS = 3.4 * APP_VISUAL_SCALE;
const APP_JUGG_WIDTH = 3.2 * APP_VISUAL_SCALE;
const APP_JUGG_HEIGHT = 7.2 * APP_VISUAL_SCALE;
const JUGG_CORNER_RATIO = 0.28;
const JUGG_ID = 'jugg-token';
const JUGG_DEFAULT_COLOR = '#facc15';
const JUGG_STROKE_COLOR = '#111827';
const FIELD_SURFACE_COLOR = '#c2dcd2';
interface FieldLayoutPoint {
  x: number;
  y: number;
}

interface FieldLayoutLineElement {
  id?: string;
  kind: 'line';
  points: FieldLayoutPoint[];
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  opacity?: number;
  closePath?: boolean;
  fill?: string;
}

interface FieldLayoutCircleElement {
  id?: string;
  kind: 'circle';
  center: FieldLayoutPoint;
  radius: number;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  opacity?: number;
}

type FieldLayoutElement = FieldLayoutLineElement | FieldLayoutCircleElement;

interface FieldLayoutDefinition {
  dimensions: {
    width: number;
    height: number;
  };
  elements: FieldLayoutElement[];
}

interface LinearGradientBackground {
  kind: 'linear-gradient';
  colors: readonly string[];
  angle?: number;
}

interface SolidBackground {
  kind: 'solid';
  color: string;
}

type FieldBackgroundSpec = LinearGradientBackground | SolidBackground;

interface CanvasFieldOverlayRect {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  opacity?: number;
}

interface CanvasFieldOverlayCircle {
  kind: 'circle';
  center: FieldLayoutPoint;
  radius: number;
  fill: string;
  opacity?: number;
}

type CanvasFieldOverlay = CanvasFieldOverlayRect | CanvasFieldOverlayCircle;

interface CanvasFieldBoundary {
  stroke: string;
  width: number;
  inset?: number;
  radius?: number;
  dash?: number[];
  opacity?: number;
}

interface CanvasFieldStyle {
  background?: FieldBackgroundSpec;
  overlays?: CanvasFieldOverlay[];
  boundary?: CanvasFieldBoundary;
}

export interface TacticsScreenshotOptions {
  scene: SceneSnapshot;
  leftTeam?: Team;
  rightTeam?: Team;
  width?: number;
  height?: number;
  padding?: number;
  background?: string;
  devicePixelRatio?: number;
  fieldLayout?: FieldLayoutDefinition;
  fieldStyle?: CanvasFieldStyle;
  fieldLayoutIsNormalized?: boolean;
  includeTeamPanels?: boolean;
}

export async function composeTacticsScreenshot(
  options: TacticsScreenshotOptions
): Promise<Blob> {
  const {
    scene,
    leftTeam,
    rightTeam,
    width = 1600,
    height = 900,
    padding = 32,
    background = '#050d1f',
    devicePixelRatio = globalThis.devicePixelRatio ?? 1,
    fieldLayout,
    fieldStyle,
    fieldLayoutIsNormalized = false,
    includeTeamPanels = true,
  } = options;

  const dpr = Math.max(1, devicePixelRatio);
  const { canvas, ctx } = createCanvas(width, height, dpr);
  if (!ctx) {
    throw new Error(
      'Canvas 2D context unavailable for screenshot composition.'
    );
  }

  ctx.scale(dpr, dpr);
  paintBackground(ctx, width, height, background);

  const showPanels = includeTeamPanels && Boolean(leftTeam && rightTeam);
  const panelWidth = Math.max(240, width * 0.2);
  const leftPanelWidth = showPanels ? panelWidth : 0;
  const rightPanelWidth = showPanels ? panelWidth : 0;
  const fieldArea = {
    x: padding + leftPanelWidth,
    y: padding,
    width: width - leftPanelWidth - rightPanelWidth - padding * 2,
    height: height - padding * 2,
  };

  if (showPanels) {
    paintTeamPanel(ctx, {
      x: padding,
      y: padding,
      width: leftPanelWidth - padding * 0.5,
      height: height - padding * 2,
      team: leftTeam!,
      align: 'left',
    });

    paintTeamPanel(ctx, {
      x: width - padding - (rightPanelWidth - padding * 0.5),
      y: padding,
      width: rightPanelWidth - padding * 0.5,
      height: height - padding * 2,
      team: rightTeam!,
      align: 'right',
    });
  }

  paintScene(ctx, fieldArea, scene, {
    fieldLayout,
    fieldStyle,
    fieldLayoutIsNormalized,
  });

  return await canvasToBlob(canvas);
}

function createCanvas(
  width: number,
  height: number,
  dpr: number
): {
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

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return await (canvas as OffscreenCanvas).convertToBlob({
      type: 'image/png',
    });
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

function paintBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: string
): void {
  if (!background || background.toLowerCase() === 'transparent') {
    ctx.clearRect(0, 0, width, height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, background);
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

function paintTeamPanel(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: TeamPanelOptions
): void {
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
    ctx.fillStyle =
      index % 2 === 0 ? 'rgba(27, 44, 82, 0.55)' : 'rgba(27, 44, 82, 0.35)';
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
  options?: {
    fieldLayout?: FieldLayoutDefinition;
    fieldStyle?: CanvasFieldStyle;
    fieldLayoutIsNormalized?: boolean;
  }
): void {
  const field = snapshot.scene.field;
  const scale = Math.min(area.width / field.width, area.height / field.height);
  const offsetX = area.x + (area.width - field.width * scale) / 2;
  const offsetY = area.y + (area.height - field.height * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const fieldLayout = options?.fieldLayout
    ? resolveLayout(
        options.fieldLayout,
        { width: field.width, height: field.height },
        options.fieldLayoutIsNormalized ?? false
      )
    : undefined;
  const fieldStyle = cloneFieldStyle(options?.fieldStyle);

  if (fieldLayout || fieldStyle) {
    paintFieldWithLayout(
      ctx,
      { width: field.width, height: field.height },
      fieldLayout,
      fieldStyle
    );
  } else {
    paintField(ctx, snapshot);
  }
  paintDrawings(ctx, snapshot.scene.drawings);
  paintTokens(ctx, snapshot.scene.tokens, snapshot);

  ctx.restore();
}

function paintField(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  snapshot: SceneSnapshot
): void {
  const { field } = snapshot.scene;
  ctx.save();
  ctx.fillStyle = field.backgroundColor ?? '#061225';
  ctx.fillRect(0, 0, field.width, field.height);

  if (!field.backgroundColor) {
    const zoneGradient = ctx.createLinearGradient(0, 0, 0, field.height);
    zoneGradient.addColorStop(0, 'rgba(35, 67, 120, 0.45)');
    zoneGradient.addColorStop(0.5, 'rgba(12, 24, 48, 0.2)');
    zoneGradient.addColorStop(1, 'rgba(35, 67, 120, 0.45)');
    ctx.fillStyle = zoneGradient;
    ctx.fillRect(0, 0, field.width, field.height);
  }

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

function paintFieldWithLayout(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dimensions: { width: number; height: number },
  layout?: FieldLayoutDefinition,
  style?: CanvasFieldStyle | undefined
): void {
  const width = dimensions.width;
  const height = dimensions.height;

  ctx.save();
  paintFieldBackground(ctx, width, height, style?.background);
  let boundaryId: string | undefined;
  let boundary: FieldLayoutLineElement | undefined;
  if (layout) {
    boundary = layout.elements.find(
      (element): element is FieldLayoutLineElement =>
        element.kind === 'line' && Boolean(element.closePath)
    );
    fillLayoutBoundary(ctx, boundary, height);
    boundaryId = boundary?.id;
  }
  paintFieldOverlays(ctx, style?.overlays);
  if (layout) {
    paintLayoutElements(ctx, layout.elements, boundaryId);
  }
  paintFieldBoundary(ctx, width, height, style?.boundary);
  ctx.restore();
}

function paintFieldBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: FieldBackgroundSpec | undefined
): void {
  ctx.clearRect(0, 0, width, height);

  if (!background) {
    return;
  }

  if (background.kind === 'solid') {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const angle = ((background.angle ?? 90) * Math.PI) / 180;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const length = Math.abs(directionX) * width + Math.abs(directionY) * height;
  const startX = halfWidth - (directionX * length) / 2;
  const startY = halfHeight - (directionY * length) / 2;
  const endX = halfWidth + (directionX * length) / 2;
  const endY = halfHeight + (directionY * length) / 2;

  const colors = background.colors.length
    ? background.colors
    : ['#0a172c', '#11263f', '#081320'];
  const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
  const stopStep = colors.length > 1 ? 1 / (colors.length - 1) : 1;
  colors.forEach((color, index) => {
    gradient.addColorStop(Math.min(1, Math.max(0, index * stopStep)), color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function paintFieldOverlays(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  overlays: CanvasFieldOverlay[] | undefined
): void {
  overlays?.forEach((overlay) => {
    ctx.save();
    if (overlay.opacity !== undefined) {
      ctx.globalAlpha = overlay.opacity;
    }
    if (overlay.kind === 'rect') {
      ctx.fillStyle = overlay.fill;
      ctx.fillRect(overlay.x, overlay.y, overlay.width, overlay.height);
    } else {
      ctx.fillStyle = overlay.fill;
      ctx.beginPath();
      ctx.arc(
        overlay.center.x,
        overlay.center.y,
        overlay.radius,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  });
}

function paintLayoutElements(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  elements: FieldLayoutElement[],
  skipBoundaryId?: string
): void {
  elements.forEach((element) => {
    if (
      skipBoundaryId &&
      element.kind === 'line' &&
      element.closePath &&
      element.id === skipBoundaryId
    ) {
      return;
    }
    if (element.kind === 'line') {
      ctx.save();
      if (element.opacity !== undefined) {
        ctx.globalAlpha = element.opacity;
      }
      ctx.strokeStyle = element.stroke ?? 'rgba(248, 250, 252, 0.65)';
      ctx.lineWidth = element.strokeWidth ?? 0.35;
      ctx.setLineDash(element.dash ?? []);
      ctx.beginPath();
      element.points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      if (element.closePath) {
        ctx.closePath();
      }
      if (element.fill) {
        ctx.fillStyle = element.fill;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    ctx.save();
    if (element.opacity !== undefined) {
      ctx.globalAlpha = element.opacity;
    }
    ctx.strokeStyle = element.stroke ?? 'rgba(248, 250, 252, 0.65)';
    ctx.lineWidth = element.strokeWidth ?? 0.35;
    ctx.setLineDash(element.dash ?? []);
    ctx.beginPath();
    ctx.arc(element.center.x, element.center.y, element.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function fillLayoutBoundary(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  boundary: FieldLayoutLineElement | undefined,
  height: number
): void {
  if (!boundary || boundary.points.length < 3) {
    return;
  }
  ctx.save();
  ctx.fillStyle = FIELD_SURFACE_COLOR;
  ctx.beginPath();
  boundary.points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.restore();
}

function paintFieldBoundary(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  boundary: CanvasFieldBoundary | undefined
): void {
  if (!boundary) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = boundary.stroke;
  ctx.lineWidth = boundary.width;
  ctx.setLineDash(boundary.dash ?? []);
  if (boundary.opacity !== undefined) {
    ctx.globalAlpha = boundary.opacity;
  }
  const inset = boundary.inset ?? 0;
  const radius = boundary.radius ?? 0;
  roundRect(
    ctx,
    inset,
    inset,
    Math.max(0, width - inset * 2),
    Math.max(0, height - inset * 2),
    radius
  );
  ctx.stroke();
  ctx.restore();
}

function paintDrawings(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  drawings: SceneSnapshot['scene']['drawings']
): void {
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

    if (drawing.kind === 'line' && drawing.points.length > 1) {
      ctx.save();
      ctx.strokeStyle = drawing.stroke;
      ctx.lineWidth = drawing.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
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
  snapshot: SceneSnapshot
): void {
  const colorByTeam = new Map<string, string>();
  colorByTeam.set(snapshot.leftTeam.id, snapshot.leftTeam.color ?? '#f87171');
  colorByTeam.set(snapshot.rightTeam.id, snapshot.rightTeam.color ?? '#60a5fa');

  tokens.forEach((token) => {
    const color = resolveTokenColor(token, colorByTeam);
    const isJugg = token.id === JUGG_ID || token.shape === 'rectangle';
    ctx.save();
    ctx.shadowColor = 'rgba(5, 10, 20, 0.55)';
    ctx.shadowBlur = 2.5;
    ctx.fillStyle = color;
    if (isJugg) {
      const width = token.width ?? APP_JUGG_WIDTH;
      const height = token.height ?? APP_JUGG_HEIGHT;
      const halfWidth = width / 2;
      const halfHeight = height / 2;
      const radius = Math.min(width, height) * JUGG_CORNER_RATIO;
      const rectX = token.x - halfWidth;
      const rectY = token.y - halfHeight;
      roundRect(ctx, rectX, rectY, width, height, radius);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = JUGG_STROKE_COLOR;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(token.x, token.y, APP_TOKEN_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.fillStyle = '#061225';
      ctx.font = `${APP_TOKEN_RADIUS * 0.8}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label =
        token.label ?? token.playerId?.slice(0, 2)?.toUpperCase() ?? '•';
      ctx.fillText(label, token.x, token.y);
    }
    ctx.restore();
  });
}

function resolveTokenColor(
  token: Token,
  colorByTeam: Map<string, string>
): string {
  if (token.color) {
    return token.color;
  }
  if (token.id === JUGG_ID || token.shape === 'rectangle') {
    return JUGG_DEFAULT_COLOR;
  }
  return colorByTeam.get(token.teamId) ?? '#f8fafc';
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(0.001, Math.hypot(to.x - from.x, to.y - from.y));
  const head = Math.min(length * 0.4, size);
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

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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

function resolveLayout(
  layout: FieldLayoutDefinition,
  target: { width: number; height: number },
  normalized: boolean
): FieldLayoutDefinition {
  const sourceWidth = normalized ? 100 : layout.dimensions.width;
  const sourceHeight = normalized ? 100 : layout.dimensions.height;
  const scaleX = sourceWidth === 0 ? 1 : target.width / sourceWidth;
  const scaleY = sourceHeight === 0 ? 1 : target.height / sourceHeight;
  const strokeScale = sourceHeight === 0 ? 1 : target.height / sourceHeight;

  return {
    dimensions: { ...target },
    elements: layout.elements.map((element) => {
      if (element.kind === 'line') {
        return {
          ...element,
          points: element.points.map((point) => ({
            x: point.x * scaleX,
            y: point.y * scaleY,
          })),
          strokeWidth:
            element.strokeWidth !== undefined
              ? element.strokeWidth * strokeScale
              : undefined,
          dash: element.dash
            ? element.dash.map((value) => value * strokeScale)
            : undefined,
        } satisfies FieldLayoutLineElement;
      }
      return {
        ...element,
        center: {
          x: element.center.x * scaleX,
          y: element.center.y * scaleY,
        },
        radius: element.radius * strokeScale,
        strokeWidth:
          element.strokeWidth !== undefined
            ? element.strokeWidth * strokeScale
            : undefined,
        dash: element.dash
          ? element.dash.map((value) => value * strokeScale)
          : undefined,
      } satisfies FieldLayoutCircleElement;
    }),
  };
}

function cloneFieldStyle(
  style: CanvasFieldStyle | undefined
): CanvasFieldStyle | undefined {
  if (!style) {
    return undefined;
  }

  return {
    background: !style.background
      ? undefined
      : style.background.kind === 'linear-gradient'
      ? {
          kind: 'linear-gradient' as const,
          angle: style.background.angle,
          colors: [...style.background.colors],
        }
      : { kind: 'solid' as const, color: style.background.color },
    overlays: style.overlays?.map((overlay) =>
      overlay.kind === 'rect'
        ? { ...overlay }
        : {
            ...overlay,
            center: { ...overlay.center },
          }
    ),
    boundary: style.boundary
      ? {
          ...style.boundary,
          dash: style.boundary.dash ? [...style.boundary.dash] : undefined,
        }
      : undefined,
  };
}
