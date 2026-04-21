import { useState, useMemo } from "react";
import { useAdminGetShiftClaims } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, startOfDay } from "date-fns";
import { customFetch } from "@workspace/api-client-react";
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MapPin,
  CalendarDays,
  IndianRupee,
  User,
  Zap,
  CheckCheck,
} from "lucide-react";
import { CrewProfileModal } from "./crew-profile-modal";

function CrewAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase();

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-10 h-10 rounded-full object-cover border border-gray-200 ring-2 ring-white shadow-sm"
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 ring-2 ring-white shadow-sm flex items-center justify-center">
      <span className="text-sm font-bold text-primary">{initial}</span>
    </div>
  );
}

function formatWaPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!e || s.toDateString() === e.toDateString()) return format(s, "d MMM yyyy");
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

function buildApprovedWa(
  name: string, eventTitle: string, location: string,
  dateRange: string, totalPay: number, phone: string, role?: string,
) {
  const waPhone = formatWaPhone(phone);
  if (!waPhone) return null;
  const firstName = name.split(" ")[0];
  const roleLine  = role ? `\nRole: ${role}` : "";
  const payLine   = totalPay > 0 ? `\nPay: Rs. ${totalPay.toLocaleString("en-IN")}` : "";
  const msg = [
    `Hi ${firstName} 👋`,
    ``,
    `Congratulations! You have been selected for the following event:`,
    ``,
    `*${eventTitle}*`,
    `Date: ${dateRange}`,
    `Location: ${location}${roleLine}${payLine}`,
    ``,
    `Log in to your dashboard to view shift details and check in on the event day:`,
    `https://goteamcrew.in/dashboard`,
    ``,
    `For any questions, email us at info@goteamcrew.in`,
    ``,
    `-- Goteamcrew Team`,
  ].join("\n");
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
}

function buildRejectedWa(name: string, eventTitle: string, phone: string) {
  const waPhone = formatWaPhone(phone);
  if (!waPhone) return null;
  const firstName = name.split(" ")[0];
  const msg = [
    `Hi ${firstName},`,
    ``,
    `Thank you for applying for *${eventTitle}*.`,
    ``,
    `Unfortunately, we could not select your profile for this event. Do not be discouraged -- new opportunities are posted regularly.`,
    ``,
    `Browse upcoming events and keep your profile updated:`,
    `https://goteamcrew.in/dashboard`,
    ``,
    `For any questions, email us at info@goteamcrew.in`,
    ``,
    `-- Goteamcrew Team`,
  ].join("\n");
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
}

type Claim = {
  id: number;
  shiftId: number;
  crewId: number;
  status: string;
  claimedAt: string;
  approvedAt?: string | null;
  shiftRole: string;
  shiftStartTime: string;
  totalPay: number;
  eventTitle: string;
  eventLocation?: string | null;
  eventCity?: string | null;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  eventPayPerDay?: number;
  crewName: string;
  crewEmail?: string | null;
  crewPhone?: string | null;
  crewPhotoUrl?: string | null;
  checkedInAt?: string | null;
  checkInLat?: string | null;
  checkInLng?: string | null;
  selfieImage?: string | null;
  isAbsent?: boolean | null;
  checkInStatus?: string | null;
  isReferral?: boolean;
  referrerName?: string | null;
  referrerProfileId?: number | null;
  appliedRoles?: string[];
  assignedRole?: string | null;
};

type TabView = "active" | "completed";

function isEventActive(claim: Claim): boolean {
  const endDate = claim.eventEndDate ?? claim.shiftStartTime;
  if (!endDate) return true;
  const eventEnd = new Date(endDate);
  const todayStart = startOfDay(new Date());
  return eventEnd >= todayStart;
}

