import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  CheckCircle2, XCircle, Clock, MapPin, Camera,
  ShieldCheck, AlertTriangle, Search, Settings2,
  RefreshCw, ChevronDown, ChevronUp, Save, Users,
  IndianRupee, X, Check, Undo2, Eye, Coffee, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrewProfileModal } from "./crew-profile-modal";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

/* ── Distance helpers ──────────────────────────────────────────────────────── */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m: number) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function fmtTime(ts: string | null | undefined) {
  if (!ts) return "—";
  try { return format(new Date(ts), "hh:mm a"); } catch { return "—"; }
}

function fmtDateTime(ts: string | null | undefined) {
  if (!ts) return "—";
  try { return format(new Date(ts), "dd MMM yyyy, hh:mm a"); } catch { return "—"; }
}

/* ── Types ─────────────────────────────────────────────────────────────────── */
type Claim = {
  id: number;
  shiftId: number;
  crewId: number;
  status: string;
  shiftRole: string;
  totalPay: number;
  eventId: number;
  eventTitle: string;
  eventLocation?: string | null;
  eventCity: string;
  eventStartDate: string;
  eventEndDate: string;
  eventPayPerDay: number;
  eventExpectedCheckIn: string | null;
  eventExpectedCheckOut: string | null;
  eventLateThreshold: number;
  eventLatitude: string | null;
  eventLongitude: string | null;
  crewName: string;
  crewEmail: string;
  crewPhone: string | null;
  crewPhotoUrl: string | null;
  checkedInAt: string | null;
  isAbsent: boolean;
  checkInStatus: string | null;
  checkInLat: string | null;
  checkInLng: string | null;
  checkInPhotoUrl: string | null;
  checkOutAt: string | null;
  checkOutStatus: string | null;
  checkOutLat: string | null;
  checkOutLng: string | null;
  checkOutPhotoUrl: string | null;
  breakStartAt: string | null;
  breakEndAt: string | null;
  totalBreakMinutes: number;
  attendanceApproved: boolean | null;
  approvedPay: number | null;
  isOverride: boolean;
  overrideReason: string | null;
  distanceFromEvent: string | null;
};

type EventGroup = {
  eventId: number;
  eventTitle: string;
  eventCity: string;
  eventStartDate: string;
  eventEndDate: string;
  expectedCheckIn: string | null;
  expectedCheckOut: string | null;
  lateThreshold: number;
  claims: Claim[];
};

type ReviewFilter = "all" | "pending" | "approved" | "rejected" | "absent";

/* ── Pay auto-calculation ───────────────────────────────────────────────────── */
/* ── Shared time formatter ───────────────────────────────────────────────────── */
function fmtMins(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function calcAutoPay(c: Claim): number {
  const base = c.totalPay > 0 ? c.totalPay : (c.eventPayPerDay > 0 ? c.eventPayPerDay : 0);
  if (!c.checkedInAt) return 0;
  if (!c.checkOutAt) return base;
  if (c.eventExpectedCheckIn && c.eventExpectedCheckOut) {
    const dateStr = c.eventStartDate.split("T")[0];
    const toDate = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      const d = new Date(`${dateStr}T00:00:00+05:30`);
      d.setHours(h, m, 0, 0);
      return d;
    };
    const expIn  = toDate(c.eventExpectedCheckIn);
    const expOut = toDate(c.eventExpectedCheckOut);
    const expMs  = expOut.getTime() - expIn.getTime();
    if (expMs > 0) {
      const actualMs =
        new Date(c.checkOutAt).getTime() - new Date(c.checkedInAt).getTime()
        - (c.totalBreakMinutes || 0) * 60000;
      return Math.round(base * Math.min(1, Math.max(0, actualMs / expMs)));
    }
  }
  return base;
}

/* ── Pay breakdown (late + early-exit deductions) ────────────────────────────── */
function calcPayBreakdown(c: Claim) {
  const base = c.totalPay > 0 ? c.totalPay : (c.eventPayPerDay > 0 ? c.eventPayPerDay : 0);
  const empty = { base, shiftMins: 0, perMinRate: 0, lateMin: 0, earlyMin: 0, lateDeduction: 0, earlyDeduction: 0, totalDeduction: 0, finalPay: base, reason: "" };

  if (!c.checkedInAt || !c.eventExpectedCheckIn || !c.eventExpectedCheckOut) return empty;

  const dateStr = c.eventStartDate.split("T")[0];
  const toDate  = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const d = new Date(`${dateStr}T00:00:00+05:30`);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const expIn    = toDate(c.eventExpectedCheckIn);
  const expOut   = toDate(c.eventExpectedCheckOut);
  const shiftMins = Math.round((expOut.getTime() - expIn.getTime()) / 60000);
  if (shiftMins <= 0) return empty;

  const perMinRate    = base / shiftMins;
  const lateMin       = Math.max(0, Math.round((new Date(c.checkedInAt).getTime() - expIn.getTime()) / 60000));
  const earlyMin      = c.checkOutAt ? Math.max(0, Math.round((expOut.getTime() - new Date(c.checkOutAt).getTime()) / 60000)) : 0;
  const lateDeduction  = lateMin  * perMinRate;
  const earlyDeduction = earlyMin * perMinRate;
  const totalDeduction = lateDeduction + earlyDeduction;
  const finalPay       = Math.max(0, Math.round(base - totalDeduction));

  const parts: string[] = [];
  if (lateMin  > 0) parts.push(`₹${Math.round(lateDeduction).toLocaleString("en-IN")} deducted for ${fmtMins(lateMin)} late`);
  if (earlyMin > 0) parts.push(`₹${Math.round(earlyDeduction).toLocaleString("en-IN")} deducted for ${fmtMins(earlyMin)} early exit`);
  const reason = parts.length ? `${parts.join(" + ")}. Final Pay: ₹${finalPay.toLocaleString("en-IN")}` : "";

  return { base, shiftMins, perMinRate, lateMin, earlyMin, lateDeduction, earlyDeduction, totalDeduction, finalPay, reason };
}

