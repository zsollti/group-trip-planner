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
import { LocaleProvider } from "./components/LocaleProvider";

/**
 * UI C — Trip Board. Routes, plus the one provider that belongs to the app
 * rather than to the page it is mounted on.
 *
 * The session, the query client and the router still live in main.tsx, so a test
 * can mount <App /> under its own router. **The language does not**, and the
 * distinction is worth keeping: those three are the environment the app runs in,
 * while the language is a property of the app itself — every screen inside these
 * routes formats a date or reads a label with it. Leaving it in main.tsx meant
 * anything that mounted <App /> directly rendered a Settings page whose language
 * section threw, which is how this arrangement was found.
 *
 * It sits inside `AuthProvider` (from either caller) because a signed-in
 * account's stored language is the answer whenever there is one.
 */
export function App() {
  return (
    <LocaleProvider>
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
    </LocaleProvider>
  );
}
