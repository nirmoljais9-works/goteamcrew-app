import { useGetMyShifts, useUnclaimShift, getGetMyShiftsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, CalendarDays, IndianRupee, CheckCircle2, Clock4, XCircle, Shirt,
  ClipboardList, ChevronRight, Zap, Timer, LogIn, Coffee, RefreshCw, LogOut, UserX,
  Camera, Loader2, AlertCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import { useLocation, useSearch } from "wouter";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function getGPS(): Promise<{ lat: string; lng: string } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30000 }
    );
  });
}

async function resizeToBase64(file: File, maxW = 800, maxH = 800, quality = 0.65): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio); h = Math.round(h * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (!e || s.toDateString() === e.toDateString()) return format(s, "d MMM yyyy");
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${format(s, "d")}–${format(e, "d MMM yyyy")}`;
  }
  return `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
}

function getEventStatus(startDate: string | null | undefined, endDate: string | null | undefined): "upcoming" | "ongoing" | "completed" {
  const now = new Date();
  if (!startDate) return "upcoming";
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date(startDate);
  end.setHours(23, 59, 59, 999);
  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "ongoing";
}

type Claim = {
  id: number;
  shiftId: number;
  status: string;
  claimedAt: string;
  approvedAt?: string | null;
  shiftRole: string;
  shiftStartTime: string;
  shiftEndTime: string;
  totalPay: number;
  eventDays?: number;
  eventPayPerDay?: number;
  eventTitle: string;
  eventLocation?: string | null;
  eventCity?: string | null;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  eventFoodProvided?: boolean;
  eventMealsProvided?: string | null;
  eventDressCode?: string | null;
  eventExpectedCheckIn?: string | null;
  eventExpectedCheckOut?: string | null;
  checkedInAt?: string | null;
  checkInStatus?: string | null;
  checkOutAt?: string | null;
  checkOutStatus?: string | null;
  isAbsent?: boolean;
  breakStartAt?: string | null;
  breakEndAt?: string | null;
  totalBreakMinutes?: number;
  attendanceApproved?: boolean | null;
  approvedPay?: string | number | null;
  isOverride?: boolean;
  overrideReason?: string | null;
};

function fmtTime(ts: string | null | undefined) {
  if (!ts) return null;
  return format(new Date(ts), "hh:mm a");
}

