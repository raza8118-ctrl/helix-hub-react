import { lazy } from 'react';
import { isWorkbenchTab } from '../workbench/modules';

const ProdReport   = lazy(() => import('./ProdReport'));
const MyReports    = lazy(() => import('./MyReports'));
const Progress     = lazy(() => import('./Progress'));
const MyAllocation = lazy(() => import('./MyAllocation'));
const EmpFeedback  = lazy(() => import('./EmpFeedback'));
const TeamFeed     = lazy(() => import('./TeamFeed'));
const WorkbenchPlaceholder = lazy(() => import('../workbench/WorkbenchPlaceholder'));
const AuditLog     = lazy(() => import('../admin/AuditLog'));
const MasterData   = lazy(() => import('../admin/MasterData'));

/**
 * Routes employee tabs to the correct page component.
 * Tab IDs: prodreport | myreports | progress | myallocation | feedback | feed
 */
export default function EmployeeApp({ activeTab, user }) {
  if (isWorkbenchTab(activeTab)) return <WorkbenchPlaceholder tabId={activeTab} />;
  switch (activeTab) {
    case 'prodreport':   return <ProdReport user={user} />;
    case 'myreports':    return <MyReports user={user} />;
    case 'progress':     return <Progress user={user} />;
    case 'myallocation': return <MyAllocation user={user} />;
    case 'feedback':     return <EmpFeedback user={user} />;
    case 'feed':         return <TeamFeed user={user} />;
    case 'auditlog':     return <AuditLog user={user} />;
    case 'masters':      return <MasterData user={user} />;
    default:             return <ProdReport user={user} />;
  }
}
