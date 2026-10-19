import { lazy } from 'react';
import { isWorkbenchTab } from '../workbench/modules';

const Dashboard       = lazy(() => import('../admin/Dashboard'));
const Today          = lazy(() => import('../admin/Today'));
const ProdMonitor     = lazy(() => import('../admin/ProdMonitor'));
const HourlyMonitor   = lazy(() => import('../admin/HourlyMonitor'));
const Summary         = lazy(() => import('../admin/Summary'));
const AdminFeedback   = lazy(() => import('../admin/AdminFeedback'));
const TeamFeed        = lazy(() => import('../employee/TeamFeed'));
const SupervisorTeam  = lazy(() => import('./SupervisorTeam'));
const WorkbenchPlaceholder = lazy(() => import('../workbench/WorkbenchPlaceholder'));
const AuditLog        = lazy(() => import('../admin/AuditLog'));
const MasterData      = lazy(() => import('../admin/MasterData'));

/**
 * Routes supervisor tabs to the correct page component — reuses the admin
 * monitoring pages, which scope themselves to the supervisor's assigned team.
 * Tab IDs: dashboard | today | prodmonitor | hourlymon | weekly | monthly | feedback | myteam | feed
 */
export default function SupervisorApp({ activeTab, user }) {
  if (isWorkbenchTab(activeTab)) return <WorkbenchPlaceholder tabId={activeTab} />;
  switch (activeTab) {
    case 'dashboard':   return <Dashboard user={user} />;
    case 'today':       return <Today user={user} />;
    case 'prodmonitor': return <ProdMonitor user={user} />;
    case 'hourlymon':   return <HourlyMonitor user={user} />;
    case 'weekly':      return <Summary key="weekly"  user={user} defaultMode="weekly"  />;
    case 'monthly':     return <Summary key="monthly" user={user} defaultMode="monthly" />;
    case 'feedback':    return <AdminFeedback user={user} />;
    case 'myteam':      return <SupervisorTeam user={user} />;
    case 'feed':        return <TeamFeed user={user} />;
    case 'auditlog':    return <AuditLog user={user} />;
    case 'masters':     return <MasterData user={user} />;
    default:            return <Today user={user} />;
  }
}
