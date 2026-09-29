// Disposable input-test target for P1-05.
//
// Purpose: decide, from ground truth, whether a driver click/type/scroll lands where
// it was aimed. The app reports what it received to a log file, so a driver's own
// "it worked" observation is never the only evidence.
//
// Design notes that matter:
//  - The client area is a labelled grid. Each cell logs the cell that received a
//    mousedown, so a coordinate error (for example a 1.5x DPI mistake) shows up as the
//    wrong cell rather than as a vague "click landed somewhere".
//  - Every mouse and key event logs both the down and the up, so an unmatched down is
//    detectable. That is how "cancellation released the key/mouse" is checked: a stuck
//    press leaves an unmatched down.
//  - The log is append-only JSONL in a directory the runner owns, outside the repo.
//
// It is never shown to the user as a product surface and holds no real data.

import { app, BrowserWindow, ipcMain } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const logPath = process.env.P1_05_TARGET_LOG ?? join(app.getPath("temp"), "p1-05-target.jsonl");
const geometryPath = process.env.P1_05_TARGET_GEOMETRY;

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "");

function log(entry) {
  appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, "utf8");
}

// The grid: 4 columns x 3 rows of 120x90 CSS pixels, so a cell is big enough to hit
// reliably while an offset of one cell is still detectable.
const GRID_COLUMNS = 4;
const GRID_ROWS = 3;
const CELL_WIDTH = 120;
const CELL_HEIGHT = 90;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>P1-05 input target</title>
<style>
  html,body{margin:0;padding:0;background:#101318;color:#e6e9ef;font-family:system-ui,sans-serif;user-select:none}
  #grid{display:grid;grid-template-columns:repeat(${GRID_COLUMNS},${CELL_WIDTH}px);grid-auto-rows:${CELL_HEIGHT}px}
  .cell{display:flex;align-items:center;justify-content:center;border:1px solid #2a2f3a;font-size:13px;color:#9aa2b1}
  .cell.hit{background:#1d3b2a;color:#8ef0b0}
  #controls{padding:8px;display:flex;flex-direction:column;gap:6px}
  button,input{font:inherit;padding:4px 8px}
  #scroller{height:60px;overflow-y:scroll;border:1px solid #2a2f3a;margin:8px}
  #scroller div{height:30px}
</style></head>
<body>
  <div id="grid"></div>
  <div id="controls">
    <button id="counter">count: 0</button>
    <input id="text" placeholder="type here" />
    <div id="scroller"><div>s0</div><div>s1</div><div>s2</div><div>s3</div><div>s4</div><div>s5</div><div>s6</div><div>s7</div><div>s8</div><div>s9</div></div>
  </div>
<script>
  const report = (event, payload) => window.p1Target.report(event, payload);
  const grid = document.getElementById('grid');

  // Cells are appended in row-major order so cell row/column labels match the DOM.
  for (let r = 0; r < ${GRID_ROWS}; r++) {
    for (let c = 0; c < ${GRID_COLUMNS}; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = 'cell-' + r + '-' + c;
      cell.textContent = r + ',' + c;
      cell.addEventListener('mousedown', (e) => {
        const rect = cell.getBoundingClientRect();
        cell.classList.add('hit');
        report('cell-mousedown', {
          cell: r + ',' + c,
          // Window-relative client coordinates of the press, so the runner can
          // compute exactly how far from the intended centre the click landed.
          offsetInCell: { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) },
          clientPoint: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
        });
      });
      grid.appendChild(cell);
    }
  }

  let count = 0;
  document.getElementById('counter').addEventListener('click', () => {
    count += 1;
    document.getElementById('counter').textContent = 'count: ' + count;
    report('counter-click', { count });
  });
  document.getElementById('text').addEventListener('input', (e) => {
    report('text-input', { value: e.target.value });
  });
  document.getElementById('scroller').addEventListener('scroll', (e) => {
    report('scroll', { scrollTop: e.target.scrollTop });
  });

  window.addEventListener('mousedown', () => report('mouse-down', {}));
  window.addEventListener('mouseup', () => report('mouse-up', {}));
  window.addEventListener('keydown', (e) => report('key-down', { key: e.key }));
  window.addEventListener('keyup', (e) => report('key-up', { key: e.key }));
  // Every wheel event, regardless of which element is under the pointer. Without this, "no scroll event"
  // cannot be told apart from "the wheel arrived but was not over the scrollable strip", which are
  // completely different failures.
  window.addEventListener('wheel', (e) => {
    const target = e.target;
    // What is actually under the pointer, so "the wheel arrived over the strip" is measured rather than
    // inferred from the coordinates we aimed at.
    const under =
      typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(Math.round(e.clientX), Math.round(e.clientY))
        : null;
    report('wheel', {
      clientPoint: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
      deltaY: Math.round(e.deltaY),
      overScroller: target instanceof Element ? Boolean(target.closest('#scroller')) : false,
      elementUnderPoint: under ? under.id || under.tagName : null,
      scrollerScrollTop: document.getElementById('scroller').scrollTop,
    });
  }, { passive: true });
</script>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: GRID_COLUMNS * CELL_WIDTH + 20,
    // Tall enough for the grid, the controls and the whole scroll strip. The strip previously hung past
    // the bottom edge, so its centre lay outside the viewport and hit-testing found nothing there: the
    // wheel reached the window at the aimed point but could not land on the intended element. The height
    // is not left to "looks right" — the point is hit-tested below and reported, so a recurrence shows
    // up as a failed assertion instead of as an inexplicable non-scroll.
    height: GRID_ROWS * CELL_HEIGHT + 260,
    x: 120,
    y: 90,
    show: process.env.P1_05_TARGET_HIDDEN !== "1",
    title: "P1-05 input target",
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  ipcMain.on("p1-target-report", (_event, payload) => {
    log({ kind: payload.event, ...payload.payload });
  });

  // Give the runner the facts it needs to aim input without guessing a frame model.
  //
  // Electron reports window geometry in DIP (device-independent pixels), while a
  // DPI-aware input driver works in physical screen pixels. Deriving one from the other
  // by multiplying by `scaleFactor` assumes the two agree on where the frame is, and on
  // this machine they do not: the driver's reported bounds are not a uniform multiple of
  // Electron's. So instead of guessing, the exact physical point of each grid cell is
  // computed here with Electron's own `screen.dipToScreenPoint` and handed to the runner.
  const { screen } = await import("electron");
  const bounds = win.getBounds();
  const contentBounds = win.getContentBounds();
  const display = screen.getDisplayMatching(bounds);

  const cellCentres = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const centreInContent = {
        x: column * CELL_WIDTH + Math.floor(CELL_WIDTH / 2),
        y: row * CELL_HEIGHT + Math.floor(CELL_HEIGHT / 2),
      };
      const dipScreenPoint = {
        x: contentBounds.x + centreInContent.x,
        y: contentBounds.y + centreInContent.y,
      };
      cellCentres.push({
        cell: `${row},${column}`,
        centreInContent,
        dipScreenPoint,
        physicalScreenPoint: screen.dipToScreenPoint(dipScreenPoint),
      });
    }
  }

  // The scrollable strip's own screen point, reported in the same two spaces as the cells.
  //
  // A caller needs this because the point an action is aimed at must be in screen DIP: the driver adds
  // the window origin back, so a window-relative point lands outside the window and the wheel goes
  // somewhere else while the driver still reports success. Deriving it here means the caller never has
  // to guess the layout.
  const scrollerCentreInContent = await win.webContents.executeJavaScript(`(() => {
    const rect = document.getElementById('scroller').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  // Is that centre actually reachable? A wheel only scrolls the strip if the point resolves to it, and a
  // point outside the viewport resolves to nothing. Measured here so the caller can refuse to draw a
  // conclusion from an unreachable point.
  const scrollerReachability = await win.webContents.executeJavaScript(`(() => {
    const scroller = document.getElementById('scroller');
    const rect = scroller.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const element = document.elementFromPoint(x, y);
    return {
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      elementAtCentre: element ? (element.id || element.tagName) : null,
      centreResolvesToScroller: element ? Boolean(element.closest('#scroller')) : false,
      stripFitsViewport: rect.bottom <= document.documentElement.clientHeight && rect.top >= 0,
      scrollerScrollHeight: scroller.scrollHeight,
      scrollerClientHeight: scroller.clientHeight,
      isScrollable: scroller.scrollHeight > scroller.clientHeight,
    };
  })()`);
  const scrollerDipScreenPoint = {
    x: contentBounds.x + scrollerCentreInContent.x,
    y: contentBounds.y + scrollerCentreInContent.y,
  };

  const geometry = {
    windowBounds: bounds,
    contentBounds,
    displayBounds: display.bounds,
    displayWorkArea: display.workArea,
    scaleFactor: display.scaleFactor,
    grid: { columns: GRID_COLUMNS, rows: GRID_ROWS, cellWidth: CELL_WIDTH, cellHeight: CELL_HEIGHT },
    cellCentres,
    scroller: {
      centreInContent: scrollerCentreInContent,
      dipScreenPoint: scrollerDipScreenPoint,
      physicalScreenPoint: screen.dipToScreenPoint(scrollerDipScreenPoint),
      reachability: scrollerReachability,
    },
  };
  if (geometryPath) writeFileSync(geometryPath, JSON.stringify(geometry, null, 2), "utf8");
  log({ kind: "ready", geometry });

  // Keep the window in front so input delivery has an unambiguous target, but do not
  // move the mouse or synthesise anything.
  // Explicitly show after the page has loaded: on some Electron/Windows desktop sessions,
  // `show: true` leaves the top-level HWND hidden until the ready-to-show transition completes.
  win.show();
  win.focus();
});

app.on("window-all-closed", () => app.quit());
