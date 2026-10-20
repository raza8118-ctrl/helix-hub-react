import { lazy } from 'react';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchPlaceholder'));
const PayerDirectory       = lazy(() => import('./PayerDirectory'));
const FileTools            = lazy(() => import('./FileTools'));
const SopLibrary           = lazy(() => import('./SopLibrary'));
const Training             = lazy(() => import('./Training'));

/** Routes Workbench tabs (every role) — built modules get their page, the rest a "Coming soon" page. */
export default function WorkbenchApp({ activeTab, user }) {
  switch (activeTab) {
    case 'wb_payers': return <PayerDirectory user={user} />;
    case 'wb_files':  return <FileTools user={user} />;
    case 'wb_sops':   return <SopLibrary user={user} />;
    case 'wb_training': return <Training user={user} />;
    default:          return <WorkbenchPlaceholder tabId={activeTab} />;
  }
}
