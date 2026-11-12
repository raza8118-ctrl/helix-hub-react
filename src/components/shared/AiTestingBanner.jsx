import { useState, useEffect } from 'react';
import { aiConfig } from '../../lib/ai';

/**
 * Yellow banner on every AI feature while AI runs in Testing mode (PO 2026-11-12) — Owner Console → Platform → AI.
 * Testing = a provider without a BAA (Gemini): made-up text only. Shows nothing in Production.
 */
export default function AiTestingBanner({ style }) {
  const [mode, setMode] = useState(null);
  useEffect(() => { let alive = true; aiConfig().then(c => alive && setMode(c.mode)); return () => { alive = false; }; }, []);
  if (mode !== 'testing') return null;
  return (
    <div className="ai-test-banner" role="note" style={style}>
      ⚠ Testing AI – do not enter patient or client data.
    </div>
  );
}
