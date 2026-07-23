import { Navigate, Route, Routes } from "react-router-dom";
import { PublicOnly, RequireAuth } from "./components/RouteGuards";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { Verify } from "./routes/Verify";
import { Dashboard } from "./routes/Dashboard";
import { TripDetail } from "./routes/TripDetail";
import { Join } from "./routes/Join";

/**
 * UI A — Command Deck. Routes only; providers (query, auth, router) live in
 * main.tsx so tests can mount <App /> under their own router.
 */
export function App() {
  return (
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
      {/* Join handles its own auth (crafting the ?next= redirect), so it is not
          wrapped in RequireAuth. */}
      <Route path="/join/:token" element={<Join />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
