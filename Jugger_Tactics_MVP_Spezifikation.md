
# Jugger Tactics — MVP → v1
*Stand: 2025-09-18 — Autor: Das Rind*

---

## 1) Executive Summary
Ein **leichtgewichtiges 2D-Top‑Down Taktik‑Tool für Jugger** als **Angular**‑App. Rendering basiert auf **Canvas 2D + Pointer Events** (eigene mini‑Engine, kommerziell nutzbar). Schwerpunkt: schnelles Skizzieren, einfache Platzierung von Spieler‑Tokens, und **PNG‑Export** (Feld + Teamleisten) — ohne html2canvas.

**MVP umfasst:**
- Jugger‑Feld mit **90°‑Drehknopf** (Portrait/Landscape; Rotation = reine View‑Transform).
- **Team‑Panels** links/rechts mit **Playercards** → Drag & Drop aufs Feld erzeugt **Token**.
- **Toolbox**: Select, Pen, Arrow, Cone/Hütchen, Erase; einfache Farb/Width‑Optionen.
- **Export‑Button**: **PNG Screenshot** (eigene Offscreen‑Komposition).

**Nicht‑Ziele (MVP):** PDF‑Editing, Timeline/Video‑Export, generischer PDF‑Editor.

---

## 2) Zielgruppe & Use Cases
- **Coach/Captain**: Taktik‑Skizzen vor Training/Spiel → PNG im Teamchat teilen.
- **Spieler:innen**: Laufwege/Positionen auf einen Blick.
- **Wiederverwendung**: Komponenten/Engine für weitere Projekte (Analytics/Recorder).

---

## 3) Funktionsumfang (MVP)
### 3.1 Feld & Rotation
- Parametrisierbares Jugger‑Feld (Maße/Markierungen).
- **90° Toggle** Portrait ↔ Landscape, Daten bleiben in Feldkoordinaten stabil.

### 3.2 Team‑Panels & Playercards
- Team‑Infos (Name, Farbe, optional Logo/Avatar).
- Drag & Drop Playercard → Token auf Feld (x,y in Feldkoordinaten).

### 3.3 Toolbox
- **Select** (move), **Pen** (Freihand), **Arrow** (Vektor + Spitze), **Cone** (Marker/Radius), **Erase**.
- Style‑Optionen: Farbe, Strichstärke (einfach).

### 3.4 Export
- **PNG** via kontrollierter **OffscreenCanvas‑Komposition**: Links‑Panel, Feld, Rechts‑Panel.
- DPI‑Skalierung; keine Fremd‑Abhängigkeit.

---

## 4) Architektur (High‑Level)
```
apps/
  tactics/
libs/
  core-domain/        # Modelle (Field, Team, Player, Token, Drawing, Scene)
  core-geometry/      # Mathe: Transform/Rotation, Hit-Tests
  core-engine/        # Canvas-Renderer + Scene-Graph + Pointer-Input
  ui-angular/         # Angular-Komponenten (FieldCanvas, Toolbox, TeamPanel)
  tools-draw/         # Tool-Plugins (Pen/Arrow/Cone/Select/Erase)
  export-screenshot/  # Offscreen-Canvas Komposition (PNG)
```

- **Zero‑deps Core**: keine externe Zeichen‑Engine, dünne Angular‑Wrapper.
- **Eventing**: `(sceneChange)` für Two‑Way‑Binding, Undo/Redo später.

---

## 5) Technisches Design (Auszug)
### 5.1 Datenmodell
```ts
export interface FieldSpec {
  width: number; height: number;
  lines?: { kind: "center" | "zone" | "mark"; x1:number; y1:number; x2:number; y2:number }[];
}
export type Orientation = "landscape" | "portrait";
export interface Team { id:string; name:string; color:string; logoUrl?:string; players: Player[]; }
export interface Player { id:string; name:string; role?: string; number?: string; avatarUrl?: string; }
export interface Token { id:string; teamId:string; playerId?:string; x:number; y:number; rotation?:number; label?:string; }
export type Drawing =
  | { id:string; kind:"pen"; points:{x:number;y:number}[]; stroke:string; width:number }
  | { id:string; kind:"arrow"; from:{x:number;y:number}; to:{x:number;y:number}; stroke:string; width:number }
  | { id:string; kind:"cone"; at:{x:number;y:number}; radius:number; fill:string };
export interface Scene { id:string; field:FieldSpec; orientation:Orientation; tokens:Token[]; drawings:Drawing[]; leftTeamId:string; rightTeamId:string; }
```

### 5.2 Rendering & Input
- **Stage/Layers**: background, drawings, tokens, overlay; DpR‑Aware.
- **Transform M**: Fit + Rotation; **M⁻¹** für Input‑Mapping.
- **Tools** folgen Interface `{{ onPointerDown/Move/Up; drawOverlay? }}`.

### 5.3 Export (PNG)
- Zusammensetzen per OffscreenCanvas (Panels+Feld), `convertToBlob('image/png')`.

---

## 6) Tests & Qualität
- **Unit**: core‑geometry (Matrix/Invert/Hit‑Tests), Tool‑Logik.
- **Component**: Angular‑Wrapper (Events, Change Detection).
- **E2E**: Drag Player → Token; Pfeil zeichnen; Export ≠ 0 Bytes.
- **Performance**: Pfad‑Simplify für Pen; gecachter Feld‑Hintergrund.

---

## 7) Roadmap
- **Phase 0**: Nx‑Workspace, Lib‑Skeletons, CI, Lint/Format.
- **Phase 1**: FieldCanvas + Panels + Drag→Token.
- **Phase 2**: Toolbox (Pen/Arrow/Cone/Erase).
- **Phase 3**: PNG‑Export.
- **Phase 4**: Politur (Undo/Redo light, JSON Import/Export, Storybook).

---

## 8) Akzeptanzkriterien (MVP)
- 90° Rotation ändert nur View; Datenkoordinaten stabil.
- Drag & Drop erzeugt Token **±5 px** zur Drop‑Position.
- Tools zeichnen mit korrekter Z‑Reihenfolge & Hit‑Boxen.
- Export erzeugt PNG (Feld **+** beide Panels) ≤ 2 s @ 1920×1080.
