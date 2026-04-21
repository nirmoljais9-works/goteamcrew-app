import { useGetMyEarnings } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import {
  IndianRupee, ChevronDown, ChevronUp, CheckCircle2, Clock,
  CalendarDays, Wallet, MapPin, Camera, X, ZoomIn, Timer,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return n.toLocaleString("en-IN");
}

function fmtDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try { return format(parseISO(dateStr), "d MMM yyyy"); }
  catch { return null; }
}

function fmtTime(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try { return format(parseISO(dateStr), "hh:mm a"); }
  catch { return null; }
}

function fmtMins(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// haversine distance in metres
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

// Parse "HH:MM" time string into total minutes since midnight
function timeStrToMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// ─── types ────────────────────────────────────────────────────────────────────

type Payment = {
  id: number;
  amount: number;
  status: string;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  paidAt?: string | null;
  createdAt: string;
  eventTitle?: string | null;
  eventStartDate?: string | null;
  eventCity?: string | null;
  shiftRole?: string | null;
  approvedPay?: number | null;
  totalPay?: number | null;
  eventPayPerDay?: number | null;
  isOverride?: boolean;
  overrideReason?: string | null;
  checkInStatus?: string | null;
  checkOutStatus?: string | null;
  checkedInAt?: string | null;
  checkOutAt?: string | null;
  totalBreakMinutes?: number;
  eventExpectedCheckIn?: string | null;
  eventExpectedCheckOut?: string | null;
  selfieImage?: string | null;
  checkOutPhotoUrl?: string | null;
  checkInLat?: string | null;
  checkInLng?: string | null;
  checkOutLat?: string | null;
  checkOutLng?: string | null;
  distanceFromEvent?: string | null;
  eventLatitude?: string | null;
  eventLongitude?: string | null;
};

// ─── pay breakdown ────────────────────────────────────────────────────────────

function calcBreakdown(p: Payment) {
  const finalPay = p.amount;
  const base = p.totalPay ?? p.eventPayPerDay ?? finalPay;
  const totalDeduction = Math.max(0, base - finalPay);
  const isLate = p.checkInStatus === "late";
  const isEarly = p.checkOutStatus === "early";

  let reason = "";
  if (p.isOverride && p.overrideReason) {
    reason = p.overrideReason;
  } else if (totalDeduction > 0) {
    const deductStr = `₹${fmtINR(Math.round(totalDeduction))}`;
    if (isLate && isEarly)       reason = `${deductStr} deducted due to late check-in + early exit`;
    else if (isLate)             reason = `${deductStr} deducted due to late check-in`;
    else if (isEarly)            reason = `${deductStr} deducted for early exit`;
    else                         reason = `${deductStr} deducted`;
  }

  const hasBreakdown = totalDeduction > 0 || (!!p.isOverride && !!p.overrideReason);
  return { base, finalPay, totalDeduction, isLate, isEarly, reason, hasBreakdown };
}

// ─── attendance calculations ──────────────────────────────────────────────────

function calcAttendance(p: Payment) {
  const checkedInAt  = p.checkedInAt  ? parseISO(p.checkedInAt)  : null;
  const checkOutAt   = p.checkOutAt   ? parseISO(p.checkOutAt)   : null;

  // worked minutes
  let workedMins: number | null = null;
  if (checkedInAt && checkOutAt) {
    workedMins = Math.round((checkOutAt.getTime() - checkedInAt.getTime()) / 60000)
               - (p.totalBreakMinutes ?? 0);
  }

  // late minutes (how late the crew was)
  let lateMin: number | null = null;
  if (p.checkInStatus === "late" && checkedInAt && p.eventExpectedCheckIn) {
    const expMins = timeStrToMins(p.eventExpectedCheckIn);
    if (expMins !== null) {
      // Use the checkedInAt date as reference
      const base = new Date(checkedInAt);
      base.setHours(Math.floor(expMins / 60), expMins % 60, 0, 0);
      lateMin = Math.max(0, Math.round((checkedInAt.getTime() - base.getTime()) / 60000));
    }
  }

  // early exit minutes (how early they left)
  let earlyMin: number | null = null;
  if (p.checkOutStatus === "early" && checkOutAt && p.eventExpectedCheckOut) {
    const expMins = timeStrToMins(p.eventExpectedCheckOut);
    if (expMins !== null) {
      const base = new Date(checkOutAt);
      base.setHours(Math.floor(expMins / 60), expMins % 60, 0, 0);
      earlyMin = Math.max(0, Math.round((base.getTime() - checkOutAt.getTime()) / 60000));
    }
  }

  // check-in distance
  const checkInDist = p.distanceFromEvent != null ? parseFloat(p.distanceFromEvent) : null;

  // check-out distance (compute from lat/lng vs event lat/lng)
  let checkOutDist: number | null = null;
  if (p.checkOutLat && p.checkOutLng && p.eventLatitude && p.eventLongitude) {
    checkOutDist = haversine(
      parseFloat(p.eventLatitude), parseFloat(p.eventLongitude),
      parseFloat(p.checkOutLat),  parseFloat(p.checkOutLng),
    );
  }

  return { workedMins, lateMin, earlyMin, checkInDist, checkOutDist };
}

// ─── sub-components ───────────────────────────────────────────────────────────

function DistBadge({ dist }: { dist: number }) {
  const isValid = dist <= 2000;
  const isReview = dist > 500 && dist <= 2000;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
      isValid && !isReview
        ? "bg-emerald-100 text-emerald-700"
        : isReview
        ? "bg-orange-100 text-orange-700"
        : "bg-rose-100 text-rose-700"
    }`}>
      {isValid ? "✓ Valid" : "✗ Invalid"}
    </span>
  );
}

function SelfieThumb({ src, label, onExpand }: { src: string; label: string; onExpand: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onExpand}
        className="relative rounded-xl overflow-hidden border border-border w-full aspect-square bg-muted group"
      >
        <img
          src={src}
          alt={label}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
        </div>
      </button>
      <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white"
      >
        <X className="w-6 h-6" />
      </button>
      <img
        src={src}
        alt="Selfie"
        className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

// ─── main card ────────────────────────────────────────────────────────────────

function PaymentCard({ p }: { p: Payment }) {
  const [expanded, setExpanded]   = useState(false);
  const [lightbox, setLightbox]   = useState<string | null>(null);
  const bd  = calcBreakdown(p);
  const att = calcAttendance(p);
  const isPaid = p.status === "paid";

  const eventName  = p.eventTitle || "Payment";
  const eventDate  = fmtDate(p.eventStartDate) || fmtDate(p.createdAt);
  const hasAttendance = !!(p.checkedInAt || p.selfieImage || att.checkInDist != null);

  return (
    <>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <div className={`rounded-2xl border overflow-hidden bg-card shadow-sm transition-shadow hover:shadow-md ${
        isPaid ? "border-emerald-200/70" : "border-amber-200/70"
      }`}>
        {/* coloured top bar */}
        <div className={`h-1 w-full ${isPaid ? "bg-emerald-400" : "bg-amber-400"}`} />

        <div className="p-4 space-y-3">

          {/* ── event header ── */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-foreground leading-tight line-clamp-1">{eventName}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {p.shiftRole && (
                  <span className="text-xs text-primary font-medium">{p.shiftRole}</span>
                )}
                {eventDate && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />{eventDate}
                  </span>
                )}
                {p.eventCity && (
                  <span className="text-xs text-muted-foreground">{p.eventCity}</span>
                )}
              </div>
            </div>
            {isPaid ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" /> Paid
              </span>
            ) : (
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                <Clock className="w-3 h-3" /> Pending
              </span>
            )}
          </div>

          {/* ── final pay ── */}
          <div className="flex items-center justify-between border-b pb-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Final Pay</span>
            <span className={`text-xl font-display font-bold ${isPaid ? "text-emerald-700" : "text-amber-700"}`}>
              ₹{fmtINR(Math.round(p.amount))}
            </span>
          </div>

          {/* ── compact deduction hint ── */}
          {bd.totalDeduction > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Base Pay</span>
                <span className="font-semibold">₹{fmtINR(Math.round(bd.base))}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-rose-600">
                <span>Deduction</span>
                <span className="font-semibold">−₹{fmtINR(Math.round(bd.totalDeduction))}</span>
              </div>
            </div>
          )}

          {/* ── toggle ── */}
          {(bd.hasBreakdown || hasAttendance) && (
            <>
              <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold text-primary hover:text-primary/80 border-t pt-2.5 transition-colors"
              >
                <span>{expanded ? "Hide Details" : "View Details"}</span>
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {expanded && (
                <div className="space-y-4 border-t pt-3">

                  {/* ── PAY BREAKDOWN ── */}
                  {bd.hasBreakdown && (
                    <section>
                      <SectionHeader label="Pay Breakdown" />
                      <div className="rounded-xl bg-muted/40 border p-3 space-y-2">
                        <Row label="Base Pay" value={`₹${fmtINR(Math.round(bd.base))}`} />
                        {bd.totalDeduction > 0 && (
                          <Row label="Deduction" value={`−₹${fmtINR(Math.round(bd.totalDeduction))}`} valueClass="text-rose-600" divider />
                        )}
                        <Row label="Final Pay" value={`₹${fmtINR(Math.round(bd.finalPay))}`} divider bold valueClass={isPaid ? "text-emerald-700" : "text-amber-700"} />
                      </div>
                      {bd.reason && (
                        <p className="mt-2 px-3 py-2 rounded-lg bg-slate-50 border text-xs text-slate-700 leading-relaxed">
                          {bd.reason}
                        </p>
                      )}
                    </section>
                  )}

                  {/* ── ATTENDANCE DETAILS ── */}
                  {hasAttendance && (
                    <section className="space-y-3">
                      <SectionHeader label="Attendance Details" />

                      {/* Times */}
                      {(p.checkedInAt || p.checkOutAt) && (
                        <DetailBlock icon={<Clock className="w-3.5 h-3.5 text-primary" />} title="Check-in / Check-out">
                          <div className="space-y-1.5">
                            {p.checkedInAt && (
                              <TimeLine
                                label="Check-in"
                                time={fmtTime(p.checkedInAt) ?? "—"}
                                badge={p.checkInStatus === "late"
                                  ? <Badge tone="orange">Late{att.lateMin ? ` (${fmtMins(att.lateMin)})` : ""}</Badge>
                                  : <Badge tone="green">On time</Badge>}
                              />
                            )}
                            {p.checkOutAt && (
                              <TimeLine
                                label="Check-out"
                                time={fmtTime(p.checkOutAt) ?? "—"}
                                badge={p.checkOutStatus === "early"
                                  ? <Badge tone="blue">Early exit{att.earlyMin ? ` (${fmtMins(att.earlyMin)})` : ""}</Badge>
                                  : <Badge tone="green">On time</Badge>}
                              />
                            )}
                          </div>
                        </DetailBlock>
                      )}

                      {/* Work summary */}
                      {(att.workedMins != null || att.lateMin != null || att.earlyMin != null) && (
                        <DetailBlock icon={<Timer className="w-3.5 h-3.5 text-primary" />} title="Work Summary">
                          <div className="space-y-1">
                            {att.workedMins != null && (
                              <SummaryRow label="Worked Time" value={fmtMins(att.workedMins)} />
                            )}
                            {att.lateMin != null && att.lateMin > 0 && (
                              <SummaryRow label="Arrived Late" value={fmtMins(att.lateMin)} valueClass="text-orange-600" />
                            )}
                            {att.earlyMin != null && att.earlyMin > 0 && (
                              <SummaryRow label="Left Early" value={fmtMins(att.earlyMin)} valueClass="text-sky-600" />
                            )}
                          </div>
                        </DetailBlock>
                      )}

                      {/* Location */}
                      {(att.checkInDist != null || att.checkOutDist != null) && (
                        <DetailBlock icon={<MapPin className="w-3.5 h-3.5 text-primary" />} title="Location">
                          <div className="space-y-1">
                            {att.checkInDist != null && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Check-in</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium">{fmtDist(att.checkInDist)} from venue</span>
                                  <DistBadge dist={att.checkInDist} />
                                </div>
                              </div>
                            )}
                            {att.checkOutDist != null && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Check-out</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium">{fmtDist(att.checkOutDist)} from venue</span>
                                  <DistBadge dist={att.checkOutDist} />
                                </div>
                              </div>
                            )}
                          </div>
                        </DetailBlock>
                      )}

                      {/* Selfies */}
                      {(p.selfieImage || p.checkOutPhotoUrl) && (
                        <DetailBlock icon={<Camera className="w-3.5 h-3.5 text-primary" />} title="Selfie Verification">
                          <div className="grid grid-cols-2 gap-2">
                            {p.selfieImage ? (
                              <SelfieThumb src={p.selfieImage} label="Check-in" onExpand={() => setLightbox(p.selfieImage!)} />
                            ) : (
                              <NoSelfie label="Check-in" />
                            )}
                            {p.checkOutPhotoUrl ? (
                              <SelfieThumb src={p.checkOutPhotoUrl} label="Check-out" onExpand={() => setLightbox(p.checkOutPhotoUrl!)} />
                            ) : (
                              <NoSelfie label="Check-out" />
                            )}
                          </div>
                        </DetailBlock>
                      )}

                      {/* Payment method */}
                      {isPaid && (p.paymentMethod || p.reference || p.paidAt) && (
                        <div className="rounded-lg border bg-emerald-50/50 px-3 py-2 text-xs space-y-0.5">
                          {p.paidAt && <p className="text-muted-foreground">Paid on {fmtDate(p.paidAt)}</p>}
                          {p.paymentMethod && <p className="text-muted-foreground capitalize">Via {p.paymentMethod}</p>}
                          {p.reference && <p className="font-mono text-[10px] text-muted-foreground">Ref: {p.reference}</p>}
                        </div>
                      )}
                    </section>
                  )}

                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── tiny shared components ───────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
  );
}

function Row({
  label, value, valueClass = "", divider = false, bold = false,
}: { label: string; value: string; valueClass?: string; divider?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-xs ${divider ? "border-t pt-1.5 mt-0.5" : ""}`}>
      <span className={bold ? "font-bold" : "text-muted-foreground"}>{label}</span>
      <span className={`font-semibold ${bold ? "font-bold" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

function DetailBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] font-bold text-foreground/80">{title}</p>
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

function TimeLine({ label, time, badge }: { label: string; time: string; badge: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="font-semibold flex-1">{time}</span>
      {badge}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "orange" | "blue" | "rose" }) {
  const cls = {
    green:  "bg-emerald-100 text-emerald-700",
    orange: "bg-orange-100 text-orange-700",
    blue:   "bg-sky-100 text-sky-700",
    rose:   "bg-rose-100 text-rose-700",
  }[tone];
  return (
    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{children}</span>
  );
}

function NoSelfie({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full aspect-square rounded-xl bg-muted border flex items-center justify-center">
        <Camera className="w-6 h-6 text-muted-foreground/30" />
      </div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

type TabKey = "all" | "paid" | "pending";

export default function Earnings() {
  const [, setLocation] = useLocation();
  const { data: summary, isLoading } = useGetMyEarnings();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    return (t === "paid" || t === "pending") ? t : "all";
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <Wallet className="w-8 h-8 animate-pulse" />
        <p>Loading payments…</p>
      </div>
    );
  }

  const allPayments: Payment[] = (summary?.payments || []) as Payment[];
  const filtered = activeTab === "paid"
    ? allPayments.filter(p => p.status === "paid")
    : activeTab === "pending"
    ? allPayments.filter(p => p.status === "pending" || p.status === "processing")
    : allPayments;

  const totalPaid    = summary?.totalPaid    ?? summary?.paidPayments    ?? 0;
  const pendingTotal = summary?.pendingPayments ?? 0;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all",     label: "All",     count: allPayments.length },
    { key: "paid",    label: "Paid",    count: allPayments.filter(p => p.status === "paid").length },
    { key: "pending", label: "Pending", count: allPayments.filter(p => p.status === "pending" || p.status === "processing").length },
  ];

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Earnings &amp; Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your complete payment history and breakdown.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 cursor-pointer hover:shadow-md active:scale-[0.97] transition-all"
          onClick={() => setActiveTab("paid")}
        >
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Total Paid</p>
          <p className="text-2xl font-display font-bold text-emerald-800 mt-0.5">₹{fmtINR(Math.round(totalPaid))}</p>
          <p className="text-[10px] text-emerald-600 mt-1">Amount received</p>
        </div>
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 cursor-pointer hover:shadow-md active:scale-[0.97] transition-all"
          onClick={() => setActiveTab("pending")}
        >
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pending Payment</p>
          <p className="text-2xl font-display font-bold text-amber-800 mt-0.5">₹{fmtINR(Math.round(pendingTotal))}</p>
          <p className="text-[10px] text-amber-600 mt-1">To be paid</p>
        </div>
      </div>

      {/* Tab pills */}
      <div className="flex gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              activeTab === t.key
                ? "bg-primary text-white border-primary"
                : "bg-card text-muted-foreground border-border/60 hover:border-primary/40"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                activeTab === t.key ? "bg-white/20" : "bg-muted"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card rounded-3xl border border-dashed gap-3">
          <IndianRupee className="w-10 h-10 text-muted-foreground/30" />
          <p className="font-semibold text-muted-foreground">No payments yet</p>
          <p className="text-sm text-muted-foreground/70">Complete a shift to see your payment here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => <PaymentCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}
