import { lazy } from 'react';
import { isWorkbenchTab } from '../workbench/modules';
import { canOpenTab, TAB_FEATURES } from '../../lib/access';

const ProdReport   = lazy(() => import('./ProdReport'));
const MyReports    = lazy(() => import('./MyReports'));
const Progress     = lazy(() => import('./Progress'));
const MyAllocation = lazy(() => import('./MyAllocation'));
const EmpFeedback  = lazy(() => import('./EmpFeedback'));
const TeamFeed     = lazy(() => import('./TeamFeed'));
const WorkbenchPlaceholder = lazy(() => import('../workbench/WorkbenchPlaceholder'));
const AdminApp     = lazy(() => import('../admin/AdminApp'));

/**
 * Routes employee tabs to the correct page component.
 * Tab IDs: prodreport | myreports | progress | myallocation | feedback | feed
 * plus any page an admin granted (lib/access.js) — those open in their admin version,
 * which limits data to the employee's own sub-processes and is view-only by default.
 */
export default function EmployeeApp({ activeTab, user }) {
  if (isWorkbenchTab(activeTab)) return <WorkbenchPlaceholder tabId={activeTab} />;
  if (TAB_FEATURES[activeTab]) {
    if (!canOpenTab(user, activeTab)) return <ProdReport user={user} />;
    return <AdminApp activeTab={activeTab === 'feedbackadmin' ? 'feedback' : activeTab} user={user} />;
  }
  switch (activeTab) {
    case 'prodreport':   return <ProdReport user={user} />;
    case 'myreports':    return <MyReports user={user} />;
    case 'progress':     return <Progress user={user} />;
    case 'myallocation': return <MyAllocation user={user} />;
    case 'feedback':     return <EmpFeedback user={user} />;
    case 'feed':         return <TeamFeed user={user} />;
    default:             return <ProdReport user={user} />;
  }
}
