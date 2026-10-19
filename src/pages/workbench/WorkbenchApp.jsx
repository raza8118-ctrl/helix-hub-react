import { lazy } from 'react';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchPlaceholder'));
const PayerDirectory       = lazy(() => import('./PayerDirectory'));

/** Routes Workbench tabs (every role) — built modules get their page, the rest a "Coming soon" page. */
export default function WorkbenchApp({ activeTab, user }) {
  switch (activeTab) {
    case 'wb_payers': return <PayerDirectory user={user} />;
    default:          return <WorkbenchPlaceholder tabId={activeTab} />;
  }
}
