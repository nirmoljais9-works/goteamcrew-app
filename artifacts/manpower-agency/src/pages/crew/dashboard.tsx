import { useGetCrewProfile, useGetMyShifts, useGetMyEarnings, useGetShifts, getGetMyShiftsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMobileMenu } from "@/components/layout/app-layout";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  CalendarDays, MapPin, Clock, LogIn, Coffee, LogOut, RefreshCw,
  Camera, Loader2, AlertCircle, CheckCircle2, ShieldX,
  IndianRupee, Briefcase, ChevronRight, Gift, Users, Sparkles,
  ArrowRight, TrendingUp, Wallet, UserCheck, Search, Star,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function getEffectivePay(s: any, profile: any): number | null {
  const payPerDay = s.eventPayPerDay != null ? parseFloat(s.eventPayPerDay) : null;
  const payFemale = s.eventPayFemale != null ? parseFloat(s.eventPayFemale) : null;
  const payMale = s.eventPayMale != null ? parseFloat(s.eventPayMale) : null;
  const payFresher = s.eventPayFresher != null ? parseFloat(s.eventPayFresher) : null;
  if (!payFemale && !payMale && !payFresher) return payPerDay;
  const gender = ((profile as any)?.gender || "").toLowerCase();
  const isFresher = ((profile as any)?.experienceLevel || "").toLowerCase() === "fresher";
  if (isFresher && payFresher) return payFresher;
  if (gender === "female" && payFemale) return payFemale;
  if (gender === "male" && payMale) return payMale;
  return payPerDay;
}

const ROLE_COLORS: Record<string, string> = {
  Model:    "bg-pink-50 text-pink-700 border-pink-200",
  Hostess:  "bg-violet-50 text-violet-700 border-violet-200",
  Promoter: "bg-blue-50 text-blue-700 border-blue-200",
  Anchor:   "bg-amber-50 text-amber-700 border-amber-200",
  Crew:     "bg-slate-50 text-slate-600 border-slate-200",
  Emcee:    "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type CaptureAction = "checkin" | "break-start" | "break-end" | "checkout";

async function getGPS(): Promise<{ lat: string; lng: string } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        resolve({ lat, lng });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function fetchFreshClaim(claimId: number): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/crew/shifts`, { credentials: "include" });
    if (!res.ok) return null;
    const list: any[] = await res.json();
    return list.find((c) => c.id === claimId) ?? null;
  } catch { return null; }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function istDateStr(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function getEventStatus(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate) return "upcoming";
  try {
    const todayIST = istDateStr(new Date());
    const startIST = istDateStr(startDate);
    const endIST   = endDate ? istDateStr(endDate) : startIST;
    if (todayIST < startIST) return "upcoming";
    if (todayIST > endIST)   return "completed";
    return "ongoing";
  } catch { return "upcoming"; }
}

function formatTime12h(t: string | null | undefined) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ap}`;
}

// ── Profile Strength ───────────────────────────────────────────────────────────
function calcStrength(profile: any): number {
  if (!profile) return 0;
  const photos: string[] = (() => {
    try { return JSON.parse(profile.portfolioPhotos || "[]"); } catch { return []; }
  })();
  let score = 0;
  // Basic Info — 20%
  const basic = [!!profile.name, !!profile.phone, !!profile.email, !!profile.city, !!profile.gender];
  score += (basic.filter(Boolean).length / basic.length) * 20;
  // Portfolio Photos — 30%
  if (photos.length >= 8) score += 30;
  else if (photos.length >= 4) score += 20;
  else if (photos.length >= 1) score += 10;
  // Documents — 30%
  if (profile.panNumber) score += 15;
  if (profile.payHolderName && profile.payAccountNumber) score += 15;
  // Additional Info — 20%
  const add = [!!profile.category, !!profile.languages, !!profile.experience, !!profile.age];
  score += (add.filter(Boolean).length / add.length) * 20;
  return Math.round(score);
}

