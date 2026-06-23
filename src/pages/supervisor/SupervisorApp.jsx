import Today         from '../admin/Today';
import ProdMonitor   from '../admin/ProdMonitor';
import HourlyMonitor from '../admin/HourlyMonitor';
import Summary       from '../admin/Summary';
import AdminFeedback from '../admin/AdminFeedback';
import TeamFeed      from '../employee/TeamFeed';
import SupervisorTeam from './SupervisorTeam';

/**
 * Routes supervisor tabs to the correct page component — reuses the admin
 * monitoring pages, which scope themselves to the supervisor's assigned team.
 * Tab IDs: today | prodmonitor | hourlymon | weekly | monthly | feedback | myteam | feed
 */
export default function SupervisorApp({ activeTab, user }) {
  switch (activeTab) {
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
