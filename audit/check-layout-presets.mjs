// Sanity: every registered layout must be a VALID grid — rectangular areas, one cell per
// area name, slot ids unique. Runs in ~1s, catches a broken preset before CI.
const { registerBuiltinLayouts, layouts } = await import('../src/workspace/layouts.ts');
registerBuiltinLayouts();
let bad = 0;
for (const l of layouts()) {
    const errs = [];
    const ids = new Set();
    for (const c of l.cells) {
        if (ids.has(c.id)) errs.push(`duplicate slot ${c.id}`);
        ids.add(c.id);
    }
    if (l.areas) {
        const grid = l.areas.map((r) => r.trim().split(/\s+/));
        const width = l.cols.length;
        for (const [r, row] of grid.entries()) if (row.length !== width) errs.push(`row ${r} has ${row.length} cols, expected ${width}`);
        if (grid.length !== l.rows.length) errs.push(`${grid.length} area rows vs ${l.rows.length} row tracks`);
        const seen = new Map();
        for (let r = 0; r < grid.length; r += 1) for (let c = 0; c < grid[r].length; c += 1) {
            const a = grid[r][c];
            seen.set(a, [...(seen.get(a) ?? []), [r, c]]);
        }
        for (const [name, pts] of seen) {
            const rows = pts.map((p) => p[0]);
            const cols2 = pts.map((p) => p[1]);
            const h = Math.max(...rows) - Math.min(...rows) + 1;
            const w = Math.max(...cols2) - Math.min(...cols2) + 1;
            if (h * w !== pts.length) errs.push(`area ${name} is not a rectangle`);
        }
        for (const c of l.cells) if (c.area && !seen.has(c.area)) errs.push(`slot ${c.id} points at missing area ${c.area}`);
        for (const name of seen.keys()) if (!l.cells.some((c) => c.area === name)) errs.push(`area ${name} has no slot`);
    } else if (l.cells.length !== l.rows.length * l.cols.length) {
        errs.push(`auto-flow ${l.cells.length} cells over ${l.rows.length}x${l.cols.length} tracks`);
    }
    if (errs.length) { bad += 1; console.log(`✗ ${l.id} (${l.label}): ${errs.join('; ')}`); }
}
console.log(`layouts: ${layouts().length} · invalid: ${bad}`);
