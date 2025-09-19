
# Monorepo – Nächstes Vorgehen (Hands‑on Checkliste)
*Stand: 2025-09-18 — Scope: Tactics (MVP) + Analytics (Recorder MVP)*

---

## 0) Preflight
- Node LTS, npm, Git init
- Optional: GitHub Actions (CI) Vorlage

---

## 1) Workspace & Libs
```bash
npx create-nx-workspace@latest jugger --preset=apps --pm=npm
cd jugger
npx nx add @nx/angular

# Apps
npx nx g @nx/angular:app tactics --routing --style=scss --standalone
npx nx g @nx/angular:app analytics --routing --style=scss --standalone

# Publishable Libs
npx nx g @nx/angular:library core-domain --buildable --publishable --importPath=@juggertools/core-domain
npx nx g @nx/angular:library core-geometry --buildable --publishable --importPath=@juggertools/core-geometry
npx nx g @nx/angular:library core-engine --buildable --publishable --importPath=@juggertools/core-engine
npx nx g @nx/angular:library ui-angular --buildable --publishable --importPath=@juggertools/ui-angular
npx nx g @nx/angular:library tools-draw --buildable --publishable --importPath=@juggertools/tools-draw
npx nx g @nx/angular:library export-screenshot --buildable --publishable --importPath=@juggertools/export-screenshot
```

---

## 2) Core implementieren
- **core-domain**: Modelle aus den Spezifikationen übernehmen.
- **core-geometry**: Transform‑Mathe (Matrix 2D, invert, rotate90, apply) + Unit‑Tests.
- **core-engine**: CanvasEngine (DpR, Layers, Transform, Pointer, Draw).

---

## 3) UI & Tools
- **ui-angular**: `<jugger-field>`, Rotate‑Button, Team‑Panel.
- **tools-draw**: Pen, Arrow, Cone, Select, Erase (minimale Hit‑Tests).
- **export-screenshot**: Offscreen‑Komposition (Panels+Feld) → PNG‑Blob.

---

## 4) Tactics App (MVP)
- CSS‑Grid: left panel | field | right panel; Toolbox rechts.
- Drag&Drop Player → Token (engine.screenToField for Drop).
- Tool‑Switch & Rotate‑Toggle; **Export**‑Button (PNG).

---

## 5) Analytics App (Recorder MVP)
- **data/**: eigener IndexedDB‑Adapter (ohne Fremd‑Lib) + GameService.
- **state/**: Signals/Actions (startTurn, commitTurn, endGame).
- **pages/**: `record-game`, `search`; **components/**: header, player-list, turn-controls, winner-slider.
- JSON‑Export Button.

---

## 6) Tests & CI
```bash
npx nx test core-geometry core-engine analytics
npx nx lint
```
- **E2E** (optional): Cypress Projekte für beide Apps.

---

## 7) Releases
- Build Apps + Libs
```bash
npx nx build tactics
npx nx build analytics
npx nx build core-domain core-geometry core-engine ui-angular tools-draw export-screenshot
```
- Optional: Changesets/SemVer für Lib‑Publishing.

---

## 8) Definition of Done (MVP)
- Rotation = reine View‑Transform (Koordinaten stabil).
- Drag erzeugt Token ±5 px zur Drop‑Position.
- Tools rendern & löschen korrekt.
- Export: PNG Feld+Panels ≤ 2 s @ 1920×1080.
- Recorder: 5+5 Guard, Outcome‑Pflicht, JSON‑Export, Suche funktionsfähig.

---

## 9) Nach MVP (Shortlist)
- Undo/Redo light, JSON Import
- Tierlist (min N), Heatmap‑Vorbereitung (Positions‑Capture)
- Server‑Sync (REST/SQLite‑Drizzle oder Firestore)
