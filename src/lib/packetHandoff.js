// Appeal Builder → Appeal Packet hand-over (roadmap 5.5). Holds patient details and PDFs, so it lives in memory only:
// never in the database, browser storage or logs. The packet takes it once (then it's wiped); sign-out wipes it too.

let handoff = null;   // { type, payer, clientId, claimNo, dos, patient, memberId, letter: { bytes, pageCount } | null, form: … | null }

/** Leaves the appeal for the Appeal Packet and opens File Tools. */
export function sendToPacket(data) {
  handoff = data;
  window.dispatchEvent(new CustomEvent('helix:open-tab', { detail: 'wb_files' }));
}

/** The waiting hand-over (not removed — safe to call while rendering). */
export const peekPacketHandoff = () => handoff;

/** Removes the hand-over once the packet has taken it. */
export function clearPacketHandoff() { handoff = null; }

if (typeof window !== 'undefined') window.addEventListener('helix:signed-out', clearPacketHandoff);
