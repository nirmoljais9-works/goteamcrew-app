import { useState, useEffect, useMemo, useCallback } from "react";
import { CrewProfileModal } from "./crew-profile-modal";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { customFetch } from "@workspace/api-client-react";
import {
  Gift,
  IndianRupee,
  CalendarDays,
  User,
  CheckCircle2,
  XCircle,
  Clock,
  Wallet,
  AlertCircle,
  RefreshCw,
  X,
  MapPin,
  Phone,
  Mail,
  Star,
  Users,
  Hourglass,
  Timer,
  AlertTriangle,
  BadgeCheck,
  Ban,
  MoreVertical,
  ChevronLeft,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function inr(amount: number | string | null | undefined) {
  if (!amount) return "₹0";
  return `₹${parseFloat(amount as string).toLocaleString("en-IN")}`;
}

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try { return format(new Date(d), "d MMM yyyy"); } catch { return null; }
}

function formatTime(d: string | null | undefined) {
  if (!d) return null;
  try { return format(new Date(d), "hh:mm a"); } catch { return null; }
}

function capitalize(s: string | null | undefined) {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

type ReferralStatus = "pending_approval" | "successful" | "paid" | "rejected" | "confirmed" | string;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  pending_approval: { label: "Pending Approval", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Clock },
  successful:       { label: "Approved — Unpaid", color: "text-blue-700",  bg: "bg-blue-50 border-blue-200",   icon: CheckCircle2 },
  paid:             { label: "Paid",              color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: Wallet },
  rejected:         { label: "Rejected",          color: "text-red-600",   bg: "bg-red-50 border-red-200",     icon: XCircle },
  confirmed:        { label: "Confirmed",         color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  selected:         { label: "Selected",          color: "text-violet-700", bg: "bg-violet-50 border-violet-200", icon: Star },
  joined:           { label: "Joined",            color: "text-teal-700",  bg: "bg-teal-50 border-teal-200",   icon: Users },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: "text-gray-600", bg: "bg-gray-100 border-gray-200", icon: AlertCircle };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function InitialAvatar({ name, photoUrl, size = "md" }: { name: string; photoUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "w-16 h-16 text-xl" : size === "sm" ? "w-7 h-7 text-xs" : "w-10 h-10 text-sm";
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className={`${sz} rounded-full object-cover shrink-0 border-2 border-border`} />;
  }
  return (
    <div className={`${sz} rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20`}>
      <span className={`font-bold text-primary`}>{(name || "?").charAt(0).toUpperCase()}</span>
    </div>
  );
}

function DrawerOverlay({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]" onClick={onClose} />;
}

interface Referral {
  id: number;
  eventId: number;
  eventTitle: string;
  eventStartDate: string | null;
  eventEndDate: string | null;
  referrerId: number;
  referrerName: string;
  referrerPhotoUrl: string | null;
  referredUserId: number | null;
  referredUserName: string | null;
  referredPhone: string | null;
  status: ReferralStatus;
  rewardAmount: string | null;
  rewardPaid: string | null;
  updatedAt: string | null;
  createdAt: string;
}

// ─── Referrer Drawer ──────────────────────────────────────────────────────────

interface ReferrerProfile {
  id: number; userId: number; name: string; email: string; phone: string;
  city: string | null; gender: string | null; category: string | null;
  experienceLevel: string | null; closeUpPhotoUrl: string | null;
  walletBalance: number; totalEarnings: number; completedShifts: number;
  age: number | null; languages: string | null; skills: string | null;
  instagramUrl: string | null; height: string | null;
}

interface ReferrerInsight {
  profile: ReferrerProfile;
  stats: {
    total: number; approved: number; rejected: number; pending: number;
    totalEarned: number; pendingPayout: number;
  };
  recentReferrals: Array<{
    id: number; eventId: number; eventTitle: string; referredUserId: number | null;
    referredUserName: string | null; referredPhone: string | null;
    status: string; rewardAmount: string | null; updatedAt: string | null;
  }>;
}

function ReferrerDrawer({ crewProfileId, name, onClose, onCandidateClick }: {
  crewProfileId: number; name: string; onClose: () => void;
  onCandidateClick?: (userId: number, eventId: number, name: string, referralId: number) => void;
}) {
  const [data, setData] = useState<ReferrerInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [statFilter, setStatFilter] = useState<"all" | "approved" | "rejected" | "pending">("all");
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const d = await customFetch(`${BASE}/api/admin/referrers/${crewProfileId}/insights`);
        setData(d as ReferrerInsight);
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [crewProfileId]);

  return (
    <>
      <DrawerOverlay onClose={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[420px] bg-background shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Referrer Profile</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 space-y-4 animate-pulse">
              <div className="flex gap-4 items-center">
                <div className="w-16 h-16 rounded-full bg-muted" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
              </div>
              <div className="space-y-2">
                {[1,2,3,4].map(i => <div key={i} className="h-12 bg-muted rounded-xl" />)}
              </div>
            </div>
          ) : error ? (
            <div className="p-5 text-center text-rose-600 text-sm">{error}</div>
          ) : data ? (
            <div className="p-5 space-y-5">
              {/* Profile card */}
              <div className="flex gap-4 items-start">
                <button onClick={() => setShowProfile(true)} className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <InitialAvatar name={data.profile.name} photoUrl={data.profile.closeUpPhotoUrl} size="lg" />
                </button>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setShowProfile(true)}
                    className="font-bold text-foreground text-base leading-tight hover:text-primary hover:underline underline-offset-2 transition-colors text-left"
                  >
                    {data.profile.name}
                  </button>
                  <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{data.profile.phone}</div>
                    <div className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{data.profile.email}</div>
                    {data.profile.city && <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{data.profile.city}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {data.profile.category && (
                      <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{capitalize(data.profile.category)}</span>
                    )}
                    {data.profile.experienceLevel && (
                      <span className="text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">{capitalize(data.profile.experienceLevel)}</span>
                    )}
                    {data.profile.gender && (
                      <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{capitalize(data.profile.gender)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Referral stats — clickable to filter recent referrals */}
              <div>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Referral Stats</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "all" as const, label: "Total", value: data.stats.total, icon: Users, color: "text-foreground", bg: "bg-muted/40", ring: "ring-2 ring-foreground/30" },
                    { key: "approved" as const, label: "Approved", value: data.stats.approved, icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-50 border border-emerald-200", ring: "ring-2 ring-emerald-500" },
                    { key: "rejected" as const, label: "Rejected", value: data.stats.rejected, icon: XCircle, color: "text-red-600", bg: "bg-red-50 border border-red-200", ring: "ring-2 ring-red-400" },
                  ].map(stat => {
                    const Icon = stat.icon;
                    const isActive = statFilter === stat.key;
                    return (
                      <button
                        key={stat.label}
                        onClick={() => setStatFilter(isActive ? "all" : stat.key)}
                        className={`rounded-xl p-3 text-center transition-all ${stat.bg} ${isActive ? stat.ring + " scale-[1.03]" : "hover:opacity-80"}`}
                      >
                        <Icon className={`w-4 h-4 mx-auto mb-1 ${stat.color}`} />
                        <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                        <p className="text-[10px] text-muted-foreground font-medium">{stat.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Earnings */}
              <div className="rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50 p-4 space-y-3">
                <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Earnings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Total Earned</p>
                    <p className="text-xl font-bold text-emerald-700">{inr(data.stats.totalEarned)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Pending Payout</p>
                    <p className="text-xl font-bold text-blue-700">{inr(data.stats.pendingPayout)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Wallet Balance</p>
                    <p className="text-base font-bold text-foreground">{inr(data.profile.walletBalance)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Completed Shifts</p>
                    <p className="text-base font-bold text-foreground">{data.profile.completedShifts ?? 0}</p>
                  </div>
                </div>
              </div>

              {/* Recent referrals — filtered by stat box selection */}
              {(() => {
                const isApprovedStatus = (s: string) => ["successful", "confirmed", "paid"].includes(s);
                const filtered = data.recentReferrals.filter(r => {
                  if (statFilter === "approved") return isApprovedStatus(r.status);
                  if (statFilter === "rejected") return r.status === "rejected";
                  if (statFilter === "pending") return r.status === "pending_approval";
                  return true;
                });
                if (filtered.length === 0) return (
                  <div className="text-center py-4 text-xs text-muted-foreground">
                    No referrals for this filter
                  </div>
                );
                return (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Recent Referrals{statFilter !== "all" ? ` · ${capitalize(statFilter)}` : ""}
                    </p>
                    <div className="space-y-2">
                      {filtered.map(r => {
                        const candidateName = r.referredUserName || r.referredPhone || "Unknown";
                        const canClick = !!r.referredUserId && !!onCandidateClick;
                        return (
                          <div key={r.id} className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2.5 gap-2">
                            <div className="flex-1 min-w-0">
                              {canClick ? (
                                <button
                                  onClick={() => onCandidateClick!(r.referredUserId!, r.eventId, candidateName, r.id)}
                                  className="font-semibold text-xs text-foreground truncate hover:text-primary hover:underline underline-offset-2 transition-colors text-left block"
                                >
                                  {candidateName}
                                </button>
                              ) : (
                                <p className="font-semibold text-xs text-foreground truncate">{candidateName}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground truncate">{r.eventTitle}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {r.rewardAmount && parseFloat(r.rewardAmount) > 0 && (
                                <span className="text-[10px] font-bold text-emerald-700">{inr(r.rewardAmount)}</span>
                              )}
                              <StatusPill status={r.status} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>
      </div>

      {/* Real crew profile modal — same as crew management */}
      <CrewProfileModal
        crewId={showProfile ? crewProfileId : null}
        onClose={() => setShowProfile(false)}
      />
    </>
  );
}

// ─── Candidate Drawer ─────────────────────────────────────────────────────────

interface CandidateInsight {
  profile: {
    id: number; name: string; email: string; phone: string;
    city: string | null; gender: string | null; category: string | null;
    experienceLevel: string | null; closeUpPhotoUrl: string | null;
    age: number | null; languages: string | null; skills: string | null;
    completedShifts: number; totalEarnings: number;
  };
  event: {
    id: number; title: string; location: string; startDate: string;
    endDate: string; role: string | null;
    payPerDay: number | null; payFemale: number | null; payMale: number | null; payFresher: number | null;
  };
  claim: {
    id: number; status: string; shiftRole: string; shiftStartTime: string; shiftEndTime: string;
    attendanceApproved: boolean | null;
  } | null;
  attendance: {
    status: "present" | "late" | "no_show" | "pending";
    lateMinutes: number; hoursWorked: number;
    checkInTime: string | null; checkOutTime: string | null;
    totalBreakMinutes: number;
  };
  payment: {
    basePay: number; deduction: number; finalPay: number | null;
    isOverride: boolean; overrideReason: string | null;
  };
  decisionTag: "eligible" | "not_eligible" | "review";
}

const DECISION_CONFIG = {
  eligible:     { label: "Eligible", emoji: "✅", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-300" },
  not_eligible: { label: "Not Eligible", emoji: "❌", color: "text-red-700", bg: "bg-red-50 border-red-300" },
  review:       { label: "Review Suggested", emoji: "⚠", color: "text-amber-700", bg: "bg-amber-50 border-amber-300" },
};

const ATTENDANCE_CONFIG = {
  present:  { label: "Present", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  late:     { label: "Late",    color: "text-amber-700",   bg: "bg-amber-50 border-amber-200",   icon: AlertTriangle },
  no_show:  { label: "No Show", color: "text-red-700",     bg: "bg-red-50 border-red-200",       icon: Ban },
  pending:  { label: "Pending", color: "text-gray-600",    bg: "bg-gray-100 border-gray-200",    icon: Hourglass },
};

function CandidateDrawer({
  userId, eventId, name, referralId, onClose, onActionDone, onBack,
}: {
  userId: number; eventId: number; name: string; referralId: number;
  onClose: () => void; onActionDone: () => void; onBack?: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<CandidateInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const d = await customFetch(`${BASE}/api/admin/candidate-insight?userId=${userId}&eventId=${eventId}`);
        setData(d as CandidateInsight);
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [userId, eventId]);

  async function doAction(action: "approve" | "reject" | "paid") {
    setActing(action === "paid" ? null : action);
    try {
      await customFetch(`${BASE}/api/admin/referrals/${referralId}/${action}`, { method: "POST" });
      toast({ title: action === "approve" ? "Referral approved" : action === "paid" ? "Marked as paid" : "Referral rejected" });
      onActionDone();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action failed", description: e.message });
    } finally { setActing(null); }
  }

  const attConfig = data ? ATTENDANCE_CONFIG[data.attendance.status] : ATTENDANCE_CONFIG.pending;
  const decConfig = data ? DECISION_CONFIG[data.decisionTag] : null;

  return (
    <>
      <DrawerOverlay onClose={onClose} />
      <CrewProfileModal crewId={showProfile && data ? data.profile.id : null} onClose={() => setShowProfile(false)} />
      <div className="fixed right-0 top-0 h-full w-full max-w-[440px] bg-background shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-1 rounded-lg hover:bg-muted transition-colors mr-1" title="Back to Referrer Profile">
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <BadgeCheck className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Candidate Overview</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 space-y-4 animate-pulse">
              <div className="h-16 bg-muted rounded-2xl" />
              <div className="flex gap-4 items-center">
                <div className="w-16 h-16 rounded-full bg-muted" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              </div>
              {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
            </div>
          ) : error ? (
            <div className="p-5 text-center text-rose-600 text-sm">{error}</div>
          ) : data ? (
            <div className="p-5 space-y-4">
              {/* Smart Decision Tag */}
              {decConfig && (
                <div className={`rounded-2xl border-2 px-4 py-3 flex items-center gap-3 ${decConfig.bg}`}>
                  <span className="text-2xl">{decConfig.emoji}</span>
                  <div>
                    <p className={`font-bold text-sm ${decConfig.color}`}>{decConfig.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {data.decisionTag === "eligible" && "Full shift completed — referral reward eligible"}
                      {data.decisionTag === "not_eligible" && "No-show recorded — referral reward not eligible"}
                      {data.decisionTag === "review" && `Arrived ${data.attendance.lateMinutes}min late — manual review recommended`}
                    </p>
                  </div>
                </div>
              )}

              {/* 1. Profile */}
              <Section title="Profile" icon={User}>
                <div className="flex gap-3 items-center">
                  <button onClick={() => setShowProfile(true)} className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50">
                    <InitialAvatar name={data.profile.name} photoUrl={data.profile.closeUpPhotoUrl} size="lg" />
                  </button>
                  <button
                    onClick={() => setShowProfile(true)}
                    className="font-bold text-foreground text-sm leading-tight hover:text-primary hover:underline underline-offset-2 transition-colors text-left"
                  >
                    {data.profile.name}
                  </button>
                </div>
              </Section>

              {/* 2. Event Details */}
              <Section title="Event Details" icon={CalendarDays}>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
                  <InfoRow label="Event" value={data.event.title} />
                  <InfoRow label="Role" value={data.claim?.shiftRole || data.event.role || "—"} />
                  <InfoRow label="Date" value={formatDate(data.event.startDate) || "—"} />
                  <InfoRow label="Location" value={data.event.location} />
                  {data.claim && (
                    <>
                      <InfoRow label="Shift Start" value={formatTime(data.claim.shiftStartTime) || "—"} />
                      <InfoRow label="Shift End" value={formatTime(data.claim.shiftEndTime) || "—"} />
                    </>
                  )}
                </div>
              </Section>

              {/* 3. Attendance */}
              <Section title="Attendance" icon={Timer}>
                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const Icon = attConfig.icon;
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${attConfig.bg} ${attConfig.color}`}>
                        <Icon className="w-3.5 h-3.5" />{attConfig.label}
                      </span>
                    );
                  })()}
                  {data.attendance.lateMinutes > 0 && (
                    <span className="text-xs text-amber-700 font-semibold">{data.attendance.lateMinutes} min late</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs">
                  <InfoRow label="Check-in" value={formatTime(data.attendance.checkInTime) || "—"} />
                  <InfoRow label="Check-out" value={formatTime(data.attendance.checkOutTime) || "—"} />
                  <InfoRow label="Hours Worked" value={data.attendance.checkOutTime ? `${data.attendance.hoursWorked}h` : "—"} />
                  <InfoRow label="Break" value={data.attendance.totalBreakMinutes > 0 ? `${data.attendance.totalBreakMinutes} min` : "None"} />
                </div>
              </Section>

              {/* 4. Payment */}
              <Section title="Payment" icon={IndianRupee}>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs mb-2">
                  <InfoRow label="Base Pay" value={inr(data.payment.basePay)} />
                  <InfoRow
                    label="Deduction"
                    value={data.payment.deduction > 0 ? `-${inr(data.payment.deduction)}` : "None"}
                    valueColor={data.payment.deduction > 0 ? "text-red-600" : undefined}
                  />
                  <InfoRow
                    label="Final Pay"
                    value={data.payment.finalPay != null ? inr(data.payment.finalPay) : "Pending"}
                    valueColor="text-emerald-700 font-bold"
                  />
                  {data.payment.isOverride && <InfoRow label="Override" value="Yes" valueColor="text-violet-700" />}
                </div>
                {data.payment.overrideReason && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2 mt-1">
                    <p className="text-[10px] font-bold uppercase text-violet-600 mb-0.5">Override Reason</p>
                    <p className="text-xs text-foreground leading-relaxed">{data.payment.overrideReason}</p>
                  </div>
                )}
              </Section>
            </div>
          ) : null}
        </div>

        {/* Action buttons — always visible at bottom */}
        <ActionBar referralId={referralId} onAction={doAction} acting={acting} />
      </div>
    </>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Chip({ children, color = "primary" }: { children: React.ReactNode; color?: "primary" | "violet" | "gray" }) {
  const cls = color === "violet" ? "bg-violet-50 text-violet-700 border border-violet-200"
    : color === "gray" ? "bg-muted text-muted-foreground"
    : "bg-primary/10 text-primary";
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className={`font-semibold text-foreground ${valueColor || ""}`}>{value}</p>
    </div>
  );
}

function ActionBar({ referralId, onAction, acting }: {
  referralId: number;
  onAction: (action: "approve" | "reject" | "paid") => void;
  acting: "approve" | "reject" | null;
}) {
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [referral, setReferral] = useState<Referral | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all = await customFetch(`${BASE}/api/admin/referrals`) as Referral[];
        const found = all.find((r: Referral) => r.id === referralId);
        if (found) setReferral(found);
      } catch {}
    })();
  }, [referralId, acting]);

  if (!referral) return null;

  const reward = referral.rewardAmount ? parseFloat(referral.rewardAmount) : 0;

  return (
    <div className="border-t bg-background/95 backdrop-blur px-4 py-3 shrink-0 space-y-2">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Referral Action</p>
      <div className="flex gap-2">
        {referral.status === "pending_approval" && (
          <>
            <Button
              size="sm"
              onClick={() => onAction("approve")}
              disabled={!!acting}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-10"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {acting === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("reject")}
              disabled={!!acting}
              className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 gap-1.5 h-10"
            >
              <XCircle className="w-3.5 h-3.5" />
              {acting === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </>
        )}
        {(referral.status === "successful" || referral.status === "confirmed") && (
          <>
            <Button
              size="sm"
              onClick={() => onAction("paid")}
              disabled={!!acting}
              className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-10"
            >
              <Wallet className="w-3.5 h-3.5" />
              Mark Paid{reward > 0 ? ` (${inr(reward)})` : ""}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("reject")}
              disabled={!!acting}
              className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 gap-1.5 h-10"
            >
              <XCircle className="w-3.5 h-3.5" /> Reject
            </Button>
          </>
        )}
        {referral.status === "rejected" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction("approve")}
            disabled={!!acting}
            className="flex-1 rounded-xl gap-1.5 h-10"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Re-approve
          </Button>
        )}
        {referral.status === "paid" && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold w-full justify-center py-2">
            <CheckCircle2 className="w-4 h-4" />
            {inr(reward)} paid to crew wallet
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminReferralPayments() {
  const { toast } = useToast();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [acting, setActing] = useState<Record<number, boolean>>({});

  // Drawer state
  const [referrerDrawer, setReferrerDrawer] = useState<{ crewProfileId: number; name: string } | null>(null);
  const [candidateDrawer, setCandidateDrawer] = useState<{ userId: number; eventId: number; name: string; referralId: number; fromReferrer?: boolean } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await customFetch(`${BASE_URL}/api/admin/referrals`);
      setReferrals(data as Referral[]);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load referrals", description: e.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function doAction(id: number, action: "approve" | "reject" | "paid") {
    setActing(a => ({ ...a, [id]: true }));
    try {
      await customFetch(`${BASE_URL}/api/admin/referrals/${id}/${action}`, { method: "POST" });
      toast({ title: action === "approve" ? "Referral approved" : action === "paid" ? "Marked as paid" : "Referral rejected" });
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Action failed", description: e.message });
    } finally {
      setActing(a => ({ ...a, [id]: false }));
    }
  }

  const uniqueEvents = useMemo(() => {
    const seen = new Map<number, string>();
    referrals.forEach(r => { if (!seen.has(r.eventId)) seen.set(r.eventId, r.eventTitle); });
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }, [referrals]);

  const filtered = useMemo(() => {
    return referrals.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (eventFilter !== "all" && r.eventId !== parseInt(eventFilter)) return false;
      return true;
    });
  }, [referrals, statusFilter, eventFilter]);

  const counts = useMemo(() => ({
    pending: referrals.filter(r => r.status === "pending_approval").length,
    successful: referrals.filter(r => r.status === "successful").length,
    paid: referrals.filter(r => r.status === "paid").length,
    rejected: referrals.filter(r => r.status === "rejected").length,
    totalPending: referrals.filter(r => r.status === "successful" && r.rewardAmount).reduce((s, r) => s + parseFloat(r.rewardAmount!), 0),
    totalPaid: referrals.filter(r => r.status === "paid" && r.rewardAmount).reduce((s, r) => s + parseFloat(r.rewardAmount!), 0),
  }), [referrals]);

  const handleReferrerClick = useCallback((e: React.MouseEvent, crewProfileId: number, name: string) => {
    e.stopPropagation();
    setReferrerDrawer({ crewProfileId, name });
  }, []);

  const handleCandidateClick = useCallback((e: React.MouseEvent, userId: number, eventId: number, name: string, referralId: number) => {
    e.stopPropagation();
    setCandidateDrawer({ userId, eventId, name, referralId });
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Referral Payments</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Review and approve referral rewards after event completion</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2 rounded-xl">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pending Approval", value: counts.pending, color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: Clock },
          { label: "Approved (Unpaid)", value: `${counts.successful} · ${inr(counts.totalPending)}`, color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: CheckCircle2 },
          { label: "Paid", value: `${counts.paid} · ${inr(counts.totalPaid)}`, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: Wallet },
          { label: "Rejected", value: counts.rejected, color: "text-red-600", bg: "bg-red-50 border-red-200", icon: XCircle },
        ].map(card => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-2xl border p-4 ${card.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${card.color}`} />
                <p className={`text-xs font-semibold ${card.color}`}>{card.label}</p>
              </div>
              <p className={`text-xl font-display font-bold ${card.color}`}>{card.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 rounded-xl h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="successful">Approved — Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-52 rounded-xl h-9">
            <SelectValue placeholder="All events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {uniqueEvents.map(e => (
              <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center text-sm text-muted-foreground self-center">
          {filtered.length} referral{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table / Cards */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed flex flex-col items-center gap-3">
          <Gift className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">No referrals found</p>
          <p className="text-xs text-muted-foreground/60">Referrals appear here once attendance is approved for the referred candidate</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const busy = acting[r.id];
            const reward = r.rewardAmount ? parseFloat(r.rewardAmount) : 0;
            const candidateName = r.referredUserName || r.referredPhone || "Unknown";
            const isPending = r.status === "pending_approval";
            const isApproved = r.status === "successful" || r.status === "confirmed";

            return (
              <div key={r.id} className="bg-card border border-border/60 rounded-2xl overflow-hidden shadow-sm">
                {/* Main row */}
                <div className="p-4 flex items-start gap-3">
                  {/* Referrer avatar — clickable to open drawer */}
                  <button
                    className="shrink-0 mt-0.5 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50"
                    onClick={e => handleReferrerClick(e, r.referrerId, r.referrerName)}
                  >
                    <InitialAvatar name={r.referrerName} photoUrl={r.referrerPhotoUrl} size="sm" />
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      {/* Left: names */}
                      <div className="min-w-0 flex-1">
                        <button
                          className="font-semibold text-sm text-foreground leading-tight hover:text-primary hover:underline underline-offset-2 transition-colors text-left"
                          onClick={e => handleReferrerClick(e, r.referrerId, r.referrerName)}
                        >
                          {r.referrerName}
                        </button>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          referred{" "}
                          {r.referredUserId ? (
                            <button
                              className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                              onClick={e => handleCandidateClick(e, r.referredUserId!, r.eventId, candidateName, r.id)}
                            >
                              {candidateName}
                            </button>
                          ) : (
                            <span className="font-medium text-foreground">{candidateName}</span>
                          )}
                        </p>
                      </div>

                      {/* Right: reward + status + 3-dot menu */}
                      <div className="flex items-center gap-2 shrink-0">
                        {reward > 0 && (
                          <span className="flex items-center gap-0.5 text-sm font-bold text-foreground">
                            <IndianRupee className="w-3.5 h-3.5" />{reward.toLocaleString("en-IN")}
                          </span>
                        )}

                        {r.status === "paid" ? (
                          <div className="flex items-center gap-1 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />Paid
                          </div>
                        ) : (
                          <StatusPill status={r.status} />
                        )}

                        {/* 3-dot kebab menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              title="More actions"
                              className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              disabled={busy}
                            >
                              {busy
                                ? <RefreshCw className="w-4 h-4 animate-spin" />
                                : <MoreVertical className="w-4 h-4" />
                              }
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg">
                            <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold uppercase tracking-wider px-2 py-1.5">
                              Actions
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />

                            {isPending && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => doAction(r.id, "approve")}
                                  className="gap-2 text-emerald-700 focus:bg-emerald-50 focus:text-emerald-800 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-4 h-4" />Approve Referral
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => doAction(r.id, "reject")}
                                  className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                                >
                                  <XCircle className="w-4 h-4" />Reject Referral
                                </DropdownMenuItem>
                              </>
                            )}

                            {isApproved && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => doAction(r.id, "paid")}
                                  className="gap-2 text-blue-700 focus:bg-blue-50 focus:text-blue-800 cursor-pointer"
                                >
                                  <Wallet className="w-4 h-4" />Mark as Paid
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => doAction(r.id, "reject")}
                                  className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer"
                                >
                                  <XCircle className="w-4 h-4" />Reject
                                </DropdownMenuItem>
                              </>
                            )}

                            {r.status === "rejected" && (
                              <DropdownMenuItem
                                onClick={() => doAction(r.id, "approve")}
                                className="gap-2 cursor-pointer"
                              >
                                <CheckCircle2 className="w-4 h-4" />Re-approve
                              </DropdownMenuItem>
                            )}

                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{r.eventTitle}</span>
                      {r.eventStartDate && <span>{formatDate(r.eventStartDate)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Referrer Drawer */}
      {referrerDrawer && (
        <ReferrerDrawer
          crewProfileId={referrerDrawer.crewProfileId}
          name={referrerDrawer.name}
          onClose={() => setReferrerDrawer(null)}
          onCandidateClick={(userId, eventId, name, referralId) => {
            setCandidateDrawer({ userId, eventId, name, referralId, fromReferrer: true });
          }}
        />
      )}

      {/* Candidate Drawer */}
      {candidateDrawer && (
        <CandidateDrawer
          userId={candidateDrawer.userId}
          eventId={candidateDrawer.eventId}
          name={candidateDrawer.name}
          referralId={candidateDrawer.referralId}
          onClose={() => { setCandidateDrawer(null); }}
          onActionDone={async () => { await load(); setCandidateDrawer(null); }}
          onBack={candidateDrawer.fromReferrer ? () => setCandidateDrawer(null) : undefined}
        />
      )}
    </div>
  );
}
