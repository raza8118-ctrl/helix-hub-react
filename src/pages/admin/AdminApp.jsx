import { lazy } from 'react';

const Today         = lazy(() => import('./Today'));
const ProdMonitor    = lazy(() => import('./ProdMonitor'));
const HourlyMonitor  = lazy(() => import('./HourlyMonitor'));
const Summary        = lazy(() => import('./Summary'));
const AdminFeedback  = lazy(() => import('./AdminFeedback'));
const TeamMgmt       = lazy(() => import('./TeamMgmt'));
const WorkAllocation = lazy(() => import('./WorkAllocation'));
const AllocMonitor   = lazy(() => import('./AllocMonitor'));
const QualityMonitor = lazy(() => import('./QualityMonitor'));
const Settings       = lazy(() => import('./Settings'));
const FeedMonitor    = lazy(() => import('./FeedMonitor'));
const TeamFeed       = lazy(() => import('../employee/TeamFeed'));

/**
 * Routes admin tabs to the correct page component.
 * Tab IDs: today | prodmonitor | hourlymon | weekly | monthly | feed |
 *          feedback | team | allocation | allocmon | feedmonitor | settings
 */
export default function AdminApp({ activeTab, user }) {
  switch (activeTab) {
    case 'today':       return <Today user={user} />;
    case 'prodmonitor': return <ProdMonitor user={user} />;
    case 'hourlymon':   return <HourlyMonitor user={user} />;
    case 'weekly':      return <Summary key="weekly"  user={user} defaultMode="weekly"  />;
    case 'monthly':     return <Summary key="monthly" user={user} defaultMode="monthly" />;
    case 'feed':        return <TeamFeed user={user} />;
    case 'feedback':    return <AdminFeedback user={user} />;
    case 'team':        return <TeamMgmt user={user} />;
    case 'allocation':  return <WorkAllocation user={user} />;
    case 'allocmon':    return <AllocMonitor user={user} />;
    case 'qualitymon':  return <QualityMonitor user={user} />;
    case 'feedmonitor': return <FeedMonitor user={user} />;
    case 'settings':    return <Settings user={user} />;
    default:            return <Today user={user} />;
  }
}