// ── AttendanceCaptureDialog ────────────────────────────────────────────────────
function AttendanceCaptureDialog({
  open, action, claimId, onDone, onClose,
}: {
  open: boolean; action: CaptureAction; claimId: number;
  onDone: () => void; onClose: () => void;
}) {
  const { toast } = useToast();
  const [gps, setGps] = useState<{ lat: string; lng: string } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState(false);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const freshClaimRef = useRef<any>(null);

  const fetchLocation = useCallback(() => {
    setGps(null); setGpsError(false); setGpsLoading(true);
    setDistanceMeters(null); setShowWarning(false);
    Promise.all([
      getGPS(),
      freshClaimRef.current ? Promise.resolve(freshClaimRef.current) : fetchFreshClaim(claimId),
    ]).then(([loc, freshClaim]) => {
      freshClaimRef.current = freshClaim;
      setGps(loc); setGpsError(!loc); setGpsLoading(false);
      const eLat = freshClaim?.eventLatitude ?? null;
      const eLng = freshClaim?.eventLongitude ?? null;
      if (loc && eLat && eLng) {
        const dist = Math.round(haversineMeters(parseFloat(eLat), parseFloat(eLng), parseFloat(loc.lat), parseFloat(loc.lng)));
        setDistanceMeters(dist);
        if (dist > 1000) setShowWarning(true);
      }
    });
  }, [claimId]);

  useEffect(() => {
    if (!open) { freshClaimRef.current = null; return; }
    setPhoto(null); setSubmitting(false);
    fetchLocation();
  }, [open]);

  const handlePhoto = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await resizeToBase64(file)); }
    catch { toast({ variant: "destructive", title: "Photo capture failed" }); }
  }, []);

  const labels: Record<CaptureAction, string> = {
    checkin: "Check In", "break-start": "Start Break", "break-end": "End Break", checkout: "Check Out",
  };

  async function confirm() {
    setSubmitting(true);
    try {
      const body: Record<string, any> = {};
      if (gps) { body.lat = gps.lat; body.lng = gps.lng; }
      if (photo) body.photoUrl = photo;
      if (distanceMeters != null) body.distanceFromEvent = distanceMeters;
      const res = await fetch(`${BASE_URL}/api/crew/attendance/${claimId}/${action}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const msgs: Record<CaptureAction, string> = {
        checkin: "Checked in successfully!", "break-start": "Break started",
        "break-end": "Break ended — welcome back!", checkout: "Checked out successfully!",
      };
      toast({ title: msgs[action] });
      onDone();
    } catch (err: any) {
      toast({ variant: "destructive", title: err.message });
      setSubmitting(false);
    }
  }

  const isFar = distanceMeters != null && distanceMeters > 1000;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-display font-bold">{labels[action]}</DialogTitle>
        </DialogHeader>
        {showWarning ? (
          <div className="space-y-3 pt-1">
            <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-500 shrink-0" />
                <p className="text-sm font-bold text-orange-800">You are far from the event location</p>
              </div>
              <p className="text-sm text-orange-700">
                You are <span className="font-bold">{(distanceMeters! / 1000).toFixed(1)} km</span> away. Your attendance may be flagged.
              </p>
              {gps && <p className="text-[11px] text-orange-500 font-mono">Your GPS: {gps.lat}, {gps.lng}</p>}
              <p className="text-xs text-orange-600">Attendance will not be blocked — you can still continue.</p>
            </div>
            <button onClick={fetchLocation} disabled={gpsLoading}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-primary border border-primary/30 rounded-2xl h-10 hover:bg-primary/5 disabled:opacity-50">
              {gpsLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Refreshing…</> : <><RefreshCw className="w-4 h-4" /> Refresh My Location</>}
            </button>
            <Button onClick={() => setShowWarning(false)} disabled={gpsLoading}
              className="w-full h-12 rounded-2xl text-base font-bold bg-orange-500 hover:bg-orange-600 text-white">Continue Anyway</Button>
            <Button variant="ghost" onClick={onClose} disabled={gpsLoading} className="w-full rounded-2xl text-muted-foreground">Cancel</Button>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className={`rounded-2xl border p-3 space-y-1 ${isFar ? "border-orange-300 bg-orange-50/40" : "border-border/60 bg-muted/30"}`}>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Location
              </p>
              {gpsLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching location…</p>
              ) : gps ? (
                isFar ? (
                  <p className="text-xs text-orange-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Outside location — {distanceMeters! >= 1000 ? `${(distanceMeters! / 1000).toFixed(1)} km` : `${distanceMeters}m`} from venue
                  </p>
                ) : distanceMeters != null ? (
                  <p className="text-xs text-emerald-700 font-semibold">✅ Within location — {distanceMeters < 1000 ? `${distanceMeters}m` : `${(distanceMeters / 1000).toFixed(1)} km`} from venue</p>
                ) : (
                  <p className="text-xs text-sky-700 font-semibold">✓ GPS captured (venue coordinates not set)</p>
                )
              ) : (
                <p className="text-xs text-amber-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> No GPS — will proceed without</p>
              )}
            </div>
            <div className={`rounded-2xl border p-3 space-y-2 ${action === "checkin" && !photo ? "border-rose-300 bg-rose-50/40" : "border-border/60 bg-muted/30"}`}>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                {action === "checkin" ? <span>Selfie <span className="text-rose-500">*required</span></span> : "Selfie (optional)"}
              </p>
              {photo ? (
                <div className="flex items-center gap-3">
                  <img src={photo} alt="selfie" className="h-16 w-16 rounded-xl object-cover border border-border" />
                  <button type="button" onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="text-xs text-rose-500 underline">Retake</button>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 text-sm text-primary font-medium border border-primary/30 rounded-xl px-4 py-2 hover:bg-primary/5 w-full justify-center">
                    <Camera className="w-4 h-4" /> Take Selfie
                  </button>
                  {action === "checkin" && <p className="text-[11px] text-rose-500 font-medium text-center">Take a selfie to verify your identity</p>}
                </>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handlePhoto} />
            </div>
            <Button onClick={confirm} disabled={submitting || gpsLoading || (action === "checkin" && !photo)}
              className="w-full h-13 rounded-2xl text-base font-bold">
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : gpsLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Fetching location…</> : labels[action]}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={submitting} className="w-full rounded-2xl text-muted-foreground">Cancel</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── TodayEventCard ────────────────────────────────────────────────────────────
function TodayEventCard({ claim, onRefresh }: { claim: any; onRefresh: () => void }) {
  const [captureAction, setCaptureAction] = useState<CaptureAction | null>(null);
  const checkedIn  = !!claim.checkedInAt;
  const onBreak    = checkedIn && !!claim.breakStartAt && !claim.breakEndAt;
  const checkedOut = !!claim.checkOutAt;

  const statusLabel = checkedOut ? "Checked Out" : onBreak ? "On Break" : checkedIn ? "Working" : "Not Checked In";
  const statusColor = checkedOut ? "bg-slate-100 text-slate-600" : onBreak ? "bg-amber-100 text-amber-700" : checkedIn ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600";

  return (
    <>
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-3xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-display font-bold leading-tight">{claim.eventTitle}</h2>
          <span className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ml-2 ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="space-y-1 mb-4">
          {(claim.eventExpectedCheckIn || claim.eventExpectedCheckOut) && (
            <p className="text-sm text-white/80">
              {[formatTime12h(claim.eventExpectedCheckIn), formatTime12h(claim.eventExpectedCheckOut)].filter(Boolean).join(" – ")}
            </p>
          )}
          {claim.checkedInAt && (
            <p className="text-sm text-white/80">
              Checked in: {format(new Date(claim.checkedInAt), "hh:mm a")}
              {claim.checkInStatus === "late" && <span className="ml-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-400/30 text-orange-100 border border-orange-300/40">(Late)</span>}
              {claim.checkInStatus === "on-time" && <span className="ml-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-400/30 text-emerald-100 border border-emerald-300/40">(On Time)</span>}
            </p>
          )}
          {claim.checkOutAt && (
            <p className="text-sm text-white/80">
              Checked out: {format(new Date(claim.checkOutAt), "hh:mm a")}
              {claim.checkOutStatus === "early" && <span className="ml-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-400/30 text-sky-100 border border-sky-300/40">(Early)</span>}
            </p>
          )}
        </div>
        {!checkedOut && (
          <div className="flex gap-2 flex-wrap">
            {!checkedIn && (
              <button onClick={() => setCaptureAction("checkin")}
                className="flex-1 flex items-center justify-center gap-2 bg-white text-indigo-700 font-bold rounded-2xl h-12 text-sm shadow-md active:scale-95 transition-transform">
                <LogIn className="w-4 h-4" /> Check In
              </button>
            )}
            {checkedIn && !onBreak && (
              <button onClick={() => setCaptureAction("break-start")}
                className="flex-1 flex items-center justify-center gap-2 bg-white/20 text-white font-semibold rounded-2xl h-12 text-sm border border-white/30 active:scale-95 transition-transform">
                <Coffee className="w-4 h-4" /> Break
              </button>
            )}
            {onBreak && (
              <button onClick={() => setCaptureAction("break-end")}
                className="flex-1 flex items-center justify-center gap-2 bg-amber-400 text-amber-900 font-bold rounded-2xl h-12 text-sm shadow-md active:scale-95 transition-transform">
                <RefreshCw className="w-4 h-4" /> End Break
              </button>
            )}
            {checkedIn && !onBreak && (
              <button onClick={() => setCaptureAction("checkout")}
                className="flex-1 flex items-center justify-center gap-2 bg-white/20 text-white font-semibold rounded-2xl h-12 text-sm border border-white/30 active:scale-95 transition-transform">
                <LogOut className="w-4 h-4" /> Check Out
              </button>
            )}
          </div>
        )}
        {checkedOut && (
          <div className="bg-white/15 rounded-2xl p-3 text-center">
            <p className="text-sm font-semibold text-white">Great work today! See you next time. 🎉</p>
          </div>
        )}
      </div>
      {captureAction && (
        <AttendanceCaptureDialog
          open={!!captureAction} action={captureAction} claimId={claim.id}
          onDone={() => { setCaptureAction(null); onRefresh(); }}
          onClose={() => setCaptureAction(null)}
        />
      )}
    </>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function CrewDashboard() {
  const [, setLocation] = useLocation();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile, isLoading: pLoading } = useGetCrewProfile();
  const { data: shifts,  isLoading: sLoading  } = useGetMyShifts({
    query: { queryKey: getGetMyShiftsQueryKey(), staleTime: 0, refetchOnMount: "always", refetchInterval: 15_000 },
  });
  const { data: earnings, isLoading: eLoading } = useGetMyEarnings();
  const [stickyAction, setStickyAction] = useState<CaptureAction | null>(null);
  const sidebarOpen = useMobileMenu();

  // Open shifts — same source as Browse Events page
  const { data: openShiftsData, isLoading: oLoading } = useGetShifts({ status: "open", query: { refetchInterval: 30_000 } } as any);

  // Referral wallet
  const [referralData, setReferralData] = useState<any>(null);
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [avatarImgError, setAvatarImgError] = useState(false);

  useEffect(() => {
    fetch(`${BASE_URL}/api/crew/referrals`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(refs => { setReferralData(refs); setLoadingExtra(false); });
  }, []);

  const refetchShifts = () => queryClient.invalidateQueries({ queryKey: ["/api/crew/shifts"] });

  if (pLoading || sLoading || eLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground font-medium">Loading your dashboard…</p>
      </div>
    );
  }

  const allClaims = (shifts || []) as any[];
  const todayIST  = istDateStr(new Date());

  const todayEvent = allClaims.find(s =>
    s.status === "approved" && getEventStatus(s.eventStartDate, s.eventEndDate) === "ongoing"
  ) || null;

  const appliedClaims   = allClaims.filter(s => s.status === "applied" || s.status === "pending");
  const upcomingShifts  = allClaims.filter(s => s.status === "approved" && getEventStatus(s.eventStartDate, s.eventEndDate) === "upcoming");
  // Same filter as Browse Events: open shifts the crew hasn't applied to, not yet started
  const _now = new Date();
  const hotOpportunities = ((openShiftsData as any[]) || [])
    .filter(s => {
      if (s.status !== "open" || s.claimedByMe) return false;
      const eventStart = s.eventStartDate || s.startTime;
      if (eventStart && new Date(eventStart) <= _now) return false;
      return true;
    })
    .slice(0, 2);

  const todayCheckedIn  = !!todayEvent?.checkedInAt && (!todayEvent.attendanceDate || todayEvent.attendanceDate === todayIST);
  const todayOnBreak    = todayCheckedIn && !!todayEvent?.breakStartAt && !todayEvent?.breakEndAt;
  const todayCheckedOut = !!todayEvent?.checkOutAt;

  const stickyActionLabel: CaptureAction | null = !todayEvent ? null
    : todayCheckedOut ? null
    : todayOnBreak    ? "break-end"
    : todayCheckedIn  ? "checkout"
    : "checkin";

  const stickyLabels: Record<CaptureAction, string> = {
    checkin: "Check In Now", "break-start": "Start Break", "break-end": "End Break", checkout: "Check Out",
  };
  const stickyIcons: Record<CaptureAction, any> = {
    checkin: LogIn, "break-start": Coffee, "break-end": RefreshCw, checkout: LogOut,
  };

  // Profile strength
  const strength = calcStrength(profile);
  const strengthColor = strength < 40 ? "bg-red-400" : strength < 70 ? "bg-amber-400" : "bg-emerald-500";
  const strengthLabel = strength < 40 ? "Needs attention" : strength < 70 ? "Good" : strength < 90 ? "Strong" : "Complete ✓";

  // Roles from comma-separated category
  const roles = profile?.category
    ? profile.category.split(",").map((r: string) => r.trim()).filter(Boolean)
    : [];

  // Money
  const totalPaid    = parseFloat((earnings?.totalPaid ?? earnings?.paidPayments ?? 0).toString()).toFixed(0);
  const pendingMoney = parseFloat((earnings?.pendingPayments ?? 0).toString()).toFixed(0);
  const walletBal    = parseFloat((referralData?.walletBalance ?? "0").toString()).toFixed(0);

  return (
    <div className="space-y-5 pb-32">

      {/* ── HEADER CARD ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-sidebar rounded-[2rem] p-5 md:p-7 relative overflow-hidden shadow-xl text-sidebar-foreground"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3 pointer-events-none" />

        <div className="relative z-10 flex items-start gap-4">
          {/* Avatar */}
          {profile?.closeUpPhotoUrl && !avatarImgError ? (
            <img src={profile.closeUpPhotoUrl} alt="Profile"
              onError={() => setAvatarImgError(true)}
              className="w-[72px] h-[72px] rounded-2xl object-cover border-2 border-white/20 shadow-lg shrink-0" />
          ) : (
            <div className="w-[72px] h-[72px] rounded-2xl bg-sidebar-primary/20 flex items-center justify-center text-sidebar-primary font-display font-bold text-3xl border-2 border-white/10 shadow-lg shrink-0">
              {profile?.name?.charAt(0) ?? "?"}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-0.5">Welcome back</p>
                <h1 className="text-xl font-display font-bold leading-tight">
                  {profile?.name?.split(" ")[0] ?? currentUser?.name}!
                </h1>
              </div>
              <StatusBadge status={profile?.status || "pending"} />
            </div>

            {/* Role tags */}
            {roles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {roles.map((role: string) => (
                  <span key={role}
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/15 text-white/90 border border-white/20">
                    {role}
                  </span>
                ))}
                {profile?.city && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/10 text-white/70 border border-white/15">
                    <MapPin className="w-2.5 h-2.5" /> {profile.city}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Profile Strength */}
        <div className="relative z-10 mt-4 bg-white/10 rounded-2xl px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-white/80">Profile Strength</p>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              strength < 40 ? "bg-red-400/30 text-red-100" :
              strength < 70 ? "bg-amber-400/30 text-amber-100" :
              "bg-emerald-400/30 text-emerald-100"
            }`}>{strength}% — {strengthLabel}</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${strengthColor}`} style={{ width: `${strength}%` }} />
          </div>
          {strength < 80 && (
            <button onClick={() => setLocation("/profile")}
              className="text-[11px] font-semibold text-white/70 hover:text-white underline underline-offset-2 transition-colors">
              Complete your profile → Better chances of getting shortlisted in events
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="relative z-10 flex gap-2 mt-4">
          <button onClick={() => setLocation("/profile")}
            className="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 border border-white/20 text-white px-3 py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5">
            <Star className="w-3.5 h-3.5" /> Edit Profile
          </button>
          <button onClick={() => setLocation("/shifts")}
            className="flex-1 text-xs font-semibold bg-white text-sidebar hover:bg-white/90 px-3 py-2 rounded-xl transition-colors font-bold flex items-center justify-center gap-1.5 shadow-md">
            <Search className="w-3.5 h-3.5" /> Browse Events
          </button>
        </div>
      </motion.div>

      {/* ── ACCOUNT ALERTS ───────────────────────────────────────────────────── */}
      {profile?.status === "blacklisted" && (
        <div className="bg-red-50 border border-red-300 rounded-2xl p-4 flex items-start gap-3">
          <ShieldX className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-900 text-sm">Account Restricted</h3>
            <p className="text-red-800 text-xs mt-0.5">You cannot apply for new events. You can still view earnings.</p>
          </div>
        </div>
      )}
      {profile?.status === "pending" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-amber-900 text-sm">Application Under Review</h3>
            <p className="text-amber-800 text-xs mt-0.5">Pending admin approval. We'll notify you on WhatsApp once reviewed.</p>
          </div>
        </div>
      )}

      {/* ── TODAY'S EVENT ─────────────────────────────────────────────────────── */}
      {todayEvent ? (
        <TodayEventCard claim={todayEvent} onRefresh={refetchShifts} />
      ) : (
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-indigo-100 rounded-3xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
            <CalendarDays className="w-6 h-6 text-indigo-500" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-foreground">No event today</p>
            <p className="text-xs text-muted-foreground mt-0.5">Find your next opportunity below</p>
          </div>
          <Link href="/shifts">
            <button className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl flex items-center gap-1">
              Browse <ArrowRight className="w-3 h-3" />
            </button>
          </Link>
        </div>
      )}

      {/* ── EARNINGS SECTION ─────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Link href="/earnings">
          <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-3xl p-5 text-white shadow-lg cursor-pointer active:scale-[0.98] transition-transform">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-white/80" />
                <p className="text-sm font-bold text-white/80 uppercase tracking-wide">My Earnings</p>
              </div>
              <ChevronRight className="w-5 h-5 text-white/60" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/15 rounded-2xl p-4">
                <p className="text-xs font-semibold text-white/70 mb-1">Total Received</p>
                <p className="text-2xl font-display font-bold">₹{parseInt(totalPaid).toLocaleString("en-IN")}</p>
                <div className="flex items-center gap-1 mt-1">
                  <TrendingUp className="w-3 h-3 text-emerald-200" />
                  <p className="text-[11px] text-white/60">{earnings?.completedShifts || 0} jobs done</p>
                </div>
              </div>
              <div className="bg-white/10 rounded-2xl p-4 border border-white/20 border-dashed">
                <p className="text-xs font-semibold text-white/70 mb-1">Pending</p>
                <p className="text-2xl font-display font-bold text-amber-200">₹{parseInt(pendingMoney).toLocaleString("en-IN")}</p>
                <p className="text-[11px] text-white/60 mt-1">To be released</p>
              </div>
            </div>
          </div>
        </Link>
      </motion.div>

      {/* ── REFER & EARN ─────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <Link href="/referrals">
          <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-3xl p-5 text-white shadow-lg cursor-pointer active:scale-[0.98] transition-transform">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-bold text-white">Refer & Earn</p>
                  <p className="text-xs text-white/70 mt-0.5">Invite friends — earn per referral</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white/60" />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="bg-white/15 rounded-2xl p-3 text-center">
                <p className="text-lg font-display font-bold">₹{parseInt(walletBal).toLocaleString("en-IN")}</p>
                <p className="text-[10px] text-white/60 mt-0.5">Wallet</p>
              </div>
              <div className="bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-lg font-display font-bold">{referralData?.totalReferrals ?? 0}</p>
                <p className="text-[10px] text-white/60 mt-0.5">Referred</p>
              </div>
              <div className="bg-white/10 rounded-2xl p-3 text-center">
                <p className="text-lg font-display font-bold text-emerald-300">{referralData?.successfulReferrals ?? 0}</p>
                <p className="text-[10px] text-white/60 mt-0.5">Successful</p>
              </div>
            </div>
          </div>
        </Link>
      </motion.div>

      {/* ── HOT OPPORTUNITIES ────────────────────────────────────────────────── */}
      {!oLoading && hotOpportunities.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-orange-100 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-orange-500" />
              </div>
              <h2 className="text-base font-display font-bold text-foreground">Open Opportunities</h2>
            </div>
            <Link href="/shifts">
              <button className="text-xs font-semibold text-primary flex items-center gap-0.5">
                See All <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
          <div className="space-y-3">
            {hotOpportunities.map((shift: any, i: number) => {
              const payPerDay = getEffectivePay(shift, profile);
              const startDate = shift.eventStartDate ? new Date(shift.eventStartDate) : (shift.startTime ? new Date(shift.startTime) : null);
              const city = shift.eventCity || (shift.eventLocation ? shift.eventLocation.split(",")[0].trim() : null);
              const role = shift.eventRole || shift.role;
              const genderReq = shift.eventGenderRequired || shift.genderPreference;
              const eligible = !genderReq || genderReq === "both" || genderReq === "Both" || genderReq === "any"
                || !profile?.gender
                || profile.gender.toLowerCase() === genderReq.toLowerCase();
              const genderLabel = genderReq && genderReq !== "both" && genderReq !== "any"
                ? `${genderReq.charAt(0).toUpperCase()}${genderReq.slice(1).toLowerCase()} only`
                : null;
              return (
                <motion.div key={shift.id}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.14 + i * 0.05 }}
                  className="bg-card border border-border/60 rounded-2xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-150"
                >
                  {/* Date badge */}
                  <div className="bg-primary/5 border border-primary/10 rounded-xl p-2.5 text-center min-w-[48px] shrink-0">
                    {startDate ? (
                      <>
                        <p className="text-[10px] font-bold text-primary uppercase">{format(startDate, "MMM")}</p>
                        <p className="text-xl font-display font-bold text-foreground leading-none">{format(startDate, "dd")}</p>
                      </>
                    ) : (
                      <CalendarDays className="w-5 h-5 text-muted-foreground mx-auto" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm leading-tight line-clamp-1">{shift.eventTitle}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {city && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" /> {city}
                        </span>
                      )}
                      {role && (
                        <span className="text-[11px] font-semibold text-primary/80 bg-primary/5 px-2 py-0.5 rounded-full">{role}</span>
                      )}
                    </div>
                    {payPerDay !== null && (
                      <p className="text-xs font-bold text-emerald-600 mt-1 flex items-center gap-1">
                        <IndianRupee className="w-3 h-3" /> {payPerDay.toLocaleString("en-IN")}<span className="font-normal text-muted-foreground">/day</span>
                      </p>
                    )}
                  </div>
                  {eligible ? (
                    <Link href={`/shifts/${shift.id}`}>
                      <button className="shrink-0 bg-primary text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-primary/90 active:scale-95 transition-all">
                        Apply
                      </button>
                    </Link>
                  ) : (
                    <div className="shrink-0 text-right">
                      <span className="block text-[10px] font-semibold text-muted-foreground bg-muted/60 px-2.5 py-1.5 rounded-xl border border-border/60">
                        {genderLabel ?? "Not eligible"}
                      </span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── MY APPLICATIONS ──────────────────────────────────────────────────── */}
      {appliedClaims.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center">
                <UserCheck className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <h2 className="text-base font-display font-bold text-foreground">My Applications</h2>
              <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{appliedClaims.length}</span>
            </div>
            <Link href="/my-shifts">
              <button className="text-xs font-semibold text-primary flex items-center gap-0.5">View All <ChevronRight className="w-3.5 h-3.5" /></button>
            </Link>
          </div>
          <div className="space-y-2">
            {appliedClaims.slice(0, 3).map((s: any) => {
              const evtDate = s.eventStartDate ? new Date(s.eventStartDate) : null;
              const isPending = s.status === "pending";
              return (
                <div key={s.id} className="bg-card border border-border/60 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPending ? "bg-amber-400" : "bg-sky-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm line-clamp-1">{s.eventTitle}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {evtDate ? format(evtDate, "dd MMM yyyy") : "Date TBA"}
                      {s.eventCity ? ` · ${s.eventCity}` : ""}
                    </p>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                    isPending ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-sky-50 text-sky-700 border border-sky-200"
                  }`}>
                    {isPending ? "Under Review" : "Applied"}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── UPCOMING CONFIRMED EVENTS ─────────────────────────────────────────── */}
      {upcomingShifts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <h2 className="text-base font-display font-bold text-foreground">Confirmed Events</h2>
              <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{upcomingShifts.length}</span>
            </div>
            <Link href="/my-shifts?tab=upcoming">
              <button className="text-xs font-semibold text-primary flex items-center gap-0.5">View All <ChevronRight className="w-3.5 h-3.5" /></button>
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingShifts.slice(0, 3).map((s: any) => {
              const evtDate = s.eventStartDate ? new Date(s.eventStartDate) : null;
              const pay = s.payAmount ? `₹${parseFloat(s.payAmount).toLocaleString("en-IN")}` : null;
              return (
                <div key={s.id} className="bg-card border border-emerald-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center min-w-[48px] shrink-0">
                    {evtDate ? (
                      <>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase">{format(evtDate, "MMM")}</p>
                        <p className="text-xl font-display font-bold text-foreground leading-none">{format(evtDate, "dd")}</p>
                      </>
                    ) : <Briefcase className="w-5 h-5 text-emerald-500 mx-auto" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm line-clamp-1">{s.eventTitle}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      {(s.eventCity || s.eventLocation) && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {s.eventCity || s.eventLocation}
                        </span>
                      )}
                      {pay && (
                        <span className="text-xs font-bold text-emerald-600">{pay}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full shrink-0">
                    Confirmed ✓
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── EMPTY STATE — when no activity at all ────────────────────────────── */}
      {!oLoading && allClaims.length === 0 && hotOpportunities.length === 0 && (
        <div className="text-center py-10 space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
            <Users className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <div>
            <p className="font-semibold text-foreground">No events yet</p>
            <p className="text-sm text-muted-foreground mt-1">Browse available events and apply to get started!</p>
          </div>
          <Link href="/shifts">
            <button className="mt-2 bg-primary text-white text-sm font-bold px-6 py-2.5 rounded-xl hover:bg-primary/90 transition-colors">
              Browse Events
            </button>
          </Link>
        </div>
      )}

      {/* ── STICKY ACTION BUTTON ──────────────────────────────────────────────── */}
      {stickyActionLabel && todayEvent && !sidebarOpen && (
        <div className="fixed bottom-0 left-0 md:left-72 right-0 z-30 p-4 bg-background/95 backdrop-blur-sm border-t border-border/60 safe-area-pb">
          <button
            onClick={() => setStickyAction(stickyActionLabel)}
            className={`w-full h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 shadow-lg active:scale-95 transition-transform ${
              stickyActionLabel === "checkin"
                ? "bg-indigo-600 text-white"
                : stickyActionLabel === "break-end"
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-white"
            }`}
          >
            {(() => { const Icon = stickyIcons[stickyActionLabel]; return <Icon className="w-5 h-5" />; })()}
            {stickyLabels[stickyActionLabel]}
          </button>
        </div>
      )}

      {stickyAction && todayEvent && (
        <AttendanceCaptureDialog
          open={!!stickyAction} action={stickyAction} claimId={todayEvent.id}
          onDone={() => { setStickyAction(null); refetchShifts(); }}
          onClose={() => setStickyAction(null)}
        />
      )}
    </div>
  );
}
