// Opening a record on another page (roadmap 10.1 global search): the search remembers what to open, switches to the
// page (App remounts it), and the page reads the waiting record once when it opens. Memory only — nothing is stored.
const pending = {};

/** Remembers what the page `tab` should open (e.g. { payerId: 12 } or { query: 'CO-16' }). */
export function setRecord(tab, what) { pending[tab] = what; }

/** The waiting record for this page, or null. Read it in a useState initializer; clear it in an effect. */
export const peekRecord = tab => pending[tab] ?? null;
export function clearRecord(tab) { delete pending[tab]; }
