// The bridge from a chart surface to the Pine editor page.
//
// The editor is a separate document (`editor.html`), so the way in is a topbar action —
// contributed through the widget's public action registry, the same seam a host uses for
// any of its own tools. One call registers everything:
//
//   • the `code` icon (module scope is per page, so the workspace page needs its own),
//   • a `dev.editor` topbar button  → the right-hand tools cluster on desktop,
//   • and a bottom-bar icon stop on the phone layout (`mobile: 'bar'`), because the topbar
//     is hidden there and a `'menu'`-placed action would only surface inside the ⋯ drawer.
//
// The editor reads its text from the same localStorage key, so a script written on one
// surface is what the other opens with.
import { registerIcon, registerWidgetAction } from '../src/plugin';
import { EDITOR_HREF } from './editor-shared';

export { EDITOR_HREF, EDITOR_STORAGE_KEY } from './editor-shared';

const CODE_ICON =
    '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 4.5-4 3.5 4 3.5M10.5 4.5l4 3.5-4 3.5"/></svg>';

let done = false;

/**
 * Register the editor entry point (idempotent — a surface may call it from several
 * modules without doubling the button).
 */
export function registerEditorEntry(): void {
    if (done) return;
    done = true;
    registerIcon('code', CODE_ICON);
    registerWidgetAction({
        id: 'dev.editor',
        target: 'topbar',
        label: 'Pine editor',
        icon: 'code',
        iconOnly: true, // the native 32px tool look on desktop; the label stays the aria-label
        align: 'right',
        mobile: 'bar', // a real stop on the phone's bottom bar, not a buried drawer row
        order: 10,
        run: () => {
            // Same tab: the editor is a full page, and every chart surface persists its own
            // state, so going back is a reload away rather than a lost document.
            window.location.href = EDITOR_HREF;
        },
    });
}
