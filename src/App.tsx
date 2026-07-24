import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { SetPassword } from "./pages/SetPassword";
import { Dashboard } from "./pages/Dashboard";
import { Shifts } from "./pages/Shifts";
import { Bookings } from "./pages/Bookings";
import { Alerts } from "./pages/Alerts";
import { Cleaners } from "./pages/Cleaners";
import { Users } from "./pages/Users";
import { Logs } from "./pages/Logs";
import { Schedule } from "./pages/Schedule";
import { Connections } from "./pages/Connections";
import { Templates } from "./pages/Templates";
import { ShiftConfirmed } from "./pages/ShiftConfirmed";
import { Spinner } from "./components/ui";

export function App() {
  const { loading, userId, canEdit, needsPassword } = useAuth();

  // Public landing for the email "Confirm Shift" button — no auth, no waiting on
  // the session. Must come before every auth/loading gate below.
  if (window.location.pathname === "/confirmed") return <ShiftConfirmed />;

  if (loading) return <Spinner />;
  // Invited user (or password reset) must set a password before entering — even
  // though the invite link already established a session.
  if (needsPassword) return <SetPassword />;
  if (!userId) return (
    <Routes>
      <Route path="*" element={<Login />} />
    </Routes>
  );

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/shifts" element={<Shifts />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/cleaners" element={<Cleaners />} />
        <Route path="/schedule" element={canEdit ? <Schedule /> : <Navigate to="/" />} />
        <Route path="/logs" element={canEdit ? <Logs /> : <Navigate to="/" />} />
        <Route path="/connections" element={canEdit ? <Connections /> : <Navigate to="/" />} />
        <Route path="/templates" element={canEdit ? <Templates /> : <Navigate to="/" />} />
        <Route path="/users" element={canEdit ? <Users /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
