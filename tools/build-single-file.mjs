#!/usr/bin/env node
// ONE-FILE BUILD — the whole workspace playground (app + providers + Pine engine) as a
// single .html, with no module graph and nothing to install.
//
// Why it exists: a phone test is the one review the desktop cannot give. The dev server
// needs a machine on the same network and a module-per-file fetch; a `file://` page cannot
// use `type="module"` at all. This build inlines the bundle into the page, so the artifact
// is ONE file you can AirDrop/WhatsApp/serve and open anywhere — including straight off the
// phone's filesystem. The charts still need the network (they stream Binance), but a page
// that fails to fetch the app never even boots.
//
//   node tools/build-single-file.mjs [outFile] [--layout 1|2|4|6|8] [--symbol BTCUSDT]
//
// Default: single/vela-workspace.html, ONE chart — a phone is one chart wide, and a 4-cell
// grid on a 390 pt screen is four unreadable thumbnails. Pass `--layout 4` for the grid.
import { build } from 'esbuild';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const root = resolve(import.meta.dirname, '..');
const outFile = resolve(argv.find((a) => !a.startsWith('--') && !/^[0-9A-Z]+$/.test(a)) ?? join(root, 'single', 'vela-workspace.html'));
const layout = flag('layout', '1');
const symbol = flag('symbol', 'BTCUSDT');

const t0 = Date.now();
// The playground's own entry hard-codes `layout: '4'`; this build swaps the two options a
// phone test cares about (how many charts, which market) in a COPY that still resolves the
// same relative imports, then removes it. Nothing in the playground changes.
const entry = join(root, 'playground/.single-entry.ts');
const source = await readFile(join(root, 'playground/workspace.ts'), 'utf8');
await writeFile(
    entry,
    source.replace(/layout: "4",/, `layout: "${layout}",`).replace(/symbol: "BTCUSDT", \/\//, `symbol: "${symbol}", //`),
);

const built = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.ts': 'ts' },
    // `import.meta.url` resolves to nothing in an IIFE; the only user is the OPTIONAL worker
    // engine, which the playground does not construct (it uses the in-page PineEngine).
    logOverride: { 'empty-import-meta': 'silent' },
    logLevel: 'warning',
});
const js = built.outputFiles[0].text;
await rm(entry, { force: true });

const template = await readFile(join(root, 'playground/workspace.html'), 'utf8');
const SCRIPT = '<script type="module" src="./workspace.ts"></script>';
if (!template.includes(SCRIPT)) throw new Error(`the template lost its entry: ${SCRIPT}`);

const page = template
    .replace('<meta name="viewport" content="width=device-width, initial-scale=1" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />\n        <meta name="theme-color" content="#151619" />\n        <meta name="apple-mobile-web-app-capable" content="yes" />\n        <meta name="mobile-web-app-capable" content="yes" />')
    .replace(SCRIPT, `<script>\n${js}\n        </script>`)
    // A phone's URL bar shrinks the viewport as you scroll; 100% of a fixed html/body keeps
    // the chart from jumping, and `overscroll-behavior` kills the rubber-band bounce that
    // otherwise drags the whole workspace when a chart is panned past its edge.
    .replace('</style>', '            html, body { overscroll-behavior: none; }\n        </style>');

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, page);

const { size } = await stat(outFile);
const gz = gzipSync(Buffer.from(page)).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`single-file build → ${outFile}`);
console.log(`  ${layout} chart${layout === '1' ? '' : 's'} · ${symbol} · ${kb(size)} raw · ${kb(gz)} gzip · JS ${kb(Buffer.byteLength(js))} · ${Date.now() - t0} ms`);
