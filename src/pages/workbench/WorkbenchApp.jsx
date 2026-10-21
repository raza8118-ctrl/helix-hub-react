import { lazy } from 'react';

const WorkbenchPlaceholder = lazy(() => import('./WorkbenchPlaceholder'));
const PayerDirectory       = lazy(() => import('./PayerDirectory'));
const FileTools            = lazy(() => import('./FileTools'));
const SopLibrary           = lazy(() => import('./SopLibrary'));
const Training             = lazy(() => import('./Training'));
const DenialNavigator      = lazy(() => import('./DenialNavigator'));
const AppealBuilder        = lazy(() => import('./AppealBuilder'));
const ARTools              = lazy(() => import('./ARTools'));
const SmartWorklist        = lazy(() => import('./SmartWorklist'));
const QaAudits             = lazy(() => import('./QaAudits'));
const ClientQueries        = lazy(() => import('./ClientQueries'));
const HandoverEscalations  = lazy(() => import('./HandoverEscalations'));
const MedicareTrackers     = lazy(() => import('./MedicareTrackers'));

/** Routes Workbench tabs (every role) — built modules get their page, the rest a "Coming soon" page. */
export default function WorkbenchApp({ activeTab, user }) {
  switch (activeTab) {
    case 'wb_payers': return <PayerDirectory user={user} />;
    case 'wb_files':  return <FileTools user={user} />;
    case 'wb_sops':   return <SopLibrary user={user} />;
    case 'wb_training': return <Training user={user} />;
    case 'wb_denials':  return <DenialNavigator user={user} />;
    case 'wb_appeals':  return <AppealBuilder user={user} />;
    case 'wb_artools':  return <ARTools user={user} />;
    case 'wb_worklist': return <SmartWorklist user={user} />;
    case 'wb_qa':       return <QaAudits user={user} />;
    case 'wb_queries':  return <ClientQueries user={user} />;
    case 'wb_handover': return <HandoverEscalations user={user} />;
    case 'wb_medicare': return <MedicareTrackers user={user} />;
    default:          return <WorkbenchPlaceholder tabId={activeTab} />;
  }
}
