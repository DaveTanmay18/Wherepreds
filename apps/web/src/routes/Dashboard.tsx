import { Navigate } from 'react-router-dom';

/**
 * The dashboard IS the leagues list. A separate landing page with nothing on
 * it is a screen the user has to get past, not a screen that helps them.
 */
export function DashboardRoute() {
  return <Navigate to="/leagues" replace />;
}