export default function AdminClaims() {
  const { data: claims, isLoading } = useAdminGetShiftClaims();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabView>("active");
  const [rejectTarget, setRejectTarget] = useState<Claim | null>(null);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [profileModalId, setProfileModalId] = useState<number | null>(null);
  const [assigningRole, setAssigningRole] = useState<Record<number, string>>({});
  const [assignBusy, setAssignBusy] = useState<Record<number, boolean>>({});

  const handleAssignRole = async (claim: Claim) => {
    const role = assigningRole[claim.id];
    if (!role) return;
    setAssignBusy(prev => ({ ...prev, [claim.id]: true }));
    try {
      await customFetch(`/api/admin/shift-claims/${claim.id}/assign-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/shift-claims`] });
      toast({ title: `✅ Role assigned: ${role}` });
    } catch (err: any) {
      toast({ title: err?.data?.error || "Failed to assign role", variant: "destructive" });
    } finally {
      setAssignBusy(prev => ({ ...prev, [claim.id]: false }));
    }
  };

  const allClaims: Claim[] = (claims as unknown as Claim[]) || [];

  const { activeClaims, completedClaims } = useMemo(() => {
    const activeClaims = allClaims.filter(isEventActive);
    const completedClaims = allClaims.filter(c => !isEventActive(c));
    return { activeClaims, completedClaims };
  }, [allClaims]);

  const visibleClaims = tab === "active" ? activeClaims : completedClaims;
  const pendingCount = activeClaims.filter(c => c.status === "pending").length;

  const setBusyFor = (id: number, val: boolean) =>
    setBusy(prev => ({ ...prev, [id]: val }));

  const patchStatus = async (claim: Claim, newStatus: "approved" | "rejected" | "pending") => {
    setBusyFor(claim.id, true);
    try {
      await customFetch(`/api/admin/shift-claims/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/shift-claims`] });

      if (newStatus === "approved") {
        toast({ title: "✅ Approved successfully" });
        const date = formatDateRange(claim.eventStartDate, claim.eventEndDate) || format(new Date(claim.shiftStartTime), "d MMM yyyy");
        const location = claim.eventCity || claim.eventLocation || "TBD";
        const url = buildApprovedWa(claim.crewName, claim.eventTitle, location, date, claim.totalPay || 0, claim.crewPhone || "", claim.shiftRole);
        if (url) setWaUrl(url);
      } else if (newStatus === "rejected") {
        toast({ title: "❌ Application rejected" });
        const url = buildRejectedWa(claim.crewName, claim.eventTitle, claim.crewPhone || "");
        if (url) setWaUrl(url);
      } else {
        toast({ title: "↩️ Reverted to pending" });
      }
    } catch (err: any) {
      const msg = err?.data?.error || err?.message?.split(": ").slice(1).join(": ") || "Action failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusyFor(claim.id, false);
    }
  };

  const handleApprove = (claim: Claim) => patchStatus(claim, "approved");
  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    await patchStatus(rejectTarget, "rejected");
    setRejectTarget(null);
  };
  const handleRevoke = (claim: Claim) => patchStatus(claim, "pending");

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading applications…</div>;

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Event Claims</h1>
            <p className="text-muted-foreground mt-1">Approve or reject crew applications.</p>
          </div>
          {pendingCount > 0 && (
            <span className="mt-1 inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-700">
              {pendingCount} pending
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit border border-border/50">
          <button
            onClick={() => setTab("active")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === "active"
                ? "bg-white text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Active
            {activeClaims.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                tab === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {activeClaims.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === "completed"
                ? "bg-white text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Completed
            {completedClaims.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                tab === "completed" ? "bg-muted-foreground/20 text-muted-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {completedClaims.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab description */}
        {tab === "active" && (
          <p className="text-xs text-muted-foreground -mt-2">
            Showing active events (today or upcoming). Past events move to the Completed tab automatically.
          </p>
        )}
        {tab === "completed" && (
          <p className="text-xs text-muted-foreground -mt-2">
            Past event claims — for reference only. Manage payments and attendance in their respective sections.
          </p>
        )}

        {/* Claims list */}
        {visibleClaims.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-dashed text-muted-foreground">
            {tab === "active" ? "No active event claims right now." : "No completed event claims yet."}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleClaims.map(claim => {
              const isPending = claim.status === "pending";
              const isApproved = claim.status === "approved";
              const isRejected = claim.status === "rejected" || claim.status === "revoked";
              const isBusy = busy[claim.id] || false;
              const isCompleted = !isEventActive(claim);
              const dateRange = formatDateRange(claim.eventStartDate, claim.eventEndDate);
              const location = [claim.eventCity, claim.eventLocation].filter(Boolean).join(" — ");

              return (
                <div
                  key={claim.id}
                  className={`rounded-2xl border overflow-hidden transition-all ${
                    isCompleted
                      ? "border-gray-200 bg-gray-50/30 opacity-80"
                      : isPending
                      ? "border-amber-200 bg-amber-50/20"
                      : isApproved
                      ? "border-emerald-200 bg-emerald-50/10"
                      : "border-rose-100 bg-rose-50/10 opacity-75"
                  }`}
                >
                  <div className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    {/* Left: crew + event info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          className="shrink-0 focus:outline-none"
                          onClick={() => setProfileModalId(claim.crewId)}
                          title="View profile"
                        >
                          <CrewAvatar name={claim.crewName} photoUrl={claim.crewPhotoUrl} />
                        </button>

                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <button
                            className="font-bold text-foreground hover:text-primary hover:underline transition-colors text-left"
                            onClick={() => setProfileModalId(claim.crewId)}
                          >
                            {claim.crewName}
                          </button>
                          <StatusBadge status={claim.status} />
                          <button
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/80 hover:text-primary bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded-full transition-colors"
                            onClick={() => setProfileModalId(claim.crewId)}
                          >
                            <User className="w-3 h-3" />
                            View Profile
                          </button>
                        </div>
                      </div>

                      <div className="text-sm text-primary font-semibold">{claim.shiftRole} — {claim.eventTitle}</div>

                      {/* Applied roles */}
                      {claim.appliedRoles && claim.appliedRoles.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Applied for:</span>
                          {claim.appliedRoles.map(r => (
                            <span key={r} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">{r}</span>
                          ))}
                        </div>
                      )}

                      {/* Assigned role */}
                      {claim.assignedRole && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Assigned:</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">{claim.assignedRole}</span>
                        </div>
                      )}

                      {/* Assign role control — only for approved claims with applied roles */}
                      {claim.status === "approved" && claim.appliedRoles && claim.appliedRoles.length > 0 && (
                        <div className="flex items-center gap-2 mt-1">
                          <select
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                            value={assigningRole[claim.id] ?? claim.assignedRole ?? ""}
                            onChange={e => setAssigningRole(prev => ({ ...prev, [claim.id]: e.target.value }))}
                          >
                            <option value="">Assign final role…</option>
                            {claim.appliedRoles.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignRole(claim)}
                            disabled={!assigningRole[claim.id] || assignBusy[claim.id]}
                            className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {assignBusy[claim.id] ? "…" : "Assign"}
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {location && (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>
                        )}
                        {dateRange && (
                          <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{dateRange}</span>
                        )}
                        {(claim.eventPayPerDay ?? 0) > 0 && (
                          <span className="flex items-center gap-1"><IndianRupee className="w-3 h-3" />₹{(claim.eventPayPerDay ?? 0).toLocaleString("en-IN")}/day</span>
                        )}
                      </div>

                      {claim.crewPhone && (
                        <p className="text-xs text-muted-foreground">📞 {claim.crewPhone}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Applied {format(new Date(claim.claimedAt), "d MMM yyyy")}
                        {claim.approvedAt && ` · Approved ${format(new Date(claim.approvedAt), "d MMM yyyy")}`}
                      </p>
                      {claim.isReferral && (
                        claim.referrerProfileId ? (
                          <button
                            onClick={() => setProfileModalId(claim.referrerProfileId!)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium self-start transition-colors hover:opacity-80 cursor-pointer underline-offset-2 hover:underline"
                            style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}
                            title="View referrer profile"
                          >
                            Referred by {claim.referrerName || "a crew member"}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium self-start" style={{ background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}>
                            Referred by {claim.referrerName || "a crew member"}
                          </span>
                        )
                      )}
                    </div>

                    {/* Right: actions — hidden for completed events */}
                    {!isCompleted && (
                      <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end shrink-0">
                        {isPending && (
                          <>
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                              onClick={() => handleApprove(claim)}
                              disabled={isBusy}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                              onClick={() => setRejectTarget(claim)}
                              disabled={isBusy}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                        {isApproved && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                            onClick={() => handleRevoke(claim)}
                            disabled={isBusy}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Revoke Approval
                          </Button>
                        )}
                        {isRejected && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
                            onClick={() => handleRevoke(claim)}
                            disabled={isBusy}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Undo Rejection
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Crew Profile Modal */}
      <CrewProfileModal
        crewId={profileModalId}
        onClose={() => setProfileModalId(null)}
      />

      {/* Reject confirmation */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this application?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject <span className="font-semibold text-foreground">{rejectTarget?.crewName}</span>'s application for <span className="font-semibold text-foreground">{rejectTarget?.eventTitle}</span>?
              {rejectTarget?.crewPhone && " A WhatsApp notification option will appear after rejection."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={handleRejectConfirm}
            >
              Yes, reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* WhatsApp notification prompt */}
      <AlertDialog open={!!waUrl} onOpenChange={(o) => { if (!o) setWaUrl(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-600" />
              Send WhatsApp notification?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Open WhatsApp with a pre-filled message to notify the crew member about their application status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setWaUrl(null)}>Skip</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => { window.open(waUrl!, "_blank"); setWaUrl(null); }}
            >
              <MessageCircle className="w-4 h-4 mr-1.5" />
              Open WhatsApp
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
