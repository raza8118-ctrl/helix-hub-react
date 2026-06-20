import Today         from './Today';
import ProdMonitor   from './ProdMonitor';
import HourlyMonitor from './HourlyMonitor';
import Summary       from './Summary';
import AdminFeedback from './AdminFeedback';
import TeamMgmt      from './TeamMgmt';
import WorkAllocation from './WorkAllocation';
import AllocMonitor  from './AllocMonitor';
import Settings      from './Settings';
import FeedMonitor   from './FeedMonitor';

/**
 * Routes admin tabs to the correct page component.
 * Tab IDs: today | prodmonitor | hourlymon | weekly | monthly |
 *          feedback | team | allocation | allocmon | feedmonitor | settings
 */
export default function AdminApp({ activeTab, user }) {
  switch (activeTab) {
    case 'today':       return <Today user={user} />;
    case 'prodmonitor': return <ProdMonitor user={user} />;
    case 'hourlymon':   return <HourlyMonitor user={user} />;
    case 'weekly':      return <Summary key="weekly"  user={user} defaultMode="weekly"  />;
    case 'monthly':     return <Summary key="monthly" user={user} defaultMode="monthly" />;
    case 'feedback':    return <AdminFeedback user={user} />;
    case 'team':        return <TeamMgmt user={user} />;
    case 'allocation':  return <WorkAllocation user={user} />;
    case 'allocmon':    return <AllocMonitor user={user} />;
    case 'feedmonitor': return <FeedMonitor user={user} />;
    case 'settings':    return <Settings user={user} />;
    default:            return <Today user={user} />;
  }
}