function workingHours(inAt: string | null | undefined, outAt: string | null | undefined, breakMins: number) {
  if (!inAt || !outAt) return null;
  const totalMs = new Date(outAt).getTime() - new Date(inAt).getTime();
  const workMs = Math.max(0, totalMs - breakMins * 60000);
  const h = Math.floor(workMs / 3600000);
  const m = Math.floor((workMs % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type CaptureAction = "checkin" | "break-start" | "break-end" | "checkout";

function AttendanceCapture({
  action,
  claimId,
  onDone,
  onCancel,
  needsPhoto,
}: {
  action: CaptureAction;
  claimId: number;
  onDone: () => void;
  onCancel: () => void;
  needsPhoto: boolean;
}) {
  const { toast } = useToast();
  const [gps, setGps] = useState<{ lat: string; lng: string } | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGpsLoading(true);
    getGPS().then((loc) => {
      setGps(loc);
      setGpsError(!loc);
      setGpsLoading(false);
    });
  }, []);

  const handlePhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await resizeToBase64(file);
      setPhoto(b64);
    } catch {
      toast({ variant: "destructive", title: "Photo capture failed" });
    }
  }, []);

  const labels: Record<CaptureAction, string> = {
    checkin: "Check In",
    "break-start": "Start Break",
    "break-end": "End Break",
    checkout: "Check Out",
  };

  async function confirm() {
    setSubmitting(true);
    try {
      const body: Record<string, string> = {};
      if (gps) { body.lat = gps.lat; body.lng = gps.lng; }
      if (photo) body.photoUrl = photo;

      const res = await fetch(`${BASE_URL}/api/crew/attendance/${claimId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const successLabels: Record<CaptureAction, string> = {
        checkin: "Checked in successfully",
        "break-start": "Break started",
        "break-end": "Break ended — welcome back!",
        checkout: "Checked out successfully",
      };
      toast({ title: successLabels[action] });
      onDone();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message });
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* GPS */}
      <div className="rounded-xl border border-border/60 p-3 space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Location
        </p>
        {gpsLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting your location…
          </p>
        ) : gps ? (
          <p className="text-xs text-emerald-700 font-medium">
            ✓ {gps.lat}, {gps.lng}
          </p>
        ) : (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Location unavailable — will proceed without GPS
          </p>
        )}
      </div>

      {/* Photo */}
      <div className="rounded-xl border border-border/60 p-3 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Photo {needsPhoto ? "" : "(optional)"}
        </p>
        {photo ? (
          <div className="flex items-center gap-3">
            <img src={photo} alt="capture" className="h-16 w-16 rounded-lg object-cover border border-border" />
            <button
              type="button"
              onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-xs text-rose-500 underline"
            >
              Retake
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 text-sm text-primary font-medium border border-primary/30 rounded-xl px-4 py-2 hover:bg-primary/5 transition-colors w-full justify-center"
          >
            <Camera className="w-4 h-4" /> Open Camera
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhoto}
        />
      </div>

      {/* Confirm / Cancel */}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 h-11" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          className="flex-1 h-11 font-semibold"
          onClick={confirm}
          disabled={submitting || gpsLoading}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Confirm {labels[action]}
        </Button>
      </div>
    </div>
  );
}

function AttendanceButtons({ claim, onRefresh }: { claim: Claim; onRefresh: () => void }) {
  const [activeAction, setActiveAction] = useState<CaptureAction | null>(null);

  const isCheckedIn = !!claim.checkedInAt;
  const isCheckedOut = !!claim.checkOutAt;
  const onBreak = !!claim.breakStartAt && !claim.breakEndAt;
  const isAbsent = !!claim.isAbsent;

  function trigger(e: React.MouseEvent, action: CaptureAction) {
    e.stopPropagation();
    setActiveAction(action);
  }

  if (isAbsent) {
    return (
      <div className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-xs font-semibold">
        <UserX className="w-3.5 h-3.5" /> Marked Absent
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Times row */}
      {(isCheckedIn || isCheckedOut) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {isCheckedIn && <span>In: <span className="font-semibold text-foreground">{fmtTime(claim.checkedInAt)}</span></span>}
          {claim.breakStartAt && <span>Break: <span className="font-semibold text-foreground">{fmtTime(claim.breakStartAt)}{claim.breakEndAt ? ` – ${fmtTime(claim.breakEndAt)}` : " (ongoing)"}</span></span>}
          {claim.totalBreakMinutes != null && claim.totalBreakMinutes > 0 && (
            <span>Total break: <span className="font-semibold text-amber-700">{claim.totalBreakMinutes}m</span></span>
          )}
          {isCheckedOut && <span>Out: <span className="font-semibold text-foreground">{fmtTime(claim.checkOutAt)}</span></span>}
          {isCheckedOut && (
            <span>Work: <span className="font-semibold text-emerald-700">{workingHours(claim.checkedInAt, claim.checkOutAt, claim.totalBreakMinutes || 0) || "—"}</span></span>
          )}
        </div>
      )}

      {/* Status badge */}
      {isCheckedOut ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Shift Complete
          </div>
          {claim.attendanceApproved === true && claim.approvedPay != null && (
            <div className={`rounded-xl border px-3 py-2 space-y-1 ${claim.isOverride ? "border-violet-200 bg-violet-50/40" : "border-emerald-200 bg-emerald-50/40"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Final Pay</span>
                <span className={`text-sm font-bold ${claim.isOverride ? "text-violet-700" : "text-emerald-700"}`}>
                  ₹{Number(claim.approvedPay).toLocaleString("en-IN")}
                </span>
              </div>
              {claim.isOverride && claim.overrideReason ? (
                <p className="text-[11px] text-violet-700 leading-snug">
                  <span className="font-semibold">Manual Adjustment:</span> {claim.overrideReason}
                </p>
              ) : null}
            </div>
          )}
          {claim.attendanceApproved === null && claim.checkedInAt && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold">
              Payment pending review
            </div>
          )}
        </div>
      ) : onBreak ? (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 text-xs font-semibold animate-pulse">
          <Coffee className="w-3.5 h-3.5" /> On Break
        </div>
      ) : isCheckedIn ? (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 text-xs font-semibold">
          <Zap className="w-3.5 h-3.5" /> {claim.checkInStatus === "late" ? "Checked In (Late)" : "Checked In"}
        </div>
      ) : null}

      {/* 4 Action Buttons */}
      {!isCheckedOut && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            disabled={isCheckedIn}
            onClick={(e) => trigger(e, "checkin")}
            className={`h-9 text-xs font-semibold gap-1.5 ${!isCheckedIn ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-muted text-muted-foreground"}`}
          >
            <LogIn className="w-3.5 h-3.5" /> Check In
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={!isCheckedIn || isCheckedOut || onBreak}
            onClick={(e) => trigger(e, "break-start")}
            className="h-9 text-xs font-semibold gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40"
          >
            <Coffee className="w-3.5 h-3.5" /> Break Start
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={!onBreak}
            onClick={(e) => trigger(e, "break-end")}
            className="h-9 text-xs font-semibold gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Break End
          </Button>

          <Button
            size="sm"
            disabled={!isCheckedIn || onBreak}
            onClick={(e) => trigger(e, "checkout")}
            className={`h-9 text-xs font-semibold gap-1.5 ${isCheckedIn && !onBreak ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-muted text-muted-foreground"}`}
          >
            <LogOut className="w-3.5 h-3.5" /> Check Out
          </Button>
        </div>
      )}

      {/* Capture Dialog */}
      <Dialog open={activeAction !== null} onOpenChange={(o) => { if (!o) setActiveAction(null); }}>
        <DialogContent className="sm:max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">
              {activeAction === "checkin" && "Check In"}
              {activeAction === "break-start" && "Start Break"}
              {activeAction === "break-end" && "End Break"}
              {activeAction === "checkout" && "Check Out"}
            </DialogTitle>
          </DialogHeader>
          {activeAction && (
            <AttendanceCapture
              action={activeAction}
              claimId={claim.id}
              needsPhoto={activeAction === "checkin" || activeAction === "checkout"}
              onDone={() => { setActiveAction(null); onRefresh(); }}
              onCancel={() => setActiveAction(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppliedAt({ date }: { date: string }) {
  return (
    <p className="text-xs text-muted-foreground mt-0.5">
      Applied {format(new Date(date), "d MMM yyyy")}
    </p>
  );
}

function EventStatusPill({ startDate, endDate }: { startDate?: string | null; endDate?: string | null }) {
  const status = getEventStatus(startDate, endDate);
  if (status === "upcoming") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
      <Timer className="w-2.5 h-2.5" /> Upcoming
    </span>
  );
  if (status === "ongoing") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 animate-pulse">
      <Zap className="w-2.5 h-2.5" /> Live Now
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      <CheckCircle2 className="w-2.5 h-2.5" /> Completed
    </span>
  );
}

function EventCard({
  claim, onDrop, onClick, onRefresh, tab,
}: {
  claim: Claim;
  onDrop?: (id: number) => void;
  onClick?: () => void;
  onRefresh?: () => void;
  tab?: TabKey;
}) {
  const isApproved = claim.status === "approved";
  const isPending = claim.status === "pending";
  const isRejected = claim.status === "rejected" || claim.status === "revoked";
  const dateRange = formatDateRange(claim.eventStartDate, claim.eventEndDate);
  const isCompleted = tab === "completed";
  const isOngoing = tab === "ongoing";
  const showAttendance = isApproved && isOngoing && !!onRefresh;
  const cardClickable = !!onClick && !isCompleted;

  const workDuration = workingHours(claim.checkedInAt, claim.checkOutAt, claim.totalBreakMinutes || 0);
  const hasPay = claim.attendanceApproved === true && claim.approvedPay != null;
  const payPending = isApproved && claim.checkedInAt && claim.checkOutAt && !hasPay;

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all duration-200 ${
        isCompleted
          ? "border-slate-200 bg-slate-50/40"
          : isApproved
          ? "border-emerald-200 bg-emerald-50/30 hover:shadow-md hover:border-emerald-300"
          : isRejected
          ? "border-rose-100 bg-rose-50/20 opacity-80"
          : "border-border/60 bg-card"
      } ${cardClickable ? "cursor-pointer active:scale-[0.99]" : ""}`}
      onClick={cardClickable ? onClick : undefined}
    >
      {/* Header banner */}
      {isCompleted ? (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-500 text-white text-xs font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Event Completed
        </div>
      ) : isApproved ? (
        <div className="flex items-center justify-between px-4 py-2 bg-emerald-500 text-white text-xs font-semibold">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Confirmed Shift — You're In!
          </span>
          <div className="flex items-center gap-2">
            <EventStatusPill startDate={claim.eventStartDate} endDate={claim.eventEndDate} />
            {!showAttendance && <ChevronRight className="w-3.5 h-3.5 opacity-70" />}
          </div>
        </div>
      ) : isPending ? (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-400 text-white text-xs font-semibold">
          <Clock4 className="w-3.5 h-3.5" />
          Application Pending Review
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-400 text-white text-xs font-semibold">
          <XCircle className="w-3.5 h-3.5" />
          Not Selected for This Event
        </div>
      )}

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-bold text-base text-foreground leading-tight">{claim.eventTitle}</h3>
          <p className="text-sm font-medium text-primary mt-0.5">{claim.shiftRole}</p>
          {!isApproved && <AppliedAt date={claim.claimedAt} />}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {dateRange && (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              {dateRange}
              {claim.eventDays && claim.eventDays > 1 && (
                <span className="text-xs text-muted-foreground/70">({claim.eventDays} days)</span>
              )}
            </span>
          )}
          {!isCompleted && (claim.eventExpectedCheckIn || claim.eventExpectedCheckOut) && (
            <span className="flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 shrink-0" />
              {[claim.eventExpectedCheckIn, claim.eventExpectedCheckOut].filter(Boolean).join(" – ")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {claim.totalPay > 0 && !isCompleted && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
              <IndianRupee className="w-3 h-3" />
              {claim.totalPay.toLocaleString("en-IN")}
              {claim.eventDays && claim.eventDays > 1 && claim.eventPayPerDay ? ` (₹${claim.eventPayPerDay.toLocaleString("en-IN")}/day)` : ""}
            </span>
          )}
          {claim.eventFoodProvided && !isCompleted && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
              🍽 Food Provided{claim.eventMealsProvided ? ` – ${claim.eventMealsProvided}` : ""}
            </span>
          )}
        </div>

        {/* Completed tab: work duration + payment status */}
        {isCompleted && isApproved && (
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {workDuration && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5" /> Work Duration
                </span>
                <span className="text-xs font-bold text-foreground">{workDuration}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <IndianRupee className="w-3.5 h-3.5" /> Payment
              </span>
              {hasPay ? (
                <span className="text-xs font-bold text-emerald-700">
                  ₹{Number(claim.approvedPay).toLocaleString("en-IN")} — Paid
                </span>
              ) : payPending ? (
                <span className="text-xs font-semibold text-amber-600">Pending</span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </div>
        )}

        {/* Attendance for ongoing tab */}
        {showAttendance && (
          <AttendanceButtons claim={claim} onRefresh={onRefresh!} />
        )}

        {/* Withdraw only for upcoming pending */}
        {isPending && !isCompleted && onDrop && (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-8 px-3 text-xs w-full mt-1"
            onClick={(e) => { e.stopPropagation(); onDrop(claim.shiftId); }}
          >
            Withdraw Application
          </Button>
        )}
      </div>
    </div>
  );
}

type TabKey = "ongoing" | "completed" | "applied" | "cancelled";

const TAB_CONFIG: { key: TabKey; label: string; emptyMsg: string }[] = [
  { key: "applied",   label: "Applied",    emptyMsg: "No applied events yet." },
  { key: "cancelled", label: "Cancelled/\nRejected",  emptyMsg: "No cancelled or rejected events." },
  { key: "ongoing",   label: "Ongoing",    emptyMsg: "No ongoing events." },
  { key: "completed", label: "Completed",  emptyMsg: "No completed events." },
];

const TAB_COLORS: Record<TabKey, { badge: string; dot: string }> = {
  ongoing:   { badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500 animate-pulse" },
  completed: { badge: "bg-slate-100 text-slate-600",     dot: "bg-slate-400" },
  applied:   { badge: "bg-amber-100 text-amber-700",     dot: "bg-amber-400" },
  cancelled: { badge: "bg-rose-100 text-rose-700",       dot: "bg-rose-500" },
};

function CancelledRejectedContent({
  claims, onDrop,
}: {
  claims: Claim[];
  onDrop: (shiftId: number) => void;
}) {
  const [subTab, setSubTab] = useState<"cancelled" | "rejected">("cancelled");
  const cancelled = claims.filter(c => c.status === "revoked");
  const rejected  = claims.filter(c => c.status === "rejected");
  const active    = subTab === "cancelled" ? cancelled : rejected;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        {(["cancelled", "rejected"] as const).map(key => {
          const count = key === "cancelled" ? cancelled.length : rejected.length;
          const isActive = subTab === key;
          return (
            <button
              key={key}
              onClick={() => setSubTab(key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                isActive
                  ? key === "cancelled"
                    ? "bg-rose-600 text-white border-rose-600"
                    : "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-muted-foreground border-border hover:border-foreground/30"
              }`}
            >
              {key === "cancelled" ? "Cancelled" : "Rejected"}
              {count > 0 && (
                <span className={`text-[10px] font-bold px-1 rounded-full ${isActive ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tab description */}
      <p className="text-xs text-muted-foreground">
        {subTab === "cancelled"
          ? "Events you withdrew from, no-shows, or shifts removed by admin."
          : "Applications that were not selected for the event."}
      </p>

      {active.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-2xl border border-dashed flex flex-col items-center gap-2">
          <ClipboardList className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {subTab === "cancelled" ? "No cancelled events." : "No rejected applications."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(c => (
            <CancelledCard key={c.id} claim={c} type={subTab} />
          ))}
        </div>
      )}
    </div>
  );
}

function CancelledCard({ claim, type }: { claim: Claim; type: "cancelled" | "rejected" }) {
  const dateRange = formatDateRange(claim.eventStartDate, claim.eventEndDate);
  const isCancelled = type === "cancelled";

  const defaultReason = isCancelled ? "Shift withdrawn" : "Position filled";
  const reason = (claim as any).reason || defaultReason;

  return (
    <div className={`rounded-xl border overflow-hidden ${isCancelled ? "border-rose-100 bg-rose-50/30" : "border-orange-100 bg-orange-50/20"}`}>
      <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold ${isCancelled ? "bg-rose-500 text-white" : "bg-orange-400 text-white"}`}>
        {isCancelled ? <XCircle className="w-3 h-3" /> : <Clock4 className="w-3 h-3" />}
        {isCancelled ? "Cancelled" : "Rejected"}
      </div>
      <div className="px-3 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-sm text-foreground leading-tight truncate">{claim.eventTitle}</p>
          <p className="text-xs text-primary font-medium">{claim.shiftRole}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
            {(claim.eventCity || claim.eventLocation) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {claim.eventCity || claim.eventLocation}
              </span>
            )}
            {dateRange && (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> {dateRange}
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap mt-0.5 ${
          isCancelled ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"
        }`}>
          {reason}
        </span>
      </div>
    </div>
  );
}

export default function MyShifts() {
  const { data: shifts, isLoading, refetch } = useGetMyShifts({
    query: { queryKey: getGetMyShiftsQueryKey(), refetchInterval: 30_000 },
  });
  const unclaimMutation = useUnclaimShift();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dropShiftId, setDropShiftId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab") as TabKey | null;
  const validTabs: TabKey[] = ["ongoing", "completed", "applied", "cancelled"];
  const activeTab: TabKey = tabParam && validTabs.includes(tabParam) ? tabParam : "ongoing";
  const setActiveTab = (tab: TabKey) => navigate(`/my-shifts?tab=${tab}`);

  const prevStatuses = useRef<Record<number, string>>({});
  useEffect(() => {
    if (!shifts) return;
    shifts.forEach((claim: Claim) => {
      const prev = prevStatuses.current[claim.id];
      if (prev && prev !== claim.status && claim.status === "approved") {
        toast({
          title: "Application Approved! 🎉",
          description: `You've been confirmed for ${claim.eventTitle}.`,
        });
      }
      prevStatuses.current[claim.id] = claim.status;
    });
  }, [shifts]);

  const confirmUnclaim = () => {
    if (dropShiftId === null) return;
    unclaimMutation.mutate({ id: dropShiftId }, {
      onSuccess: () => {
        toast({ title: "Application withdrawn" });
        setDropShiftId(null);
        queryClient.invalidateQueries({ queryKey: [`/api/crew/shifts`] });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Failed to withdraw application" });
        setDropShiftId(null);
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1, 2].map(i => (
          <div key={i} className="h-36 rounded-2xl bg-muted/50" />
        ))}
      </div>
    );
  }

  const allClaims: Claim[] = shifts || [];

  // Partition claims into 4 tabs
  const byTab: Record<TabKey, Claim[]> = { ongoing: [], completed: [], applied: [], cancelled: [] };

  allClaims.forEach(c => {
    if (c.status === "rejected" || c.status === "revoked") {
      byTab.cancelled.push(c);
      return;
    }
    if (c.status === "pending") {
      byTab.applied.push(c);
      return;
    }
    // approved claims → time-based
    const evtStatus = getEventStatus(c.eventStartDate, c.eventEndDate);
    if (evtStatus === "completed") {
      byTab.completed.push(c);
    } else {
      byTab.ongoing.push(c);
    }
  });

  const tabClaims = byTab[activeTab];

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Event Status</h1>
        <p className="text-[13px] text-muted-foreground/70 mt-1">Track your ongoing, completed &amp; cancelled/rejected events</p>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-2">
        {TAB_CONFIG.map(({ key, label }) => {
          const count = byTab[key].length;
          const isActive = activeTab === key;
          const colors = TAB_COLORS[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`w-full min-w-0 overflow-hidden flex flex-col items-center justify-center gap-1 px-1 py-2.5 rounded-2xl text-[10px] font-semibold transition-all duration-200 border leading-tight text-center break-words ${
                isActive
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot} ${!isActive ? "opacity-60" : ""}`} />
              <span className="w-full text-center whitespace-pre-line">{label}</span>
              {count > 0 && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${isActive ? "bg-white/20 text-white" : colors.badge}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "cancelled" ? (
        <CancelledRejectedContent
          claims={tabClaims}
          onDrop={(shiftId) => setDropShiftId(shiftId)}
        />
      ) : tabClaims.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-3xl border border-dashed flex flex-col items-center gap-3">
          <ClipboardList className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">
            {TAB_CONFIG.find(t => t.key === activeTab)!.emptyMsg}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tabClaims.map(c => (
            <EventCard
              key={c.id}
              claim={c}
              tab={activeTab}
              onClick={activeTab === "ongoing" && c.status === "approved"
                ? () => navigate(`/shifts/${c.shiftId}?from=my-shifts`)
                : undefined}
              onDrop={activeTab === "applied"
                ? (shiftId) => setDropShiftId(shiftId)
                : undefined}
              onRefresh={activeTab === "ongoing" ? () => refetch() : undefined}
            />
          ))}
        </div>
      )}

      <AlertDialog open={dropShiftId !== null} onOpenChange={(o) => { if (!o) setDropShiftId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to withdraw your application? You may not be able to re-apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Application</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={confirmUnclaim}
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
