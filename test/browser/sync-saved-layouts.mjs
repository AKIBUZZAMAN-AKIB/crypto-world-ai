// Saved-layout management (gap 14). Desktop management now lives in the SEPARATE
// layout-name popover, not in the grid setup panel. jsdom proves the callbacks;
// Chromium proves the file picker, the download, and that rows survive a re-render.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
try {
    const openManager = async () => {
        if (await page.locator('.vela-lm').count()) return;
        await page.locator('.vela-widget-layoutname').click();
        await page.waitForSelector('.vela-lm', { timeout: 5000 });
    };
    const openActions = async (name) => {
        await openManager();
        await page.locator(`.vela-lm-srow[data-name="${name}"] .vela-lm-kebab`).click();
        await page.waitForSelector('.vela-lm-act', { timeout: 5000 });
    };
    const initialLayout = await page.evaluate(() => window.__ws.getState().layout);

    // 1. Save through the manager's primary verb (the grid panel has no save field now).
    await openManager();
    await page.locator('.vela-lm-primary').click();
    await page.locator('.vela-lm-input').fill('Scalp');
    await page.locator('.vela-lm-btn[data-primary]').click();
    await page.waitForFunction(() => window.__ws.savedLayoutList().some((l) => l.name === 'Scalp'));
    const saved = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(saved.some((l) => l.name === 'Scalp'), 'the manager creates the saved layout', saved);

    // 2. Rename through the row's one-field dialog.
    await openActions('Scalp');
    await page.locator('.vela-lm-act', { hasText: 'Rename…' }).click();
    const renameField = page.locator('.vela-lm-input');
    await renameField.fill('Swing');
    await page.locator('.vela-lm-btn[data-primary]').click();
    await page.waitForFunction(() => window.__ws.savedLayoutList().some((l) => l.name === 'Swing'));
    const renamed = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(renamed.some((l) => l.name === 'Swing') && !renamed.some((l) => l.name === 'Scalp'), 'the rename commits', renamed);

    // 3. Export: a real .json download, named after the snapshot.
    await openActions('Swing');
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.locator('.vela-lm-act').filter({ hasText: /^Export$/ }).click(),
    ]);
    const filename = download.suggestedFilename();
    assert(/^Swing.*\.json$/.test(filename), 'the export downloads a .json file', filename);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const json = Buffer.concat(chunks).toString('utf8');
    const envelope = JSON.parse(json);
    assert(envelope.kind === 'layout' && envelope.name === 'Swing' && envelope.state?.layout === initialLayout, 'the file carries the snapshot', envelope);

    // 4. Import the same file back: the taken name gets a suffix, the row appears.
    await openManager();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.vela-lm-row', { hasText: 'Import layout file…' }).click();
    const picked = await chooser;
    await picked.setFiles({ name: filename, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForFunction(() => window.__ws.savedLayoutList().length === 2, null, { timeout: 5000 });
    const imported = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(imported.some((l) => l.name === 'Swing (2)'), 'the import lands beside the taken name', imported);
    assert((await page.locator('.vela-lm-srow').count()) === 2, 'both rows are rendered after the import');

    // 5. The imported snapshot opens like any other.
    const otherLayout = initialLayout === '1' ? '2h' : '1';
    await page.evaluate((id) => window.__ws.setLayout(id), otherLayout);
    await page.evaluate(() => window.__ws.openLayout('Swing (2)'));
    const layout = await page.evaluate(() => window.__ws.getState().layout);
    assert(layout === initialLayout, 'opening the imported snapshot restores its layout', layout);

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-saved-layouts', { saved, renamed, filename, imported, layout });
} finally {
    await browser.close();
}
