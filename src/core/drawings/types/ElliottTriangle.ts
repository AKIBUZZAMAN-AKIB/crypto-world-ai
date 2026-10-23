import { PatternDrawing } from './PatternDrawing';

/** Elliott triangle (A·B·C·D·E) — the five-leg consolidation that precedes a breakout. */
export class ElliottTriangle extends PatternDrawing {
    readonly type = 'elliotttriangle' as const;

    vertexLabels(): readonly string[] {
        return ['A', 'B', 'C', 'D', 'E'];
    }
}
