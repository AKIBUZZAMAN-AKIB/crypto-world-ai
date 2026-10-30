// Factual Pine v6 reference snapshot and deliberately lightweight lexical helpers.
// The index is not a compiler or a promise that an attached execution engine supports
// a name. See NOTICE and tools/update-pine-reference.mjs for provenance and refresh.
import data from './pine-reference-data.json';

export interface PineReference {
    name: string;
    kind: 'fun' | 'var' | 'const' | 'type' | 'kw';
    signatures?: string[];
    parameters?: Record<string, string>;
}

export interface PineSuggestion {
    label: string;
    kind: PineReference['kind'] | 'namespace' | 'local' | 'localFunction' | 'method' | 'property' | 'parameter';
    reference?: PineReference;
    signature?: string;
}

export interface PineCompletions {
    wordStart: number;
    word: string;
    items: PineSuggestion[];
}

export interface PineSignature {
    label: string;
    parameters: { label: string; type?: string }[];
}

export interface PineSignatureHelp {
    signatures: PineSignature[];
    activeSignature: number;
    activeParameter: number;
}

interface LocalSymbol {
    name: string;
    indent: number;
    kind: 'local' | 'localFunction';
    type?: string;
    signature?: string;
}

interface UserType {
    name: string;
    fields: { name: string; type: string }[];
}

interface UserMethod {
    name: string;
    receiverType: string;
    parameters: { name: string; type?: string; display: string }[];
}

const reference = data.records as PineReference[];
const methodTypes = ['chart.point', 'array', 'matrix', 'map', 'line', 'linefill', 'label', 'box', 'table', 'polyline', 'footprint', 'volume_row'];
const methods = new Set<string>();
const namespaces = new Set<string>();
for (const record of reference) {
    const parts = record.name.split('.');
    for (let i = 1; i < parts.length; i++) namespaces.add(parts.slice(0, i).join('.'));
    // Official Pine methods are namespace functions whose first argument is the
    // object receiver. Derive this from the same snapshot rather than a stale list.
    const type = methodTypes.find((name) => record.name.startsWith(`${name}.`));
    const first = record.signatures?.[0] ? signatureParameters(record.signatures[0])[0] : undefined;
    const argumentType = first ? record.parameters?.[first] : undefined;
    const typePattern = type && new RegExp(`\\b${type.replace('.', '\\.')}\\b`, 'i');
    if (record.kind === 'fun' && typePattern && argumentType && typePattern.test(argumentType)) methods.add(record.name);
}

export const PINE_REFERENCE_COUNT = reference.length;
export const PINE_REFERENCE_DATE = data.retrieved;

/** Hide strings and comments without moving offsets. `inCode` describes the caret. */
export function maskPineNonCode(source: string): { masked: string; inCode: boolean } {
    let state: 'code' | 'line' | 'block' | 'single' | 'double' = 'code';
    let masked = '';
    for (let i = 0; i < source.length; i++) {
        const c = source[i]!;
        const next = source[i + 1];
        if (state === 'code') {
            if (c === '/' && (next === '/' || next === '*')) {
                state = next === '/' ? 'line' : 'block';
                masked += '  ';
                i++;
            } else if (c === '"' || c === "'") {
                state = c === '"' ? 'double' : 'single';
                masked += ' ';
            } else masked += c;
        } else if (state === 'line') {
            if (c === '\n') { state = 'code'; masked += '\n'; } else masked += ' ';
        } else if (state === 'block') {
            if (c === '*' && next === '/') { masked += '  '; state = 'code'; i++; }
            else masked += c === '\n' ? '\n' : ' ';
        } else if (c === '\\' && next !== undefined) {
            masked += next === '\n' ? ' \n' : '  ';
            i++;
        } else if ((state === 'single' && c === "'") || (state === 'double' && c === '"')) {
            masked += ' ';
            state = 'code';
        } else masked += c === '\n' ? '\n' : ' ';
    }
    return { masked, inCode: state === 'code' };
}

const OBJECT_TYPES = 'chart\\.point|array|matrix|map|line|linefill|label|box|table|polyline|footprint|volume_row';

