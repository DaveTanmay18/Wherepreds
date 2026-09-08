import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './lib/auth.js';
import { Loading } from './components/ui.jsx';
import { AdminRoute } from './routes/Admin.js';
import { AdminLeagueRoute } from './routes/AdminLeague.js';
import { AppShell } from './routes/AppShell.js';
import { DashboardRoute } from './routes/Dashboard.js';
import { BracketRoute } from './routes/Bracket.js';
import { CompetitionRoute } from './routes/Competition.js';
import { FootballRoute } from './routes/Football.js';
import { LeagueRoute } from './routes/League.js';
import { LeagueMembersRoute } from './routes/LeagueMembers.js';
import { LeagueNewRoute } from './routes/LeagueNew.js';
import { LeaguesRoute } from './routes/Leagues.js';
import { PredictRoute } from './routes/Predict.js';
import { MatchCentreRoute } from './routes/MatchCentre.js';
import { RoundResultsRoute } from './routes/RoundResults.js';
import { RulesEditorRoute } from './routes/RulesEditor.js';
import { StandingsRoute } from './routes/Standings.js';
import { LoginRoute } from './routes/Login.js';
import { RegisterRoute } from './routes/Register.js';
import { TeamRoute } from './routes/Team.js';

/**
 * Route guard (task P0-23). Preserves the intended destination so signing in
 * lands you where you were headed, not on a generic home page — which matters
 * when the link was "predict this round" shared in a group chat.
 */
function RequireAuth() {
  const { data: user, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function RedirectIfAuthed() {
  const { data: user, isPending } = useSession();
  if (isPending) return <FullPageSpinner />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Route-guard pending state. Centred in the viewport, since there is no
 *  app shell rendered yet at this point. */
function FullPageSpinner() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <Loading inline />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginRoute /> },
      { path: '/register', element: <RegisterRoute /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardRoute /> },
          { path: '/leagues', element: <LeaguesRoute /> },
          { path: '/leagues/new', element: <LeagueNewRoute /> },
          { path: '/leagues/:slug', element: <LeagueRoute /> },
          { path: '/leagues/:slug/members', element: <LeagueMembersRoute /> },
          { path: '/leagues/:slug/standings', element: <StandingsRoute /> },
          { path: '/leagues/:slug/rules', element: <RulesEditorRoute /> },
          { path: '/leagues/:slug/predict/:sequence', element: <PredictRoute /> },
          { path: '/leagues/:slug/rounds/:sequence', element: <RoundResultsRoute /> },
          { path: '/football', element: <FootballRoute /> },
          { path: '/football/team/:slug', element: <TeamRoute /> },
          { path: '/football/fixture/:id', element: <MatchCentreRoute /> },
          { path: '/football/:slug/bracket', element: <BracketRoute /> },
          { path: '/football/:slug', element: <CompetitionRoute /> },
          // Platform admin. The API enforces `isAdmin` on every one of these
          // endpoints — routing here is convenience, never access control.
          { path: '/admin', element: <AdminRoute /> },
          { path: '/admin/leagues/:slug', element: <AdminLeagueRoute /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
