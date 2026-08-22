import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Dashboard from "./pages/Dashboard";
import Patients from "./pages/Patients";
import Visits from "./pages/Visits";
import Billing from "./pages/Billing";
import DrugInventory from "./pages/DrugInventory";
import RevenueReports from "./pages/RevenueReports";
import Appointments from "./pages/Appointments";
import Settings from "./pages/Settings";
import OwnerDashboard from "./pages/OwnerDashboard";
import NotFound from "./pages/NotFound";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Staff from "./pages/Staff";
import AcceptInvite from "./pages/AcceptInvite";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import { OfflineBanner } from "./components/OfflineBanner";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Replace current entry so Back button doesn't loop
    window.location.replace(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
    return null;
  }

  return <Component />;
}

// Each wrapped route component is defined ONCE here, at module scope — not
// inline inside Router()'s JSX. An inline arrow function like
// `component={() => <ProtectedRoute component={Dashboard} />}` gets a brand
// new function reference every time Router() re-renders, which happens on
// every navigation (Router calls useLocation()). Wouter treats a new function
// reference as a different component, so ProtectedRoute was fully unmounting
// and remounting — cold-starting its auth check — on every single click. If
// isAuthenticated read false for even one tick during that fresh remount
// (before cached auth state caught up), it fired the login redirect, which
// then bounced straight back once the real state resolved a moment later —
// exactly the "navigates for a second, then reverts" symptom. Defining these
// once here keeps the reference stable across re-renders, so ProtectedRoute
// stays mounted and simply updates, instead of remounting on every click.
const ProtectedDashboard = () => <ProtectedRoute component={Dashboard} />;
const ProtectedPatients = () => <ProtectedRoute component={Patients} />;
const ProtectedVisits = () => <ProtectedRoute component={Visits} />;
const ProtectedBilling = () => <ProtectedRoute component={Billing} />;
const ProtectedDrugInventory = () => <ProtectedRoute component={DrugInventory} />;
const ProtectedRevenueReports = () => <ProtectedRoute component={RevenueReports} />;
const ProtectedAppointments = () => <ProtectedRoute component={Appointments} />;
const ProtectedStaff = () => <ProtectedRoute component={Staff} />;
const ProtectedSettings = () => <ProtectedRoute component={Settings} />;
const ProtectedOwnerDashboard = () => <ProtectedRoute component={OwnerDashboard} />;

function Router() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  // Redirect authenticated users from / to /dashboard — must be in useEffect,
  // NOT in the render body, to avoid mutating location during React's render pass.
  useEffect(() => {
    if (isAuthenticated && window.location.pathname === "/") {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password/:token" component={ResetPassword} />
      <Route path="/accept-invite/:token" component={AcceptInvite} />
      <Route path="/dashboard" component={ProtectedDashboard} />
      <Route path="/patients" component={ProtectedPatients} />
      <Route path="/visits" component={ProtectedVisits} />
      <Route path="/billing" component={ProtectedBilling} />
      <Route path="/inventory" component={ProtectedDrugInventory} />
      <Route path="/reports" component={ProtectedRevenueReports} />
      <Route path="/appointments" component={ProtectedAppointments} />
      <Route path="/staff" component={ProtectedStaff} />
      <Route path="/settings" component={ProtectedSettings} />
      <Route path="/owner" component={ProtectedOwnerDashboard} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <OfflineBanner />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
