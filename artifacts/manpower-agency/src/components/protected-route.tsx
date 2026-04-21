import { ReactNode, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle, FileEdit, Mail, LogOut } from "lucide-react";

function PendingBanner() {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 text-sm font-medium"
      style={{
        background: "#fffbeb",
        borderBottom: "1px solid #fde68a",
        color: "#92400e",
      }}
    >
      <Clock className="w-3.5 h-3.5 shrink-0 text-amber-500" />
      <span>Your profile is under review — we'll notify you within 1–2 business days.</span>
    </div>
  );
}

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRole?: "admin" | "crew";
}

function PendingScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-10 h-10 text-amber-600" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Your profile is under review</h1>
          <p className="text-gray-600 text-sm leading-relaxed">
            We've received your application and our team is reviewing it. This usually takes 1–2 business days. We'll notify you once it's approved.
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-amber-200 p-5 text-left space-y-3">
          <p className="text-sm font-semibold text-amber-800">What happens next?</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">1</span>
              Our team reviews your profile and documents
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">2</span>
              You'll receive a WhatsApp or email notification
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs flex items-center justify-center shrink-0 mt-0.5 font-bold">3</span>
              Once approved, you can browse and claim shifts
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <a href="mailto:info@goteamcrew.in">
            <Button variant="outline" className="w-full gap-2" type="button">
              <Mail className="w-4 h-4" /> Contact Support
            </Button>
          </a>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectedScreen({
  rejectionReason,
  crewProfileId,
  onLogout,
}: {
  rejectionReason?: string | null;
  crewProfileId?: number | null;
  onLogout: () => void;
}) {
  const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const editLink = crewProfileId
    ? `${BASE_URL}/register?crew_id=${crewProfileId}`
    : `${BASE_URL}/register`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-10 h-10 text-red-600" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Your profile was not approved</h1>
          <p className="text-gray-600 text-sm leading-relaxed">
            Unfortunately, your application did not meet our requirements at this time. You can update your profile and resubmit.
          </p>
        </div>

        {rejectionReason && (
          <div className="bg-white rounded-2xl border border-red-200 p-5 text-left">
            <p className="text-sm font-semibold text-red-800 mb-1">Reason for rejection</p>
            <p className="text-sm text-gray-700 italic">"{rejectionReason}"</p>
          </div>
        )}

        <div className="space-y-3">
          <Link href={editLink}>
            <Button className="w-full gap-2 bg-primary hover:bg-primary/90 text-white h-12 text-base rounded-xl" type="button">
              <FileEdit className="w-5 h-5" /> Fix &amp; Resubmit Profile
            </Button>
          </Link>
          <a href="mailto:info@goteamcrew.in">
            <Button variant="outline" className="w-full gap-2" type="button">
              <Mail className="w-4 h-4" /> Contact Support
            </Button>
          </a>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, allowedRole }: ProtectedRouteProps) {
  const { user, isLoading, logout } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      if (location && location !== "/login") {
        sessionStorage.setItem("loginRedirect", location);
      }
      setLocation("/login");
      return;
    }

    if (allowedRole && user.role !== allowedRole) {
      setLocation(user.role === "admin" ? "/admin" : "/dashboard");
      return;
    }

    // Blacklisted crew may only access /earnings
    if (user.role === "crew" && user.status === "blacklisted" && location !== "/earnings") {
      setLocation("/earnings");
    }
  }, [isLoading, user, allowedRole, location]);

  // Show spinner while auth loads, while the redirect effect fires, or while
  // the role check is pending. Never return null — null causes a blank white
  // screen on iOS tab restore when the WKWebView is recreated after file picker.
  const spinner = (
    <div className="h-screen w-full flex items-center justify-center bg-background">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
  if (isLoading) return spinner;
  if (!user) return spinner;
  if (allowedRole && user.role !== allowedRole) return spinner;

  // ── Status gating for crew users ────────────────────────────────────────
  // Pending/resubmitted crew are ALWAYS blocked — no bypass allowed.
  // They must wait for admin approval before accessing any crew page.
  if (user.role === "crew") {
    const status = user.status;

    if (status === "pending" || status === "resubmitted") {
      return <PendingScreen onLogout={logout} />;
    }

    if (status === "rejected") {
      return (
        <RejectedScreen
          rejectionReason={user.rejectionReason}
          crewProfileId={user.crewProfileId}
          onLogout={logout}
        />
      );
    }
  }

  return <AppLayout>{children}</AppLayout>;
}
