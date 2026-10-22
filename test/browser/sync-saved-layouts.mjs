// Saved-layout management (gap 14): save → rename in place → export a real file →
// import it back under a new name → open it. jsdom proves the callbacks; only Chromium
// proves the file picker, the download, and that the row survives a re-render.
import { open, assert, report } from './helpers.mjs';

const { browser, page, errors } = await open();
// The download event needs a context that accepts downloads (Playwright's default) and
// a listener registered BEFORE the click that starts it.
try {
    const openPicker = async () => {
        await page.evaluate(() => window.__ws.topbar.openLayoutPicker());
        await page.waitForSelector('.vela-lp-save input', { timeout: 5000 });
    };

    // 1. Save a snapshot through the field the user actually types in.
    await openPicker();
    await page.fill('.vela-lp-save input', 'Scalp');
    await page.evaluate(() => document.querySelector('.vela-lp-save button').click());
    await page.waitForFunction(() => window.__ws.savedLayoutList().some((l) => l.name === 'Scalp'));
    const saved = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(saved.some((l) => l.name === 'Scalp'), 'the save field creates the row', saved);

    // 2. Rename in place: the label becomes an input, Enter commits, order holds.
    const renameBtn = page.locator('.vela-lp-saved[data-layout="Scalp"] button[aria-label="Rename Scalp"]');
    assert((await renameBtn.count()) === 1, 'the row carries a rename action', await renameBtn.count());
    await renameBtn.click();
    const field = page.locator('.vela-lp-rename');
    assert((await field.count()) === 1, 'the label turned into an input');
    await field.fill('Swing');
    await field.press('Enter');
    await page.waitForFunction(() => window.__ws.savedLayoutList().some((l) => l.name === 'Swing'));
    const renamed = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(renamed.some((l) => l.name === 'Swing') && !renamed.some((l) => l.name === 'Scalp'), 'Enter commits the rename', renamed);
    assert((await page.locator('.vela-lp-rename').count()) === 0, 'the input closed after the commit');

    // 3. Export: a real .json download, named after the snapshot.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.locator('.vela-lp-saved[data-layout="Swing"] button[aria-label="Export Swing as JSON"]').click(),
    ]);
    const filename = download.suggestedFilename();
    assert(/^Swing.*\.json$/.test(filename), 'the export downloads a .json file', filename);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const json = Buffer.concat(chunks).toString('utf8');
    const envelope = JSON.parse(json);
    assert(envelope.kind === 'layout' && envelope.name === 'Swing' && envelope.state?.layout === '4', 'the file carries the snapshot', envelope);

    // 4. Import the same file back: the taken name gets a suffix, the row appears.
    const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => document.querySelector('.vela-lp-import').click());
    const picked = await chooser;
    await picked.setFiles({ name: filename, mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForFunction(() => window.__ws.savedLayoutList().length === 2, null, { timeout: 5000 });
    const imported = await page.evaluate(() => window.__ws.savedLayoutList());
    assert(imported.some((l) => l.name === 'Swing (2)'), 'the import lands beside the taken name', imported);
    assert((await page.locator('.vela-lp-saved').count()) === 2, 'both rows are rendered after the import');

    // 5. The imported snapshot opens like any other.
    await page.evaluate(() => window.__ws.setLayout('1'));
    await page.evaluate(() => window.__ws.openLayout('Swing (2)'));
    const layout = await page.evaluate(() => window.__ws.getState().layout);
    assert(layout === '4', 'opening the imported snapshot restores its layout', layout);

    assert(errors.length === 0, 'no page errors', errors.slice(0, 2));
    report('sync-saved-layouts', { saved, renamed, filename, imported, layout });
} finally {
    await browser.close();
}
