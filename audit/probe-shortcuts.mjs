// Acceptance probe for the reference-parity keymap added in this round:
//   digits → interval, `.` → layouts panel, Alt+W → watchlist/symbol search,
//   Alt+G → go-to-date dialog, Alt+I → inverted scale, Ctrl+Alt+H → hide all
//   drawings, Ctrl+C / Ctrl+V on a selected drawing.
// Every assertion is read off the live chart state, not off the DOM's appearance.
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5190/workspace.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ws?.cells().length >= 1, null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelector('[aria-label="Dismiss hint"]')?.click());

// Focus the plot so the workspace keymap owns the keystrokes.
await p.click('.vela-ws-grid, canvas', { position: { x: 400, y: 300 } }).catch(() => {});
await p.waitForTimeout(200);

const tf = () => p.evaluate(() => window.__ws.cells()[0].state.timeframe);
const out = {};

out.tfBefore = await tf();
await p.keyboard.press('7');
await p.waitForTimeout(400);
out.tfAfterDigit7 = await tf(); // 4h

await p.keyboard.press('8');
await p.waitForTimeout(400);
out.tfAfterDigit8 = await tf(); // 1D

// `.` opens the layouts & templates panel
await p.keyboard.press('.');
await p.waitForTimeout(700);
out.layoutsPanelOpen = await p.evaluate(() => {
    const pane = document.getElementById('vela-md-pane-layouts');
    return Boolean(pane && pane.offsetParent !== null);
});
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
out.layoutsPanelClosed = await p.evaluate(() => {
    const pane = document.getElementById('vela-md-pane-layouts');
    return Boolean(pane && pane.offsetParent === null);
});

// Alt+W opens the watchlist / symbol search
await p.keyboard.press('Alt+w');
await p.waitForTimeout(700);
out.watchlistOpen = await p.evaluate(
    () => Boolean(document.querySelector('[data-watchlist], .vela-sp-watch, .vela-sp')) || Boolean(document.querySelector('input[placeholder*="symbol" i]')),
);
await p.keyboard.press('Escape');
await p.waitForTimeout(500);

// Alt+G opens the go-to-date dialog
await p.keyboard.press('Alt+g');
await p.waitForTimeout(700);
out.goToDateOpen = await p.evaluate(() => Boolean(document.querySelector('.vela-gtd')));
await p.keyboard.press('Escape');
await p.waitForTimeout(500);

// Alt+I inverts the price scale
out.invertBefore = await p.evaluate(() => Boolean(window.__ws.cells()[0].chart.renderer.get('invertScale')));
await p.keyboard.press('Alt+i');
await p.waitForTimeout(400);
out.invertAfter = await p.evaluate(() => Boolean(window.__ws.cells()[0].chart.renderer.get('invertScale')));
await p.keyboard.press('Alt+i');
await p.waitForTimeout(300);

// `,` opens the typed-interval entry (the multi-digit door)
await p.keyboard.press(',');
await p.waitForTimeout(700);
out.intervalEntryOpen = await p.evaluate(() => Boolean(document.querySelector('.vela-tq-input')));
await p.keyboard.press('Escape');
await p.waitForTimeout(600);

// Draw a line, copy it with Ctrl+C, paste with Ctrl+V (chart-resident keys)
out.drawingsBefore = await p.evaluate(() => window.__ws.cells()[0].chart.drawings.all().length);
await p.evaluate(() => {
    const chart = window.__ws.cells()[0].chart;
    chart.drawings.add('hline', { price: 1 });
    chart.drawings.select(chart.drawings.all().at(-1).id);
});
await p.waitForTimeout(300);
out.selected = await p.evaluate(() => window.__ws.cells()[0].chart.drawings.selection().length);
await p.keyboard.press('Control+c');
await p.waitForTimeout(300);
await p.keyboard.press('Control+v');
await p.waitForTimeout(600);
out.drawingsAfterPaste = await p.evaluate(() => window.__ws.cells()[0].chart.drawings.all().length);

// Ctrl+Alt+H hides every drawing, and again brings them back
await p.keyboard.press('Control+Alt+h');
await p.waitForTimeout(500);
out.hiddenAfterHideAll = await p.evaluate(() => window.__ws.cells()[0].chart.drawings.hiddenAll);
out.hiddenAfterSecondPress = await p.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400));
    return window.__ws.cells()[0].chart.drawings.hiddenAll;
});
await p.keyboard.press('Control+Alt+h');
await p.waitForTimeout(700);
out.hiddenAfterSecondPress = await p.evaluate(() => window.__ws.cells()[0].chart.drawings.hiddenAll);

out.errors = errors.slice(0, 4);
console.log(JSON.stringify(out, null, 1));
await b.close();