/* ── Location status ────────────────────────────────────────────────────────── */
function getLocStatus(c: Claim) {
  if (!c.checkInLat || !c.checkInLng) return { type: "no-gps" as const, dist: null };
  if (!c.eventLatitude || !c.eventLongitude) return { type: "unknown" as const, dist: null };
  const dist = haversineMeters(
    parseFloat(c.checkInLat), parseFloat(c.checkInLng),
    parseFloat(c.eventLatitude), parseFloat(c.eventLongitude),
  );
  return { type: dist <= 500 ? ("ok" as const) : ("far" as const), dist };
}

/* ── Is "safe" for bulk approve ─────────────────────────────────────────────── */
function isSafe(c: Claim): boolean {
  if (c.attendanceApproved !== null) return false;
  if (!c.checkedInAt) return false;
  if (!c.checkInPhotoUrl) return false;
  const loc = getLocStatus(c);
  return loc.type === "ok" || loc.type === "unknown";
}

/* ── EventSettings ──────────────────────────────────────────────────────────── */
function EventSettingsPanel({ eventId, current, onSaved }: {
  eventId: number;
  current: { expectedCheckIn: string | null; expectedCheckOut: string | null; lateThreshold: number };
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen]           = useState(false);
  const [saving, setSaving]       = useState(false);
  const [checkIn, setCheckIn]     = useState(current.expectedCheckIn || "");
  const [checkOut, setCheckOut]   = useState(current.expectedCheckOut || "");
  const [threshold, setThreshold] = useState(String(current.lateThreshold));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/events/${eventId}/attendance-settings`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCheckIn: checkIn || null, expectedCheckOut: checkOut || null, lateThresholdMinutes: parseInt(threshold) || 15 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Settings saved" });
      onSaved();
      setOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted">
        <Settings2 className="w-3.5 h-3.5" />
        Attendance Settings
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-xl border bg-card space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Expected Check-In", val: checkIn, set: setCheckIn, type: "time" },
              { label: "Expected Check-Out", val: checkOut, set: setCheckOut, type: "time" },
              { label: "Late After (mins)", val: threshold, set: setThreshold, type: "number" },
            ].map(f => (
              <div key={f.label}>
                <label className="text-[10px] text-muted-foreground font-medium block mb-0.5">{f.label}</label>
                <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)}
                  className="w-full text-xs border rounded-lg px-2 py-1.5 bg-white" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs gap-1">
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-8 text-xs">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Details Modal ──────────────────────────────────────────────────────────── */
function DetailsModal({ c, open, onClose, onRefresh }: {
  c: Claim;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const pb      = useMemo(() => calcPayBreakdown(c), [c]);
  const autoPay = useMemo(() => (pb.shiftMins > 0 ? pb.finalPay : calcAutoPay(c)), [c, pb]);
  const [payInput, setPayInput] = useState(
    c.approvedPay !== null ? String(Math.round(c.approvedPay)) : String(autoPay),
  );
  const [overrideReason, setOverrideReason] = useState(c.overrideReason || "");
  const [busy, setBusy] = useState<"finalize" | "undo" | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showPayDetails, setShowPayDetails] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const loc = getLocStatus(c);

  const isPayOverridden = String(autoPay) !== payInput;
  const overridePayNum = parseFloat(payInput) || 0;
  const isReasonRequired = isPayOverridden && overridePayNum < autoPay;
  const overrideReasonMissing = isReasonRequired && !overrideReason.trim();

  async function act(endpoint: string, body?: any) {
    const action: "finalize" | "undo" = endpoint.includes("undo") ? "undo" : "finalize";
    setBusy(action);
    setConfirming(false);
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setBusy(null);
    }
  }

  const isApproved = c.attendanceApproved === true;
  const isRejected = c.attendanceApproved === false;

  const checkOutDist = c.checkOutLat && c.checkOutLng && c.eventLatitude && c.eventLongitude
    ? haversineMeters(parseFloat(c.checkOutLat), parseFloat(c.checkOutLng), parseFloat(c.eventLatitude), parseFloat(c.eventLongitude))
    : null;

  return (
    <>
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-2xl p-0"
        onInteractOutside={e => { if (lightbox) e.preventDefault(); }}
        onEscapeKeyDown={e => { if (lightbox) { e.preventDefault(); setLightbox(null); } }}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-bold">{c.crewName}</DialogTitle>
          <p className="text-xs text-muted-foreground">{c.shiftRole} · {c.eventTitle}</p>
        </DialogHeader>

        <div className="px-5 py-4 space-y-5">

          {/* ── Attendance Summary ── */}
          {(() => {
            // Late by minutes (positive = late)
            let lateMin: number | null = null;
            if (c.checkedInAt && c.eventExpectedCheckIn) {
              const dateStr = c.eventStartDate.split("T")[0];
              const [h, m] = c.eventExpectedCheckIn.split(":").map(Number);
              const exp = new Date(`${dateStr}T00:00:00+05:30`);
              exp.setHours(h, m, 0, 0);
              lateMin = Math.max(0, Math.round((new Date(c.checkedInAt).getTime() - exp.getTime()) / 60000));
            }
            // Early exit minutes (positive = left early)
            let earlyMin: number | null = null;
            if (c.checkOutAt && c.eventExpectedCheckOut) {
              const dateStr = c.eventStartDate.split("T")[0];
              const [h, m] = c.eventExpectedCheckOut.split(":").map(Number);
              const exp = new Date(`${dateStr}T00:00:00+05:30`);
              exp.setHours(h, m, 0, 0);
              earlyMin = Math.max(0, Math.round((exp.getTime() - new Date(c.checkOutAt).getTime()) / 60000));
            }
            // Total worked time (excluding breaks)
            let workedMin: number | null = null;
            if (c.checkedInAt && c.checkOutAt) {
              workedMin = Math.round(
                (new Date(c.checkOutAt).getTime() - new Date(c.checkedInAt).getTime()) / 60000
              ) - (c.totalBreakMinutes || 0);
            }
            const checkInDist  = loc.dist;
            const threshold    = c.eventLateThreshold ?? 15;

            type Chip = { label: string; value: string; tone: "green" | "orange" | "red" | "sky" | "gray" };
            const chips: Chip[] = [];

            // Late
            if (c.eventExpectedCheckIn) {
              if (lateMin === null)       chips.push({ label: "Late by",      value: "—",            tone: "gray"   });
              else if (lateMin === 0)     chips.push({ label: "Late by",      value: "On time",      tone: "green"  });
              else if (lateMin <= threshold) chips.push({ label: "Late by",   value: fmtMins(lateMin),  tone: "orange" });
              else                        chips.push({ label: "Late by",      value: fmtMins(lateMin),  tone: "red"    });
            }

            // Early exit
            if (c.eventExpectedCheckOut) {
              if (earlyMin === null)  chips.push({ label: "Early exit",  value: "—",              tone: "gray"  });
              else if (earlyMin === 0) chips.push({ label: "Early exit", value: "None",           tone: "green" });
              else                    chips.push({ label: "Early exit",  value: fmtMins(earlyMin),   tone: "sky"   });
            }

            // Worked time
            chips.push({
              label: "Worked",
              value: workedMin !== null ? fmtMins(workedMin) : "—",
              tone:  workedMin !== null ? "green" : "gray",
            });

            // Check-in distance
            chips.push({
              label: "Check-in GPS",
              value: checkInDist !== null ? fmtDist(checkInDist) : "—",
              tone:  checkInDist === null ? "gray" : checkInDist <= 500 ? "green" : checkInDist <= 2000 ? "orange" : "red",
            });

            // Check-out distance
            chips.push({
              label: "Check-out GPS",
              value: checkOutDist !== null ? fmtDist(checkOutDist) : "—",
              tone:  checkOutDist === null ? "gray" : checkOutDist <= 500 ? "green" : checkOutDist <= 2000 ? "orange" : "red",
            });

            // Selfies
            chips.push({ label: "Check-in selfie",  value: c.checkInPhotoUrl  ? "✓ Present" : "✕ Missing", tone: c.checkInPhotoUrl  ? "green" : "red" });
            chips.push({ label: "Check-out selfie", value: c.checkOutPhotoUrl ? "✓ Present" : "✕ Missing", tone: c.checkOutPhotoUrl ? "green" : "red" });

            // Location validity
            chips.push({
              label: "Location valid",
              value: loc.type === "no-gps"   ? "No GPS"
                   : loc.type === "unknown"  ? "No coords"
                   : loc.type === "ok"       ? "✓ Valid"
                   :                          "✕ Far",
              tone:  loc.type === "ok" ? "green" : loc.type === "far" ? "red" : "gray",
            });

            const toneClass: Record<string, string> = {
              green:  "bg-emerald-50 text-emerald-700 border-emerald-200",
              orange: "bg-orange-50  text-orange-700  border-orange-200",
              red:    "bg-rose-50    text-rose-700    border-rose-200",
              sky:    "bg-sky-50     text-sky-700     border-sky-200",
              gray:   "bg-slate-50   text-slate-500   border-slate-200",
            };

            return (
              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Zap className="w-3 h-3" /> Attendance Summary
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {chips.map(chip => (
                    <div key={chip.label} className={`flex flex-col rounded-lg border px-2.5 py-2 ${toneClass[chip.tone]}`}>
                      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60 leading-tight">{chip.label}</span>
                      <span className="text-[12px] font-bold mt-0.5 leading-tight">{chip.value}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* ── Check-In ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Check-In
            </h3>
            {c.checkedInAt ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{fmtDateTime(c.checkedInAt)}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    c.checkInStatus === "late"
                      ? "bg-orange-100 text-orange-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {c.checkInStatus === "late" ? "Late" : "On Time"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* Selfie */}
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-1">Check-In Selfie</p>
                    {c.checkInPhotoUrl ? (
                      <button
                        type="button"
                        onClick={() => setLightbox(c.checkInPhotoUrl!)}
                        className="w-full block rounded-xl overflow-hidden border hover:opacity-90 transition focus:outline-none"
                      >
                        <img src={c.checkInPhotoUrl} alt="Check-in selfie" className="w-full h-28 object-cover" />
                        <p className="text-[10px] text-center text-primary py-1 bg-muted/60">Tap to enlarge</p>
                      </button>
                    ) : (
                      <div className="w-full h-28 rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground border">No selfie</div>
                    )}
                  </div>
                  {/* GPS */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium">GPS Location</p>
                    {c.checkInLat && c.checkInLng ? (
                      <>
                        <p className="text-xs font-mono text-foreground">{parseFloat(c.checkInLat).toFixed(5)}, {parseFloat(c.checkInLng).toFixed(5)}</p>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${c.checkInLat},${c.checkInLng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-primary underline"
                        >
                          View on Maps
                        </a>
                        {loc.dist !== null && (
                          <p className={`text-xs font-semibold ${loc.type === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
                            {fmtDist(loc.dist)} from venue
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No GPS data</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border bg-slate-50 p-3 text-sm text-muted-foreground text-center">Not checked in</div>
            )}
          </section>

          {/* ── Break ── */}
          {(c.breakStartAt || c.totalBreakMinutes > 0) && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                <Coffee className="w-3.5 h-3.5" /> Break
              </h3>
              <div className="rounded-xl border bg-muted/20 p-3 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Start</p>
                  <p className="text-sm font-semibold">{fmtTime(c.breakStartAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">End</p>
                  <p className="text-sm font-semibold">{fmtTime(c.breakEndAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">Duration</p>
                  <p className="text-sm font-bold text-amber-600">{c.totalBreakMinutes} mins</p>
                </div>
              </div>
            </section>
          )}

          {/* ── Check-Out ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Check-Out
            </h3>
            {c.checkOutAt ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{fmtDateTime(c.checkOutAt)}</span>
                  {c.checkOutStatus === "early" ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Early Exit</span>
                  ) : (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">On Time</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium mb-1">Check-Out Selfie</p>
                    {c.checkOutPhotoUrl ? (
                      <button
                        type="button"
                        onClick={() => setLightbox(c.checkOutPhotoUrl!)}
                        className="w-full block rounded-xl overflow-hidden border hover:opacity-90 transition focus:outline-none"
                      >
                        <img src={c.checkOutPhotoUrl} alt="Check-out selfie" className="w-full h-28 object-cover" />
                        <p className="text-[10px] text-center text-primary py-1 bg-muted/60">Tap to enlarge</p>
                      </button>
                    ) : (
                      <div className="w-full h-28 rounded-xl bg-muted flex items-center justify-center text-xs text-muted-foreground border">No selfie</div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-medium">GPS Location</p>
                    {c.checkOutLat && c.checkOutLng ? (
                      <>
                        <p className="text-xs font-mono text-foreground">{parseFloat(c.checkOutLat).toFixed(5)}, {parseFloat(c.checkOutLng).toFixed(5)}</p>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${c.checkOutLat},${c.checkOutLng}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-primary underline"
                        >
                          View on Maps
                        </a>
                        {checkOutDist !== null && (
                          <p className={`text-xs font-semibold ${checkOutDist <= 500 ? "text-emerald-600" : "text-rose-600"}`}>
                            {fmtDist(checkOutDist)} from venue
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No GPS data</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border bg-slate-50 p-3 text-sm text-muted-foreground text-center">Not checked out</div>
            )}
          </section>

          {/* ── Timestamps log ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Exact Timestamps
            </h3>
            <div className="rounded-xl border bg-muted/20 p-3 space-y-1.5">
              {[
                { label: "Check-In",    value: c.checkedInAt },
                { label: "Break Start", value: c.breakStartAt },
                { label: "Break End",   value: c.breakEndAt },
                { label: "Check-Out",   value: c.checkOutAt },
              ].map(row => (
                <div key={row.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-medium w-24 shrink-0">{row.label}</span>
                  <span className="font-mono text-foreground text-right">{row.value ? fmtDateTime(row.value) : "—"}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Admin action (inside details) ── */}
          {c.checkedInAt && (
            <section className="border-t pt-4 space-y-4">

              {/* ── Payment Summary card (always visible when checked in) ── */}
              {pb.shiftMins > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                      <IndianRupee className="w-3 h-3" /> Payment Summary
                    </p>
                  </div>

                  <div className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Base Pay</span>
                      <span className="font-semibold text-foreground">₹{pb.base.toLocaleString("en-IN")}</span>
                    </div>
                    {pb.lateMin > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-orange-600">Late ({fmtMins(pb.lateMin)})</span>
                        <span className="font-semibold text-orange-600">−₹{Math.round(pb.lateDeduction).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {pb.earlyMin > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-sky-600">Early exit ({fmtMins(pb.earlyMin)})</span>
                        <span className="font-semibold text-sky-600">−₹{Math.round(pb.earlyDeduction).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {pb.totalDeduction > 0 && (
                      <div className="flex items-center justify-between text-xs border-t pt-1.5 mt-1">
                        <span className="text-rose-600 font-medium">Total Deduction</span>
                        <span className="font-bold text-rose-600">−₹{Math.round(pb.totalDeduction).toLocaleString("en-IN")}</span>
                      </div>
                    )}
                  </div>

                  <div className={`px-3 py-2.5 border-t flex items-center justify-between ${
                    pb.totalDeduction === 0 ? "bg-emerald-50" :
                    pb.totalDeduction <= pb.base * 0.15 ? "bg-orange-50" : "bg-rose-50"
                  }`}>
                    <span className="text-xs font-bold text-foreground">Auto Pay</span>
                    <span className={`text-base font-bold ${
                      pb.totalDeduction === 0 ? "text-emerald-700" :
                      pb.totalDeduction <= pb.base * 0.15 ? "text-orange-700" : "text-rose-700"
                    }`}>₹{pb.finalPay.toLocaleString("en-IN")}</span>
                  </div>

                  {pb.reason && (
                    <div className="border-t">
                      <button
                        type="button"
                        onClick={() => setShowPayDetails(s => !s)}
                        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors"
                      >
                        <span>{showPayDetails ? "Hide" : "View"} deduction reason</span>
                        {showPayDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {showPayDetails && (
                        <div className="px-3 pb-3 border-t bg-slate-50/60">
                          <p className="pt-2 text-[11px] text-muted-foreground leading-relaxed">{pb.reason}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Override Pay input (read-only when locked) ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap flex items-center gap-1">
                    <IndianRupee className="w-3.5 h-3.5" />
                    {pb.shiftMins > 0 ? "Override Pay" : "Pay"}
                  </label>
                  <div className="relative max-w-[120px]">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">₹</span>
                    <input
                      type="number" min={0} value={payInput}
                      onChange={e => { if (!isApproved && !isRejected) { setPayInput(e.target.value); setConfirming(false); } }}
                      readOnly={isApproved || isRejected}
                      className={`w-full pl-6 pr-2 py-1.5 text-sm border rounded-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        isApproved || isRejected ? "bg-slate-50 text-muted-foreground cursor-not-allowed" : "bg-white"
                      }`}
                    />
                  </div>
                  {isPayOverridden && !isApproved && !isRejected && (
                    <span className="text-[10px] font-bold text-violet-700 border border-violet-200 bg-violet-50 px-2 py-0.5 rounded-full">
                      Manual Override
                    </span>
                  )}
                  {isApproved && c.isOverride && (
                    <span className="text-[10px] font-bold text-violet-700 border border-violet-200 bg-violet-50 px-2 py-0.5 rounded-full">
                      Manual Override Applied
                    </span>
                  )}
                  {isApproved && !c.isOverride && (
                    <span className="text-[10px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded-full">
                      Locked
                    </span>
                  )}
                </div>

                {/* Override reason textarea — shown when editing and pay is changed */}
                {isPayOverridden && !isApproved && !isRejected && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-violet-700 flex items-center gap-1">
                      Reason for Override {isReasonRequired && <span className="text-rose-500">*</span>}
                    </label>
                    <textarea
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      rows={2}
                      placeholder="Enter reason (e.g., client delay, partial shift approved, special case)"
                      className={`w-full px-3 py-2 text-xs border rounded-lg resize-none focus:outline-none focus:ring-2 ${
                        overrideReasonMissing
                          ? "border-rose-300 focus:ring-rose-300 bg-rose-50"
                          : "border-violet-200 focus:ring-violet-300 bg-violet-50/30"
                      }`}
                    />
                    {overrideReasonMissing && (
                      <p className="text-[11px] text-rose-600 font-medium">Required when reducing pay below base amount</p>
                    )}
                  </div>
                )}

                {/* Finalized override reason (read-only) */}
                {isApproved && c.isOverride && c.overrideReason && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2 space-y-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-violet-600">Override Reason</p>
                    <p className="text-xs text-foreground leading-relaxed">{c.overrideReason}</p>
                  </div>
                )}
              </div>

              {/* ── Status banner: Finalized ── */}
              {isApproved && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-700">Finalized</p>
                      <p className="text-xs text-emerald-600">
                        Final Pay: ₹{c.approvedPay !== null ? Math.round(c.approvedPay).toLocaleString("en-IN") : "?"} · Sent to Payments
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => act(`/api/admin/shift-claims/${c.id}/undo-attendance`)}
                    disabled={!!busy}
                    className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1 shrink-0 ml-3"
                  >
                    {busy === "undo" ? <RefreshCw className="w-3 h-3 animate-spin" /> : null} Undo
                  </button>
                </div>
              )}

              {/* ── Status banner: Rejected ── */}
              {isRejected && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-rose-600 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" /> Rejected
                  </span>
                  <button
                    onClick={() => act(`/api/admin/shift-claims/${c.id}/undo-attendance`)}
                    disabled={!!busy}
                    className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1"
                  >
                    {busy === "undo" ? <RefreshCw className="w-3 h-3 animate-spin" /> : null} Undo
                  </button>
                </div>
              )}

              {/* ── Finalize button (only when pending) ── */}
              {!isApproved && !isRejected && (
                confirming ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
                    <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" />
                      Finalize this payment?
                    </p>
                    <p className="text-xs text-amber-700">
                      This will lock the attendance record and send{" "}
                      <strong>₹{(parseFloat(payInput) || 0).toLocaleString("en-IN")}</strong> to the Payments dashboard.
                      {isPayOverridden && (
                        <span className="block mt-1 text-violet-700 font-semibold">
                          Override reason: "{overrideReason.trim()}"
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => act(`/api/admin/shift-claims/${c.id}/approve-attendance`, {
                          payAmount: parseFloat(payInput) || 0,
                          ...(isPayOverridden && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
                        })}
                        disabled={!!busy}
                        className="flex-1 h-10 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      >
                        {busy === "finalize" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Yes, Finalize
                      </Button>
                      <Button
                        onClick={() => setConfirming(false)}
                        disabled={!!busy}
                        variant="outline"
                        className="h-10 px-4 rounded-xl text-sm font-medium"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={() => {
                      if (overrideReasonMissing) {
                        toast({ variant: "destructive", title: "Reason required", description: "A reason is required when reducing pay below the base amount." });
                        return;
                      }
                      setConfirming(true);
                    }}
                    disabled={!!busy}
                    className="w-full h-12 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-white gap-2"
                  >
                    {busy === "finalize" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Finalize &amp; Send to Payments
                  </Button>
                )
              )}

            </section>
          )}
        </div>

      </DialogContent>
    </Dialog>

    {lightbox && createPortal(
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.92)", padding: "16px" }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setLightbox(null); }}
      >
        <button
          type="button"
          style={{ position: "absolute", top: 16, right: 16, zIndex: 10000, pointerEvents: "auto", width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.25)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setLightbox(null); }}
        >
          <X size={22} />
        </button>
        <img
          src={lightbox}
          alt="Selfie full size"
          style={{ maxWidth: "100%", maxHeight: "85vh", objectFit: "contain", borderRadius: 16, pointerEvents: "none" }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
        <p style={{ position: "absolute", bottom: 20, fontSize: 12, color: "rgba(255,255,255,0.45)", pointerEvents: "none" }}>Tap anywhere to close</p>
      </div>,
      document.body
    )}
    </>
  );
}

/* ── Review Card (simplified main card) ─────────────────────────────────────── */
function ReviewCard({ c, onRefresh, onOpenProfile }: { c: Claim; onRefresh: () => void; onOpenProfile: (crewId: number) => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"undo" | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const loc = getLocStatus(c);

  const isApproved  = c.attendanceApproved === true;
  const isRejected  = c.attendanceApproved === false;
  const isPending   = c.attendanceApproved === null && !!c.checkedInAt;
  const isNoShow    = !c.checkedInAt;

  async function act(endpoint: string, body?: any) {
    setBusy("undo");
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setBusy(null);
    }
  }

  /* ── Master validity status ── */
  type MasterStatus = "verified" | "needs-review" | "invalid";
  const masterStatus: MasterStatus = (() => {
    if (!c.checkedInAt)                              return "invalid";
    if (!c.checkInPhotoUrl)                          return "invalid";
    if (loc.dist !== null && loc.dist > 2000)        return "invalid";
    if (c.checkInStatus === "late")                  return "needs-review";
    if (c.checkOutStatus === "early")                return "needs-review";
    if (loc.type === "no-gps")                       return "needs-review";
    if (loc.dist !== null && loc.dist > 500)         return "needs-review";
    return "verified";
  })();

  const masterLabel = {
    verified:       { text: "✔ Verified",  cls: "bg-emerald-100 text-emerald-700 border-emerald-300", bar: "bg-emerald-400" },
    "needs-review": { text: "⚠ Review",    cls: "bg-amber-100 text-amber-700 border-amber-300",       bar: "bg-amber-400"   },
    invalid:        { text: "✕ Invalid",   cls: "bg-rose-100 text-rose-600 border-rose-300",           bar: "bg-rose-400"    },
  }[masterStatus];

  /* ── Inline badge builder ── */
  const badges: { icon: React.ReactNode; text: string; color: string }[] = [];

  // Check-In badge
  if (!c.checkedInAt) {
    badges.push({ icon: <Clock size={10} />, text: "Not Checked In", color: "bg-rose-50 text-rose-500 border-rose-200" });
  } else if (c.checkInStatus === "late") {
    badges.push({ icon: <Clock size={10} />, text: `${fmtTime(c.checkedInAt)} Late`, color: "bg-orange-50 text-orange-600 border-orange-200" });
  } else {
    badges.push({ icon: <Clock size={10} />, text: fmtTime(c.checkedInAt), color: "bg-emerald-50 text-emerald-700 border-emerald-200" });
  }

  // Break badge
  if (c.breakStartAt || c.totalBreakMinutes > 0) {
    const breakText = c.breakStartAt && c.breakEndAt
      ? `${fmtTime(c.breakStartAt)}–${fmtTime(c.breakEndAt)} · ${c.totalBreakMinutes}m`
      : `Break ${c.totalBreakMinutes}m`;
    badges.push({ icon: <Coffee size={10} />, text: breakText, color: "bg-amber-50 text-amber-600 border-amber-200" });
  }

  // Check-Out badge
  if (c.checkOutAt) {
    if (c.checkOutStatus === "early") {
      badges.push({ icon: <Clock size={10} />, text: `${fmtTime(c.checkOutAt)} Early`, color: "bg-sky-50 text-sky-600 border-sky-200" });
    } else {
      badges.push({ icon: <Clock size={10} />, text: fmtTime(c.checkOutAt), color: "bg-emerald-50 text-emerald-700 border-emerald-200" });
    }
  }

  // GPS badge — distance only, color tells the story
  if (loc.dist !== null && loc.dist <= 500) {
    badges.push({ icon: <MapPin size={10} />, text: fmtDist(loc.dist), color: "bg-emerald-50 text-emerald-700 border-emerald-200" });
  } else if (loc.dist !== null && loc.dist <= 2000) {
    badges.push({ icon: <MapPin size={10} />, text: fmtDist(loc.dist), color: "bg-amber-50 text-amber-600 border-amber-200" });
  } else if (loc.dist !== null) {
    badges.push({ icon: <MapPin size={10} />, text: fmtDist(loc.dist), color: "bg-rose-50 text-rose-500 border-rose-200" });
  } else if (loc.type === "no-gps") {
    badges.push({ icon: <MapPin size={10} />, text: "No GPS", color: "bg-slate-100 text-slate-400 border-slate-200" });
  } else if (c.checkInLat) {
    badges.push({ icon: <MapPin size={10} />, text: "GPS OK", color: "bg-blue-50 text-blue-600 border-blue-200" });
  }

  // Selfie badge — "Verified" or "Missing", no emoji in text
  if (c.checkInPhotoUrl) {
    badges.push({ icon: <Camera size={10} />, text: "Verified", color: "bg-emerald-50 text-emerald-700 border-emerald-200" });
  } else {
    badges.push({ icon: <Camera size={10} />, text: "Missing", color: "bg-rose-50 text-rose-500 border-rose-200" });
  }

  return (
    <>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Top bar tracks master status */}
        <div className={`h-[3px] w-full ${masterLabel.bar}`} />

        <div className="p-4 space-y-3">
          {/* Top row: photo + name + status */}
          <div className="flex gap-3">
            {/* Crew photo */}
            <div className="shrink-0">
              {c.checkInPhotoUrl ? (
                <button onClick={() => setShowDetails(true)}>
                  <img src={c.checkInPhotoUrl} alt={c.crewName}
                    className="w-14 h-14 rounded-xl object-cover border-2 border-emerald-200 hover:opacity-90 transition" />
                </button>
              ) : c.crewPhotoUrl ? (
                <img src={c.crewPhotoUrl} alt={c.crewName}
                  className="w-14 h-14 rounded-xl object-cover border border-border" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-xl font-bold text-muted-foreground border border-border">
                  {c.crewName.charAt(0)}
                </div>
              )}
            </div>

            {/* Info + badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <button
                    onClick={() => { console.log("Crew ID:", c.crewId); onOpenProfile(c.crewId); }}
                    className="font-bold text-sm leading-tight truncate text-left underline-offset-2 hover:underline hover:text-primary transition-colors cursor-pointer"
                  >
                    {c.crewName}
                  </button>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.shiftRole}</p>
                  {/* Event context */}
                  {(() => {
                    const venue = c.eventLocation || c.eventCity || null;
                    const date  = c.eventStartDate ? format(new Date(c.eventStartDate), "d MMM") : null;
                    return (
                      <div className="flex flex-wrap items-center gap-y-[2px] mt-[5px]" style={{ gap: "0 6px" }}>
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#6B7280" }}>
                          <span style={{ opacity: 0.75 }}>📅</span>
                          <span>{c.eventTitle}</span>
                        </span>
                        {venue && (
                          <>
                            <span style={{ color: "#9CA3AF", margin: "0 1px" }}>•</span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#6B7280" }}>
                              <span style={{ opacity: 0.75 }}>📍</span>
                              <span>{venue}</span>
                            </span>
                          </>
                        )}
                        {date && (
                          <>
                            <span style={{ color: "#9CA3AF", margin: "0 1px" }}>•</span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "#6B7280" }}>
                              <span style={{ opacity: 0.75 }}>🗓</span>
                              <span>{date}</span>
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Right column: single primary status badge — decision takes priority over validity */}
                <div className="shrink-0 flex items-end">
                  {isApproved ? (
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full border text-emerald-600 bg-emerald-50 border-emerald-200">
                      ✔ Finalized
                    </span>
                  ) : isRejected ? (
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full border text-rose-500 bg-rose-50 border-rose-200">
                      ✕ Rejected
                    </span>
                  ) : isNoShow ? (
                    <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full border text-slate-400 bg-slate-50 border-slate-200">
                      No Show
                    </span>
                  ) : (
                    <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full border ${masterLabel.cls}`}>
                      {masterLabel.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Badges — compact, color-coded */}
              <div className="flex flex-wrap gap-1.5">
                {badges.map((b, i) => (
                  <span key={i} className={`inline-flex items-center gap-[3px] text-[11px] font-medium px-2 py-[2px] rounded-full border ${b.color}`}>
                    {b.icon}{b.text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom action row */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            {/* View Details always available */}
            <button
              onClick={() => setShowDetails(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <Eye className="w-3.5 h-3.5" /> View Details
            </button>

            <div className="flex-1" />

            {(isApproved || isRejected) && (
              <button
                onClick={() => act(`/api/admin/shift-claims/${c.id}/undo-attendance`)}
                disabled={!!busy}
                className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1"
              >
                {busy === "undo" ? <RefreshCw className="w-3 h-3 animate-spin" /> : null} Undo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Details modal */}
      <DetailsModal c={c} open={showDetails} onClose={() => setShowDetails(false)} onRefresh={onRefresh} />
    </>
  );
}

/* ── Stats bar ──────────────────────────────────────────────────────────────── */
function StatsBar({ claims }: { claims: Claim[] }) {
  const pending  = claims.filter(c => c.attendanceApproved === null && !!c.checkedInAt).length;
  const approved = claims.filter(c => c.attendanceApproved === true).length;
  const rejected = claims.filter(c => c.attendanceApproved === false).length;
  const noShow   = claims.filter(c => !c.checkedInAt && !c.isAbsent).length;
  const safe     = claims.filter(isSafe).length;

  const items = [
    { label: "Pending",   value: pending,  color: "text-amber-600" },
    { label: "Finalized", value: approved, color: "text-emerald-700" },
    { label: "Rejected",  value: rejected, color: "text-rose-600" },
    { label: "No Show",  value: noShow,   color: "text-slate-500" },
    { label: "Safe",     value: safe,     color: "text-blue-600" },
    { label: "Total",    value: claims.length, color: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 p-3 rounded-xl bg-muted/50 text-center">
      {items.map(i => (
        <div key={i.label}>
          <p className={`text-base font-bold ${i.color}`}>{i.value}</p>
          <p className="text-[10px] text-muted-foreground">{i.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────── */
export default function AdminAttendance() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [selectedEventId, setSelectedEventId] = useState<number | "all">("all");
  const [filter, setFilter]                   = useState<ReviewFilter>("all");
  const [search, setSearch]                   = useState("");
  const [bulkBusy, setBulkBusy]               = useState(false);
  const [profileModalId, setProfileModalId]   = useState<number | null>(null);

  const { data: allClaims = [], isLoading } = useQuery({
    queryKey: ["admin-shift-claims"],
    queryFn:  () => customFetch(`${BASE_URL}/api/admin/shift-claims`),
    refetchInterval: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-shift-claims"] });

  const approved: Claim[] = (allClaims as Claim[]).filter((c: Claim) => c.status === "approved");

  /* Build event groups */
  const eventMap = new Map<number, EventGroup>();
  for (const c of approved) {
    if (!eventMap.has(c.eventId)) {
      eventMap.set(c.eventId, {
        eventId:         c.eventId,
        eventTitle:      c.eventTitle,
        eventCity:       c.eventCity,
        eventStartDate:  c.eventStartDate,
        eventEndDate:    c.eventEndDate,
        expectedCheckIn:  c.eventExpectedCheckIn,
        expectedCheckOut: c.eventExpectedCheckOut,
        lateThreshold:    c.eventLateThreshold ?? 15,
        claims: [],
      });
    }
    eventMap.get(c.eventId)!.claims.push(c);
  }

  const eventGroups = Array.from(eventMap.values()).sort(
    (a, b) => new Date(b.eventStartDate).getTime() - new Date(a.eventStartDate).getTime(),
  );

  const currentGroup   = selectedEventId === "all" ? null : eventGroups.find(e => e.eventId === selectedEventId) ?? null;
  const claimsInView   = selectedEventId === "all" ? approved : (currentGroup?.claims ?? []);

  /* Filter */
  const filtered = claimsInView.filter(c => {
    if (filter === "pending"  && !(c.attendanceApproved === null && !!c.checkedInAt)) return false;
    if (filter === "approved" && c.attendanceApproved !== true)  return false;
    if (filter === "rejected" && c.attendanceApproved !== false) return false;
    if (filter === "absent"   && !!c.checkedInAt) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.crewName.toLowerCase().includes(q) && !c.crewEmail.toLowerCase().includes(q) && !(c.crewPhone || "").includes(q)) return false;
    }
    return true;
  });

  const pills: { key: ReviewFilter; label: string; count: number }[] = [
    { key: "all",      label: "All",           count: claimsInView.length },
    { key: "pending",  label: "Pending",        count: claimsInView.filter(c => c.attendanceApproved === null && !!c.checkedInAt).length },
    { key: "approved", label: "Finalized",      count: claimsInView.filter(c => c.attendanceApproved === true).length },
    { key: "rejected", label: "Rejected",       count: claimsInView.filter(c => c.attendanceApproved === false).length },
    { key: "absent",   label: "Not Checked In", count: claimsInView.filter(c => !c.checkedInAt).length },
  ];

  const safeCount = claimsInView.filter(isSafe).length;

  async function approveAllSafe() {
    setBulkBusy(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/attendance/approve-all-safe`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedEventId !== "all" ? { eventId: selectedEventId } : {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      toast({ title: `Approved ${d.approvedCount} crew members` });
      refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-16 px-1">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Attendance Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review crew attendance and approve in one tap.</p>
        </div>
        {safeCount > 0 && (
          <Button
            onClick={approveAllSafe}
            disabled={bulkBusy}
            className="shrink-0 h-10 px-4 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
          >
            {bulkBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Approve Safe ({safeCount})
          </Button>
        )}
      </div>

      {/* Event selector */}
      <select
        value={selectedEventId === "all" ? "all" : String(selectedEventId)}
        onChange={e => { setSelectedEventId(e.target.value === "all" ? "all" : parseInt(e.target.value)); setFilter("all"); }}
        className="w-full border rounded-xl px-3 py-2.5 text-sm bg-card shadow-sm"
      >
        <option value="all">All Events ({approved.length} crew)</option>
        {eventGroups.map(eg => (
          <option key={eg.eventId} value={eg.eventId}>
            {eg.eventTitle}{eg.eventCity ? ` — ${eg.eventCity}` : ""} ({eg.claims.length} crew)
          </option>
        ))}
      </select>

      {/* Attendance settings for selected event */}
      {currentGroup && (
        <EventSettingsPanel
          eventId={currentGroup.eventId}
          current={{ expectedCheckIn: currentGroup.expectedCheckIn, expectedCheckOut: currentGroup.expectedCheckOut, lateThreshold: currentGroup.lateThreshold }}
          onSaved={refresh}
        />
      )}

      {/* Stats */}
      {claimsInView.length > 0 && <StatsBar claims={claimsInView} />}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search crew name, email, or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 rounded-xl h-10"
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {pills.map(p => (
          <button key={p.key} onClick={() => setFilter(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              filter === p.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
            }`}>
            {p.label} <span className="ml-1 opacity-70">{p.count}</span>
          </button>
        ))}
      </div>

      {/* Crew review cards */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {claimsInView.length === 0 ? "No approved crew for this selection." : "No results match your filters."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => <ReviewCard key={c.id} c={c} onRefresh={refresh} onOpenProfile={setProfileModalId} />)}
        </div>
      )}

      {/* Summary totals */}
      {claimsInView.length > 0 && (() => {
        const totalPay = claimsInView
          .filter(c => c.attendanceApproved === true)
          .reduce((s, c) => s + (c.approvedPay !== null ? c.approvedPay : 0), 0);
        return (
          <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Approved Crew
            </span>
            <span className="font-bold text-emerald-700">
              {claimsInView.filter(c => c.attendanceApproved === true).length} of {claimsInView.length}
              {totalPay > 0 && <span className="ml-2 text-foreground">· ₹{Math.round(totalPay).toLocaleString()}</span>}
            </span>
          </div>
        );
      })()}

      <CrewProfileModal
        crewId={profileModalId}
        onClose={() => setProfileModalId(null)}
      />
    </div>
  );
}
