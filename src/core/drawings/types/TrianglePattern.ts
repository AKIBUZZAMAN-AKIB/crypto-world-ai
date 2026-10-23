import { PatternDrawing } from './PatternDrawing';

/**
 * Triangle pattern — five pivots whose two converging trendlines frame a coil: the upper
 * line runs through A·C·E, the lower through B·D. Both are extended to their apex, which
 * is what makes the pattern readable as a triangle rather than a zigzag.
 */
export class TrianglePattern extends PatternDrawing {
    readonly type = 'trianglepattern' as const;

    vertexLabels(): readonly string[] {
        return ['A', 'B', 'C', 'D', 'E'];
    }

    override legRatios(): boolean {
        return true;
    }
}
