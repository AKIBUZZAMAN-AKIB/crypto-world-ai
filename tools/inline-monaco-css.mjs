// In esbuild-based single-file / browser-global builds, retain Monaco's CSS as
// runtime-injected styles and embed its one font. Vite handles these imports itself.
// This keeps an IIFE usable without a CDN, a companion stylesheet or a font URL.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function embedFont(css, path) {
    const urls = [...css.matchAll(/url\((['"]?)(\.\/[^)'"]+\.ttf)\1\)/g)];
    for (const match of urls) {
        const font = await readFile(resolve(dirname(path), match[2]));
        css = css.replace(match[0], `url(data:font/ttf;base64,${font.toString('base64')})`);
    }
    return css;
}

function styleModule(css, path) {
    const normalized = path.replace(/\\/g, '/');
    const id = `vela-monaco-${normalized.split('monaco-editor/esm/')[1] ?? normalized}`;
    // A data attribute prevents duplicate copies across bundled entry points.
    return `if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-vela-monaco]')].some(s => s.dataset.velaMonaco === ${JSON.stringify(id)})) { const s = document.createElement('style'); s.dataset.velaMonaco = ${JSON.stringify(id)}; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); }`;
}

export function inlineMonacoCss() {
    return {
        name: 'inline-monaco-css',
        setup(build) {
            build.onLoad({ filter: /monaco-editor[/\\]esm[/\\].*\.css$/ }, async (args) => ({
                contents: styleModule(await embedFont(await readFile(args.path, 'utf8'), args.path), args.path),
                loader: 'js',
            }));
        },
    };
}

// tsup's built-in CSS onLoad runs before custom plugins, so use its injectStyle
// hook instead. Its first argument is a JSON-encoded CSS string.
export async function injectMonacoCssForTsup(encodedCss, path) {
    const css = await embedFont(JSON.parse(encodedCss), path);
    return styleModule(css, path);
}
