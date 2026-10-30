import { describe, expect, it } from 'vitest';
import type { IndicatorHandle } from '../src/core/IndicatorHandle';
import { IndicatorLiveSync } from '../src/workspace/indicator-live-sync';

/** Endpoints deliberately emit synchronously, exercising the no-echo guard too. */
function fixtures() {
    let serial = 0;
    const cells: Array<{ id: string; handles: () => IndicatorHandle[]; copy: (source: IndicatorHandle) => IndicatorHandle | null; list: IndicatorHandle[]; add: (kind?: string, source?: string) => IndicatorHandle; writes: number }> = [];
    const link = new IndicatorLiveSync(() => cells, () => {});
    function cell(id: string) {
        const endpoint = {
            id, list: [] as IndicatorHandle[], writes: 0,
            handles() { return this.list; },
            add(kind = 'rsi', source?: string) {
                let inputs: Record<string, string | number | boolean> = { length: 14 };
                let props: Record<string, string | number | boolean> = { color: '#fff' };
                const h = {
                    id: `${id}-${++serial}`, title: kind, ...(source ? { source } : { nativeType: kind }),
                    inputValues: () => ({ ...inputs }), propValues: () => ({ ...props }),
                    setInputs(values: typeof inputs) { inputs = { ...inputs, ...values }; endpoint.writes++; link.inputsChanged(id, h.id); },
                    setProps(values: typeof props) { props = { ...props, ...values }; endpoint.writes++; link.inputsChanged(id, h.id); },
                } as unknown as IndicatorHandle;
                this.list.push(h);
                return h;
            },
            copy(source: IndicatorHandle) {
                if (source.nativeType === 'volume') return this.list.find((h) => h.nativeType === 'volume') ?? this.add('volume');
                return this.add(source.nativeType ?? source.title, source.source);
            },
        };
        cells.push(endpoint);
        return endpoint;
    }
    return { cell, cells, link };
}

