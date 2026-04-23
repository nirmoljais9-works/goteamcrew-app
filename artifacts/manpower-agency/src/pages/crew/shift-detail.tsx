import { useGetShift, useGetCrewProfile } from "@workspace/api-client-react";
import { useParams, useLocation, useSearch } from "wouter";
import { useState, useEffect, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, MapPin, CalendarDays, Clock, Users, IndianRupee,
  UserCheck, Shirt, Sparkles, GraduationCap, CheckCircle2, ChevronRight,
  AlertTriangle, AlertCircle, ZoomIn, X, Gift, Copy, MessageCircle,
  Navigation, Fingerprint, Zap, Timer, Camera, Loader2, LocateFixed, LogOut, RefreshCw,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

/** Always-fresh GPS — enableHighAccuracy forces hardware GPS, maximumAge:0 disables any cached position */
function getLiveGPS(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    console.log("[GPS] Fetching fresh GPS — enableHighAccuracy:true, maximumAge:0");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        console.log(`[GPS] Fresh position acquired → lat:${lat.toFixed(6)} lng:${lng.toFixed(6)} accuracy:${Math.round(accuracy)}m`);
        resolve({ lat, lng });
      },
      (err) => {
        console.warn("[GPS] getCurrentPosition failed:", err.code, err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

/** Fetch the freshest shift data directly from the API — never rely on React Query cache */
async function fetchFreshShift(shiftId: string | number): Promise<any | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/shifts/${shiftId}`, { credentials: "include" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isGenderEligible(profileGender: string | null | undefined, eventGenderRequired: string | null | undefined): boolean {
  if (!eventGenderRequired || eventGenderRequired === "both" || eventGenderRequired === "Both" || eventGenderRequired === "any") return true;
  if (!profileGender) return true;
  return profileGender.toLowerCase() === eventGenderRequired.toLowerCase();
}

interface RoleConfigEntry {
  gender: string;
  role: string;
  task: string;
  minPay?: number;
  maxPay?: number;
  pay?: number; // legacy
  slots?: number;
}

function getMatchingRoleConfig(s: any, profile: any): RoleConfigEntry | null {
  try {
    const raw = s.eventRoleConfigs || (s as any).roleConfigs;
    if (!raw) return null;
    const configs: RoleConfigEntry[] = JSON.parse(raw);
    if (!configs.length) return null;
    const gender = ((profile as any)?.gender || "").toLowerCase();
    const match = configs.find(c => c.gender === gender) || configs.find(c => c.gender === "both") || configs[0];
    return match;
  } catch { return null; }
}

function getEffectivePay(s: any, profile: any): number | null {
  const matchingConfig = getMatchingRoleConfig(s, profile);
  if (matchingConfig) {
    // Prefer minPay from new schema, fallback to legacy "pay"
    return matchingConfig.minPay ?? matchingConfig.pay ?? null;
  }
  // Fallback legacy fields
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

function getEffectivePayRange(s: any, profile: any): { min: number; max: number } | null {
  const matchingConfig = getMatchingRoleConfig(s, profile);
  if (matchingConfig) {
    const min = matchingConfig.minPay ?? matchingConfig.pay ?? null;
    const max = matchingConfig.maxPay ?? min;
    if (min == null) return null;
    return { min, max: max ?? min };
  }
  const single = getEffectivePay(s, profile);
  return single != null ? { min: single, max: single } : null;
}

async function createReferral(shiftEventId: number, referredPhone?: string) {
  const res = await fetch(`${BASE_URL}/api/referrals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ eventId: shiftEventId, referredPhone }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Failed to create referral");
  return res.json();
}

const PAYMENT_LABELS: Record<string, string> = {
  same_day: "Same Day Pay",
  "7_days": "Paid within 7 Days",
  "15_days": "Paid within 15 Days",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  fresher: "Fresher OK",
  "6months": "6+ months exp",
  "1year": "1+ year exp",
  "2years": "2+ years exp",
};

const MEALS_LABELS: Record<string, string> = {
  "1_meal": "1 Meal",
  "2_meals": "2 Meals",
  "3_meals": "3 Meals",
  "snacks_only": "Snacks Only",
};

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getISTComponents(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${mStr || "00"} ${ampm}`;
}

function calcEventDays(startISO: string, endISO: string): number {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 mb-3">
      {children}
    </p>
  );
}

async function compressSelfie(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Slide-to-Apply component ──────────────────────────────────────────────────
// status: "idle"    → slider ready to drag (reset to start)
//         "pending" → handle locked at end, awaiting confirmation
//         "applying"→ API call in flight (spinner)
//         "success" → green success bar (terminal state)
function SlideToApply({
  onSlideComplete,
  status = "idle",
  disabled = false,
}: {
  onSlideComplete: () => void;
  status?: "idle" | "pending" | "applying" | "success";
  disabled?: boolean;
}) {
  const trackRef    = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const draggingRef = useRef(false);
  const [progress, setProgressState] = useState(0);
  const [dragging, setDragging]      = useState(false);
  const [maxSlide, setMaxSlide]      = useState(0);

  const setProgress = (p: number) => {
    progressRef.current = p;
    setProgressState(p);
  };

  // Measure track on mount
  useEffect(() => {
    if (trackRef.current) {
      const h = trackRef.current.clientHeight;
      setMaxSlide(trackRef.current.clientWidth - h);
    }
  }, []);

  // When parent resets status to "idle" → snap handle back
  useEffect(() => {
    if (status === "idle") {
      draggingRef.current = false;
      setDragging(false);
      setProgress(0);
    }
  }, [status]);

  const calcProgress = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const h    = track.clientHeight;
    const max  = rect.width - h;
    const x    = Math.max(0, Math.min(clientX - rect.left - h / 2, max));
    return (x / max) * 100;
  };

  const onRelease = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (progressRef.current >= 88) {
      // Lock handle at end — parent decides what happens next
      setProgress(100);
      if (navigator.vibrate) navigator.vibrate(40);
      onSlideComplete();
    } else {
      setProgress(0);
    }
  };

  // Mouse events (desktop)
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setProgress(calcProgress(e.clientX));
    const onUp   = () => onRelease();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const canDrag = status === "idle" && !disabled;

  const startDrag = () => {
    if (!canDrag) return;
    draggingRef.current = true;
    setDragging(true);
  };

  // Touch events (mobile)
  const onTouchStart = () => { if (canDrag) { draggingRef.current = true; setDragging(true); } };
  const onTouchMove  = (e: React.TouchEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    setProgress(calcProgress(e.touches[0].clientX));
  };
  const onTouchEnd = () => onRelease();

  // Display progress: when pending/applying lock at 100, else use drag value
  const displayProgress = (status === "pending" || status === "applying") ? 100 : progress;
  const translateX      = (displayProgress / 100) * maxSlide;

  // ── Success state ─────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="w-full h-14 rounded-full flex items-center justify-center gap-2 bg-emerald-500 text-white font-bold text-base shadow-lg shadow-emerald-200">
        <CheckCircle2 className="w-5 h-5" /> Applied Successfully ✓
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      className={`relative w-full h-14 rounded-full overflow-hidden select-none touch-none ${
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed opacity-70"
      }`}
      style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
      onMouseDown={canDrag ? startDrag : undefined}
      onTouchStart={canDrag ? onTouchStart : undefined}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Fill overlay grows left → right */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, #4c1d95, #5b21b6)",
          transform: `scaleX(${displayProgress / 100})`,
          transformOrigin: "left",
          transition: dragging ? "none" : "transform 0.35s ease",
        }}
      />

      {/* Centered label — fades out as handle nears the end */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        {status === "applying" ? (
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        ) : (
          <span
            className="text-base font-bold text-white transition-opacity duration-150"
            style={{ opacity: displayProgress > 55 ? 0 : 1 }}
          >
            Apply Now
          </span>
        )}
      </div>

      {/* Draggable handle */}
      <div
        className="absolute top-[4px] bottom-[4px] z-20 pointer-events-none flex items-center justify-center rounded-full bg-white shadow-md"
        style={{
          left: 4,
          aspectRatio: "1 / 1",
          transform: `translateX(${translateX}px)`,
          transition: dragging ? "none" : "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {displayProgress >= 80 || status === "applying" ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : (
          <ChevronRight className="w-5 h-5 text-primary" />
        )}
      </div>
    </div>
  );
}

export default function ShiftDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const search = useSearch();
  const fromMyShifts = new URLSearchParams(search).get("from") === "my-shifts";

  const { user: currentUser } = useAuth();
  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [slideStatus, setSlideStatus]   = useState<"idle" | "pending" | "applying" | "success">("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [dressCodeImageOpen, setDressCodeImageOpen] = useState(false);
  const [dressCodeImageError, setDressCodeImageError] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralData, setReferralData] = useState<any>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInStep, setCheckInStep] = useState<"getting-location" | "warning" | "ready" | "submitting">("getting-location");
  const [checkInLat, setCheckInLat] = useState<number | null>(null);
  const [checkInLng, setCheckInLng] = useState<number | null>(null);
  const [checkInDistanceMeters, setCheckInDistanceMeters] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser) {
      console.log("Current Role:", currentUser.role, "| User:", currentUser.name, "| ID:", currentUser.id);
    }
  }, [currentUser]);

  const { data: shift, isLoading } = useGetShift(parseInt(id || "0"), { query: { refetchOnMount: "always", staleTime: 0, refetchInterval: 30_000 } } as any);
  const { data: profile } = useGetCrewProfile();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  const s = shift as any;

  const [checkingOut, setCheckingOut] = useState(false);

  const isConfirmedShift = s?.myClaimStatus === "approved";
  const toISTDate = (d: string | Date): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(typeof d === "string" ? new Date(d) : d);
    const g = (t: string) => parts.find(p => p.type === t)!.value;
    return `${g("year")}-${g("month")}-${g("day")}`;
  };

  const todayIST = toISTDate(new Date());

  // Only count a check-in as valid for TODAY if the attendanceDate matches today.
  // This prevents stale check-ins from a previous event date being treated as already checked-in.
  const alreadyCheckedIn = !!s?.myCheckedInAt && (
    !s.myAttendanceDate || s.myAttendanceDate === todayIST
  );
  const alreadyCheckedOut = !!s?.myCheckOutAt;

  const isEventToday = (() => {
    if (!s?.eventStartDate) return false;
    try {
      // Compare IST dates only (not times) — crew should see check-in button all day
      // on the event date, even before the exact event start time.
      const startIST = toISTDate(s.eventStartDate);
      const endIST   = s.eventEndDate ? toISTDate(s.eventEndDate) : startIST;
      const result = todayIST >= startIST && todayIST <= endIST;
      console.log(`[ShiftDetail] isEventToday=${result} todayIST=${todayIST} startIST=${startIST} endIST=${endIST}`);
      console.log(`[ShiftDetail] claimStatus=${s.myClaimStatus} checkedIn=${s.myCheckedInAt ?? "null"} attendanceDate=${s.myAttendanceDate ?? "null"} checkedOut=${s.myCheckOutAt ?? "null"}`);
      return result;
    } catch {
      return false;
    }
  })();

  const mapsUrl = (() => {
    const q = [s?.eventCity, s?.eventLocation].filter(Boolean).join(", ");
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
  })();

  const openCheckInModal = () => {
    // Open modal immediately — crew sees "Fetching latest location…" while we load
    setCheckInOpen(true);
    setCheckInStep("getting-location");
    setCheckInLat(null);
    setCheckInLng(null);
    setCheckInDistanceMeters(null);
    setLocationError(null);
    setSelfiePreview(null);
    setSelfieBase64(null);

    // Fetch LIVE GPS + FRESH event data in parallel — no cached values
    Promise.all([
      getLiveGPS(),
      fetchFreshShift(id!),
    ]).then(([gps, freshShift]) => {
      const eLat = freshShift?.eventLatitude ?? s?.eventLatitude ?? null;
      const eLng = freshShift?.eventLongitude ?? s?.eventLongitude ?? null;

      console.log("[Location Debug] check-in — data_source: live_api_fetch", {
        crew_lat: gps?.lat ?? "GPS_FAILED",
        crew_lng: gps?.lng ?? "GPS_FAILED",
        event_lat: eLat ?? "NULL",
        event_lng: eLng ?? "NULL",
        event_title: freshShift?.title ?? s?.title ?? "unknown",
      });

      if (!gps) {
        setLocationError("Location access denied — check-in will proceed without GPS.");
        setCheckInStep("ready");
        return;
      }

      setCheckInLat(gps.lat);
      setCheckInLng(gps.lng);

      if (eLat && eLng) {
        const dist = Math.round(haversineMeters(parseFloat(eLat), parseFloat(eLng), gps.lat, gps.lng));
        console.log(`[Location Debug] distance_meters: ${dist} | distance_km: ${(dist / 1000).toFixed(2)}`);
        setCheckInDistanceMeters(dist);
        if (dist > 1000) {
          setCheckInStep("warning");
          return;
        }
      } else {
        console.warn("[Location Debug] Event has no coordinates — distance check skipped. Admin must set event lat/lng.");
      }

      setCheckInStep("ready");
    });
  };

  /** Re-fetch GPS only (no dialog reset) — called by Refresh Location button in warning screen */
  const refreshCheckInLocation = () => {
    setCheckInStep("getting-location");
    setCheckInLat(null);
    setCheckInLng(null);
    setCheckInDistanceMeters(null);
    setLocationError(null);

    Promise.all([
      getLiveGPS(),
      fetchFreshShift(id!),
    ]).then(([gps, freshShift]) => {
      const eLat = freshShift?.eventLatitude ?? s?.eventLatitude ?? null;
      const eLng = freshShift?.eventLongitude ?? s?.eventLongitude ?? null;

      console.log("[Location Debug] check-in RETRY — data_source: live_api_fetch", {
        crew_lat: gps?.lat ?? "GPS_FAILED",
        crew_lng: gps?.lng ?? "GPS_FAILED",
        event_lat: eLat ?? "NULL",
        event_lng: eLng ?? "NULL",
      });

      if (!gps) {
        setLocationError("Location access denied — check-in will proceed without GPS.");
        setCheckInStep("ready");
        return;
      }

      setCheckInLat(gps.lat);
      setCheckInLng(gps.lng);

      if (eLat && eLng) {
        const dist = Math.round(haversineMeters(parseFloat(eLat), parseFloat(eLng), gps.lat, gps.lng));
        console.log(`[Location Debug] RETRY distance_meters: ${dist} | distance_km: ${(dist / 1000).toFixed(2)}`);
        setCheckInDistanceMeters(dist);
        if (dist > 1000) {
          setCheckInStep("warning");
          return;
        }
      }

      setCheckInStep("ready");
    });
  };

  const handleSelfieCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressSelfie(file);
      setSelfieBase64(compressed);
      setSelfiePreview(compressed);
    } catch {
      toast({ variant: "destructive", title: "Could not process image" });
    }
  };

  const submitCheckIn = async () => {
    setCheckInStep("submitting");
    try {
      const body: Record<string, any> = { lat: checkInLat, lng: checkInLng, selfieImage: selfieBase64 };
      if (checkInDistanceMeters != null) body.distanceFromEvent = checkInDistanceMeters;
      await customFetch(`${BASE_URL}/api/shifts/${id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "✅ Attendance marked!", description: "You've been checked in for this shift." });
      queryClient.invalidateQueries({ queryKey: [`/api/shifts/${id}`] });
      setCheckInOpen(false);
    } catch (err: any) {
      const msg = err?.data?.error || err?.message || "Something went wrong";
      toast({ variant: "destructive", title: "Check-in failed", description: msg });
      setCheckInStep("ready");
    }
  };

  const submitCheckOut = async (distMeters?: number) => {
    setCheckingOut(true);
    try {
      const body: Record<string, any> = {};
      if (distMeters != null) body.distanceFromEvent = distMeters;
      await customFetch(`${BASE_URL}/api/shifts/${id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: "✅ Checked out!", description: "Your attendance is complete." });
      queryClient.invalidateQueries({ queryKey: [`/api/shifts/${id}`] });
    } catch (err: any) {
      const msg = err?.data?.error || err?.message || "Something went wrong";
      toast({ variant: "destructive", title: "Check-out failed", description: msg });
    } finally {
      setCheckingOut(false);
    }
  };

  const handleCheckOut = async () => {
    // Show loading state immediately; GPS + fresh event fetch run in parallel
    setCheckingOut(true);
    try {
      const [gps, freshShift] = await Promise.all([
        getLiveGPS(),
        fetchFreshShift(id!),
      ]);

      const eLat = freshShift?.eventLatitude ?? s?.eventLatitude ?? null;
      const eLng = freshShift?.eventLongitude ?? s?.eventLongitude ?? null;

      console.log("[Location Debug] checkout — data_source: live_api_fetch", {
        crew_lat: gps?.lat ?? "GPS_FAILED",
        crew_lng: gps?.lng ?? "GPS_FAILED",
        event_lat: eLat ?? "NULL",
        event_lng: eLng ?? "NULL",
        event_title: freshShift?.title ?? s?.title ?? "unknown",
      });

      let distMeters: number | undefined;
      if (gps && eLat && eLng) {
        distMeters = Math.round(haversineMeters(parseFloat(eLat), parseFloat(eLng), gps.lat, gps.lng));
        console.log(`[Location Debug] checkout distance_meters: ${distMeters} | distance_km: ${(distMeters / 1000).toFixed(2)}`);
        if (distMeters > 1000) {
          const ok = window.confirm(
            `⚠️ You are ${(distMeters / 1000).toFixed(1)} km from the event venue.\n\nYour check-out may be flagged for admin review.\n\nContinue anyway?`
          );
          if (!ok) {
            setCheckingOut(false);
            return;
          }
        }
      } else if (!gps) {
        console.warn("[Location Debug] checkout: GPS unavailable — proceeding without distance check.");
      } else {
        console.warn("[Location Debug] checkout: Event has no coordinates — distance check skipped.");
      }

      await submitCheckOut(distMeters);
    } catch {
      await submitCheckOut();
    }
  };


  // Open confirm dialog (used by both role-picker button and legacy slide)
  const handleSlideComplete = () => {
    if (profile?.status !== "approved") {
      toast({ variant: "destructive", title: "Cannot Apply", description: "Your account must be approved before applying." });
      setSlideStatus("idle");
      return;
    }
    setSlideStatus("pending");
    setConfirmed(false);
    setConfirmOpen(true);
  };

  const handleApplyWithRoles = () => {
    if (selectedRoles.length === 0) {
      toast({ variant: "destructive", title: "Select a role", description: "Please select at least one role to apply." });
      return;
    }
    setConfirmed(false);
    setConfirmOpen(true);
  };

  // Called when user clicks Confirm inside the dialog
  const handleConfirmApply = async () => {
    setConfirmOpen(false);
    setIsApplying(true);
    setSlideStatus("applying");
    try {
      await customFetch(`${BASE_URL}/api/shifts/${id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedRoles: selectedRoles.length > 0 ? selectedRoles : undefined }),
      });
      setSlideStatus("success");
      toast({ title: "Application submitted!", description: "Your application is under review. The admin will get back to you soon." });
      queryClient.invalidateQueries({ queryKey: [`/api/shifts/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/shifts`] });
    } catch (err: any) {
      setSlideStatus("idle");
      toast({ variant: "destructive", title: "Error", description: err?.data?.error || err?.message || "Failed to apply." });
    } finally {
      setIsApplying(false);
    }
  };

  // Called when user cancels the confirmation dialog
  const handleCancelApply = () => {
    setConfirmOpen(false);
    setConfirmed(false);
    setSlideStatus("idle");
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => {
      if (prev.includes(role)) return prev.filter(r => r !== role);
      if (prev.length >= 2) return prev; // max 2
      return [...prev, role];
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-muted-foreground text-lg">Shift not found.</p>
        <Button variant="ghost" onClick={() => navigate("/shifts")}>← Back</Button>
      </div>
    );
  }

  console.log("[shift-detail] food_provided:", s.eventFoodProvided, "| meals_provided:", (s as any).eventMealsProvided);

  const matchingConfig = getMatchingRoleConfig(s, profile);
  const displayRole = matchingConfig?.role || s.eventRole || s.role;
  const payRange = getEffectivePayRange(s, profile);
  const payPerDay = payRange?.min ?? null;
  const gender = s.eventGenderRequired || s.genderPreference;
  const genderBoth = !gender || gender === "both" || gender === "any";
  const spotsLeft = (s.spotsTotal || 0) - (s.spotsFilled || 0);
  const workTask = matchingConfig?.task || s.eventWorkTask || s.description;
  const notes = s.eventDescription || null;

  const startIST = s.eventStartDate ? getISTComponents(new Date(s.eventStartDate)) : null;
  const endIST = s.eventEndDate ? getISTComponents(new Date(s.eventEndDate)) : null;
  const sameDay = startIST && endIST && startIST.date === endIST.date;

  const totalDays = s.eventStartDate && s.eventEndDate
    ? calcEventDays(s.eventStartDate, s.eventEndDate)
    : 1;



  const activeDressCode = s.eventDressCode || s.dressCode || null;
  const activeDressCodeImage = s.eventDressCodeImage || null;
  const hasRequirements = activeDressCode || s.groomingInstructions || s.experienceRequired || s.requirements;
  const isApplied = s.claimedByMe;
  const isAdmin = currentUser?.role === "admin";
  const isFull = !isApplied && spotsLeft <= 0;

  const applicationsClosed = s.applicationsOpen === false;
  const isApproved = !isAdmin && profile?.status === "approved";

  const profileGender = (profile as any)?.gender || null;
  const eligible = isGenderEligible(profileGender, gender);

  // Parse all unique roles available for this crew from event role configs
  const availableRoles: string[] = (() => {
    const raw = s.eventRoleConfigs;
    if (!raw) return [];
    try {
      const configs: RoleConfigEntry[] = JSON.parse(raw);
      return configs
        .filter(rc => {
          if (!profileGender) return true;
          const g = rc.gender?.toLowerCase();
          return !g || g === "both" || g === profileGender.toLowerCase();
        })
        .map(rc => rc.role)
        .filter(Boolean)
        .filter((r, idx, arr) => arr.indexOf(r) === idx);
    } catch { return []; }
  })();
  const referralReward = s.eventReferralReward ? parseFloat(s.eventReferralReward) : null;

  // Referrals only allowed before the event starts
  const referralPeriodOpen = s.eventStartDate
    ? new Date() < new Date(s.eventStartDate)
    : s.startTime
    ? new Date() < new Date(s.startTime)
    : true;

  const showReferInFooter = isConfirmedShift && referralReward !== null && referralReward > 0 && referralPeriodOpen;

  const handleReferAndEarn = async () => {
    if (!s.eventId) return;
    setReferralLoading(true);
    try {
      const data = await createReferral(s.eventId);
      setReferralData(data);
      setReferralOpen(true);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not generate referral", description: err.message });
    } finally {
      setReferralLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!referralData?.referralLink) return;
    const msg = referralData.whatsappMessage || `Hey 👋\n\nThere's a paid event opportunity on Goteamcrew.\n\nYou'll need to register first (takes 1–2 mins), then you can view details and apply.\n\nHere's the link:\n${referralData.referralLink}\n\nLet me know if you need help 🙂`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Please copy the link manually." });
    }
  };

  return (
    <div className="pb-32">
      {/* Back button */}
      <button
        onClick={() => navigate(fromMyShifts ? "/my-shifts" : "/shifts")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="max-w-2xl mx-auto space-y-4">

        {/* Hero Card */}
        <div className="bg-card rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-primary via-violet-500 to-indigo-400" />
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <span className="inline-block text-xs font-bold uppercase tracking-widest text-primary bg-primary/8 px-2.5 py-1 rounded-full mb-3">
                  {displayRole}
                </span>
                <h1 className="text-2xl font-display font-bold text-foreground leading-tight">{s.eventTitle}</h1>
                {workTask && (
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{workTask}</p>
                )}
              </div>
              {payRange !== null && (
                <div className="text-right shrink-0">
                  {payRange.max && payRange.max !== payRange.min ? (
                    <>
                      <div className="flex items-center gap-0.5 text-2xl font-display font-bold text-foreground">
                        <IndianRupee className="w-5 h-5" />
                        {payRange.min.toFixed(0)}–{payRange.max.toFixed(0)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">per day (based on profile)</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-0.5 text-3xl font-display font-bold text-foreground">
                        <IndianRupee className="w-6 h-6" />
                        {payRange.min.toFixed(0)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">per day</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confirmed shift banner */}
        {!isAdmin && isConfirmedShift && (
          <div className="rounded-2xl overflow-hidden border border-emerald-200">
            <div className="bg-emerald-500 px-4 py-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2 text-white text-sm font-bold">
                <CheckCircle2 className="w-4 h-4" />
                Confirmed — You're In!
              </span>
              {(() => {
                const now = new Date();
                const start = s.eventStartDate ? new Date(s.eventStartDate) : null;
                const end = s.eventEndDate ? new Date(s.eventEndDate) : (start ? new Date(s.eventStartDate) : null);
                if (end) end.setHours(23, 59, 59, 999);
                if (!start) return null;
                if (now < start) return (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-white/20 text-white px-2 py-0.5 rounded-full">
                    <Timer className="w-2.5 h-2.5" /> Upcoming
                  </span>
                );
                if (end && now > end) return (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-white/20 text-white px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Completed
                  </span>
                );
                return (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-yellow-300 text-yellow-900 px-2 py-0.5 rounded-full animate-pulse">
                    <Zap className="w-2.5 h-2.5" /> Live Now
                  </span>
                );
              })()}
            </div>
            <div className="bg-emerald-50 px-4 py-3 grid grid-cols-3 divide-x divide-emerald-200">
              {s.myApprovedAt && (
                <div className="pr-4">
                  <p className="text-[10px] uppercase font-bold text-emerald-600/70 tracking-wide">Confirmed</p>
                  <p className="text-xs font-semibold text-emerald-800 mt-0.5">{format(new Date(s.myApprovedAt), "d MMM yyyy")}</p>
                </div>
              )}
              {alreadyCheckedIn && s.myCheckedInAt && (
                <div className="px-4">
                  {s.myCheckInStatus === "late" ? (
                    <p className="text-[10px] uppercase font-bold text-amber-600/80 tracking-wide">⚠️ Checked In Late</p>
                  ) : (
                    <p className="text-[10px] uppercase font-bold text-emerald-600/70 tracking-wide">✅ Checked In</p>
                  )}
                  <p className={`text-xs font-semibold mt-0.5 ${s.myCheckInStatus === "late" ? "text-amber-800" : "text-emerald-800"}`}>
                    {format(new Date(s.myCheckedInAt), "h:mm a, d MMM")}
                  </p>
                </div>
              )}
              {alreadyCheckedOut && s.myCheckOutAt && (
                <div className="px-4">
                  {s.myCheckOutStatus === "early" ? (
                    <p className="text-[10px] uppercase font-bold text-sky-600/80 tracking-wide">⚡ Early Check-Out</p>
                  ) : (
                    <p className="text-[10px] uppercase font-bold text-blue-600/80 tracking-wide">🚪 Checked Out</p>
                  )}
                  <p className={`text-xs font-semibold mt-0.5 ${s.myCheckOutStatus === "early" ? "text-sky-800" : "text-blue-800"}`}>
                    {format(new Date(s.myCheckOutAt), "h:mm a, d MMM")}
                  </p>
                </div>
              )}
              <div className={s.myApprovedAt ? "pl-4" : ""}>
                <p className="text-[10px] uppercase font-bold text-emerald-600/70 tracking-wide">Role</p>
                <p className="text-xs font-semibold text-emerald-800 mt-0.5">{s.eventRole || s.role}</p>
              </div>
            </div>
          </div>
        )}

        {/* Gender eligibility banner */}
        {!isAdmin && !eligible && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <Gift className="w-4.5 h-4.5 text-violet-600" />
            </div>
            <div>
              <p className="font-semibold text-violet-900 text-sm">
                This event is for {gender?.toLowerCase() === "male" ? "Male" : "Female"} applicants only
              </p>
              <p className="text-violet-700 text-xs mt-0.5 leading-relaxed">
                {referralPeriodOpen
                  ? <>This event is not available for your profile, but you can refer a friend and earn{referralReward ? ` ₹${referralReward.toLocaleString("en-IN")}` : " a reward"} if they get selected!</>
                  : "This event is not available for your profile. Referrals are closed as the event has started."}
              </p>
            </div>
          </div>
        )}

        {/* Referral reward badge for eligible users — hidden once event starts */}
        {!isAdmin && eligible && referralReward && referralReward > 0 && referralPeriodOpen && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
              <Gift className="w-4 h-4 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-900">Refer & Earn ₹{referralReward.toLocaleString("en-IN")}</p>
              <p className="text-xs text-green-700 mt-0.5">Know someone perfect? Share your link — earn when they're selected!</p>
            </div>
            <Button
              size="sm"
              className="shrink-0 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs px-3"
              onClick={handleReferAndEarn}
              disabled={referralLoading}
            >
              {referralLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Share"}
            </Button>
          </div>
        )}

        {/* Location & Dates Card */}
        <div className="bg-card rounded-2xl border border-border/60 p-5 space-y-3">
          <SectionLabel>When & Where</SectionLabel>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-rose-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground font-medium">Venue</p>
                <p className="text-sm font-semibold text-foreground">
                  {s.eventCity ? `${s.eventCity} — ` : ""}{s.eventLocation}
                </p>
              </div>
            </div>

            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/60 transition-colors text-sm font-semibold text-primary"
              >
                <MapPin className="w-4 h-4 shrink-0" />
                Open in Google Maps
              </a>
            )}

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <CalendarDays className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Dates</p>
                {startIST && endIST ? (
                  <p className="text-sm font-semibold text-foreground">
                    {sameDay
                      ? `${format(new Date(s.eventStartDate), "d MMM yyyy")} | ${formatTime12h(startIST.time)} – ${formatTime12h(endIST.time)}`
                      : `${format(new Date(s.eventStartDate), "d MMM")} – ${format(new Date(s.eventEndDate), "d MMM yyyy")}`
                    }
                    {!sameDay && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">({totalDays} days)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-foreground">
                    {format(new Date(s.startTime), "EEE, MMM d, yyyy")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Timings</p>
                <p className="text-sm font-semibold text-foreground">
                  {(s.eventTimings ? s.eventTimings.replace(/\s*IST\s*$/i, "") : null) || (startIST && endIST
                    ? `${formatTime12h(startIST.time)} – ${formatTime12h(endIST.time)}`
                    : `${format(new Date(s.startTime), "h:mm a")} – ${format(new Date(s.endTime), "h:mm a")}`
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          <span className="flex items-center gap-1.5 bg-primary/8 text-primary font-semibold text-xs px-3 py-1.5 rounded-full">
            <Users className="w-3.5 h-3.5" />
            {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
          </span>
          {!genderBoth && (
            <span className="flex items-center gap-1.5 bg-violet-50 text-violet-700 font-semibold text-xs px-3 py-1.5 rounded-full capitalize">
              <UserCheck className="w-3.5 h-3.5" />
              {gender} only
            </span>
          )}
          {s.eventFoodProvided && (
            <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 font-semibold text-xs px-3 py-1.5 rounded-full">
              🍽 Food Provided
            </span>
          )}
          {(s as any).eventIncentives && (
            <span className="flex items-center gap-1.5 bg-amber-50 text-amber-700 font-semibold text-xs px-3 py-1.5 rounded-full">
              🎯 Incentives
            </span>
          )}
          {s.paymentType && (
            <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 font-semibold text-xs px-3 py-1.5 rounded-full">
              <IndianRupee className="w-3.5 h-3.5" />
              {PAYMENT_LABELS[s.paymentType] || s.paymentType}
            </span>
          )}
          {s.experienceRequired && (
            <span className="flex items-center gap-1.5 bg-amber-50 text-amber-700 font-semibold text-xs px-3 py-1.5 rounded-full">
              <GraduationCap className="w-3.5 h-3.5" />
              {EXPERIENCE_LABELS[s.experienceRequired] || s.experienceRequired}
            </span>
          )}
        </div>

        {/* Openings — per-role slot breakdown */}
        {(() => {
          const raw = s.eventRoleConfigs;
          if (!raw) return null;
          try {
            const configs: RoleConfigEntry[] = JSON.parse(raw);
            const hasSlots = configs.some(c => c.slots != null && c.slots > 0);
            if (!hasSlots) return null;
            return (
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Openings</p>
                <div className="space-y-2">
                  {configs.map((c, idx) => c.role && c.slots != null && c.slots > 0 ? (
                    <div key={idx} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{c.role}</span>
                        {c.gender && c.gender !== "both" && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full capitalize">{c.gender}</span>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-primary">{c.slots} slot{c.slots !== 1 ? "s" : ""}</span>
                    </div>
                  ) : null)}
                </div>
              </div>
            );
          } catch { return null; }
        })()}

        {/* Food — minimal inline */}
        <p className="text-sm text-gray-500">
          🍽 Food:{" "}
          {s.eventFoodProvided
            ? ((s as any).eventMealsProvided
                ? (MEALS_LABELS[(s as any).eventMealsProvided] || (s as any).eventMealsProvided)
                : "Included")
            : "Self-arranged"}
        </p>

        {/* Incentives */}
        {(s as any).eventIncentives && (
          <div className="flex items-start gap-3 bg-amber-50 rounded-2xl border border-amber-100 p-4">
            <div className="text-2xl leading-none">🎯</div>
            <div>
              <p className="text-sm font-semibold text-amber-800">Incentives Available</p>
              <p className="text-xs text-amber-700 mt-0.5">{(s as any).eventIncentives}</p>
            </div>
          </div>
        )}


        {/* Role Selection — shown before applying when roles are available */}
        {!isAdmin && eligible && !isApplied && isApproved && availableRoles.length > 0 && !applicationsClosed && !isFull && (
          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-500 mb-3">
              Select Your Role{availableRoles.length > 1 ? "(s)" : ""} <span className="text-gray-400 normal-case font-normal tracking-normal">(max 2)</span>
            </p>
            <div className="space-y-2">
              {availableRoles.map(role => {
                const isSelected = selectedRoles.includes(role);
                const isDisabled = !isSelected && selectedRoles.length >= 2;
                return (
                  <button
                    key={role}
                    onClick={() => toggleRole(role)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                      isSelected
                        ? "border-violet-400 bg-violet-100 text-violet-900 shadow-sm"
                        : isDisabled
                        ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                        : "border-gray-200 bg-white text-gray-700 hover:border-violet-300 hover:bg-violet-50/60"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? "border-violet-500 bg-violet-500" : "border-gray-300 bg-white"
                    }`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <span>{role}</span>
                  </button>
                );
              })}
            </div>
            {selectedRoles.length === 2 && (
              <p className="text-[11px] text-violet-500 mt-2.5 text-center">Maximum 2 roles selected</p>
            )}
            {selectedRoles.length > 0 && availableRoles.length > 1 && (
              <p className="text-[11px] text-gray-400 mt-1.5 text-center">
                {selectedRoles.length === 1 ? "Add a backup role if you're flexible" : "Preferred + backup role selected"}
              </p>
            )}
          </div>
        )}

        {/* Applied roles / Assigned role display */}
        {isApplied && (s.myAssignedRole || (s.myAppliedRoles && s.myAppliedRoles.length > 0)) && (
          <div className="rounded-2xl border px-5 py-4">
            {s.myAssignedRole ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-0.5">Selected For</p>
                  <p className="text-base font-bold text-gray-900">{s.myAssignedRole}</p>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Applied For</p>
                <div className="flex flex-wrap gap-2">
                  {s.myAppliedRoles.map((r: string) => (
                    <span key={r} className="px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">{r}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Earnings card — premium daily-first */}
        {payRange !== null && (
          <div className="animate-in fade-in duration-500 rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/60 px-5 py-4 shadow-sm">

            {/* Header row */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                <IndianRupee className="w-3.5 h-3.5 text-violet-600" />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-500">Earnings</span>
            </div>

            {/* Daily pay — dominant */}
            <p className="text-[26px] font-bold text-gray-900 tracking-tight leading-none">
              {payRange.max && payRange.max !== payRange.min
                ? <>₹{payRange.min.toLocaleString("en-IN")}–₹{payRange.max.toLocaleString("en-IN")}</>
                : <>₹{payRange.min.toLocaleString("en-IN")}</>
              }
              <span className="text-sm font-medium text-violet-400 ml-1.5">/ day</span>
            </p>

            <div className="my-3 border-t border-violet-100" />

            {/* Estimated total — secondary */}
            {totalDays > 1 ? (
              <p className="text-xs font-medium text-gray-500">
                Estimated total:{" "}
                <span className="text-gray-700 font-semibold">
                  {payRange.max && payRange.max !== payRange.min
                    ? <>₹{(payRange.min * totalDays).toLocaleString("en-IN")}–₹{(payRange.max * totalDays).toLocaleString("en-IN")}</>
                    : <>₹{(payRange.min * totalDays).toLocaleString("en-IN")}</>
                  }
                </span>
                <span className="text-gray-400 ml-1">for {totalDays} days</span>
              </p>
            ) : null}

            {/* Disclaimer */}
            <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">
              Final pay depends on experience, profile &amp; selection
            </p>
          </div>
        )}

        {/* Dress Code */}
        {(activeDressCode || activeDressCodeImage) && (
          <div className="bg-card rounded-2xl border border-border/60 p-5">
            <SectionLabel>Dress Code</SectionLabel>
            <div className="space-y-3">
              {activeDressCode && (
                <div className="flex items-start gap-3 text-sm">
                  <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                    <Shirt className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="pt-1">
                    <p className="font-semibold text-foreground">{activeDressCode}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Wear this attire for the event</p>
                  </div>
                </div>
              )}
              {activeDressCodeImage && !dressCodeImageError ? (
                <div className="space-y-2">
                  <button
                    onClick={() => setDressCodeImageOpen(true)}
                    className="relative w-full rounded-xl overflow-hidden border border-border/60 shadow-sm group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <img
                      src={activeDressCodeImage}
                      alt="Dress code reference"
                      className="w-full max-h-52 object-cover"
                      onError={() => setDressCodeImageError(true)}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-800 shadow-md">
                        <ZoomIn className="w-3.5 h-3.5" />
                        Tap to view
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setDressCodeImageOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 py-1 transition-colors"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    View Full Image
                  </button>
                </div>
              ) : activeDressCodeImage && dressCodeImageError ? (
                <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground text-center">
                  No reference image available
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Dress Code Fullscreen Modal */}
        {dressCodeImageOpen && activeDressCodeImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
            onClick={() => setDressCodeImageOpen(false)}
          >
            <div
              className="relative max-w-lg w-full"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={() => setDressCodeImageOpen(false)}
                className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4 text-slate-700" />
              </button>
              <div className="rounded-2xl overflow-hidden shadow-2xl">
                <img
                  src={activeDressCodeImage}
                  alt="Dress code reference"
                  className="w-full object-contain max-h-[80vh]"
                />
                {activeDressCode && (
                  <div className="bg-white px-4 py-3 text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Dress Code</p>
                    <p className="font-semibold text-slate-800">{activeDressCode}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Requirements */}
        {(s.groomingInstructions || s.experienceRequired || s.requirements) && (
          <div className="bg-card rounded-2xl border border-border/60 p-5">
            <SectionLabel>Requirements</SectionLabel>
            <ul className="space-y-2.5">
              {s.groomingInstructions && (
                <li className="flex items-start gap-3 text-sm">
                  <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    <span className="font-semibold text-foreground">Grooming: </span>
                    <span className="text-muted-foreground">{s.groomingInstructions}</span>
                  </div>
                </li>
              )}
              {s.requirements && s.requirements.split(/[,\n•\-]/).filter(Boolean).map((req: string, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                  <span className="text-muted-foreground">{req.trim()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        {notes && (
          <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
            <SectionLabel>Notes & Instructions</SectionLabel>
            <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-line">{notes}</p>
          </div>
        )}

        {/* Bottom spacer for sticky bar */}
        <div className="h-4" />
      </div>

      {/* Referral Dialog */}
      <Dialog open={referralOpen} onOpenChange={setReferralOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                <Gift className="w-5 h-5 text-green-600" />
              </div>
              <DialogTitle className="text-lg font-display font-bold leading-tight">
                Refer & Earn
                {referralData?.referralReward && (
                  <span className="ml-2 text-base font-bold text-green-600">
                    ₹{parseFloat(referralData.referralReward).toLocaleString("en-IN")}
                  </span>
                )}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share this link with a friend. When they register and get selected for this event, you earn the referral reward!
            </p>

            {referralData?.referralLink && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Preview message</p>
                <div className="bg-muted/50 rounded-xl p-4 text-xs text-foreground border border-border/60 whitespace-pre-wrap leading-relaxed">
                  {referralData.whatsappMessage || `Hey 👋\n\nThere's a paid event opportunity on Goteamcrew.\n\nYou'll need to register first (takes 1–2 mins), then you can view details and apply.\n\nHere's the link:\n${referralData.referralLink}\n\nLet me know if you need help 🙂`}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl gap-2"
                onClick={handleCopyLink}
              >
                <Copy className="w-4 h-4" />
                {copiedLink ? "Copied!" : "Copy Message"}
              </Button>
              {referralData?.whatsappMessage && (
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(referralData.whatsappMessage)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button className="w-full rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white gap-2">
                    <MessageCircle className="w-4 h-4" />
                    WhatsApp
                  </Button>
                </a>
              )}
            </div>

            {referralData?.referralReward && (
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xs text-green-700 font-medium">
                  You'll earn <strong>₹{parseFloat(referralData.referralReward).toLocaleString("en-IN")}</strong> when your referral gets selected!
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal */}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open) handleCancelApply(); }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <DialogTitle className="text-lg font-display font-bold leading-tight">
                Confirm Your Application
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <span>Please apply only if you are <strong className="text-foreground">available for all days</strong> of this event.</span>
            </div>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>If you back out after being selected, <strong className="text-foreground">your profile may be blacklisted</strong> from future opportunities.</span>
            </div>
          </div>

          <div className="flex items-start gap-3 bg-indigo-50 rounded-xl p-3.5 mt-1">
            <Checkbox
              id="confirm-check"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(!!v)}
              className="mt-0.5 shrink-0"
            />
            <Label
              htmlFor="confirm-check"
              className="text-sm font-medium text-indigo-900 leading-snug cursor-pointer"
            >
              I confirm I am serious and available for this event
            </Label>
          </div>

          <DialogFooter className="flex gap-2 mt-1">
            <Button
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={handleCancelApply}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl"
              disabled={!confirmed || isApplying}
              onClick={handleConfirmApply}
            >
              {isApplying ? "Applying..." : "Confirm & Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-in Modal */}
      <Dialog open={checkInOpen} onOpenChange={(o) => { if (!o && checkInStep !== "submitting") setCheckInOpen(false); }}>
        <DialogContent className="max-w-xs rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <Fingerprint className="w-5 h-5 text-emerald-600" />
              </div>
              <DialogTitle className="text-lg font-display font-bold leading-tight">Check In</DialogTitle>
            </div>
          </DialogHeader>

          {checkInStep === "getting-location" ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Fetching latest location…</p>
              <p className="text-xs text-muted-foreground/70">Getting live GPS + event data</p>
            </div>
          ) : checkInStep === "warning" ? (
            <div className="flex flex-col gap-3 pb-2">
              <div className="rounded-xl bg-orange-50 border border-orange-200 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-500 shrink-0" />
                  <p className="text-sm font-bold text-orange-800">You are far from the event location</p>
                </div>
                <p className="text-sm text-orange-700">
                  You are <span className="font-bold">{checkInDistanceMeters != null ? (checkInDistanceMeters / 1000).toFixed(1) : "?"} km</span> away from the event venue.
                  Your attendance may be flagged for admin review.
                </p>
                {checkInLat != null && checkInLng != null && (
                  <p className="text-[11px] text-orange-500 font-mono">
                    Your GPS: {checkInLat.toFixed(6)}, {checkInLng.toFixed(6)}
                  </p>
                )}
                <p className="text-xs text-orange-600">Attendance will not be blocked — you can still continue.</p>
              </div>
              <button
                onClick={refreshCheckInLocation}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-primary border border-primary/30 rounded-xl h-10 hover:bg-primary/5"
              >
                <RefreshCw className="w-4 h-4" /> Refresh My Location
              </button>
              <Button
                onClick={() => setCheckInStep("ready")}
                className="w-full h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              >
                Continue Anyway
              </Button>
              <Button
                variant="ghost"
                onClick={() => setCheckInOpen(false)}
                className="w-full rounded-xl text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-2">
              {/* Location status */}
              {checkInLat ? (
                checkInDistanceMeters != null && checkInDistanceMeters > 1000 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-orange-50 border border-orange-200 text-orange-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">⚠️ Outside location — {checkInDistanceMeters >= 1000 ? `${(checkInDistanceMeters / 1000).toFixed(1)} km` : `${checkInDistanceMeters}m`} from venue</span>
                  </div>
                ) : checkInDistanceMeters != null ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-700">
                    <LocateFixed className="w-4 h-4 shrink-0" />
                    <span className="font-semibold">✅ Within location — {checkInDistanceMeters < 1000 ? `${checkInDistanceMeters}m` : `${(checkInDistanceMeters / 1000).toFixed(1)} km`} from venue</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-sky-50 border border-sky-200 text-sky-700">
                    <LocateFixed className="w-4 h-4 shrink-0" />
                    <span>GPS captured (venue coordinates not set)</span>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{locationError || "Location not available"}</span>
                </div>
              )}

              {/* Selfie capture — required */}
              <div className={`flex flex-col gap-2 rounded-xl p-2.5 border ${!selfieBase64 ? "border-rose-200 bg-rose-50/30" : "border-transparent"}`}>
                <p className="text-sm font-semibold flex items-center gap-1">
                  Selfie <span className="text-rose-500 font-bold">*</span>
                  <span className="text-xs font-normal text-rose-500 ml-1">required</span>
                </p>
                {selfiePreview ? (
                  <div className="relative">
                    <img src={selfiePreview} alt="Selfie preview" className="w-full h-44 object-cover rounded-xl border border-border" />
                    <button
                      className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70 transition-colors"
                      onClick={() => { setSelfiePreview(null); setSelfieBase64(null); }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-2 h-36 rounded-xl border-2 border-dashed border-rose-300 cursor-pointer hover:border-rose-400 transition-colors bg-rose-50/20">
                    <Camera className="w-7 h-7 text-rose-400" />
                    <span className="text-sm text-rose-500 font-medium">Tap to take your selfie</span>
                    <span className="text-xs text-rose-400">Identity verification required</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      className="hidden"
                      onChange={handleSelfieCapture}
                    />
                  </label>
                )}
              </div>

              <DialogFooter className="mt-1">
                <Button
                  onClick={submitCheckIn}
                  disabled={checkInStep === "submitting" || !selfieBase64}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white h-11 rounded-xl font-semibold"
                >
                  {checkInStep === "submitting" ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>
                  ) : !selfieBase64 ? (
                    "Take selfie to continue"
                  ) : "Submit Check-In"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sticky Apply Footer */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-sm border-t border-border/60 px-4 py-4 safe-area-inset-bottom">
        <div className="max-w-2xl mx-auto">
          {isAdmin ? (
            <div className="flex items-center justify-center gap-2 h-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 font-medium text-sm">
              You are logged in as admin — please login as crew to apply
            </div>
          ) : isConfirmedShift ? (
            <div className="space-y-2">
              <div className={`grid gap-2 ${showReferInFooter ? "grid-cols-3" : "grid-cols-2"}`}>
                {/* Maps */}
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center justify-center gap-1 h-14 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <Navigation className="w-4 h-4" />
                    <span className="text-[10px] font-semibold">Maps</span>
                  </a>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1 h-14 rounded-2xl bg-slate-50 border border-slate-200 text-slate-400">
                    <Navigation className="w-4 h-4" />
                    <span className="text-[10px] font-semibold">Maps</span>
                  </div>
                )}

                {/* Refer & Earn — only when slots remain and reward exists */}
                {showReferInFooter && (
                  <button
                    onClick={handleReferAndEarn}
                    disabled={referralLoading}
                    className="flex flex-col items-center justify-center gap-1 h-14 rounded-2xl bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 active:scale-95 transition-all"
                  >
                    <Gift className="w-4 h-4" />
                    <span className="text-[10px] font-semibold">
                      {referralLoading ? "…" : `Refer ₹${referralReward!.toLocaleString("en-IN")}`}
                    </span>
                  </button>
                )}

                {/* Check-in */}
                <button
                  onClick={openCheckInModal}
                  disabled={alreadyCheckedIn || !isEventToday}
                  className={`flex flex-col items-center justify-center gap-1 h-14 rounded-2xl border transition-colors ${
                    alreadyCheckedIn
                      ? "bg-emerald-100 border-emerald-300 text-emerald-700 cursor-default"
                      : isEventToday
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 active:scale-95"
                      : "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  <Fingerprint className="w-4 h-4" />
                  <span className="text-[10px] font-semibold">
                    {alreadyCheckedIn ? "Checked In ✓" : checkingIn ? "…" : "Check In"}
                  </span>
                </button>
              </div>
              {!isEventToday && !alreadyCheckedIn && (
                <p className="text-center text-[10px] text-muted-foreground">Check-in unlocks on event day</p>
              )}
              {/* Check-Out button — shown once checked in */}
              {alreadyCheckedIn && (
                <button
                  onClick={handleCheckOut}
                  disabled={alreadyCheckedOut || checkingOut}
                  className={`w-full flex items-center justify-center gap-2 h-12 rounded-2xl border font-semibold text-sm transition-colors ${
                    alreadyCheckedOut
                      ? "bg-blue-100 border-blue-300 text-blue-700 cursor-default"
                      : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 active:scale-95"
                  }`}
                >
                  <LogOut className="w-4 h-4" />
                  {alreadyCheckedOut ? `Checked Out ✓` : checkingOut ? "Checking out…" : "Check Out"}
                </button>
              )}
            </div>
          ) : isApplied ? (
            <div className="flex items-center justify-center gap-2 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 font-semibold">
              <CheckCircle2 className="w-5 h-5" />
              Applied — waiting for approval
            </div>
          ) : isFull ? (
            <div className="flex items-center justify-center gap-2 h-14 rounded-2xl bg-red-50 border border-red-200 text-red-600 font-semibold">
              <Users className="w-5 h-5" />
              All Slots Filled — Applications Closed
            </div>
          ) : applicationsClosed ? (
            <div className="flex items-center justify-center h-14 rounded-2xl bg-muted text-muted-foreground font-medium">
              Applications closed
            </div>
          ) : !eligible ? (
            <div className="space-y-2">
              {referralPeriodOpen ? (
                <Button
                  className="w-full h-14 rounded-2xl text-base font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-200 flex items-center justify-center gap-2"
                  onClick={handleReferAndEarn}
                  disabled={referralLoading}
                >
                  <Gift className="w-5 h-5" />
                  {referralLoading ? "Generating link..." : "Refer & Earn"}
                  {referralReward ? ` ₹${referralReward.toLocaleString("en-IN")}` : ""}
                </Button>
              ) : (
                <div className="w-full h-14 rounded-2xl bg-muted border border-border/60 flex items-center justify-center gap-2 text-muted-foreground font-semibold text-sm">
                  <Clock className="w-4 h-4" />
                  Referral Closed
                </div>
              )}
              <p className="text-center text-xs text-muted-foreground">
                This event is for {gender?.toLowerCase() === "male" ? "Male" : "Female"} applicants only
                {!referralPeriodOpen && " · Event has started"}
              </p>
            </div>
          ) : !isApproved ? (
            <div className="w-full h-14 rounded-full flex items-center justify-center bg-muted text-muted-foreground font-medium text-sm">
              Approval Required to Apply
            </div>
          ) : availableRoles.length > 0 ? (
            <Button
              className={`w-full h-14 rounded-2xl text-base font-semibold shadow-lg transition-all ${
                selectedRoles.length > 0
                  ? "bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
              onClick={handleApplyWithRoles}
              disabled={selectedRoles.length === 0 || isApplying}
            >
              {isApplying ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Applying…</>
              ) : selectedRoles.length === 0 ? (
                "Select a role above to apply"
              ) : (
                `Apply for ${selectedRoles.join(" & ")}`
              )}
            </Button>
          ) : (
            <SlideToApply
              onSlideComplete={handleSlideComplete}
              status={slideStatus}
              disabled={!isApproved}
            />
          )}
          {!isAdmin && eligible && !isApproved && !isApplied && !applicationsClosed && (
            <p className="text-center text-xs text-muted-foreground mt-2">
              Your profile needs admin approval before you can apply.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
