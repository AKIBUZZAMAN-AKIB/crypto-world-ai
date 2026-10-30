// Shared deterministic ledger fixtures for the real offline workspace.
import { OFFLINE } from '../helpers.mjs';

export function strategyTesterFixtures(browser, errors) {
    const wait = (page, ms = 180) => page.waitForTimeout(ms);

    async function boot(size, touch = false) {
        const context = await browser.newContext({
            viewport: size,
            ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
        });
        const page = await context.newPage();
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(OFFLINE, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__ws?.active?.chart?.lastBar, null, { timeout: 30000 });
        await wait(page, 350);
        return { context, page };
    }

    async function openTester(page, touch) {
        const mobile = await page.evaluate(() => document.querySelector('.vela-workspace').dataset.layout === 'mobile');
        if (mobile) {
            if (touch) await page.locator('.vela-mb-more').tap(); else await page.locator('.vela-mb-more').click();
            const row = page.locator('.vela-more-panel:visible .vela-md-row', { hasText: 'Strategy tester' });
            if (touch) await row.tap(); else await row.click();
        } else {
            const button = page.locator('button[aria-label="Strategy tester"]');
            await button.scrollIntoViewIfNeeded();
            if (touch) await button.tap(); else await button.click();
        }
        await page.locator('.vela-st:visible').waitFor();
        await wait(page, 350);
    }

    // Synthetic ledger is a controllable UI fixture, not a financial result. The real
    // engine path is checked separately below against the actual run's ledger.
    async function seed(page, options = {}, settle = 150) {
        await page.evaluate(({ cell, name, n, amount }) => {
            const ws = window.__ws;
            const chart = ws.cell(cell ?? ws.active.id).chart;
            const trades = Array.from({ length: n ?? 80 }, (_, i) => ({
                id: `ui-${i}`,
                side: i % 2 ? 'short' : 'long', qty: i + 1,
                entry: { id: 'E', time: 1_700_000_000_000 + i * 7_200_000, price: 100.25 + i },
                exit: { id: 'X', time: 1_700_003_600_000 + i * 7_200_000, price: 101.50 + i },
                pnl: i === 0 && amount ? amount : (i % 2 ? -2 : 3), open: false,
            }));
            const net = trades.reduce((total, trade) => total + trade.pnl, 0);
            const grossProfit = trades.reduce((total, trade) => total + Math.max(0, trade.pnl), 0);
            const grossLoss = trades.reduce((total, trade) => total + Math.max(0, -trade.pnl), 0);
            const state = { position: 0, avgPrice: 0, equity: 10000 + net, openPnl: 0, netPnl: net,
                grossProfit, grossLoss, wins: trades.filter((t) => t.pnl > 0).length,
                losses: trades.filter((t) => t.pnl < 0).length, even: 0, maxDrawdown: 40,
                maxRunup: 50, initialCapital: 10000 };
            const run = { id: `test-${cell ?? ws.active.id}`, title: name ?? 'Test strategy', kind: 'strategy',
                cause: 'history', complete: true, bar: 799, time: 1_700_000_000_000,
                forming: false, first: true, plots: {}, vars: {}, strategy: state, warnings: [],
                trades: async () => trades, series: async () => [] };
            ws.strategyTester.setRun(chart, run);
        }, options);
        await wait(page, settle);
    }

    async function select(page, name, touch = false) {
        const button = page.getByRole('tab', { name, exact: true });
        if (touch) await button.tap(); else await button.click();
        await wait(page, 120);
    }

    return { wait, boot, openTester, seed, select };
}