describe('indicator live sync', () => {
    it('copies only selected charts and propagates settings and style in both directions without echo', () => {
        const { cell, link } = fixtures();
        const a = cell('a'), b = cell('b'), c = cell('c');
        const src = a.add();
        link.set('a', src.id, 'charts', ['b']);
        expect([b.list.length, c.list.length]).toEqual([1, 0]);
        const peer = b.list[0]!;
        a.writes = b.writes = 0;
        src.setInputs({ length: 9 });
        expect(peer.inputValues().length).toBe(9);
        expect([a.writes, b.writes]).toEqual([1, 1]);
        peer.setProps({ color: '#123456' });
        expect(src.propValues().color).toBe('#123456');
        link.set('a', src.id, 'none');
        src.setInputs({ length: 21 });
        expect(peer.inputValues().length).toBe(9); // the copy is kept but unlinked
    });

    it('links an inherited new layout cell instead of duplicating it and adds copies to other new cells', () => {
        const { cell, link } = fixtures();
        const a = cell('a'), b = cell('b');
        const src = a.add();
        link.set('a', src.id, 'layout');
        const c = cell('c');
        const inherited = c.add();
        const d = cell('d');
        link.reconcileLayout(new Map([['c', 'a'], ['d', 'a']]));
        expect(c.list).toEqual([inherited]);
        expect(d.list).toHaveLength(1);
        src.setInputs({ length: 31 });
        expect([b.list[0]!.inputValues().length, inherited.inputValues().length, d.list[0]!.inputValues().length]).toEqual([31, 31, 31]);
    });

    it('can opt in on a single chart before the layout expands', () => {
        const { cell, link } = fixtures();
        const a = cell('a');
        const source = a.add();
        link.set('a', source.id, 'layout');
        expect(link.status('a', source.id).mode).toBe('layout');
        const b = cell('b');
        const inherited = b.add();
        link.reconcileLayout(new Map([['b', 'a']]));
        source.setInputs({ length: 41 });
        expect(b.list).toEqual([inherited]);
        expect(inherited.inputValues().length).toBe(41);
    });

    it('does not resurrect a locally removed layout copy during later reconciliation', () => {
        const { cell, link } = fixtures();
        const a = cell('a'), b = cell('b'), c = cell('c');
        const source = a.add();
        link.set('a', source.id, 'layout');
        const removed = b.list.pop()!;
        link.removed('b', removed.id);
        expect(link.status('a', source.id).mode).toBe('charts');
        link.reconcileLayout();
        expect(b.list).toHaveLength(0);
        source.setInputs({ length: 28 });
        expect(c.list[0]!.inputValues().length).toBe(28);
    });

    it('fills the initiating script defaults after preparation without losing early edits', () => {
        let sourceInputs: Record<string, string | number | boolean> = { length: 9 };
        let peerInputs: Record<string, string | number | boolean> = { length: 14, color: '#old' };
        const source = {
            id: 'source', title: 'script', source: 'script', props: [],
            inputValues: () => ({ ...sourceInputs }), propValues: () => ({}),
            setInputs: (values: typeof sourceInputs) => { sourceInputs = { ...sourceInputs, ...values }; }, setProps: () => {},
        } as unknown as IndicatorHandle;
        const peer = {
            id: 'peer', title: 'script', source: 'script', props: [],
            inputValues: () => ({ ...peerInputs }), propValues: () => ({}),
            setInputs: (values: typeof peerInputs) => { peerInputs = { ...peerInputs, ...values }; }, setProps: () => {},
        } as unknown as IndicatorHandle;
        const link = new IndicatorLiveSync(() => [
            { id: 'a', handles: () => [source], copy: () => source },
            { id: 'b', handles: () => [peer], copy: () => peer },
        ], () => {});
        link.set('a', source.id, 'charts', ['b']);
        expect(peerInputs).toEqual({ length: 9, color: '#old' });
        sourceInputs = { length: 9, color: '#default' }; // prepare merged the declaration defaults
        link.ready('a', source.id);
        expect(peerInputs).toEqual({ length: 9, color: '#default' });
    });

    it('returns peer-only property overrides to their declaration defaults when the schema arrives', () => {
        let peerProps: Record<string, string | number | boolean> = { precision: 4 };
        let schema: IndicatorHandle['props'] = [];
        const source = { id: 'source', title: 'volume', nativeType: 'volume', props: [], inputValues: () => ({}), propValues: () => ({}) } as unknown as IndicatorHandle;
        const peer = {
            id: 'peer', title: 'volume', nativeType: 'volume', get props() { return schema; },
            inputValues: () => ({}), propValues: () => ({ ...peerProps }),
            setInputs: () => {}, setProps: (values: typeof peerProps) => { peerProps = { ...peerProps, ...values }; },
        } as unknown as IndicatorHandle;
        const link = new IndicatorLiveSync(() => [
            { id: 'a', handles: () => [source], copy: () => source },
            { id: 'b', handles: () => [peer], copy: () => peer },
        ], () => {});
        link.set('a', source.id, 'charts', ['b']);
        expect(peerProps.precision).toBe(4); // schema not yet available
        schema = [{ key: 'precision', title: 'Precision', type: 'int', defval: 2 }];
        link.ready('b', peer.id);
        expect(peerProps.precision).toBe(2);
    });

    it('does not take a singleton that is already linked to another instance', () => {
        const { cell, link } = fixtures();
        const a = cell('a'), b = cell('b'), c = cell('c');
        const one = a.add('volume'), two = c.add('volume');
        link.set('a', one.id, 'charts', ['b']);
        const peer = b.list[0]!;
        peer.setInputs({ length: 8 });
        link.set('c', two.id, 'charts', ['b']);
        expect(b.list).toEqual([peer]);
        expect(peer.inputValues().length).toBe(8);
        expect(link.status('c', two.id).mode).toBe('none');
        peer.setInputs({ length: 17 });
        expect(one.inputValues().length).toBe(17);
        expect(two.inputValues().length).toBe(14);
    });

    it('keeps pooled members when layout sync is reaffirmed while they are hidden', () => {
        const { cell, cells, link } = fixtures();
        const a = cell('a'), b = cell('b');
        const source = a.add();
        link.set('a', source.id, 'layout');
        const peer = b.list[0]!;
        const saved = link.snapshot();
        cells.splice(cells.indexOf(b), 1);
        link.restore(saved);
        link.set('a', source.id, 'layout');
        expect(link.status('a', source.id).pending).toEqual(['b']);
        source.setInputs({ length: 47 });
        cells.push(b);
        link.resolvePending();
        expect(b.list).toEqual([peer]);
        expect(peer.inputValues().length).toBe(47);
    });

    it('persists separate duplicate ordinals, including temporarily absent charts', () => {
        const { cell, cells, link } = fixtures();
        const a = cell('a'), b = cell('b');
        a.add();
        const source = a.add();
        b.add();
        link.set('a', source.id, 'charts', ['b']);
        const saved = link.snapshot();
        expect(saved[0]!.members.map((m) => m.ordinal)).toEqual([1, 1]);
        link.clear();
        const before = b.list[1]!;
        cells.splice(cells.indexOf(b), 1);
        link.restore(saved);
        expect(link.snapshot()[0]!.members).toHaveLength(2);
        source.setInputs({ length: 22 }); // edit while b is hidden
        cells.push(b);
        link.reconcileLayout();
        expect(before.inputValues().length).toBe(22);
        source.setInputs({ length: 27 });
        expect(before.inputValues().length).toBe(27);
        expect(b.list[0]!.inputValues().length).toBe(14);
    });

    it('copies source-backed scripts and retains their source identity through restore', () => {
        const { cell, link } = fixtures();
        const a = cell('a'), b = cell('b');
        const source = a.add('Script', 'title Study\nplot close');
        link.set('a', source.id, 'charts', ['b']);
        const saved = link.snapshot();
        expect(b.list[0]!.source).toBe(source.source);
        expect(saved[0]!.members[0]!.key.startsWith('script:')).toBe(true);
        link.clear();
        link.restore(saved);
        b.list[0]!.setProps({ color: '#00ff00' });
        expect(source.propValues().color).toBe('#00ff00');
    });
});
