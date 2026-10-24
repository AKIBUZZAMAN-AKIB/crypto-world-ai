// The constants the chart surfaces and the editor page must agree on.
//
// Kept apart from `editor-link.ts` so the editor page can import the storage key WITHOUT
// importing the widget action — otherwise its own topbar would grow a "Pine editor" button
// that just reloads the page it is already on.
export const EDITOR_HREF = './editor.html';
export const EDITOR_STORAGE_KEY = 'vela-play:editor-code';
