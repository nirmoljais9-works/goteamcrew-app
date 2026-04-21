import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { Component, type ReactNode, type ErrorInfo } from "react";

// ── Global error boundary ────────────────────────────────────────────────────
// Catches React render errors and shows a recovery screen instead of blank.
class GlobalErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err?.message || "Unexpected error" };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-center">
          <p className="text-lg font-semibold text-destructive">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-xs">{this.state.message}</p>
          <button
            className="mt-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            onClick={() => { this.setState({ hasError: false, message: "" }); window.location.reload(); }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Pages
import Landing from "@/pages/landing";
import Login from "@/pages/auth/login";
import Register from "@/pages/auth/register";
import RegisterSuccess from "@/pages/register-success";
import SelfieTest from "@/pages/selfie-test";
import Blacklisted from "@/pages/blacklisted";
import NotFound from "@/pages/not-found";

// Crew Pages
import CrewDashboard from "@/pages/crew/dashboard";
import BrowseShifts from "@/pages/crew/shifts";
import ShiftDetail from "@/pages/crew/shift-detail";
import MyShifts from "@/pages/crew/my-shifts";
import MyReferrals from "@/pages/crew/my-referrals";
import Earnings from "@/pages/crew/earnings";
import Profile from "@/pages/crew/profile";

// Admin Pages
import AdminDashboard from "@/pages/admin/dashboard";
import AdminCrew from "@/pages/admin/crew";
import AdminEvents from "@/pages/admin/events";
import AdminShifts from "@/pages/admin/shifts";
import AdminClaims from "@/pages/admin/claims";
import AdminPayments from "@/pages/admin/payments";
import AdminCrewDetail from "@/pages/admin/crew-detail";
import AdminSettings from "@/pages/admin/settings";
import AdminAttendance from "@/pages/admin/attendance";
import AdminReferralPayments from "@/pages/admin/referral-payments";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/register-success" component={RegisterSuccess} />
      <Route path="/selfie-test" component={SelfieTest} />
      <Route path="/blacklisted" component={Blacklisted} />

      {/* Crew Routes */}
      <Route path="/dashboard"><ProtectedRoute allowedRole="crew"><CrewDashboard /></ProtectedRoute></Route>
      <Route path="/shifts"><ProtectedRoute allowedRole="crew"><BrowseShifts /></ProtectedRoute></Route>
      <Route path="/shifts/:id"><ProtectedRoute allowedRole="crew"><ShiftDetail /></ProtectedRoute></Route>
      <Route path="/my-shifts"><ProtectedRoute allowedRole="crew"><MyShifts /></ProtectedRoute></Route>
      <Route path="/referrals"><ProtectedRoute allowedRole="crew"><MyReferrals /></ProtectedRoute></Route>
      <Route path="/earnings"><ProtectedRoute allowedRole="crew"><Earnings /></ProtectedRoute></Route>
      <Route path="/profile"><ProtectedRoute allowedRole="crew"><Profile /></ProtectedRoute></Route>

      {/* Admin Routes */}
      <Route path="/admin"><ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute></Route>
      <Route path="/admin/crew"><ProtectedRoute allowedRole="admin"><AdminCrew /></ProtectedRoute></Route>
      <Route path="/admin/events"><ProtectedRoute allowedRole="admin"><AdminEvents /></ProtectedRoute></Route>
      <Route path="/admin/shifts"><ProtectedRoute allowedRole="admin"><AdminShifts /></ProtectedRoute></Route>
      <Route path="/admin/claims"><ProtectedRoute allowedRole="admin"><AdminClaims /></ProtectedRoute></Route>
      <Route path="/admin/payments"><ProtectedRoute allowedRole="admin"><AdminPayments /></ProtectedRoute></Route>
      <Route path="/admin/crew/:id"><ProtectedRoute allowedRole="admin"><AdminCrewDetail /></ProtectedRoute></Route>
      <Route path="/admin/settings"><ProtectedRoute allowedRole="admin"><AdminSettings /></ProtectedRoute></Route>
      <Route path="/admin/attendance"><ProtectedRoute allowedRole="admin"><AdminAttendance /></ProtectedRoute></Route>
      <Route path="/admin/referral-payments"><ProtectedRoute allowedRole="admin"><AdminReferralPayments /></ProtectedRoute></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
}

export default App;
