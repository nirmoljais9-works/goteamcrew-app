import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Users, AlertCircle, CalendarDays, DollarSign, Briefcase, CheckSquare, CheckCircle, XCircle, ShieldBan } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

function useAdminStats() {
  return useQuery({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json() as Promise<{
        totalCrew: number;
        pendingApprovals: number;
        approvedCount: number;
        rejectedCount: number;
        blacklistedCount: number;
        totalEvents: number;
        activeEvents: number;
        totalShifts: number;
        openShifts: number;
        pendingShiftClaims: number;
        totalPaymentsOwed: number;
        totalPaid: number;
      }>;
    },
  });
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading) {
    return (
      <div className="p-12 text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  const crewCards = [
    {
      label: "Total Registered",
      value: stats?.totalCrew ?? 0,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
      border: "border-blue-100",
      link: "/admin/crew",
      filter: "all",
    },
    {
      label: "Pending Approval",
      value: stats?.pendingApprovals ?? 0,
      icon: AlertCircle,
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-100",
      link: "/admin/crew",
      filter: "pending",
      highlight: (stats?.pendingApprovals ?? 0) > 0,
    },
    {
      label: "Approved",
      value: stats?.approvedCount ?? 0,
      icon: CheckCircle,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      link: "/admin/crew",
      filter: "approved",
    },
    {
      label: "Rejected",
      value: stats?.rejectedCount ?? 0,
      icon: XCircle,
      color: "text-red-500",
      bg: "bg-red-50",
      border: "border-red-100",
      link: "/admin/crew",
      filter: "rejected",
    },
    {
      label: "Blacklisted",
      value: stats?.blacklistedCount ?? 0,
      icon: ShieldBan,
      color: "text-gray-600",
      bg: "bg-gray-100",
      border: "border-gray-200",
      link: "/admin/crew",
      filter: "blacklisted",
    },
  ];

  const opsCards = [
    {
      label: "Active Events",
      value: stats?.activeEvents ?? 0,
      icon: CalendarDays,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      border: "border-indigo-100",
      link: "/admin/events",
    },
    {
      label: "Open Shifts",
      value: stats?.openShifts ?? 0,
      icon: Briefcase,
      color: "text-violet-600",
      bg: "bg-violet-50",
      border: "border-violet-100",
      link: "/admin/shifts",
    },
    {
      label: "Pending Claims",
      value: stats?.pendingShiftClaims ?? 0,
      icon: CheckSquare,
      color: "text-rose-600",
      bg: "bg-rose-50",
      border: "border-rose-100",
      link: "/admin/claims",
      highlight: (stats?.pendingShiftClaims ?? 0) > 0,
    },
    {
      label: "Payments Owed",
      value: `₹${(stats?.totalPaymentsOwed ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`,
      icon: DollarSign,
      color: "text-orange-600",
      bg: "bg-orange-50",
      border: "border-orange-100",
      link: "/admin/payments",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-8 text-white shadow-lg">
        <h1 className="text-2xl md:text-3xl font-bold mb-1">Goteamcrew Admin</h1>
        <p className="text-white/80 text-sm">Manage registrations, events, shifts and payments from one place.</p>
      </div>

      {/* Crew Overview */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Crew Overview</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {crewCards.map((card, i) => (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Link href={card.link}>
                <Card className={`cursor-pointer border ${card.border} hover:shadow-md transition-all duration-200 group h-full ${card.highlight ? "ring-2 ring-amber-300 ring-offset-1" : ""}`}>
                  <CardContent className="p-4">
                    <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center ${card.color} mb-3 group-hover:scale-110 transition-transform`}>
                      <card.icon className="w-5 h-5" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{card.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{card.label}</p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Operations */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Operations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {opsCards.map((card, i) => (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06 }}>
              <Link href={card.link}>
                <Card className={`cursor-pointer border ${card.border} hover:shadow-md transition-all duration-200 group h-full ${card.highlight ? "ring-2 ring-rose-300 ring-offset-1" : ""}`}>
                  <CardContent className="p-4">
                    <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center ${card.color} mb-3 group-hover:scale-110 transition-transform`}>
                      <card.icon className="w-5 h-5" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{card.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{card.label}</p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { href: "/admin/crew", label: "Review Registrations", sub: `${stats?.pendingApprovals ?? 0} pending`, icon: Users },
            { href: "/admin/claims", label: "Approve Shift Claims", sub: `${stats?.pendingShiftClaims ?? 0} pending`, icon: CheckSquare },
            { href: "/admin/payments", label: "Process Payments", sub: `₹${(stats?.totalPaymentsOwed ?? 0).toLocaleString("en-IN")} owed`, icon: DollarSign },
          ].map(action => (
            <Link key={action.href} href={action.href}>
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-muted/40 hover:border-primary/30 transition-all cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <action.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.sub}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
