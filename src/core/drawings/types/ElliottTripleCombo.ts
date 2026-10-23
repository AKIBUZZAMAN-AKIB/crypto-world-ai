import { PatternDrawing } from './PatternDrawing';

/**
 * Elliott triple combo (W·X·Y·X·Z) — three corrective structures joined by two linking
 * waves. The two links share the same label, which is the reference's own convention
 * (the second X is the same kind of wave, one degree along).
 */
export class ElliottTripleCombo extends PatternDrawing {
    readonly type = 'elliottriplecombo' as const;

    vertexLabels(): readonly string[] {
        return ['W', 'X', 'Y', 'X', 'Z'];
    }
}
