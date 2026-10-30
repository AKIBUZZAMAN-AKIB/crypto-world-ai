#!/usr/bin/env node
// Refresh the factual Pine v6 completion index. This is a maintainer tool, not a
// runtime network dependency. It records names, signatures and argument types only,
// not the reference's prose or examples. Review the resulting diff before shipping.
//
// Usage: node tools/update-pine-reference.mjs
// Requires the project's Playwright Chromium installation and network access.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = 'https://www.tradingview.com/pine-script-reference/v6/';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('[id="fun_ta.sma"]').waitFor({ timeout: 30_000 });
    const records = await page.evaluate(() => [...document.querySelectorAll('.tv-pine-reference-item[id]')]
        .map((item) => {
            const underscore = item.id.indexOf('_');
            const kind = item.id.slice(0, underscore);
            const name = item.id.slice(underscore + 1);
            if (!['fun', 'var', 'const', 'type', 'kw'].includes(kind)) return null;
            const signatures = [...item.querySelectorAll('.tv-pine-reference-item__syntax')]
                .map((node) => node.textContent?.trim().replace(/\s+/g, ' ') ?? '').filter(Boolean);
            const parameters = {};
            for (const node of item.querySelectorAll('.tv-pine-reference-item__arg-type')) {
                const match = node.textContent?.trim().match(/^([A-Za-z_][\w]*)\s+\((.+)\)$/);
                if (match && !(match[1] in parameters)) parameters[match[1]] = match[2];
            }
            return { name, kind, ...(signatures.length ? { signatures } : {}),
                ...(Object.keys(parameters).length ? { parameters } : {}) };
        }).filter(Boolean));
    if (records.length < 800 || !records.some((r) => r.name === 'request.footprint')) {
        throw new Error(`Unexpected reference shape: ${records.length} entries; refusing to replace the index`);
    }
    const out = {
        source: url,
        retrieved: new Date().toISOString().slice(0, 10),
        records,
    };
    const path = resolve('src/widget/pine-reference-data.json');
    await writeFile(path, JSON.stringify(out) + '\n');
    console.log(`Wrote ${records.length} reference entries to ${path}`);
} finally {
    await browser.close();
}
