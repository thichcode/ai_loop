import { JobsList } from './pages/JobsList';
import { NewJob } from './pages/NewJob';
import { JobDetail } from './pages/JobDetail';

function parsePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'new') return { page: 'new' as const };
  if (parts[0] === 'jobs' && parts[1]) return { page: 'detail' as const, id: parts[1] };
  return { page: 'list' as const };
}

export function App() {
  const route = parsePath();
  if (route.page === 'new') return <NewJob />;
  if (route.page === 'detail') return <JobDetail id={route.id} />;
  return <JobsList />;
}
