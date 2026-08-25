import { Navigate, Route, Routes } from "react-router-dom";
import { BoardBackdrop } from "./components/BoardBackdrop";
import { PublicOnly, RequireAuth } from "./components/RouteGuards";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { Verify } from "./routes/Verify";
import { Dashboard } from "./routes/Dashboard";
import { TripDetail } from "./routes/TripDetail";
import { Join } from "./routes/Join";
import { Settings } from "./routes/Settings";
import { Admin } from "./routes/Admin";
import { Unsubscribed } from "./routes/Unsubscribed";
import { LocaleProvider } from "./components/LocaleProvider";
import { TourProvider } from "./components/Tour";
import { SessionSocketProvider } from "./components/SessionSocketProvider";
import { ChatDockProvider } from "./components/ChatDock";

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
      {/*
       * Above the routes, because the guided tour outlives any one of them: the
       * account menu offers it from every page, and each route hands it the
       * steps that make sense where the reader actually is (`TourSteps`). Inside
       * `LocaleProvider` for the ordinary reason — its own words are translated.
       */}
      <TourProvider>
        {/*
         * The session's socket and the chat that rides on it, above the routes
         * and outside them.
         *
         * Both used to live on the trip screen, which is what made a
         * conversation a property of the page you were standing on: leaving the
         * board closed the connection and took the chat with it. Here they
         * outlive navigation, so the dock can offer every board's conversation
         * from the overview, the settings page, or another trip entirely — and
         * moving between boards costs no handshake.
         *
         * The socket provider is outside the dock because it is the more
         * general thing: the board's live sync and the connection indicator
         * read it too, and neither has anything to do with chat.
         */}
        <SessionSocketProvider>
          <ChatDockProvider>
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
              {/* The itinerary — the same screen as the board, with the lanes
            swapped for the calendar. Still its own URL rather than a piece of
            component state, so it stays linkable, Back still undoes the switch,
            and a frozen trip keeps a read-only view of what it turned out to be
            at the address people already have. */}
              <Route
                path="/trips/:id/timeline"
                element={
                  <RequireAuth>
                    <TripDetail view="timeline" />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ChatDockProvider>
        </SessionSocketProvider>
      </TourProvider>
    </LocaleProvider>
  );
}
