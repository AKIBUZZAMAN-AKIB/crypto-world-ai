import { PatternDrawing } from './PatternDrawing';

/**
 * Three drives — three same-direction drives joined by two retracements. The reference
 * numbers the drives 1·2·3 and the retracement ends A·C, and places them along the path
 * in that order: drive 1 ends, retrace to A, drive 2 ends, retrace to C, drive 3 ends.
 * The leg ratios are the tool's whole value (each drive extends the prior retracement by
 * 127.2–161.8%), so they are annotated on every leg.
 */
export class ThreeDrives extends PatternDrawing {
    readonly type = 'threedrives' as const;

    vertexLabels(): readonly string[] {
        return ['1', 'A', '2', 'C', '3'];
    }

    override legRatios(): boolean {
        return true;
    }
}
