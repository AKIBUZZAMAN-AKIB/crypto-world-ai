/**
 * Save text as a file — the one place Export touches the browser. Guarded because the
 * UI also runs under jsdom and inside hosts that forbid object URLs; there it simply
 * does nothing instead of throwing out of a click handler.
 */
export function downloadText(doc: Document, filename: string, text: string, mime = 'application/json'): void {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename.replace(/[^\w.\- ()]+/g, '_');
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
