import { lazy } from 'react';
import { isWorkbenchTab } from '../workbench/modules';
import { canOpenTab, TAB_FEATURES } from '../../lib/access';

const Dashboard       = lazy(() => import('../admin/Dashboard'));
const TeamDashboard   = lazy(() => import('../admin/TeamDashboard'));
const Today          = lazy(() => import('../admin/Today'));
const ProdMonitor     = lazy(() => import('../admin/ProdMonitor'));
const HourlyMonitor   = lazy(() => import('../admin/HourlyMonitor'));
const Summary         = lazy(() => import('../admin/Summary'));
const AdminFeedback   = lazy(() => import('../admin/AdminFeedback'));
const TeamFeed        = lazy(() => import('../employee/TeamFeed'));
const SupervisorTeam  = lazy(() => import('./SupervisorTeam'));
const WorkbenchApp    = lazy(() => import('../workbench/WorkbenchApp'));
const AdminApp        = lazy(() => import('../admin/AdminApp'));

// Tabs every supervisor has; anything else in TAB_FEATURES must be granted by an admin
const OWN_TABS = new Set(['dashboard', 'teamdash', 'today', 'prodmonitor', 'hourlymon', 'weekly', 'monthly', 'feedback', 'myteam', 'feed']);

/**
 * Routes supervisor tabs to the correct page component — reuses the admin
 * monitoring pages, which scope themselves to the supervisor's assigned team.
 * Tab IDs: dashboard | today | prodmonitor | hourlymon | weekly | monthly | feedback | myteam | feed
 * plus any page an admin granted (lib/access.js), opened in its admin version.
 */
export default function SupervisorApp({ activeTab, user }) {
  if (isWorkbenchTab(activeTab)) return <WorkbenchApp activeTab={activeTab} user={user} />;
  if (TAB_FEATURES[activeTab] && !OWN_TABS.has(activeTab)) {
    return canOpenTab(user, activeTab) ? <AdminApp activeTab={activeTab} user={user} /> : <Today user={user} />;
  }
  switch (activeTab) {
    case 'dashboard':   return <Dashboard user={user} />;
    case 'teamdash':    return canOpenTab(user, 'teamdash') ? <TeamDashboard user={user} /> : <Today user={user} />;
    case 'today':       return <Today user={user} />;
    case 'prodmonitor': return <ProdMonitor user={user} />;
    case 'hourlymon':   return <HourlyMonitor user={user} />;
    case 'weekly':      return <Summary key="weekly"  user={user} defaultMode="weekly"  />;
    case 'monthly':     return <Summary key="monthly" user={user} defaultMode="monthly" />;
    case 'feedback':    return <AdminFeedback user={user} />;
    case 'myteam':      return <SupervisorTeam user={user} />;
    case 'feed':        return <TeamFeed user={user} />;
    default:            return <Today user={user} />;
  }
}
