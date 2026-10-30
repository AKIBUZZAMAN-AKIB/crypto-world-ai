// Use the SAME production tsup options for every part, but emit the large workspace
// and widget declaration graphs one entry at a time to stay within modest CI memory.
import configs from '../tsup.config';

const all = configs as any[];
const lib = all[0];
const part = process.env.VELA_BUILD_PART;
const typeEntry = process.env.VELA_TYPE_ENTRY;

let selected;
if (part === 'esm') selected = { ...lib, name: 'lib-esm', format: ['esm'], dts: false, clean: true };
else if (part === 'cjs') selected = { ...lib, name: 'lib-cjs', format: ['cjs'], dts: false, clean: false };
else if (part === 'browser-dev') selected = all[1];
else if (part === 'browser-min') selected = all[2];
else if (part === 'types' && typeEntry && lib.entry[typeEntry]) {
    selected = { ...lib, name: `types-${typeEntry}`, clean: false, entry: { [typeEntry]: lib.entry[typeEntry] } };
} else throw new Error(`Unknown build part or declaration entry: ${part ?? ''} ${typeEntry ?? ''}`);

export default selected;
