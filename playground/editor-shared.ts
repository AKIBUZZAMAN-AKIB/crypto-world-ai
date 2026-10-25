// The constants the chart surfaces and the editor page must agree on.
//
// The editor's PANEL lives in the shell (`src/widget/pine-editor.ts`) and keeps a real
// script library; these constants only bind the standalone deep-link page (`editor.html`)
// to the same document, so a bookmark and the pane never diverge.
export const EDITOR_HREF = './editor.html';
export const EDITOR_STORAGE_KEY = 'vela-play:editor-code';
