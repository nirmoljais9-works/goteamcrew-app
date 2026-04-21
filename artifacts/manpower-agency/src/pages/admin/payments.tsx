import { useState, useMemo } from "react";
import { useGetPayments } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { customFetch } from "@workspace/api-client-react";
import {
  ChevronDown,
  ChevronUp,
  IndianRupee,
  CalendarDays,
  MapPin,
  User,
  CheckCircle2,
  Clock,
  TrendingDown,
  Wallet,
  CreditCard,
  Building2,
} from "lucide-react";
import { CrewProfileModal } from "./crew-profile-modal";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function inr(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!e || s.toDateString() === e.toDateString()) return format(s, "d MMM yyyy");
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

function CrewAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = name?.trim()?.charAt(0)?.toUpperCase() ?? "?";
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
    <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 ring-2 ring-white shadow-sm flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-primary">{initial}</span>
    </div>
  );
}

type Payment = {
  id: number;
  crewId: number;
  shiftClaimId?: number | null;
  amount: number;
  basePay?: number;
  status: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  createdAt: string;
  crewName: string;
  crewPhone?: string | null;
  crewPhotoUrl?: string | null;
  shiftRole?: string | null;
  eventTitle?: string | null;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  eventCity?: string | null;
  eventLocation?: string | null;
  eventPayPerDay?: number | null;
  claimApprovedPay?: number | null;
  claimCheckInStatus?: string | null;
  claimCheckOutStatus?: string | null;
  claimIsAbsent?: boolean | null;
  claimCheckedInAt?: string | null;
  claimCheckOutAt?: string | null;
  attendanceApproved?: boolean | null;
};

type FilterTab = "all" | "pending" | "paid";

function deductionLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "late") return "Late check-in";
  if (status === "very_late") return "Very late check-in";
  if (status === "early_exit") return "Early exit";
  if (status === "absent") return "Absent";
  return null;
}

function buildDeductionLines(p: Payment): Array<{ label: string; reason: string }> {
  const lines: Array<{ label: string; reason: string }> = [];
  if (p.claimIsAbsent) {
    lines.push({ label: "Absent", reason: "No pay — marked absent" });
    return lines;
  }
  if (p.claimCheckInStatus && p.claimCheckInStatus !== "on_time") {
    const label = deductionLabel(p.claimCheckInStatus);
    if (label) lines.push({ label, reason: `Deducted due to ${label.toLowerCase()}` });
  }
  if (p.claimCheckOutStatus && p.claimCheckOutStatus !== "on_time") {
    const label = deductionLabel(p.claimCheckOutStatus);
    if (label) lines.push({ label, reason: `Deducted due to ${label.toLowerCase()}` });
  }
  return lines;
}

type ExpandState = {
  details: boolean;
  payForm: boolean;
};

