import { PatternDrawing } from './PatternDrawing';

/**
 * Elliott double combo (W·X·Y) — two corrective structures joined by the linking wave X.
 * Three points: the end of the first corrective, the end of the link, the end of the
 * second corrective.
 */
export class ElliottDoubleCombo extends PatternDrawing {
    readonly type = 'elliottdoublecombo' as const;

    vertexLabels(): readonly string[] {
        return ['W', 'X', 'Y'];
    }
}