/** Recognize simple user-defined type blocks and their explicitly typed fields. */
function collectUserTypes(masked: string): UserType[] {
    const types: UserType[] = [];
    let current: { indent: number; type: UserType } | null = null;
    for (const raw of masked.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const indent = (raw.match(/^[\t ]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
        if (current && indent <= current.indent) current = null;
        const header = line.match(/^(?:export\s+)?type\s+([A-Za-z_]\w*)\s*$/);
        if (header) {
            const type: UserType = { name: header[1]!, fields: [] };
            types.push(type);
            current = { indent, type };
            continue;
        }
        if (!current || indent <= current.indent) continue;
        const field = line.match(/^(chart\.point|[A-Za-z_]\w*(?:\s*<[^>\n]+>)?)\s+([A-Za-z_]\w*)(?=\s*(?:=|$))/);
        if (field) current.type.fields.push({ name: field[2]!, type: field[1]! });
    }
    return types;
}

/** Recognize single-line method headers with an explicitly typed first parameter. */
function collectUserMethods(masked: string): UserMethod[] {
    const result: UserMethod[] = [];
    for (const line of masked.split('\n')) {
        const header = line.trim().match(/^(?:export\s+)?method\s+([A-Za-z_]\w*)\s*\((.*)\)\s*=>/);
        if (!header) continue;
        const args = signatureParameters(`method(${header[2]})`);
        const receiver = args[0]?.match(/^(?:(?:const|simple|series)\s+)?(chart\.point|[A-Za-z_]\w*)(?:\s*<[^>]+>)?\s+[A-Za-z_]\w*(?:\s*=.*)?$/);
        if (!receiver) continue;
        const parameters = args.slice(1).map((display) => {
            const declaration = display.split('=')[0]?.trim() ?? '';
            const name = declaration.match(/([A-Za-z_]\w*)$/)?.[1];
            if (!name) return null;
            const type = declaration.slice(0, declaration.length - name.length).trim();
            // Defaults may contain masked strings or expressions; omit them rather
            // than showing incomplete or misleading values in the signature.
            return { name, display: declaration, ...(type ? { type } : {}) };
        });
        if (parameters.some((parameter) => parameter === null)) continue;
        result.push({ name: header[1]!, receiverType: receiver[1]!, parameters: parameters.filter((parameter) => parameter !== null) });
    }
    return result;
}

/**
 * Track declarations through simple indentation scopes. This deliberately does not
 * infer arbitrary expressions, imported libraries, or full Pine types.
 */
function collectLocalSymbols(masked: string, userTypes = collectUserTypes(masked)): LocalSymbol[] {
    const symbols: LocalSymbol[] = [];
    const userTypePattern = userTypes.map((type) => type.name).join('|');
    const types = `${OBJECT_TYPES}${userTypePattern ? `|${userTypePattern}` : ''}`;
    const declaration = new RegExp(`^(?:(?:var|varip|const|simple|series)\\s+)*(?:(${types})(?:\\s*<[^>\\n]+>)?\\s+|(?:int|float|bool|string|color)\\s+)?([A-Za-z_]\\w*)\\s*=(?!=)\\s*(.*)$`);
    const lines = masked.split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        const indent = (raw.match(/^[\t ]*/)?.[0] ?? '').replace(/\t/g, '    ').length;
        for (let i = symbols.length - 1; i >= 0; i--) {
            if (symbols[i]!.indent > indent) symbols.splice(i, 1);
        }
        const fn = line.match(/^(?:export\s+)?(?:method\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=>/);
        if (fn) {
            const args = fn[2]!.split(',').map((arg) => arg.trim()).filter(Boolean);
            symbols.push({ name: fn[1]!, indent, kind: 'localFunction', signature: `${fn[1]}(${args.join(', ')})` });
            for (const arg of args) {
                const name = arg.split('=')[0]?.trim().match(/([A-Za-z_]\w*)$/)?.[1];
                if (name) symbols.push({ name, indent: indent + 1, kind: 'local' });
            }
            continue;
        }
        const tuple = line.match(/^\[([^\]]+)\]\s*=(?!=)/);
        if (tuple) {
            for (const entry of tuple[1]!.split(',')) {
                const name = entry.trim();
                if (/^[A-Za-z_]\w*$/.test(name) && name !== '_') symbols.push({ name, indent, kind: 'local' });
            }
            continue;
        }
        const match = line.match(declaration);
        if (match) {
            const [, explicitType, name, value] = match;
            const userConstructor = value?.match(/^([A-Za-z_]\w*)\.new\s*\(/)?.[1];
            const inferred = value?.match(new RegExp(`^(${OBJECT_TYPES})\\.(?:new(?:_|\\b|<)|from\\b)`))?.[1]
                ?? (/^chart\.point\.(?:from_index|from_time|now|copy)\s*\(/.test(value ?? '') ? 'chart.point' : undefined)
                ?? (/^request\.footprint\s*\(/.test(value ?? '') ? 'footprint' : undefined)
                ?? (userTypes.some((type) => type.name === userConstructor) ? userConstructor : undefined);
            symbols.push({ name: name!, indent, kind: 'local', type: explicitType ?? inferred });
            continue;
        }
        const loop = line.match(/^for\s+([A-Za-z_]\w*)\s*(?:=|\bin\b)/);
        if (loop) symbols.push({ name: loop[1]!, indent: indent + 1, kind: 'local' });
    }
    const unique = new Map<string, LocalSymbol>();
    for (const symbol of symbols) unique.set(symbol.name, symbol);
    return [...unique.values()];
}

function directChild(name: string, prefix: string): string | null {
    const start = prefix ? `${prefix}.` : '';
    if (!name.startsWith(start)) return null;
    const remaining = name.slice(start.length);
    return remaining && !remaining.includes('.') ? remaining : null;
}

/** Suggestions for a caret offset. Comments/strings and unrelated namespaces are excluded. */
export function pineCompletions(source: string, offset: number): PineCompletions {
    const cursor = Math.max(0, Math.min(source.length, offset));
    const { masked, inCode } = maskPineNonCode(source.slice(0, cursor));
    if (!inCode) return { wordStart: cursor, word: '', items: [] };
    const token = masked.match(/(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*$|(?:[A-Za-z_]\w*\.)+$/)?.[0] ?? '';
    const dot = token.lastIndexOf('.');
    const prefix = dot < 0 ? '' : token.slice(0, dot);
    const word = dot < 0 ? token : token.slice(dot + 1);
    const userTypes = collectUserTypes(masked);
    const locals = collectLocalSymbols(masked, userTypes);
    const items: PineSuggestion[] = [];
    const matches = (candidate: string): boolean => candidate.toLowerCase().startsWith(word.toLowerCase());
    const inferred = prefix && !prefix.includes('.') ? locals.find((s) => s.name === prefix)?.type : undefined;
    if (inferred) {
        // Special types with documented fields (currently chart.point) are distinct
        // from methods: inserting a field must not add function parentheses.
        const type = reference.find((record) => record.kind === 'type' && record.name === inferred);
        for (const [label, detail] of Object.entries(type?.parameters ?? {})) {
            if (matches(label)) items.push({ label, kind: 'property', signature: detail });
        }
        const userType = userTypes.find((entry) => entry.name === inferred);
        for (const field of userType?.fields ?? []) {
            if (matches(field.name)) items.push({ label: field.name, kind: 'property', signature: field.type });
        }
        if (userType && matches('copy')) {
            items.push({ label: 'copy', kind: 'method', signature: `${prefix}.copy() → ${userType.name}` });
        }
        for (const method of collectUserMethods(masked)) {
            if (method.receiverType !== inferred || !matches(method.name) || methods.has(`${inferred}.${method.name}`)) continue;
            items.push({ label: method.name, kind: 'method', signature: `${prefix}.${method.name}(${method.parameters.map((parameter) => parameter.display).join(', ')})` });
        }
        for (const record of reference) {
            if (record.kind !== 'fun' || !methods.has(record.name) || !record.name.startsWith(`${inferred}.`)) continue;
            const label = directChild(record.name, inferred);
            if (label && matches(label)) {
                const original = record.signatures?.[0];
                const params = original ? signatureParameters(original).slice(1) : [];
                const returned = original?.includes('→') ? ` → ${original.split('→').slice(1).join('→').trim()}` : '';
                items.push({ label, kind: 'method', reference: record, signature: `${prefix}.${label}(${params.join(', ')})${returned}` });
            }
        }
    } else if (prefix && userTypes.some((type) => type.name === prefix)) {
        const type = userTypes.find((entry) => entry.name === prefix)!;
        if (matches('new')) items.push({ label: 'new', kind: 'localFunction', signature: `${prefix}.new(${type.fields.map((field) => field.name).join(', ')})` });
        if (matches('copy')) items.push({ label: 'copy', kind: 'localFunction', signature: `${prefix}.copy(id)` });
    } else if (!prefix || namespaces.has(prefix)) {
        for (const namespace of namespaces) {
            const label = directChild(namespace, prefix);
            if (label && matches(label)) items.push({ label, kind: 'namespace' });
        }
        for (const record of reference) {
            const label = directChild(record.name, prefix);
            if (label && matches(label) && /^[A-Za-z_]\w*(?:<[^>]+>)?$/.test(label)) {
                items.push({ label, kind: record.kind, reference: record });
            }
        }
        if (!prefix) {
            for (const type of userTypes) {
                if (matches(type.name)) items.push({ label: type.name, kind: 'type', signature: 'User-defined type' });
            }
            for (const symbol of locals) {
                if (matches(symbol.name)) items.push({ label: symbol.name, kind: symbol.kind, signature: symbol.signature });
            }
            // Named arguments are drawn from the actual overload signatures. They are
            // offered as `name = `, not treated as variable declarations or runtime checks.
            const previous = masked.slice(0, cursor - word.length).trimEnd().slice(-1);
            const help = previous === '(' || previous === ',' ? pineSignatureHelp(source, cursor) : null;
            if (help) {
                for (const signature of help.signatures) {
                    for (const parameter of signature.parameters) {
                        if (/^[A-Za-z_]\w*$/.test(parameter.label) && matches(parameter.label)) {
                            items.push({ label: parameter.label, kind: 'parameter', signature: parameter.type ? `Parameter · ${parameter.type}` : 'Parameter' });
                        }
                    }
                }
            }
        }
    }
    const seen = new Set<string>();
    return {
        wordStart: cursor - word.length,
        word,
        items: items.filter((item) => {
            const key = `${item.kind}:${item.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }),
    };
}

/** Extract parameter labels from one official signature, keeping overloads separate. */
export function signatureParameters(signature: string): string[] {
    const open = signature.indexOf('(');
    if (open < 0) return [];
    const result: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = start; i < signature.length; i++) {
        const char = signature[i];
        if (char === '(' || char === '[' || char === '<') depth++;
        else if (char === ')' && depth === 0) {
            const last = signature.slice(start, i).trim();
            if (last) result.push(last);
            return result;
        } else if (char === ')' || char === ']' || char === '>') depth = Math.max(0, depth - 1);
        else if (char === ',' && depth === 0) {
            const part = signature.slice(start, i).trim();
            if (part) result.push(part);
            start = i + 1;
        }
    }
    return [];
}

function callableAt(masked: string): { name: string; argument: number; named?: string } | null {
    let parens = 0;
    let brackets = 0;
    let braces = 0;
    let argument = 0;
    let lastComma = masked.length;
    for (let i = masked.length - 1; i >= 0; i--) {
        const c = masked[i];
        if (c === ')') parens++;
        else if (c === ']') brackets++;
        else if (c === '}') braces++;
        else if (c === '[') brackets = Math.max(0, brackets - 1);
        else if (c === '{') braces = Math.max(0, braces - 1);
        else if (c === '(') {
            if (parens > 0) { parens--; continue; }
            if (brackets || braces) continue;
            const match = masked.slice(0, i).match(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s*<([^>\n]+)>)?\s*$/);
            const base = match?.[1];
            const name = base && match?.[2]
                ? reference.find((record) => record.kind === 'fun' && record.name.startsWith(`${base}<`))?.name ?? base
                : base;
            if (name) {
                const start = lastComma === masked.length ? i + 1 : lastComma + 1;
                const named = masked.slice(start).match(/^\s*([A-Za-z_]\w*)\s*=/)?.[1];
                return { name, argument, ...(named ? { named } : {}) };
            }
            // A grouping parenthesis is not a call. Continue looking outward.
            argument = 0;
            lastComma = masked.length;
        } else if (c === ',' && parens === 0 && brackets === 0 && braces === 0) {
            argument++;
            if (lastComma === masked.length) lastComma = i;
        }
    }
    return null;
}

/** Signature help for the innermost call, including named parameters and overloads. */
export function pineSignatureHelp(source: string, offset: number): PineSignatureHelp | null {
    const cursor = Math.max(0, Math.min(source.length, offset));
    const { masked, inCode } = maskPineNonCode(source.slice(0, cursor));
    if (!inCode) return null;
    const call = callableAt(masked);
    if (!call) return null;
    const userTypes = collectUserTypes(masked);
    const locals = collectLocalSymbols(masked, userTypes);
    const dot = call.name.indexOf('.');
    const receiver = dot > 0 ? call.name.slice(0, dot) : '';
    const member = dot > 0 ? call.name.slice(dot + 1) : '';
    const receiverType = locals.find((s) => s.name === receiver)?.type;
    const methodName = receiverType && member && !member.includes('.') ? `${receiverType}.${member}` : '';
    const isMethod = !!methodName && methods.has(methodName);
    const ref = reference.find((r) => r.kind === 'fun' && r.name === (isMethod ? methodName : call.name));
    const local = !ref ? locals.find((s) => s.name === call.name && s.kind === 'localFunction') : undefined;
    const declaredType = userTypes.find((type) => type.name === receiver);
    const instanceType = userTypes.find((type) => type.name === receiverType);
    const customMethod = !isMethod && receiverType && member && !member.includes('.')
        ? collectUserMethods(masked).find((method) => method.receiverType === receiverType && method.name === member) : undefined;
    const userSignature = declaredType && member === 'new'
        ? `${call.name}(${declaredType.fields.map((field) => field.name).join(', ')}) → ${declaredType.name}`
        : declaredType && member === 'copy' ? `${call.name}(id) → ${declaredType.name}`
        : instanceType && member === 'copy' ? `${call.name}() → ${instanceType.name}`
        : customMethod ? `${call.name}(${customMethod.parameters.map((parameter) => parameter.display).join(', ')})` : undefined;
    const labels = ref?.signatures ?? (local?.signature ? [local.signature] : userSignature ? [userSignature] : []);
    if (!labels.length) return null;
    const signatures = labels.map((label) => {
        let params = signatureParameters(label);
        let display = label;
        if (isMethod) {
            params = params.slice(1);
            const returned = label.includes('→') ? ` → ${label.split('→').slice(1).join('→').trim()}` : '';
            display = `${call.name}(${params.join(', ')})${returned}`;
        }
        if (customMethod && !ref && !(instanceType && member === 'copy')) {
            return { label: display, parameters: customMethod.parameters.map((parameter) => ({
                label: parameter.name, ...(parameter.type ? { type: parameter.type } : {}),
            })) };
        }
        return { label: display, parameters: params.map((name) => {
            const type = ref?.parameters?.[name] ?? (member === 'new' ? declaredType?.fields.find((field) => field.name === name)?.type : undefined);
            return { label: name, ...(type ? { type } : {}) };
        }) };
    });
    let activeSignature = 0;
    if (call.named) {
        const matching = signatures.findIndex((signature) => signature.parameters.some((param) => param.label === call.named));
        if (matching >= 0) activeSignature = matching;
    } else {
        const matching = signatures.findIndex((signature) => call.argument < signature.parameters.length);
        if (matching >= 0) activeSignature = matching;
    }
    const selected = signatures[activeSignature]!;
    const namedIndex = call.named ? selected.parameters.findIndex((param) => param.label === call.named) : -1;
    const activeParameter = Math.max(0, Math.min(selected.parameters.length - 1, namedIndex >= 0 ? namedIndex : call.argument));
    return { signatures, activeSignature, activeParameter };
}

/** Reference entries for a dotted identifier; prefer values unless followed by `(`. */
export function pineReferenceAt(source: string, offset: number): { record: PineReference; start: number; end: number } | null {
    const before = source.slice(0, Math.max(0, Math.min(source.length, offset)));
    if (!maskPineNonCode(before).inCode) return null;
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEndAt = source.indexOf('\n', offset);
    const lineEnd = lineEndAt < 0 ? source.length : lineEndAt;
    const line = source.slice(lineStart, lineEnd);
    const col = offset - lineStart;
    const pattern = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/g;
    for (const match of line.matchAll(pattern)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (col < start || col > end) continue;
        const candidates = reference.filter((r) => r.name === match[0]);
        const call = /^\s*\(/.test(line.slice(end));
        const record = candidates.find((r) => call ? r.kind === 'fun' : r.kind !== 'fun') ?? candidates[0];
        return record ? { record, start: lineStart + start, end: lineStart + end } : null;
    }
    return null;
}