function PaymentCard({
  payment,
  onUpdated,
  onViewProfile,
}: {
  payment: Payment;
  onUpdated: () => void;
  onViewProfile: (id: number) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<ExpandState>({ details: false, payForm: false });
  const [method, setMethod] = useState<string>(payment.paymentMethod || "cash");
  const [reference, setReference] = useState(payment.reference || "");
  const [busy, setBusy] = useState(false);

  const isPending = payment.status === "pending" || payment.status === "processing";
  const isPaid = payment.status === "paid";

  const basePay = payment.basePay ?? 0;
  const finalPay = payment.amount;
  const deduction = basePay > 0 ? Math.max(0, basePay - finalPay) : 0;
  const hasBreakdown = basePay > 0;
  const deductionLines = buildDeductionLines(payment);
  const eventDateRange = formatDateRange(payment.eventStartDate, payment.eventEndDate);
  const location = payment.eventCity || payment.eventLocation || null;

  const markPaid = async () => {
    setBusy(true);
    try {
      await customFetch(`${BASE_URL}/api/payments/${payment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", paymentMethod: method, reference: reference || null }),
      });
      toast({ title: "✅ Payment marked as paid" });
      onUpdated();
    } catch (err: any) {
      toast({ title: err?.data?.error || "Failed to update payment", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border overflow-hidden shadow-sm transition-all ${
      isPaid ? "border-emerald-200 bg-emerald-50/10" :
      payment.status === "failed" ? "border-rose-200 bg-rose-50/10" :
      "border-amber-200 bg-amber-50/10"
    }`}>
      {/* Top section */}
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button className="shrink-0 focus:outline-none" onClick={() => onViewProfile(payment.crewId)} title="View profile">
            <CrewAvatar name={payment.crewName} photoUrl={payment.crewPhotoUrl} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="font-bold text-foreground hover:text-primary hover:underline transition-colors text-left"
                onClick={() => onViewProfile(payment.crewId)}
              >
                {payment.crewName}
              </button>
              <button
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded-full transition-colors"
                onClick={() => onViewProfile(payment.crewId)}
              >
                <User className="w-3 h-3" />
                Profile
              </button>
            </div>
            <div className="text-sm text-primary font-semibold mt-0.5 truncate">
              {payment.eventTitle || "Manual Payment"}
              {payment.shiftRole && <span className="text-muted-foreground font-normal"> · {payment.shiftRole}</span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
              {eventDateRange && (
                <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{eventDateRange}</span>
              )}
              {location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{location}</span>
              )}
              {!eventDateRange && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(new Date(payment.createdAt), "d MMM yyyy")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status badge */}
        <div className="shrink-0 mt-0.5">
          <StatusBadge status={payment.status} />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/40 mx-4" />

      {/* Pay summary */}
      <div className="px-4 py-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Final Pay</p>
          <p className="text-2xl font-bold text-foreground flex items-center gap-1">
            <IndianRupee className="w-5 h-5 text-muted-foreground" />
            {finalPay.toLocaleString("en-IN")}
          </p>
        </div>
        {hasBreakdown && (
          <div className="flex gap-4 text-sm text-right">
            <div>
              <p className="text-xs text-muted-foreground">Base Pay</p>
              <p className="font-semibold text-foreground">{inr(basePay)}</p>
            </div>
            {deduction > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Deduction</p>
                <p className="font-semibold text-rose-600">-{inr(deduction)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expandable: View Details */}
      {(deductionLines.length > 0 || payment.notes || hasBreakdown) && (
        <>
          <div className="border-t border-border/40 mx-4" />
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded(e => ({ ...e, details: !e.details }))}
          >
            <span className="font-medium flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" />
              {expanded.details ? "Hide Details" : "View Details"}
            </span>
            {expanded.details ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {expanded.details && (
            <div className="px-4 pb-3 space-y-2">
              {deductionLines.length > 0 ? (
                <div className="rounded-xl bg-rose-50/50 border border-rose-100 divide-y divide-rose-100">
                  {deductionLines.map((line, i) => (
                    <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-rose-700">{line.label}</p>
                        <p className="text-xs text-rose-600/80">{line.reason}</p>
                      </div>
                      {deduction > 0 && deductionLines.length === 1 && (
                        <span className="text-sm font-bold text-rose-700">-{inr(deduction)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : hasBreakdown && deduction === 0 ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-700 font-medium">
                  ✅ No deductions — full pay
                </div>
              ) : null}

              {payment.notes && (
                <div className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Note</p>
                  <p className="text-sm text-foreground">{payment.notes}</p>
                </div>
              )}

              {isPaid && payment.paidAt && (
                <p className="text-xs text-muted-foreground">
                  Paid on {format(new Date(payment.paidAt), "d MMM yyyy, h:mm a")}
                  {payment.paymentMethod && ` via ${payment.paymentMethod.charAt(0).toUpperCase() + payment.paymentMethod.slice(1)}`}
                  {payment.reference && ` · Ref: ${payment.reference}`}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Mark as Paid section */}
      {isPending && (
        <>
          <div className="border-t border-border/40 mx-4" />
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setExpanded(e => ({ ...e, payForm: !e.payForm }))}
          >
            <span className="font-medium flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              Payment details (optional)
            </span>
            {expanded.payForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {expanded.payForm && (
            <div className="px-4 pb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Payment Method</label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">
                      <span className="flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" />Cash</span>
                    </SelectItem>
                    <SelectItem value="upi">
                      <span className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />UPI</span>
                    </SelectItem>
                    <SelectItem value="bank">
                      <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />Bank Transfer</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Reference ID</label>
                <Input
                  className="h-9 text-sm"
                  placeholder="UTR / Txn ID"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="px-4 pb-4">
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
              onClick={markPaid}
              disabled={busy}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {busy ? "Marking as paid…" : `Mark as Paid · ${inr(finalPay)}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminPayments() {
  const { data: rawPayments, isLoading } = useGetPayments();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [profileModalId, setProfileModalId] = useState<number | null>(null);

  const payments: Payment[] = (rawPayments as unknown as Payment[]) || [];

  const pendingCount = payments.filter(p => p.status === "pending" || p.status === "processing").length;
  const paidCount    = payments.filter(p => p.status === "paid").length;

  const filtered = useMemo(() => {
    if (filter === "pending") return payments.filter(p => p.status === "pending" || p.status === "processing");
    if (filter === "paid")    return payments.filter(p => p.status === "paid");
    return payments;
  }, [payments, filter]);

  // Sort: pending first, then paid, newest first within each group
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const order: Record<string, number> = { pending: 0, processing: 1, paid: 2, failed: 3 };
    const diff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [filtered]);

  const totalPending = payments.filter(p => p.status === "pending" || p.status === "processing")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalPaid = payments.filter(p => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading payments…</div>;

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground mt-1">Track and process crew payouts.</p>
        </div>

        {/* Summary strip */}
        {payments.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-3">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pending Payout</p>
              <p className="text-2xl font-bold text-amber-800 mt-0.5">{inr(totalPending)}</p>
              <p className="text-xs text-amber-600 mt-0.5">{pendingCount} payment{pendingCount !== 1 ? "s" : ""}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Total Paid</p>
              <p className="text-2xl font-bold text-emerald-800 mt-0.5">{inr(totalPaid)}</p>
              <p className="text-xs text-emerald-600 mt-0.5">{paidCount} payment{paidCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit border border-border/50">
          {(["all", "pending", "paid"] as FilterTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all capitalize ${
                filter === tab
                  ? "bg-white text-foreground shadow-sm border border-border/60"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "pending" && pendingCount > 0 && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{pendingCount}</span>
              )}
              {tab === "paid" && paidCount > 0 && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">{paidCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Cards */}
        {sorted.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-dashed text-muted-foreground">
            {filter === "pending" ? "No pending payments." : filter === "paid" ? "No paid payments yet." : "No payments available."}
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map(payment => (
              <PaymentCard
                key={payment.id}
                payment={payment}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/payments"] })}
                onViewProfile={setProfileModalId}
              />
            ))}
          </div>
        )}
      </div>

      <CrewProfileModal crewId={profileModalId} onClose={() => setProfileModalId(null)} />
    </>
  );
}
