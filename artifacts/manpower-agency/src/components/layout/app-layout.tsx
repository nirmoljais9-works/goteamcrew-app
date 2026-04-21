import { ReactNode, createContext, useContext } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { 
  LayoutDashboard, 
  CalendarDays, 
  Briefcase, 
  Wallet, 
  UserCircle, 
  Users, 
  LogOut, 
  CheckSquare, 
  CreditCard,
  Menu,
  X,
  Settings,
  Gift,
  ClipboardCheck,
  ShieldAlert,
  HandCoins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const MobileMenuContext = createContext(false);
export function useMobileMenu() { return useContext(MobileMenuContext); }


function CrewStatusSidebarHint() {
  return (
    <p
      style={{
        fontSize: 10,
        color: "rgba(255,255,255,0.45)",
        fontWeight: 300,
        marginTop: 2,
        lineHeight: 1.2,
        letterSpacing: "-0.2px",
        maxWidth: "100%",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      Applied / Cancelled &amp; Rejected / Ongoing / Completed
    </p>
  );
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isAdmin = user?.role === "admin";
  const isBlacklisted = !isAdmin && user?.status === "blacklisted";

  const crewLinks = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, blocked: isBlacklisted },
    { href: "/shifts", label: "Browse Events", icon: CalendarDays, blocked: isBlacklisted },
    { href: "/my-shifts", label: "Event Status", icon: Briefcase, blocked: isBlacklisted, hintNode: <CrewStatusSidebarHint /> },
    { href: "/referrals", label: "Refer & Earn", icon: Gift, blocked: isBlacklisted },
    { href: "/earnings", label: "Earnings & Payments", icon: Wallet, blocked: false },
    { href: "/profile", label: "Profile", icon: UserCircle, blocked: isBlacklisted },
  ];

  const adminLinks = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/crew", label: "Crew Management", hint: "Approve / Reject / Blacklist / Remove", icon: Users },
    { href: "/admin/events", label: "Events", hint: "Create / Edit Events", icon: CalendarDays },
    { href: "/admin/claims", label: "Event Claims", hint: "Approve / Reject", icon: CheckSquare },
    { href: "/admin/shifts", label: "Shifts", icon: Briefcase },
    { href: "/admin/attendance", label: "Attendance", icon: ClipboardCheck },
    { href: "/admin/payments", label: "Payments", icon: CreditCard },
    { href: "/admin/referral-payments", label: "Referral Payments", hint: "Approve & Pay Referrals", icon: HandCoins },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  const links = isAdmin ? adminLinks : crewLinks;

  const SidebarContent = () => (
    <>
      <div className="px-5 pt-5 pb-3">
        <div className="bg-white rounded-xl px-3 py-2 inline-block">
          <img
            src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`}
            alt="Goteamcrew"
            className="h-9 w-auto object-contain"
          />
        </div>
      </div>
      
      <div className="px-3 py-2 flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="text-[10px] font-bold text-sidebar-foreground/40 uppercase tracking-[0.15em] mb-3 px-3">
          {isAdmin ? "Admin Portal" : "Crew Portal"}
        </div>
        <nav className="space-y-0.5">
          {links.map((link: any) => {
            const isActive = location === link.href || (location.startsWith(link.href) && link.href !== "/admin" && link.href !== "/dashboard");
            if (link.blocked) {
              return (
                <div
                  key={link.href}
                  className="flex items-center gap-3 px-3 py-3 rounded-[12px] opacity-35 cursor-not-allowed select-none"
                  title="Not available — account restricted"
                >
                  <link.icon className="w-4.5 h-4.5 shrink-0" />
                  <span className="text-sm text-sidebar-foreground/70">{link.label}</span>
                </div>
              );
            }
            return (
              <Link key={link.href} href={link.href}>
                <div
                  className={`group flex items-start gap-3 px-3 py-2.5 rounded-[12px] cursor-pointer transition-all duration-200 ${
                    isActive 
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" 
                      : "text-sidebar-foreground/65 hover:bg-white/8 hover:text-sidebar-foreground"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <link.icon className={`w-[18px] h-[18px] shrink-0 mt-0.5 transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-60 group-hover:opacity-90"}`} />
                  <div className="min-w-0">
                    <p className={`text-sm leading-snug ${isActive ? "font-semibold" : "font-medium"}`}>{link.label}</p>
                    {(link as any).hintNode ? (
                      <div className={`${isActive ? "text-primary-foreground/65" : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60"}`}>
                        {(link as any).hintNode}
                      </div>
                    ) : link.hint ? (
                      <p className={`text-[11px] leading-[1.3] mt-1 whitespace-pre-line break-words ${isActive ? "text-primary-foreground/60" : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60"}`}>
                        {link.hint}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-3 pb-4 pt-2 shrink-0 border-t border-white/8">
        <div className="bg-white/5 rounded-[14px] p-3.5 border border-white/8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-bold text-sm shrink-0">
              {user?.name.charAt(0)}
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{user?.name}</p>
              <p className="text-[11px] text-sidebar-foreground/45 truncate">{user?.email}</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            className="w-full justify-start text-sidebar-foreground/70 border-white/10 hover:bg-white/8 hover:text-sidebar-foreground h-9 text-sm"
            onClick={logout}
          >
            <LogOut className="w-3.5 h-3.5 mr-2 opacity-70" />
            Sign Out
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card border-b border-border sticky top-0 z-30">
        <img
          src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`}
          alt="Goteamcrew"
          className="h-9 w-auto object-contain"
        />
        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        style={{ height: "100dvh" }}
        className={`fixed md:sticky top-0 left-0 w-72 bg-sidebar border-r border-sidebar-border z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <SidebarContent />
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 w-full min-w-0 flex flex-col">
        {isBlacklisted && (
          <div className="sticky top-0 z-20 bg-red-600 text-white px-4 py-2.5 flex items-center gap-2.5 text-sm font-medium shadow-md">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Your account is restricted. You can only view earnings.</span>
            <a
              href="mailto:info@goteamcrew.in"
              className="ml-auto underline underline-offset-2 whitespace-nowrap opacity-90 hover:opacity-100 text-xs font-semibold"
            >
              Contact support
            </a>
          </div>
        )}
        <div className="flex-1 p-4 md:p-8 lg:p-10 max-w-7xl mx-auto w-full">
          <MobileMenuContext.Provider value={isMobileMenuOpen}>
            {children}
          </MobileMenuContext.Provider>
        </div>
      </main>
    </div>
  );
}
