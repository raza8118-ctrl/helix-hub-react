import ProdReport    from './ProdReport';
import MyReports     from './MyReports';
import Progress      from './Progress';
import MyAllocation  from './MyAllocation';
import EmpFeedback   from './EmpFeedback';
import TeamFeed      from './TeamFeed';

/**
 * Routes employee tabs to the correct page component.
 * Tab IDs: prodreport | myreports | progress | myallocation | feedback | feed
 */
export default function EmployeeApp({ activeTab, user }) {
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
