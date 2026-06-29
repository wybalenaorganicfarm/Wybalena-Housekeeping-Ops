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
import { Spinner } from "./components/ui";

export function App() {
  const { loading, userId, isSuperAdmin, canEdit, needsPassword } = useAuth();

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
        <Route path="/logs" element={canEdit ? <Logs /> : <Navigate to="/" />} />
        <Route path="/users" element={isSuperAdmin ? <Users /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
