import { Navigate, Route, Routes } from "react-router-dom";
import { BoardBackdrop } from "./components/BoardBackdrop";
import { PublicOnly, RequireAuth } from "./components/RouteGuards";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { Verify } from "./routes/Verify";
import { Dashboard } from "./routes/Dashboard";
import { TripDetail } from "./routes/TripDetail";
import { Timeline } from "./routes/Timeline";
import { Join } from "./routes/Join";
import { Settings } from "./routes/Settings";
import { Admin } from "./routes/Admin";
import { Unsubscribed } from "./routes/Unsubscribed";

/**
 * UI C — Trip Board. Routes only; providers live in main.tsx so tests can mount
 * <App /> under their own router.
 */
export function App() {
  return (
    <>
      <BoardBackdrop />
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Register />
            </PublicOnly>
          }
        />
        <Route path="/verify" element={<Verify />} />
        {/* Join crafts its own ?next= redirect when logged out. */}
        <Route path="/join/:token" element={<Join />} />
        {/* The unsubscribe landing is public on purpose: it is opened from an
            email client with no session (Phase 5.3). */}
        <Route path="/unsubscribed" element={<Unsubscribed />} />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
        {/* The operator's console. Guarded only as "signed in" here, because
            the real gate is the API's: every /admin request 404s for anyone
            this deployment has not named. Routing cannot be the check — a
            client-side role is a suggestion. */}
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <Admin />
            </RequireAuth>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/trips/:id"
          element={
            <RequireAuth>
              <TripDetail />
            </RequireAuth>
          }
        />
        {/* The itinerary. Its own route, not a mode on the board: different
            question, different frame, and it stays useful on a frozen trip. */}
        <Route
          path="/trips/:id/timeline"
          element={
            <RequireAuth>
              <Timeline />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
