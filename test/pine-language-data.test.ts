import { describe, expect, it } from 'vitest';
import {
    maskPineNonCode,
    pineCompletions,
    pineReferenceAt,
    pineSignatureHelp,
    PINE_REFERENCE_COUNT,
    PINE_REFERENCE_DATE,
    signatureParameters,
} from '../src/widget/pine-language-data';

const complete = (code: string) => pineCompletions(code, code.length).items;
const labels = (code: string) => complete(code).map((item) => item.label);
const signature = (code: string) => pineSignatureHelp(code, code.length);

describe('Pine reference completions', () => {
    it('uses the dated official reference snapshot, not a short hand-picked list', () => {
        expect(PINE_REFERENCE_COUNT).toBeGreaterThan(900);
        expect(PINE_REFERENCE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(labels('ta.sm')).toContain('sma');
        expect(labels('request.se')).toContain('security');
        expect(labels('strategy.closedtrades.')).toContain('profit');
        expect(labels('color.re')).toContain('red');
        expect(labels('unknown.sm')).not.toContain('sma');
    });

    it('distinguishes a variable and function with the same name', () => {
        const results = complete('ta.tr').filter((item) => item.label === 'tr');
        expect(results.map((item) => item.kind)).toEqual(expect.arrayContaining(['fun', 'var']));
        expect(pineReferenceAt('ta.tr', 4)?.record.kind).toBe('var');
        expect(pineReferenceAt('ta.tr(true)', 4)?.record.kind).toBe('fun');
    });

    it('does not suggest inside line comments, block comments, or strings', () => {
        expect(complete('// ta.sm')).toEqual([]);
        expect(complete('/* ta.sm')).toEqual([]);
        expect(complete('plot("ta.sm')).toEqual([]);
        expect(labels('/* ta.sm */\nta.sm')).toContain('sma');
        expect(maskPineNonCode('"a, b" // comment\nclose').masked).toHaveLength('"a, b" // comment\nclose'.length);
    });

    it('offers scoped local variables, function names and confidently typed methods', () => {
        const source = 'myAverage(source, length) =>\n    base = ta.sma(source, length)\n    ba';
        expect(labels(source)).toContain('base');
        expect(labels(source)).toContain('barstate');
        expect(labels('myAverage(source) =>\n    source\nmyA')).toContain('myAverage');
        expect(labels('myAverage(source) =>\n    source\nso')).not.toContain('source');
        const array = complete('var array<float> prices = array.new<float>()\nprices.pu');
        expect(array.find((item) => item.label === 'push')?.signature).toBe('prices.push(value) → void');
        expect(labels('var array<float> prices = array.new<float>()\nprices.pu')).not.toContain('plot');
        expect(labels('untyped = close\nuntyped.pu')).toEqual([]);
        expect(labels('var box region = box.new(na, na, na, na)\nregion.set_x')).toContain('set_xloc');
        expect(labels('var box region = box.new(na, na, na, na)\nregion.ne')).not.toContain('new');
    });

    it('offers chart.point fields and methods only for a recognized point receiver', () => {
        const source = 'chart.point pivot = chart.point.now(close)\npivot.';
        const fields = complete(source);
        expect(fields.find((item) => item.label === 'price')).toMatchObject({ kind: 'property', signature: 'series float' });
        expect(fields.find((item) => item.label === 'time')).toMatchObject({ kind: 'property', signature: 'series int' });
        expect(fields.find((item) => item.label === 'copy')).toMatchObject({ kind: 'method', signature: 'pivot.copy() → chart.point' });
        expect(labels('pivot = chart.point.from_index(10, close)\npivot.pr')).toContain('price');
        expect(labels('pivot = close\npivot.pr')).toEqual([]);
    });

    it('recognizes simple user-defined types, constructors and typed fields', () => {
        const declaration = 'type Pivot\n    int index\n    float price\n';
        expect(complete(`${declaration}Piv`).find((item) => item.label === 'Pivot')?.kind).toBe('type');
        expect(complete(`${declaration}Pivot.ne`).find((item) => item.label === 'new')?.signature).toBe('Pivot.new(index, price)');
        const object = `${declaration}Pivot p = Pivot.new()\np.`;
        expect(complete(object).find((item) => item.label === 'price')).toMatchObject({ kind: 'property', signature: 'float' });
        expect(complete(object).find((item) => item.label === 'copy')).toMatchObject({ kind: 'method', signature: 'p.copy() → Pivot' });
        expect(labels(`${declaration}p = Pivot.new()\np.in`)).toContain('index');
        expect(signature(`${declaration}p = Pivot.new(`)?.signatures[0]).toEqual({
            label: 'Pivot.new(index, price) → Pivot', parameters: [{ label: 'index', type: 'int' }, { label: 'price', type: 'float' }],
        });
        expect(labels(`${declaration}p = close\np.pr`)).toEqual([]);
    });

    it('suggests explicitly typed user methods on matching receivers', () => {
        const declaration = 'type Pivot\n    float price\nmethod move(Pivot self, float amount) =>\n    self.price += amount\n';
        const source = `${declaration}Pivot p = Pivot.new()\np.mo`;
        expect(complete(source).find((item) => item.label === 'move')).toMatchObject({ kind: 'method', signature: 'p.move(float amount)' });
        expect(signature(`${declaration}Pivot p = Pivot.new()\np.move(`)?.signatures[0]).toEqual({
            label: 'p.move(float amount)', parameters: [{ label: 'amount', type: 'float' }],
        });
        expect(complete(`${declaration}Pivot p = Pivot.new()\np.move(am`).find((item) => item.label === 'amount')?.kind).toBe('parameter');
        expect(labels(`${declaration}var array<float> p = array.new<float>()\np.mo`)).not.toContain('move');
    });

    it('keeps generic constructors and named argument suggestions available', () => {
        expect(labels('array.ne')).toContain('new<type>');
        expect(labels('map.ne')).toContain('new<type,type>');
        expect(complete('input.int(20, mi').find((item) => item.label === 'minval')?.kind).toBe('parameter');
        expect(complete('input.int(20, close + mi').filter((item) => item.kind === 'parameter')).toEqual([]);
        expect(signature('array.new<float>(')?.signatures[0]?.label).toContain('array.new<type>');
    });
});

describe('Pine parameter help', () => {
    it('includes the current reference arguments rather than stale signatures', () => {
        const security = signature('request.security(');
        expect(security?.signatures[0]?.label).toContain('calc_bars_count');
        const footprint = signature('request.footprint(');
        expect(footprint?.signatures[0]?.label).toContain('ticks_per_row, va_percent, imbalance_percent');
        expect(signature('ta.sma(close, ')?.activeParameter).toBe(1);
        expect(signature('ta.sma(close, ')?.signatures[0]?.parameters[1]).toEqual({ label: 'length', type: 'series int' });
    });

    it('counts arguments across nested calls and ignores commas in strings', () => {
        const result = signature('ta.sma(ta.ema(close, 9), ');
        expect(result?.signatures[0]?.label).toBe('ta.sma(source, length) → series float');
        expect(result?.activeParameter).toBe(1);
        expect(signature('plot(close, "a,b", ')?.activeParameter).toBe(2);
    });

    it('selects the overload containing a named parameter', () => {
        const result = signature('input.int(20, minval = ');
        expect(result?.activeSignature).toBe(1);
        expect(result?.signatures[result.activeSignature]?.parameters[result.activeParameter]?.label).toBe('minval');
    });

    it('uses method syntax without a duplicate receiver parameter', () => {
        const result = signature('var array<float> prices = array.new<float>()\nprices.push(');
        expect(result?.signatures[0]?.label).toBe('prices.push(value) → void');
        expect(result?.signatures[0]?.parameters.map((p) => p.label)).toEqual(['value']);
    });

    it('supports simple user functions and keeps overload parameters separate', () => {
        expect(signature('myAverage(source, length) =>\n    source\nmyAverage(close, ')?.activeParameter).toBe(1);
        expect(signatureParameters('math.max(number0, number1, ...) → series float')).toEqual(['number0', 'number1', '...']);
        expect(signatureParameters('example(map<string, float> values, array<int> indexes) → void'))
            .toEqual(['map<string, float> values', 'array<int> indexes']);
        expect(signature('something.unknown(')).toBeNull();
    });
});
