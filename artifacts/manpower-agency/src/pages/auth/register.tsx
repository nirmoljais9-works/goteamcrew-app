import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileImage, FileText, CheckCircle, ArrowRight, ArrowLeft, CalendarDays, Camera as CameraIcon, AlertTriangle, X } from "lucide-react";
import { INDIA_STATES, STATE_CITIES } from "@/data/india-locations";

const ROLE_OPTIONS = [
  "Model",
  "Host / Promoter / Usher",
  "Hostess",
  "Volunteer",
  "Supervisor",
  "Emcee / Anchor",
  "Other (Please specify)",
] as const;

function parseDobText(text: string): { iso: string; valid: boolean; error?: string } {
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return { iso: "", valid: false };
  const dd = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const yyyy = parseInt(digits.slice(4, 8), 10);
  const currentYear = new Date().getFullYear();
  if (dd < 1 || dd > 31) return { iso: "", valid: false, error: "Day must be between 1 and 31" };
  if (mm < 1 || mm > 12) return { iso: "", valid: false, error: "Month must be between 1 and 12" };
  if (yyyy < 1940 || yyyy > currentYear) return { iso: "", valid: false, error: `Year must be between 1940 and ${currentYear}` };
  // Use Date rollover to catch invalid combos (31 Feb, 31 Apr, 29 Feb non-leap etc.)
  const date = new Date(yyyy, mm - 1, dd);
  if (date.getFullYear() !== yyyy || date.getMonth() !== mm - 1 || date.getDate() !== dd)
    return { iso: "", valid: false, error: "Invalid date — e.g. 31 Apr or 30 Feb don't exist" };
  if (date >= new Date()) return { iso: "", valid: false, error: "Date of birth cannot be in the future" };
  // Minimum age: 15 years
  const today = new Date();
  let age = today.getFullYear() - yyyy;
  if (today.getMonth() + 1 < mm || (today.getMonth() + 1 === mm && today.getDate() < dd)) age--;
  if (age < 15) return { iso: "", valid: false, error: "You must be at least 15 years old to register" };
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { iso, valid: true };
}

function autoFormatDob(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// ─── Selfie validation helpers (module-level, no re-creation on renders) ──────

function computeBrightness(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4)
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  return sum / (w * h);
}

// Skin-tone ratio check (YCbCr space) — covers light, medium, dark, and very dark skin
// Used as post-capture fallback when FaceDetector API is unavailable (iOS/Safari)
function computeSkinRatio(data: Uint8ClampedArray, w: number, h: number): number {
  // Analyse the central oval (40% width × 60% height) where the face should appear
  const x1 = Math.floor(w * 0.3), x2 = Math.floor(w * 0.7);
  const y1 = Math.floor(h * 0.2), y2 = Math.floor(h * 0.8);
  let skin = 0, total = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const Y  =  0.299 * r + 0.587 * g + 0.114 * b;
      const Cb = -0.169 * r - 0.331 * g + 0.500 * b + 128;
      const Cr =  0.500 * r - 0.419 * g - 0.081 * b + 128;
      // Cr≥138 reliably separates skin from cream/beige surfaces (cream walls have Cr≈130-134)
      // Diverse skin: very fair Cr≈144, medium Indian Cr≈150, dark Cr≈141, very dark Cr≈141
      if (Y >= 30 && Cb >= 70 && Cb <= 140 && Cr >= 138 && Cr <= 180) skin++;
      total++;
    }
  }
  return total > 0 ? skin / total : 0;
}

function computeBlurVariance(data: Uint8ClampedArray, w: number, h: number): number {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  let sumL = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap = Math.abs(
        -gray[idx - w - 1] - gray[idx - w] - gray[idx - w + 1]
        - gray[idx - 1] + 8 * gray[idx] - gray[idx + 1]
        - gray[idx + w - 1] - gray[idx + w] - gray[idx + w + 1]
      );
      sumL += lap; sumSq += lap * lap; n++;
    }
  }
  const mean = sumL / n;
  return sumSq / n - mean * mean;
}

interface PostCaptureResult {
  found: boolean; centered: boolean; largeEnough: boolean;
  multiple: boolean; apiAvailable: boolean;
}
async function detectFaceOnCanvas(canvas: HTMLCanvasElement): Promise<PostCaptureResult> {
  const pass: PostCaptureResult = { found: true, centered: true, largeEnough: true, multiple: false, apiAvailable: false };
  if (!("FaceDetector" in window)) return pass;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd = new (window as any).FaceDetector({ maxDetectedFaces: 3 });
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return { ...pass, apiAvailable: true };
    const bmp = await createImageBitmap(blob);
    const faces = await fd.detect(bmp);
    bmp.close();
    if (faces.length === 0) return { found: false, centered: false, largeEnough: false, multiple: false, apiAvailable: true };
    if (faces.length > 1) return { found: true, centered: false, largeEnough: true, multiple: true, apiAvailable: true };
    const f = faces[0].boundingBox;
    const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
    const centered = Math.abs(cx / canvas.width - 0.5) < 0.32 && Math.abs(cy / canvas.height - 0.5) < 0.32;
    const largeEnough = (f.width * f.height) / (canvas.width * canvas.height) > 0.04;
    return { found: true, centered, largeEnough, multiple: false, apiAvailable: true };
  } catch {
    return pass;
  }
}

// ── Email domain typo detection ───────────────────────────────────────────────
const COMMON_DOMAINS = [
  "gmail.com","yahoo.com","outlook.com","hotmail.com",
  "yahoo.in","rediffmail.com","icloud.com","live.com","protonmail.com",
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/** Returns the full corrected email if domain looks like a typo, else null. */
function suggestEmailDomain(email: string): string | null {
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 1) return null;
  const local  = email.slice(0, atIdx + 1);
  const domain = email.slice(atIdx + 1).toLowerCase();
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;
  for (const d of COMMON_DOMAINS) {
    if (levenshtein(domain, d) <= 2) return local + d;
  }
  return null;
}

/** Strict format: local@domain.tld where tld is 2+ alpha chars */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export default function Register() {
  const [, setLocation] = useLocation();
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const urlReferrerId = urlParams.get("ref");
  const urlReferralEventId = urlParams.get("event");
  const urlCrewId = urlParams.get("crew_id");

  const [prefillRejectionReason, setPrefillRejectionReason] = useState<string | null>(null);
  const [prefillLoaded, setPrefillLoaded] = useState(false);
  const { toast } = useToast();

  // ── Resume detection ─────────────────────────────────────────────────────────
  // Compute once at mount (IIFE so it runs before useState calls)
  const _resumeStep = (() => {
    try { return Math.max(1, Math.min(4, parseInt(sessionStorage.getItem("crewFormStep") || "1", 10) || 1)); } catch { return 1; }
  })();
  const _hasSavedProgress = (() => {
    try {
      const d = JSON.parse(localStorage.getItem("crewFormData") || "{}");
      return _resumeStep > 1 || !!(d.name || d.email || d.phone);
    } catch { return false; }
  })();

  // If saved progress exists, hold the user at step 1 until they choose to Continue/Start Over
  const [step, setStep] = useState(_hasSavedProgress ? 1 : _resumeStep);
  const [resumeStep] = useState(_resumeStep);
  const [showResumeBanner, setShowResumeBanner] = useState(_hasSavedProgress);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // ── Referral gender validation ────────────────────────────────────────────
  const [eventGenderReq, setEventGenderReq] = useState<string | null>(null);
  const [genderMismatchError, setGenderMismatchError] = useState<string | null>(null);

  // Fetch gender requirement once — use URL param if present, fall back to sessionStorage
  // Using a stable ref so this only fires on mount regardless of URL param changes
  const _initRefEventId = urlReferralEventId || sessionStorage.getItem("referralEvent");
  useEffect(() => {
    const refEventId = urlReferralEventId || sessionStorage.getItem("referralEvent");
    if (!refEventId) return;
    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    fetch(`${BASE_URL}/api/auth/event-gender/${refEventId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.genderRequired) setEventGenderReq(d.genderRequired); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_initRefEventId]);

  // DOB
  const [dobText, setDobText] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("crewFormMeta") || "{}").dobText || ""; } catch { return ""; }
  });
  const [dobError, setDobError] = useState("");
  const calendarRef = useRef<HTMLInputElement>(null);

  // Phone
  const [phoneDigits, setPhoneDigits] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("crewFormMeta") || "{}").phoneDigits || ""; } catch { return ""; }
  });
  const [intlCode, setIntlCode] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("crewFormMeta") || "{}").intlCode || "+"; } catch { return "+"; }
  });
  const [phoneError, setPhoneError] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [whatsappIsOnPhone, setWhatsappIsOnPhone] = useState(false);
  const [whatsappFieldRevealed, setWhatsappFieldRevealed] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappError, setWhatsappError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  // ── Custom OTP modal state ──────────────────────────────────────────────
  const [otpModalOpen, setOtpModalOpen]     = useState(false);
  const [otpValue,        setOtpValue]        = useState("");
  const [otpFocused,      setOtpFocused]      = useState(false);
  const [otpVerifying,    setOtpVerifying]    = useState(false);
  const [otpTimer,        setOtpTimer]        = useState(0);
  const [otpError,        setOtpError]        = useState("");
  const [otpResending,    setOtpResending]    = useState(false);
  const [otpSendCooldown, setOtpSendCooldown] = useState(0);
  const otpInputRef        = useRef<HTMLInputElement | null>(null);
  const [stepError,        setStepError]        = useState("");
  const [showFieldErrors,  setShowFieldErrors]  = useState(false);
  const [emailError,       setEmailError]       = useState("");
  const [emailChecking,    setEmailChecking]    = useState(false);
  const [emailSuggestion,  setEmailSuggestion]  = useState<string | null>(null);
  const otpTimerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const otpSendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startSendCooldown = (seconds: number) => {
    setOtpSendCooldown(seconds);
    if (otpSendCooldownRef.current) clearInterval(otpSendCooldownRef.current);
    otpSendCooldownRef.current = setInterval(() => {
      setOtpSendCooldown(prev => {
        if (prev <= 1) { clearInterval(otpSendCooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  // ── Duplicate-check state ────────────────────────────────────────────────
  type ExistsStatus = null | "checking" | "clear" | "exists";
  const [existsStatus, setExistsStatus] = useState<ExistsStatus>(null);
  const [existingUserStatus, setExistingUserStatus] = useState<string | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Height
  const [heightRaw, setHeightRaw] = useState(() => {
    try { return (JSON.parse(localStorage.getItem("crewFormData") || "{}").height || "").replace(/\D/g, "").slice(0, 3); } catch { return ""; }
  });
  const [heightError, setHeightError] = useState("");
  const fmtHeight = (raw: string) => {
    if (raw.length === 3) return `${raw[0]}'${raw[1]}${raw[2]}"`;
    if (raw.length === 2) return `${raw[0]}'${raw[1]}"`;
    return raw;
  };
  const isHeightValid = (raw: string) => {
    if (raw.length < 1) return false;
    return parseInt(raw[0]) >= 5;
  };

  const [formData, setFormData] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("crewFormData") || "{}");
      return {
        name: saved.name || "",
        contactNumber: saved.contactNumber || "",
        email: saved.email || "",
        password: "",
        country: saved.country || "India",
        state: saved.state || "",
        city: saved.city || "",
        customCity: saved.customCity || "",
        intlCity: saved.intlCity || "",
        dob: saved.dob || "",
        gender: saved.gender || "",
        categories: Array.isArray(saved.categories) ? (saved.categories as string[]) : [],
        customRole: saved.customRole || "",
        experienceLevel: saved.experienceLevel || "",
        languages: Array.isArray(saved.languages) ? (saved.languages as string[]) : [],
        otherLanguage: saved.otherLanguage || "",
        height: saved.height || "",
        idType: saved.idType || "",
        instagramUrl: saved.instagramUrl || "",
        referralSource: saved.referralSource || "",
        referralOther: saved.referralOther || "",
      };
    } catch {
      return {
        name: "", contactNumber: "", email: "", password: "",
        country: "India", state: "", city: "", customCity: "",
        intlCity: "", dob: "", gender: "", categories: [] as string[], customRole: "",
        experienceLevel: "", languages: [] as string[], otherLanguage: "", height: "", idType: "", instagramUrl: "",
        referralSource: "", referralOther: "",
      };
    }
  });

  // Auto-save formData (excluding password) to localStorage
  useEffect(() => {
    const { password, ...rest } = formData;
    localStorage.setItem("crewFormData", JSON.stringify(rest));
  }, [formData]);

  // Save DOB display and phone meta to sessionStorage
  useEffect(() => {
    const meta = { dobText, phoneDigits, intlCode };
    sessionStorage.setItem("crewFormMeta", JSON.stringify(meta));
  }, [dobText, phoneDigits, intlCode]);

  // Persist current step so users can resume on reload
  useEffect(() => {
    sessionStorage.setItem("crewFormStep", String(step));
  }, [step]);

  // Persist referral tracking params — in case URL gets stripped during a redirect
  useEffect(() => {
    if (urlReferrerId) sessionStorage.setItem("referralRef", urlReferrerId);
    if (urlReferralEventId) sessionStorage.setItem("referralEvent", urlReferralEventId);
  }, [urlReferrerId, urlReferralEventId]);

  // ── Shared prefill helper — populates form from a crew profile object ──────
  const applyProfilePrefill = useCallback((profile: Record<string, string | null>) => {
    setPrefillRejectionReason(profile.rejectionReason || null);
    setFormData(prev => ({
      ...prev,
      name: profile.name || prev.name,
      email: profile.email || prev.email,
      gender: profile.gender || prev.gender,
      city: profile.city || prev.city,
      height: profile.height || prev.height,
      instagramUrl: profile.instagramUrl || prev.instagramUrl,
      categories: profile.category
        ? profile.category.split(",").map((c: string) => c.trim()).filter(Boolean)
        : prev.categories,
      experienceLevel: profile.experienceLevel || prev.experienceLevel,
      languages: profile.languages
        ? profile.languages.split(",").map((l: string) => l.trim()).filter(Boolean)
        : prev.languages,
    }));
    if (profile.phone) {
      // Strip non-digits, then remove leading 91 to get bare 10-digit number
      const bare = profile.phone.replace(/\D/g, "").replace(/^91/, "").slice(-10);
      setPhoneDigits(bare);
      // Set contactNumber in the same format validateAndSetPhone uses for India
      setFormData(prev => ({ ...prev, contactNumber: `+91${bare}` }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill form from crew_id URL param (for rejected applicants revisiting via link)
  useEffect(() => {
    if (!urlCrewId || prefillLoaded) return;
    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    fetch(`${BASE_URL}/api/auth/crew-profile/${urlCrewId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(profile => {
        if (profile.error) return;
        applyProfilePrefill(profile);
        setPrefillLoaded(true);
        const email = (profile.email || "").toLowerCase().trim();
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          checkEmailExists(email);
        }
      })
      .catch(() => setPrefillLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCrewId]);

  const isIndia = formData.country === "India";
  // Block form for approved/pending/blacklisted; rejected/resubmitted users may reapply
  const formDisabled = existsStatus === "exists" && existingUserStatus !== "rejected" && existingUserStatus !== "resubmitted";

  const [files, setFiles] = useState<{
    idFile: File | null;
    selfie: File | null;
  }>({ idFile: null, selfie: null });

  // ── Camera / selfie state ────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediapieFdRef = useRef<any>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // Post-capture validation
  const [selfieValidating, setSelfieValidating] = useState(false);
  const [selfieValError, setSelfieValError] = useState("");
  const [capturedTemp, setCapturedTemp] = useState<string | null>(null);

  // Real-time face detection state (batched into one object to minimise re-renders)
  const [faceState, setFaceState] = useState({
    detected: false, inCircle: false, multiple: false, tooSmall: false,
  });
  const [fdAvailable, setFdAvailable] = useState(false);
  const detectionActiveRef = useRef(false);

  // Motion / liveness
  const [motionDetected, setMotionDetected] = useState(false);
  const motionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const motionPrevRef    = useRef<Uint8ClampedArray | null>(null);
  const motionExpiryRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionConsecRef  = useRef(0); // consecutive high-motion frames required before liveness counts
  const faceDetectedRef  = useRef(false); // mirror of faceState.detected readable inside interval closures
  // KYC auto-hold: 1.5 s stability window before enabling capture
  const [captureUnlocked, setCaptureUnlocked] = useState(false);
  // tracks whether user has tapped "Confirm" on the captured selfie
  const [selfieConfirmed, setSelfieConfirmed] = useState(false);

  // ── derived: can the user press "Take Photo"? ────────────────────────────
  // Face detection is now ALWAYS required (Chrome FaceDetector or MediaPipe).
  // While face detection is loading (!fdAvailable), capture is always blocked.
  const faceReady = fdAvailable
    && faceState.detected && faceState.inCircle && !faceState.multiple && !faceState.tooSmall;
  // logicalReady = all validations pass; captureUnlocked = held for 1.5 s without interruption
  const logicalReady = !cameraLoading && faceReady && motionDetected;
  const canCapture   = logicalReady && captureUnlocked;

  // ── derived: circle colour + status message ──────────────────────────────
  const circleStatus = (() => {
    // Loading: face detection model still initialising
    if (!fdAvailable)         return { color: "#9ca3af", dash: true,  msg: "Starting face detection…" };
    // Live face checks (same logic for Chrome FaceDetector + MediaPipe)
    if (!faceState.detected)  return { color: "#9ca3af", dash: true,  msg: "No face detected. Align your face inside the circle" };
    if (faceState.multiple)   return { color: "#f87171", dash: true,  msg: "Multiple faces detected. Please be alone" };
    if (faceState.tooSmall)   return { color: "#fbbf24", dash: true,  msg: "Move closer to the camera" };
    if (!faceState.inCircle)  return { color: "#fbbf24", dash: true,  msg: "Align your face inside the circle" };
    if (!motionDetected)      return { color: "#60a5fa", dash: true,  msg: "Slowly nod your head to confirm you're live" };
    return                    { color: "#22c55e", dash: false, msg: "Liveness confirmed — ready to capture" };
  })();

  // ── KYC-style dynamic guidance shown at the top of the camera view ────────
  const topInstruction = (() => {
    if (!fdAvailable)                      return "Starting face detection…";
    if (!faceState.detected)               return "Align your face inside the circle";
    if (faceState.multiple)                return "Only one face allowed";
    if (faceState.tooSmall)                return "Move closer to the camera";
    if (!faceState.inCircle)               return "Hold still and look straight";
    if (!motionDetected)                   return "Slowly move your head";
    if (logicalReady && !captureUnlocked)  return "Hold steady…";
    return "Perfect — ready to capture";
  })();

  // ── helpers ──────────────────────────────────────────────────────────────
  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const stopMotionDetection = () => {
    if (motionIntervalRef.current) { clearInterval(motionIntervalRef.current); motionIntervalRef.current = null; }
    if (motionExpiryRef.current)   { clearTimeout(motionExpiryRef.current);   motionExpiryRef.current   = null; }
    motionPrevRef.current  = null;
    motionConsecRef.current = 0;
  };

  // resetMotion: immediately invalidate liveness (called when face leaves frame, camera closes, session resets)
  const resetMotion = () => {
    setMotionDetected(false);
    if (motionExpiryRef.current) { clearTimeout(motionExpiryRef.current); motionExpiryRef.current = null; }
    motionConsecRef.current = 0;
  };

  // recordMotion: ONLY records motion when face is currently confirmed by the detection loop.
  // faceDetectedRef is updated synchronously in the detection loop so the interval can read it
  // without stale-closure problems — React state (faceState) is not readable inside setInterval.
  const recordMotion = () => {
    // Hard gate: if FaceDetector is available but face is not currently in the circle, discard motion
    if ("FaceDetector" in window && !faceDetectedRef.current) return;
    setMotionDetected(true);
    if (motionExpiryRef.current) clearTimeout(motionExpiryRef.current);
    motionExpiryRef.current = setTimeout(() => setMotionDetected(false), 3500);
  };

  const startMotionDetection = (video: HTMLVideoElement) => {
    stopMotionDetection();
    const W = 80, H = 60;
    const tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = H;
    const tmpCtx = tmp.getContext("2d")!;
    motionConsecRef.current = 0;
    // Keep running — each real movement refreshes the 3.5s liveness window.
    // Threshold is intentionally HIGH (4.5%) to filter camera noise and auto-focus artifacts.
    // 2 consecutive high-motion frames (600 ms) are required so a single noisy frame never counts.
    motionIntervalRef.current = setInterval(() => {
      if (video.readyState < 2 || video.paused) return;
      tmpCtx.drawImage(video, 0, 0, W, H);
      const cur = tmpCtx.getImageData(0, 0, W, H).data;
      if (motionPrevRef.current) {
        let changed = 0;
        for (let i = 0; i < cur.length; i += 4) {
          const d = (Math.abs(cur[i] - motionPrevRef.current[i])
            + Math.abs(cur[i + 1] - motionPrevRef.current[i + 1])
            + Math.abs(cur[i + 2] - motionPrevRef.current[i + 2])) / 3;
          if (d > 20) changed++;
        }
        const ratio = changed / (W * H);
        if (ratio > 0.60) {
          // Camera was dramatically repositioned (turned to point at something else).
          // Reset liveness immediately so the user can't carry over a verified state.
          resetMotion();
          motionConsecRef.current = 0;
        } else if (ratio > 0.045) {
          motionConsecRef.current++;
          if (motionConsecRef.current >= 2) recordMotion(); // genuine movement confirmed
        } else {
          motionConsecRef.current = 0; // reset streak on quiet frame
        }
      }
      motionPrevRef.current = cur.slice() as Uint8ClampedArray;
    }, 300);
  };

  // Shared helper: interpret detected face boxes and update faceState
  const applyFaceBoxes = (
    faces: Array<{ cx: number; cy: number; w: number; h: number }>,
    vw: number, vh: number
  ) => {
    const circleR = Math.min(vw, vh) * 0.467;
    const cx = vw / 2, cy = vh / 2;
    if (faces.length === 0) {
      faceDetectedRef.current = false;
      setFaceState({ detected: false, inCircle: false, multiple: false, tooSmall: false });
      resetMotion();
    } else {
      const multi = faces.length > 1;
      const f = faces[0];
      const area = f.w * f.h;
      const tooSmall = area / (vw * vh) < 0.035;
      const dist = Math.hypot(f.cx - cx, f.cy - cy);
      const inCircle = !multi && !tooSmall && dist < circleR * 0.82;
      faceDetectedRef.current = inCircle;
      setFaceState({ detected: true, inCircle, multiple: multi, tooSmall });
    }
  };

  const startDetectionLoop = async (video: HTMLVideoElement) => {
    detectionActiveRef.current = true;

    // ── Path A: Chrome's built-in FaceDetector API ──────────────────────────
    if ("FaceDetector" in window) {
      setFdAvailable(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fd = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
      const tick = async () => {
        if (!detectionActiveRef.current) return;
        if (video.readyState >= 2 && !video.paused) {
          try {
            const faces = await fd.detect(video);
            if (!detectionActiveRef.current) return;
            const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
            applyFaceBoxes(
              faces.map((f: { boundingBox: DOMRectReadOnly }) => ({
                cx: f.boundingBox.x + f.boundingBox.width / 2,
                cy: f.boundingBox.y + f.boundingBox.height / 2,
                w: f.boundingBox.width,
                h: f.boundingBox.height,
              })),
              vw, vh
            );
          } catch {
            faceDetectedRef.current = false;
            if (detectionActiveRef.current) {
              setFaceState({ detected: false, inCircle: false, multiple: false, tooSmall: false });
              resetMotion();
            }
          }
        }
        if (detectionActiveRef.current) setTimeout(tick, 200);
      };
      tick();
      return;
    }

    // ── Path B: MediaPipe Face Detection (iOS / Safari / Firefox) ───────────
    // Dynamic import keeps MediaPipe out of the main bundle — only loads when
    // the camera is actually opened, so other pages are completely unaffected.
    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let FaceDetectionClass: any;
    try {
      const mp = await import("@mediapipe/face_detection");
      FaceDetectionClass = mp.FaceDetection;
    } catch {
      // MediaPipe failed to load — fall back to skin-tone post-capture check only
      return;
    }
    const mpFd = new FaceDetectionClass({
      locateFile: (file: string) => `${BASE_URL}/mp-fd/${file}`,
    });
    mpFd.setOptions({ model: "short", minDetectionConfidence: 0.5 });

    mpFd.onResults((results: { detections?: Array<{ boundingBox?: { xCenter: number; yCenter: number; width: number; height: number } }> }) => {
      if (!detectionActiveRef.current) return;
      // Mark as available on first callback (model finished loading)
      setFdAvailable(true);
      const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
      const detections = results.detections ?? [];
      applyFaceBoxes(
        detections.map((d) => {
          const bb = d.boundingBox!;
          // MediaPipe bounding box: xCenter/yCenter are NORMALISED (0–1)
          return {
            cx: bb.xCenter * vw,
            cy: bb.yCenter * vh,
            w:  bb.width   * vw,
            h:  bb.height  * vh,
          };
        }),
        vw, vh
      );
    });

    mediapieFdRef.current = mpFd;

    // Drive detection with our own loop (no MediaPipe Camera utility needed)
    const tick = async () => {
      if (!detectionActiveRef.current) return;
      if (video.readyState >= 2 && !video.paused) {
        try { await mpFd.send({ image: video }); } catch { /* ignore bad frames */ }
      }
      if (detectionActiveRef.current) setTimeout(tick, 200);
    };
    tick();
  };

  // Phase 1 — set state so React renders the <video> element.
  const openCamera = () => {
    setCameraVisible(false);
    setCameraLoading(true);
    setCameraError("");
    setSelfieValError("");
    setCapturedTemp(null);
    resetMotion(); // clear liveness for this new session — no cached state from previous open
    faceDetectedRef.current = false;
    setFaceState({ detected: false, inCircle: false, multiple: false, tooSmall: false });
    detectionActiveRef.current = false;
    setCameraOpen(true);
  };

  // Phase 2 — starts stream after video element mounts.
  const startCamera = async (video: HTMLVideoElement) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setCameraLoading(false);
      requestAnimationFrame(() => {
        setCameraVisible(true);
        startMotionDetection(video);
        startDetectionLoop(video);
      });
    } catch (err: unknown) {
      setCameraLoading(false);
      setCameraOpen(false);
      stopMotionDetection();
      detectionActiveRef.current = false;
      const denied = err instanceof Error && err.name === "NotAllowedError";
      setCameraError(denied ? "Camera permission denied." : "Could not open camera.");
      toast({
        variant: "destructive", title: "Camera unavailable",
        description: denied
          ? "Please allow camera access in your browser settings and try again."
          : "Could not access your camera. Please try again.",
      });
    }
  };

  useEffect(() => {
    if (!cameraOpen) return;
    const video = videoRef.current;
    if (!video) { setCameraLoading(false); return; }
    startCamera(video);
    return () => {
      stopStream(); stopMotionDetection(); detectionActiveRef.current = false;
      mediapieFdRef.current?.close(); mediapieFdRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  // Auto-hold: once all validations pass, wait 1.5 s before enabling capture
  useEffect(() => {
    if (!logicalReady) { setCaptureUnlocked(false); return; }
    const t = setTimeout(() => setCaptureUnlocked(true), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicalReady]);

  const closeCamera = () => {
    setCameraVisible(false);
    stopStream();
    stopMotionDetection();
    detectionActiveRef.current = false;
    // Close MediaPipe instance if it was used
    mediapieFdRef.current?.close();
    mediapieFdRef.current = null;
    setTimeout(() => setCameraOpen(false), 280);
  };

  // Capture → re-verify live conditions → post-capture checks → save or error
  const doCapture = async (video: HTMLVideoElement) => {
    // Gate 1: all live conditions (face + position + motion) must be true right now
    if (!canCapture) return;

    // Gate 2: hard fail-safe — if FaceDetector is available and reports no face at the
    // instant of capture (e.g. user moved away just before clicking), block immediately.
    // This is intentionally separate from canCapture so it fires even on race conditions.
    if (fdAvailable && !faceState.detected) {
      setSelfieValError("Face not detected. Position your face inside the circle and try again.");
      return;
    }

    const canvas = captureCanvasRef.current;
    if (!canvas) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;

    // ① Snapshot mirrored frame
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ② Stop all live processes, show validating overlay
    stopStream(); stopMotionDetection(); detectionActiveRef.current = false;
    const tempPreview = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedTemp(tempPreview);
    setSelfieValidating(true);
    setSelfieValError("");
    setCameraVisible(false);
    setTimeout(() => setCameraOpen(false), 280);

    // ③ Quality: brightness + blur on downsampled copy
    const SW = 160, SH = Math.round(160 * h / w);
    const small = document.createElement("canvas");
    small.width = SW; small.height = SH;
    small.getContext("2d")!.drawImage(canvas, 0, 0, SW, SH);
    const sd = small.getContext("2d")!.getImageData(0, 0, SW, SH);

    let valError = "";
    const brightness = computeBrightness(sd.data, SW, SH);
    const blurVar    = computeBlurVariance(sd.data, SW, SH);

    if      (brightness < 35)  valError = "Image too dark. Ensure good lighting and retake.";
    else if (brightness > 240) valError = "Image too bright. Avoid direct light on your face and retake.";
    else if (blurVar < 28)     valError = "Image not clear. Please retake with a steady hand in good light.";

    // ④ Face check on captured frame (post-capture re-verify)
    if (!valError) {
      const face = await detectFaceOnCanvas(canvas);
      if (face.apiAvailable) {
        // Chrome / FaceDetector API: full geometric checks
        if (!face.found)            valError = "No face detected. Position your face inside the circle and retake.";
        else if (face.multiple)     valError = "Multiple faces detected. Please be alone and retake.";
        else if (!face.largeEnough) valError = "Move closer to the camera so your face is clearly visible.";
        else if (!face.centered)    valError = "Align your face properly in the circle and retake.";
      } else {
        // iOS / Safari fallback: FaceDetector not available — use YCbCr skin-tone heuristic
        // Checks the central region of the downsampled frame for human skin pixels.
        // Rejects walls, fans, ceilings, objects that have no warm skin-toned pixels.
        const skinRatio = computeSkinRatio(sd.data, SW, SH);
        if (skinRatio < 0.04) {
          valError = "No face detected. Please face the camera directly, ensure good lighting, and retake.";
        }
      }
    }

    setSelfieValidating(false);
    if (valError) { setSelfieValError(valError); return; }

    // ⑤ All checks passed — persist
    setSelfiePreview(tempPreview);
    setCapturedTemp(null);
    canvas.toBlob(blob => {
      if (blob) setFiles(prev => ({ ...prev, selfie: new File([blob!], "selfie.jpg", { type: "image/jpeg" }) }));
    }, "image/jpeg", 0.92);
  };

  const capturePhoto = () => { const v = videoRef.current; if (v) doCapture(v); };

  const retakeSelfie = () => {
    setSelfiePreview(null); setCapturedTemp(null); setSelfieValError("");
    setSelfieConfirmed(false); setCaptureUnlocked(false);
    setFiles(prev => ({ ...prev, selfie: null }));
    openCamera();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    if (name === "state") {
      setFormData(prev => ({ ...prev, state: value, city: "", customCity: "" }));
    } else if (name === "country") {
      setFormData(prev => ({
        ...prev,
        country: value,
        state: "",
        city: "",
        customCity: "",
        intlCity: "",
        contactNumber: "",
      }));
      setPhoneDigits("");
      setIntlCode("+");
      setPhoneError("");
      setPhoneVerified(false);
    } else if (name === "idType") {
      // Clear any previously uploaded ID file when type changes
      if (value !== formData.idType) {
        setFiles(prev => ({ ...prev, idFile: null }));
      }
      setFormData(prev => ({ ...prev, idType: value }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  // DOB handlers
  const handleDobTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = autoFormatDob(e.target.value);
    setDobText(formatted);
    const digits = formatted.replace(/\D/g, "");

    // Immediate partial validation — catch bad day/month as soon as entered
    if (digits.length >= 2) {
      const dd = parseInt(digits.slice(0, 2), 10);
      if (dd < 1 || dd > 31) {
        setDobError("Day must be between 01 and 31");
        setFormData(prev => ({ ...prev, dob: "" }));
        return;
      }
    }
    if (digits.length >= 4) {
      const mm = parseInt(digits.slice(2, 4), 10);
      if (mm < 1 || mm > 12) {
        setDobError("Month must be between 01 and 12");
        setFormData(prev => ({ ...prev, dob: "" }));
        return;
      }
    }

    setDobError("");

    // Full validation once all 8 digits are entered
    if (digits.length === 8) {
      const { iso, valid, error } = parseDobText(formatted);
      if (valid) {
        setFormData(prev => ({ ...prev, dob: iso }));
      } else {
        setFormData(prev => ({ ...prev, dob: "" }));
        setDobError(error || "Please enter a valid date of birth");
      }
    } else {
      setFormData(prev => ({ ...prev, dob: "" }));
    }
  };

  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value;
    if (!iso) return;
    const [yyyy, mm, dd] = iso.split("-");
    setDobText(`${dd}/${mm}/${yyyy}`);
    setDobError("");
    setFormData(prev => ({ ...prev, dob: iso }));
  };

  // Phone handlers
  const validateAndSetPhone = (digits: string, code: string, india: boolean) => {
    if (india) {
      if (digits.length !== 10 || !/^[6-9]/.test(digits)) {
        setPhoneError("Enter valid 10-digit mobile number");
        setFormData(prev => ({ ...prev, contactNumber: "" }));
      } else {
        setPhoneError("");
        setFormData(prev => ({ ...prev, contactNumber: `+91${digits}` }));
      }
    } else {
      if (digits.length < 6 || digits.length > 15) {
        setPhoneError("Enter valid phone number");
        setFormData(prev => ({ ...prev, contactNumber: "" }));
      } else {
        setPhoneError("");
        const fullCode = code.startsWith("+") ? code : `+${code}`;
        setFormData(prev => ({ ...prev, contactNumber: `${fullCode}${digits}` }));
      }
    }
  };

  // ── OTP timer helpers ─────────────────────────────────────────────────────
  const startOtpTimer = (seconds = 30) => {
    if (otpTimerRef.current) clearInterval(otpTimerRef.current);
    setOtpTimer(seconds);
    otpTimerRef.current = setInterval(() => {
      setOtpTimer(t => {
        if (t <= 1) { clearInterval(otpTimerRef.current!); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  const openOtpModal = () => {
    setOtpValue("");
    setOtpError("");
    setOtpModalOpen(true);
    startOtpTimer(30);
    setTimeout(() => otpInputRef.current?.focus(), 100);
  };

  const closeOtpModal = () => {
    setOtpModalOpen(false);
    setOtpValue("");
    setOtpFocused(false);
    setOtpError("");
    setOtpVerifying(false);
    if (otpTimerRef.current) clearInterval(otpTimerRef.current);
  };

  // ── MSG91 OTP Verification ────────────────────────────────────────────────
  const triggerOTP = () => {
    if (!phoneDigits || phoneDigits.length !== 10 || phoneError) return;
    if (otpLoading || otpSendCooldown > 0) return;
    setOtpLoading(true);
    const identifier = `91${phoneDigits}`;
    console.log("[OTP] triggerOTP called — identifier:", identifier, "| domain:", window.location.hostname);

    const doSend = () => {
      console.log("[OTP] Calling window.initSendOTP with widgetId: 36646f674475303238343136");
      // @ts-ignore
      window.initSendOTP({
        widgetId: "36646f674475303238343136",
        tokenAuth: "508849TqFl2WeiaRJg69df3ff5P1",
        identifier,
        exposeMethods: true,
        success: (_data: unknown) => {
          console.log("[OTP] Verification SUCCESS", _data);
          setPhoneVerified(true);
          closeOtpModal();
          setOtpLoading(false);
        },
        failure: (_err: unknown) => {
          console.error("[OTP] Verification FAILED", _err);
          setOtpError("Verification failed. Please try again.");
          setOtpVerifying(false);
          setOtpLoading(false);
        },
      });

      // OTP is now in flight — open our custom entry modal immediately
      setOtpLoading(false);
      startSendCooldown(30);
      openOtpModal();
    };

    const urls = [
      "https://verify.msg91.com/otp-provider.js",
      "https://verify.phone91.com/otp-provider.js",
    ];
    let urlIndex = 0;
    // @ts-ignore
    if (typeof window.initSendOTP === "function") {
      console.log("[OTP] MSG91 SDK already loaded — calling doSend()");
      doSend();
    } else {
      const loadNext = () => {
        if (urlIndex >= urls.length) {
          console.error("[OTP] All MSG91 script URLs failed to load — OTP unavailable");
          setOtpLoading(false);
          toast({ variant: "destructive", title: "OTP service unavailable", description: "Please check your connection and try again." });
          return;
        }
        const script = document.createElement("script");
        script.src = urls[urlIndex];
        script.async = true;
        console.log("[OTP] Attempting to load MSG91 SDK from:", urls[urlIndex]);
        script.onload = () => {
          console.log("[OTP] Script loaded from:", urls[urlIndex - 1] ?? urls[urlIndex]);
          // @ts-ignore
          if (typeof window.initSendOTP === "function") {
            console.log("[OTP] window.initSendOTP is available — calling doSend()");
            doSend();
          } else {
            console.warn("[OTP] Script loaded but window.initSendOTP not found — trying next URL");
            urlIndex++; loadNext();
          }
        };
        script.onerror = () => {
          console.error("[OTP] Failed to load script from:", urls[urlIndex]);
          urlIndex++; loadNext();
        };
        document.head.appendChild(script);
      };
      loadNext();
    }
  };

  // Single-input OTP handler — browser autofill (SMS, iOS, Android) fills the
  // whole code at once; onChange distributes digits to the visual boxes.
  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
    setOtpValue(val);
    setOtpError("");
    if (val.length === 4) {
      submitOtp(val);
    }
  };

  const submitOtp = (otp?: string) => {
    const code = otp ?? otpValue;
    if (code.length !== 4) { setOtpError("Please enter the 4-digit OTP"); return; }
    setOtpVerifying(true);
    setOtpError("");
    // @ts-ignore
    if (typeof window.verifyOtp === "function") {
      // @ts-ignore
      window.verifyOtp(code,
        (_data: unknown) => { setPhoneVerified(true); closeOtpModal(); setOtpLoading(false); },
        (_err: unknown) => {
          setOtpVerifying(false);
          setOtpError("Incorrect OTP. Please try again.");
          setOtpValue("");
          setTimeout(() => otpInputRef.current?.focus(), 50);
        }
      );
    } else {
      setOtpVerifying(false);
      setOtpError("Verification service error. Please retry.");
    }
  };

  const resendOtp = () => {
    if (otpTimer > 0 || otpResending) return;
    setOtpResending(true);
    setOtpValue("");
    setOtpError("");
    const identifier = `91${phoneDigits}`;
    // @ts-ignore
    if (typeof window.retryOtp === "function") {
      // @ts-ignore
      window.retryOtp("text",
        () => { setOtpResending(false); startOtpTimer(30); setTimeout(() => otpInputRef.current?.focus(), 50); },
        () => { setOtpResending(false); setOtpError("Failed to resend OTP. Please try again."); }
      );
    // @ts-ignore
    } else if (typeof window.sendOtp === "function") {
      // @ts-ignore
      window.sendOtp(identifier, true,
        () => { setOtpResending(false); startOtpTimer(30); setTimeout(() => otpInputRef.current?.focus(), 50); },
        () => { setOtpResending(false); setOtpError("Failed to resend OTP. Please try again."); }
      );
    } else {
      setOtpResending(false);
    }
  };

  // ── Duplicate registration check ─────────────────────────────────────────
  const triggerExistsCheck = (params: { phone?: string; email?: string }) => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    setExistsStatus("checking");
    checkTimerRef.current = setTimeout(async () => {
      try {
        const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
        const qs = new URLSearchParams();
        if (params.phone)  qs.set("phone", params.phone);
        if (params.email)  qs.set("email", params.email);
        const res = await fetch(`${BASE_URL}/api/auth/check-exists?${qs}`, { cache: "no-store" });
        const data = await res.json();
        if (data.exists) {
          setExistsStatus("exists" as ExistsStatus);
          setExistingUserStatus(data.status ?? null);
          // Auto-prefill form if the account is rejected/resubmitted and we have a profile ID
          if ((data.status === "rejected" || data.status === "resubmitted") && data.crewProfileId && !prefillLoaded) {
            fetch(`${BASE_URL}/api/auth/crew-profile/${data.crewProfileId}`, { cache: "no-store" })
              .then(r => r.json())
              .then(profile => {
                if (!profile.error) {
                  applyProfilePrefill(profile);
                  const email = (profile.email || "").toLowerCase().trim();
                  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    checkEmailExists(email);
                  }
                }
              })
              .catch(() => {});
          }
        } else {
          setExistsStatus("clear");
          setExistingUserStatus(null);
        }
      } catch {
        setExistsStatus(null); // network error — let the user proceed
      }
    }, 600);
  };

  const resetExistsCheck = () => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    setExistsStatus(null);
    setExistingUserStatus(null);
  };

  // ── Email-only uniqueness check (never touches existsStatus / banners) ──
  const emailCheckTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailCheckAbortRef  = useRef<AbortController | null>(null);
  const emailSpinnerTimers  = useRef<ReturnType<typeof setTimeout>[]>([]);

  // On mount: silently validate any email pre-filled from localStorage
  useEffect(() => {
    const email = formData.email?.toLowerCase().trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      checkEmailExists(email);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkEmailExists = (email: string) => {
    // Cancel any pending debounce + in-flight request + spinner timers
    if (emailCheckTimerRef.current) clearTimeout(emailCheckTimerRef.current);
    if (emailCheckAbortRef.current) emailCheckAbortRef.current.abort();
    emailSpinnerTimers.current.forEach(clearTimeout);
    emailSpinnerTimers.current = [];
    setEmailChecking(false);

    emailCheckTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      emailCheckAbortRef.current = controller;

      // Only reveal the spinner if the API takes >300ms — avoids flash for fast responses
      const showSpinner  = setTimeout(() => setEmailChecking(true),  300);
      // Cap how long the spinner is visible (1.5s max) — never block the user
      const hideSpinner  = setTimeout(() => setEmailChecking(false), 1800);
      emailSpinnerTimers.current = [showSpinner, hideSpinner];

      try {
        const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
        const res = await fetch(
          `${BASE_URL}/api/auth/check-exists?email=${encodeURIComponent(email)}`,
          { cache: "no-store", signal: controller.signal }
        );
        clearTimeout(showSpinner);
        clearTimeout(hideSpinner);
        setEmailChecking(false);

        const data = await res.json();
        if (data.exists) {
          setEmailError("This email is already registered. Please use a different email or log in.");
        } else {
          setEmailError(prev =>
            prev === "This email is already registered. Please use a different email or log in." ? "" : prev
          );
        }
      } catch {
        // Aborted (new request started) or network error — hide spinner, let user proceed silently
        clearTimeout(showSpinner);
        clearTimeout(hideSpinner);
        setEmailChecking(false);
      }
    }, 500);
  };

  const handlePhoneDigits = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, isIndia ? 10 : 15);
    setPhoneDigits(digits);
    setPhoneVerified(false);
    validateAndSetPhone(digits, intlCode, isIndia);
    // Trigger duplicate check when Indian number is complete (10 digits)
    if (isIndia && digits.length === 10) {
      triggerExistsCheck({ phone: `+91${digits}` });
    } else if (digits.length < 10) {
      resetExistsCheck();
    }
  };

  const handleIntlCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (!val.startsWith("+")) val = "+" + val.replace(/\D/g, "");
    else val = "+" + val.slice(1).replace(/\D/g, "");
    setIntlCode(val);
    validateAndSetPhone(phoneDigits, val, false);
  };

  const effectiveCity = isIndia
    ? (formData.city === "Other" ? formData.customCity : formData.city)
    : formData.intlCity;

  // Smoothly scroll to a field by id and focus it
  const scrollToField = (id: string) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        try { (el as HTMLInputElement).focus(); } catch {}
      }
    }, 60);
  };

  const failStep = (fieldId: string) => {
    setStepError("Please fill all required details");
    setShowFieldErrors(true);
    scrollToField(fieldId);
  };

  const nextStep = () => {
    if (step === 1) {
      if (formDisabled) {
        toast({ variant: "destructive", title: "Account already exists", description: "Please log in or contact support." });
        return;
      }
      if (!formData.name) { failStep("name"); return; }
      if (!formData.email) { failStep("email"); return; }
      if (!EMAIL_RE.test(formData.email.trim())) {
        setEmailError("Enter a valid email address (e.g. name@gmail.com)");
        failStep("email"); return;
      }
      if (emailError) { failStep("email"); return; }
      if (emailSuggestion) {
        setEmailError("Please confirm your email — did you mean " + emailSuggestion + "?");
        failStep("email"); return;
      }
      if (!formData.password) { failStep("password"); return; }
      if (dobError || !formData.dob) { failStep("dob"); return; }
      if (!formData.gender) { failStep("field-gender"); return; }
      if (!formData.contactNumber || phoneError) { failStep("field-phone"); return; }
      if (isIndia && !phoneVerified) {
        setStepError("Please verify your phone number with OTP before continuing");
        setShowFieldErrors(true);
        scrollToField("field-phone");
        return;
      }
      if (!whatsappIsOnPhone) {
        if (!whatsappFieldRevealed) {
          setWhatsappFieldRevealed(true);
          setWhatsappError("Please confirm if this number is on WhatsApp or provide a WhatsApp number");
          setStepError("Please fill all required details");
          scrollToField("whatsappCheckbox");
          return;
        }
        if (!whatsappNumber || whatsappNumber.length !== 10) {
          setWhatsappError("Please enter a valid 10-digit WhatsApp number");
          failStep("whatsappNumber");
          return;
        }
      }
      if (isIndia) {
        if (!formData.state) { failStep("field-state"); return; }
        if (!formData.city) { failStep("field-city"); return; }
        if (formData.city === "Other" && !formData.customCity.trim()) { failStep("field-city"); return; }
      } else {
        if (!formData.intlCity.trim()) { failStep("field-city"); return; }
      }
      if (eventGenderReq) {
        const req = eventGenderReq.toLowerCase();
        if (req !== "any" && req !== "both" && req !== "") {
          if (!formData.gender || formData.gender.toLowerCase() !== req) {
            setGenderMismatchError(`This event is for ${eventGenderReq} candidates only. You cannot register with this referral link.`);
            failStep("field-gender");
            return;
          }
        }
      }
    }
    if (step === 2) {
      if (formData.categories.length === 0) { failStep("field-categories"); return; }
      if (!formData.experienceLevel) { failStep("field-experience"); return; }
      if (formData.categories.includes("Other (Please specify)") && !formData.customRole.trim()) {
        failStep("field-categories"); return;
      }
      if (formData.languages.length === 0) { failStep("field-languages"); return; }
      if (formData.languages.includes("Other") && !formData.otherLanguage.trim()) {
        failStep("field-languages"); return;
      }
      if (heightRaw.length === 0) { setHeightError("Please enter your height"); failStep("height"); return; }
      if (!isHeightValid(heightRaw)) { setHeightError("Minimum height should be 5 feet"); failStep("height"); return; }
      if (!formData.referralSource) { failStep("field-referral"); return; }
      if (formData.referralSource === "Other" && !formData.referralOther.trim()) {
        failStep("field-referral"); return;
      }
    }
    setStepError("");
    setShowFieldErrors(false);
    setStep(prev => prev + 1);
  };

  const prevStep = () => setStep(prev => prev - 1);

  // ── Resume / Start Over ───────────────────────────────────────────────────
  const handleContinueRegistration = () => {
    setStep(resumeStep);
    setShowResumeBanner(false);
  };

  const handleStartOver = () => {
    localStorage.removeItem("crewFormData");
    sessionStorage.removeItem("crewFormMeta");
    sessionStorage.removeItem("crewFormStep");
    setFormData({
      name: "", contactNumber: "", email: "", password: "",
      country: "India", state: "", city: "", customCity: "",
      intlCity: "", dob: "", gender: "", categories: [], customRole: "",
      experienceLevel: "", languages: [], otherLanguage: "", height: "", idType: "", instagramUrl: "",
      referralSource: "", referralOther: "",
    });
    setDobText("");
    setPhoneDigits("");
    setPhoneVerified(false);
    setIntlCode("+");
    setHeightRaw("");
    setStep(1);
    setShowResumeBanner(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Hard guard: password is never saved across sessions ───────────────
    if (!formData.password || formData.password.trim().length === 0) {
      toast({ variant: "destructive", title: "Password required", description: "Please go back to Step 1 and set your password before submitting." });
      setStep(1);
      setTimeout(() => document.getElementById("password")?.focus(), 300);
      return;
    }

    if (!formData.idType || !files.idFile || !files.selfie) {
      toast({ variant: "destructive", title: "Missing files", description: "Please select an ID type, upload your ID, and take a selfie." });
      return;
    }
    if (!termsAccepted) {
      toast({ variant: "destructive", title: "Terms & Conditions", description: "Please accept Terms & Conditions before submitting." });
      return;
    }

    // ── Gender requirement check for referred events ───────────────────────
    if (eventGenderReq) {
      const req = eventGenderReq.toLowerCase();
      if (req !== "any" && req !== "both" && req !== "") {
        const userGender = formData.gender.toLowerCase();
        if (userGender !== req) {
          setGenderMismatchError(`This event is only for ${eventGenderReq} candidates. You cannot apply for this event.`);
          return;
        }
      }
    }
    setGenderMismatchError(null);

    setIsSubmitting(true);
    try {
      const data = new FormData();

      // Calculate age from dob (ISO format: YYYY-MM-DD)
      let age = "";
      if (formData.dob) {
        const birth = new Date(formData.dob);
        const today = new Date();
        let a = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--;
        age = String(a);
      }

      // Core fields (mapped to API field names)
      const normalizedName = formData.name.trim().split(/\s+/).filter((w: string) => w.length > 0).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      const normalizedEmail = formData.email.toLowerCase().trim();
      data.append("name", normalizedName);
      data.append("email", normalizedEmail);
      data.append("password", formData.password);
      data.append("phone", formData.contactNumber);   // API expects "phone"
      data.append("city", effectiveCity);
      data.append("gender", formData.gender);
      const roleList = formData.categories
        .map(c => c === "Other (Please specify)" ? formData.customRole.trim() : c)
        .filter(Boolean);
      data.append("category", roleList.join(", "));
      if (formData.customRole.trim()) data.append("customRole", formData.customRole.trim());
      data.append("experienceLevel", formData.experienceLevel);
      data.append("age", age);
      if (formData.height) data.append("height", fmtHeight(heightRaw) || formData.height);
      if (formData.instagramUrl) data.append("instagramUrl", formData.instagramUrl);
      if (formData.state) data.append("state", formData.state);
      if (formData.dob) data.append("dob", formData.dob);
      if (formData.idType) data.append("idType", formData.idType);
      if (formData.referralSource) data.append("referralSource", formData.referralSource);
      if (formData.referralOther) data.append("referralOther", formData.referralOther);

      // Pass referral tracking params — use URL first, fall back to sessionStorage
      const effectiveRef = urlReferrerId || sessionStorage.getItem("referralRef");
      const effectiveEvent = urlReferralEventId || sessionStorage.getItem("referralEvent");
      if (effectiveRef) data.append("referrerId", effectiveRef);
      if (effectiveEvent) data.append("referralEventId", effectiveEvent);
      if (effectiveRef) console.log(`[register] Sending referral: ref=${effectiveRef}, event=${effectiveEvent}`);
      // Pass crew_id for resubmission tracking
      if (urlCrewId) data.append("crewId", urlCrewId);

      // Languages
      const langList = formData.languages.includes("Other")
        ? [...formData.languages.filter(l => l !== "Other"), formData.otherLanguage.trim()].filter(Boolean)
        : formData.languages;
      data.append("languages", langList.join(", "));

      // Files
      data.append("aadhaarCard", files.idFile!);
      data.append("closeUpPhoto", files.selfie!);

      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/register`, { method: "POST", body: data, credentials: "include" });
      const responseData = await res.json().catch(() => ({}));

      if (res.ok) {
        localStorage.removeItem("crewFormData");
        sessionStorage.removeItem("crewFormMeta");
        sessionStorage.removeItem("crewFormStep");
        sessionStorage.removeItem("referralRef");
        sessionStorage.removeItem("referralEvent");
        if (responseData.reapplied) {
          setLocation("/register-success?reapplied=true");
        } else {
          setLocation("/register-success");
        }
        return;
      }

      // Handle specific error codes
      const code = responseData.code;
      const msg = (responseData.error || responseData.message || "An unexpected error occurred.") +
        (responseData.detail ? ` (${responseData.detail})` : "");

      if (code === "GENDER_MISMATCH") {
        setGenderMismatchError(msg);
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      } else if (code === "BLACKLISTED") {
        toast({
          variant: "destructive",
          title: "Registration blocked",
          description: "You are not allowed to register on this platform. Contact info@goteamcrew.in for assistance.",
        });
      } else if (code === "ALREADY_REGISTERED") {
        toast({
          variant: "destructive",
          title: "Already registered",
          description: "You are already registered. Please log in to your account.",
        });
        setTimeout(() => setLocation("/login"), 2500);
      } else {
        toast({ variant: "destructive", title: "Registration failed", description: msg });
      }
    } catch {
      toast({ variant: "destructive", title: "Network error", description: "Could not connect to the server. Please check your connection." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const citiesForState = formData.state ? (STATE_CITIES[formData.state] ?? ["Other"]) : [];

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4 sm:px-6 lg:px-8 flex flex-col items-center">

      {/* ── Premium OTP Modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {otpModalOpen && (
          <motion.div
            key="otp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          >
            <motion.div
              key="otp-card"
              initial={{ opacity: 0, scale: 0.92, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 24 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Top accent bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-primary via-violet-400 to-primary" />

              <div className="px-7 py-8 flex flex-col items-center text-center">
                {/* Close button */}
                <button
                  onClick={closeOtpModal}
                  className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Icon ring */}
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                  <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
                  </svg>
                </div>

                {/* Heading */}
                <h2 className="text-xl font-bold text-foreground mb-1">Verify your number</h2>
                <p className="text-sm text-muted-foreground mb-1">We sent a 4-digit code to</p>
                <p className="text-sm font-semibold text-foreground mb-7">+91 {phoneDigits}</p>

                {/* OTP digit boxes — 4 visual divs + one real hidden input */}
                {/* The single input carries autocomplete="one-time-code" so Safari/Chrome/Android  */}
                {/* can autofill the SMS code into it; onChange distributes digits to the boxes.    */}
                <div
                  className="relative flex gap-3 mb-5"
                  onClick={() => otpInputRef.current?.focus()}
                >
                  {/* 4 visual-only boxes */}
                  {[0, 1, 2, 3].map(i => {
                    const digit = otpValue[i] ?? "";
                    const isActive = otpFocused && i === Math.min(otpValue.length, 3);
                    return (
                      <div
                        key={i}
                        className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-xl font-bold select-none transition-all
                          ${otpError
                            ? "border-red-400 bg-red-50 text-red-600"
                            : digit
                              ? "border-primary bg-primary/5 text-primary"
                              : isActive
                                ? "border-primary bg-white ring-4 ring-primary/15"
                                : "border-input bg-muted/40 text-foreground"
                          }
                          ${otpVerifying ? "opacity-60" : ""}`}
                      >
                        {digit}
                      </div>
                    );
                  })}

                  {/* Real input — invisible overlay — receives focus, keyboard & autofill */}
                  <input
                    ref={otpInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={4}
                    pattern="\d{4}"
                    value={otpValue}
                    onChange={handleOtpChange}
                    onFocus={() => setOtpFocused(true)}
                    onBlur={() => setOtpFocused(false)}
                    disabled={otpVerifying}
                    aria-label="Enter OTP"
                    className="absolute inset-0 w-full h-full z-10 cursor-text opacity-0"
                    style={{ caretColor: "transparent", fontSize: "1px" }}
                  />
                </div>

                {/* Error */}
                {otpError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-red-500 font-medium mb-4"
                  >
                    {otpError}
                  </motion.p>
                )}

                {/* Verify button */}
                <button
                  type="button"
                  onClick={() => submitOtp()}
                  disabled={otpValue.length !== 4 || otpVerifying}
                  className={`w-full h-12 rounded-2xl font-semibold text-sm transition-all
                    bg-primary text-white flex items-center justify-center gap-2 mb-5
                    ${otpVerifying
                      ? "opacity-95 cursor-not-allowed"
                      : otpValue.length !== 4
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:bg-primary/90 active:scale-[0.98]"
                    }`}
                >
                  {otpVerifying ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Verifying…
                    </>
                  ) : "Verify OTP"}
                </button>

                {/* Resend row */}
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">Didn't receive it?</span>
                  {otpTimer > 0 ? (
                    <span className="text-muted-foreground font-medium">Resend in {otpTimer}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={resendOtp}
                      disabled={otpResending}
                      className="text-primary font-semibold hover:underline disabled:opacity-50"
                    >
                      {otpResending ? "Sending…" : "Resend OTP"}
                    </button>
                  )}
                </div>

                {/* Footer */}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="w-full max-w-3xl mb-8 flex justify-center">
        <Link href="/">
          <img src={`${import.meta.env.BASE_URL}images/goteamcrew-logo.png`} alt="Goteamcrew" className="h-14 w-auto object-contain hover:opacity-80 transition-opacity cursor-pointer" />
        </Link>
      </div>

      {/* ── Resume Registration banner ─────────────────────────────────────── */}
      {showResumeBanner && (
        <div className="w-full max-w-3xl mb-4">
          <div className="rounded-2xl bg-white border border-border/50 shadow-[0_1px_8px_rgba(0,0,0,0.06)] px-4 py-4">
            {/* Top row — icon + text */}
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 mt-0.5">
                <ArrowRight className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground leading-snug">Finish your profile or start again</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  You left on <span className="font-medium text-foreground">Step {resumeStep}</span>
                  {" · "}{resumeStep === 1 ? "Personal Details" : resumeStep === 2 ? "Professional Info" : resumeStep === 3 ? "Documents & Photos" : "Review & Submit"}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Choose an option to continue</p>
              </div>
            </div>

            {/* Actions — stacked so "Continue where you left" never wraps */}
            <div className="flex flex-col gap-2 mt-3.5">
              <button
                type="button"
                onClick={handleContinueRegistration}
                className="w-full text-[13px] font-semibold bg-primary text-primary-foreground rounded-xl py-2.5 hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm"
              >
                Continue where you left
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className="w-full text-[12px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition-all py-1"
              >
                Start Again
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`w-full max-w-3xl bg-card rounded-[2rem] shadow-xl border border-border/50 overflow-hidden relative ${showResumeBanner ? "select-none" : ""}`}>
        {/* Blur + click-block overlay when banner is active */}
        {showResumeBanner && (
          <div
            className="absolute inset-0 z-20 rounded-[2rem] backdrop-blur-[3px] bg-white/30"
            style={{ pointerEvents: "all", cursor: "not-allowed" }}
            aria-hidden="true"
          />
        )}
        <div className="bg-white px-8 py-6 border-b border-gray-100">
          {/* Title row */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Crew Registration Forms</h2>
            <span className="text-sm font-medium text-gray-400">Step {step}/4</span>
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-2 mb-3">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                  i <= step ? "bg-primary" : "bg-gray-200"
                }`}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className="w-full h-[6px] rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-in-out"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>

          {/* Step label */}
          <p className="text-sm text-gray-400 mt-2.5 font-medium">
            {step === 1 ? "Personal Details" : step === 2 ? "Professional Info" : step === 3 ? "Documents & Photos" : "Review & Submit"}
          </p>
        </div>

        <div className="p-8 sm:p-12">
          <form onSubmit={onSubmit}>
            {/* Password nudge — shown whenever we've resumed past step 1 without a password */}
            {step > 1 && !formData.password && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800">Welcome back — your progress was saved!</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    For security, your password was not saved. Please{" "}
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="underline font-semibold hover:text-amber-900 transition-colors"
                    >
                      go back to Step 1
                    </button>{" "}
                    and re-enter it before submitting.
                  </p>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">

                  {/* ── Rejection reason banner (from edit link crew_id param) ── */}
                  {prefillRejectionReason && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-2">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                          <AlertTriangle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-red-800 text-sm">Your previous application was not approved</p>
                          <p className="text-xs text-red-700 mt-1 font-medium">Reason: <span className="italic">{prefillRejectionReason}</span></p>
                          <p className="text-xs text-red-600 mt-1">Please update your details below and resubmit. All fields are prefilled from your previous application.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Status-aware banners — one per possible status ── */}

                  {/* Approved / Active */}
                  {existsStatus === "exists" && (existingUserStatus === "approved" || existingUserStatus === "active") && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-emerald-800 text-sm">Your account is approved</p>
                          <p className="text-xs text-emerald-700 mt-1">You already have an active account. Please log in to access your dashboard.</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Link href="/login">
                          <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4 text-xs">Log In</Button>
                        </Link>
                        <a href="mailto:info@goteamcrew.in">
                          <Button type="button" size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 h-9 px-4 text-xs">Contact Support</Button>
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Pending */}
                  {existsStatus === "exists" && existingUserStatus === "pending" && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-amber-800 text-sm">Your profile is under review</p>
                          <p className="text-xs text-amber-700 mt-1">We've received your application and our team is reviewing it. We'll notify you once it's approved.</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a href="mailto:info@goteamcrew.in">
                          <Button type="button" size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100 h-9 px-4 text-xs">Contact Support</Button>
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Rejected — form prefilled and enabled so they can reapply */}
                  {existsStatus === "exists" && existingUserStatus === "rejected" && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                          <AlertTriangle className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-orange-800 text-sm">Your previous application was not approved</p>
                          <p className="text-xs text-orange-700 mt-1">Your details have been prefilled from your previous application. Review, update anything needed, and resubmit.</p>
                          {prefillRejectionReason && (
                            <p className="text-xs text-orange-700 mt-1 font-medium">Reason: <span className="italic">{prefillRejectionReason}</span></p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a href="mailto:info@goteamcrew.in">
                          <Button type="button" size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100 h-9 px-4 text-xs">Contact Support</Button>
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Resubmitted — already updated, under review again */}
                  {existsStatus === "exists" && existingUserStatus === "resubmitted" && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-amber-800 text-sm">Your updated profile is under review</p>
                          <p className="text-xs text-amber-700 mt-1">You have already resubmitted your profile. Our team is reviewing it. You may update again if needed.</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a href="mailto:info@goteamcrew.in">
                          <Button type="button" size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-100 h-9 px-4 text-xs">Contact Support</Button>
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Blacklisted — form fully disabled */}
                  {existsStatus === "exists" && existingUserStatus === "blacklisted" && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-red-800 text-sm">Your account is restricted</p>
                          <p className="text-xs text-red-700 mt-1">This account has been restricted from registering. Please contact support if you think this is a mistake.</p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <a href="mailto:info@goteamcrew.in">
                          <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700 text-white h-9 px-4 text-xs">Contact Support</Button>
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* Full Name */}
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name <span className="text-red-500">*</span></Label>
                      <Input
                        id="name"
                        name="name"
                        value={formData.name}
                        onChange={(e) => { handleInputChange(e); if (showFieldErrors) setShowFieldErrors(false); setStepError(""); }}
                        onBlur={() =>
                          setFormData(prev => ({
                            ...prev,
                            name: prev.name
                              .trim()
                              .split(/\s+/)
                              .filter((w: string) => w.length > 0)
                              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                              .join(" "),
                          }))
                        }
                        className="h-12 bg-muted/50"
                        placeholder="Enter your full name"
                        required
                        disabled={formDisabled}
                      />
                    </div>

                    {/* Contact Details */}
                    <div id="field-phone" className="space-y-2">
                      <Label>Contact Details <span className="text-red-500">*</span></Label>
                      {isIndia ? (
                        <div className="space-y-2">
                          {/* Full-width phone input */}
                          <div className={`flex h-12 w-full rounded-md border bg-muted/50 overflow-hidden transition-all
                            ${phoneVerified ? "border-green-400 bg-green-50/40" : "border-input focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30"}
                            ${formDisabled || phoneVerified ? "pointer-events-none opacity-70" : ""}`}>
                            <span className="flex items-center px-3 border-r border-input bg-muted/30 text-sm font-medium text-foreground shrink-0 gap-1">
                              🇮🇳 <span className="text-muted-foreground">+91</span>
                            </span>
                            <input
                              type="tel"
                              inputMode="numeric"
                              value={phoneDigits}
                              onChange={handlePhoneDigits}
                              placeholder="10-digit mobile number"
                              maxLength={10}
                              disabled={formDisabled || phoneVerified}
                              readOnly={phoneVerified}
                              className="flex-1 min-w-0 px-3 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
                            />
                            {/* Right-side indicators */}
                            {phoneVerified ? (
                              <span className="flex items-center pr-3 text-green-600">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              </span>
                            ) : existsStatus === "checking" ? (
                              <span className="flex items-center pr-3">
                                <svg className="animate-spin w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                </svg>
                              </span>
                            ) : null}
                          </div>

                          {/* Verify button / verified badge — below the input */}
                          {!phoneVerified && (
                            <button
                              type="button"
                              onClick={triggerOTP}
                              disabled={!phoneDigits || phoneDigits.length !== 10 || !!phoneError || otpLoading || otpSendCooldown > 0 || formDisabled}
                              className="w-full h-11 rounded-md text-sm font-medium transition-all border
                                bg-primary text-primary-foreground border-primary
                                hover:bg-primary/90
                                disabled:opacity-40 disabled:cursor-not-allowed
                                flex items-center justify-center gap-2 select-none"
                            >
                              {otpLoading ? (
                                <>
                                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                  </svg>
                                  Sending OTP…
                                </>
                              ) : otpSendCooldown > 0 ? (
                                <>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                  Resend OTP in {otpSendCooldown}s
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                  Verify with OTP
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex h-12 rounded-md border border-input bg-muted/50 overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
                          <input
                            type="text"
                            value={intlCode}
                            onChange={handleIntlCode}
                            placeholder="+1"
                            maxLength={5}
                            className="w-16 px-2 border-r border-input bg-muted/30 text-sm font-medium text-foreground outline-none text-center"
                          />
                          <input
                            type="tel"
                            inputMode="numeric"
                            value={phoneDigits}
                            onChange={handlePhoneDigits}
                            placeholder="Enter your phone number"
                            maxLength={15}
                            className="flex-1 px-3 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
                          />
                        </div>
                      )}
                      {phoneError ? (
                        <p className="text-xs text-red-500">{phoneError}</p>
                      ) : phoneVerified ? (
                        <p className="text-xs text-green-600 font-medium">Phone number verified successfully.</p>
                      ) : null}

                      {/* WhatsApp — inside Contact Details column */}
                      <div className="pt-1">
                        {whatsappError && !whatsappIsOnPhone && (
                          <p className="text-xs text-red-500 mb-1">{whatsappError}</p>
                        )}
                        <p className="text-sm text-muted-foreground mb-1">Is this number on WhatsApp?</p>
                        <label className="flex items-center gap-2 cursor-pointer w-fit" htmlFor="whatsappCheckbox">
                          <input
                            id="whatsappCheckbox"
                            type="checkbox"
                            checked={whatsappIsOnPhone}
                            onChange={(e) => {
                              setWhatsappIsOnPhone(e.target.checked);
                              setWhatsappError("");
                              if (e.target.checked) { setWhatsappNumber(""); setWhatsappFieldRevealed(false); }
                            }}
                            disabled={formDisabled}
                            className="w-4 h-4 rounded accent-primary cursor-pointer disabled:opacity-50"
                          />
                          <span className="text-sm text-muted-foreground">Yes</span>
                        </label>

                        <AnimatePresence>
                          {whatsappFieldRevealed && !whatsappIsOnPhone && (
                            <motion.div
                              key="wa-input"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-1 pt-2">
                                <Label htmlFor="whatsappNumber" className="text-sm font-medium">
                                  WhatsApp Number <span className="text-red-500">*</span>
                                </Label>
                                <div className={`flex h-11 rounded-md border bg-muted/50 overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 ${whatsappError && !whatsappNumber ? "border-red-400" : "border-input"}`}>
                                  <span className="flex items-center px-3 text-sm font-medium text-muted-foreground border-r border-input bg-muted/30 select-none">+91</span>
                                  <input
                                    id="whatsappNumber"
                                    type="tel"
                                    inputMode="numeric"
                                    autoFocus
                                    value={whatsappNumber}
                                    onChange={(e) => { setWhatsappNumber(e.target.value.replace(/\D/g, "").slice(0, 10)); setWhatsappError(""); }}
                                    placeholder="Enter WhatsApp number"
                                    maxLength={10}
                                    disabled={formDisabled}
                                    className="flex-1 px-3 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground disabled:opacity-60"
                                  />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Create Password — immediately after phone */}
                    <div className="space-y-2">
                      <Label htmlFor="password">Create Password <span className="text-red-500">*</span></Label>
                      <Input id="password" name="password" type="password" value={formData.password} onChange={handleInputChange} className="h-12 bg-muted/50" placeholder="Create a strong password" required disabled={formDisabled} />
                    </div>

                    {/* Login details info box */}
                    <div className="col-span-full rounded-xl px-3 py-2" style={{ background: "rgba(124,58,237,0.08)" }}>
                      <p className="text-[12.5px] text-gray-600">🔐 Remember your phone number &amp; password — you'll need them to log in later.</p>
                    </div>

                    {/* Email */}
                    <div className="space-y-2">
                      <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={formData.email}
                        onChange={(e) => {
                          handleInputChange(e);
                          setEmailError("");
                          setEmailSuggestion(null);
                          const lowered = e.target.value.toLowerCase().trim();
                          if (EMAIL_RE.test(lowered)) {
                            setEmailSuggestion(suggestEmailDomain(lowered));
                            checkEmailExists(lowered);
                          } else {
                            if (emailCheckTimerRef.current) clearTimeout(emailCheckTimerRef.current);
                            setEmailChecking(false);
                          }
                        }}
                        onBlur={() => {
                          const lowered = formData.email.toLowerCase().trim();
                          setFormData(prev => ({ ...prev, email: lowered }));
                          if (!lowered) return;
                          if (!EMAIL_RE.test(lowered)) {
                            setEmailError("Enter a valid email address (e.g. name@gmail.com)");
                            setEmailSuggestion(null);
                            setEmailChecking(false);
                          } else {
                            const suggestion = suggestEmailDomain(lowered);
                            setEmailSuggestion(suggestion);
                            if (!emailChecking && !emailError) checkEmailExists(lowered);
                          }
                        }}
                        className={`h-12 bg-muted/50 ${emailError ? "border-red-400 focus-visible:ring-red-400" : emailSuggestion ? "border-amber-400 focus-visible:ring-amber-400" : emailChecking ? "border-primary/40" : ""}`}
                        placeholder="Enter your email address"
                        required
                        disabled={formDisabled}
                      />
                      {emailChecking && !emailError && !emailSuggestion && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          Checking…
                        </p>
                      )}
                      {emailSuggestion && !emailError && (
                        <p className="text-xs text-amber-700 flex items-center gap-1 flex-wrap">
                          <span>Did you mean</span>
                          <button
                            type="button"
                            className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, email: emailSuggestion }));
                              setEmailSuggestion(null);
                              setEmailError("");
                              checkEmailExists(emailSuggestion);
                            }}
                          >
                            {emailSuggestion}
                          </button>
                          <span>?</span>
                        </p>
                      )}
                      {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                    </div>

                    {/* Country */}
                    <div className="space-y-2">
                      <Label>Country <span className="text-red-500">*</span></Label>
                      <Select value={formData.country} onValueChange={val => handleSelectChange("country", val)} disabled={formDisabled}>
                        <SelectTrigger className="h-12 bg-muted/50">
                          <SelectValue placeholder="Select your country" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="India">🇮🇳 India</SelectItem>
                          <SelectItem value="International">🌍 International</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* State — India only */}
                    {isIndia && (
                      <div id="field-state" className="space-y-2">
                        <Label>State <span className="text-red-500">*</span></Label>
                        <SearchableSelect
                          options={INDIA_STATES}
                          value={formData.state}
                          onChange={val => handleSelectChange("state", val)}
                          placeholder="Select your state"
                          disabled={formDisabled}
                        />
                      </div>
                    )}

                    {/* City — India: searchable dropdown */}
                    {isIndia && (
                      <div id="field-city" className="space-y-2">
                        <Label>City <span className="text-red-500">*</span></Label>
                        <SearchableSelect
                          options={citiesForState}
                          value={formData.city}
                          onChange={val => handleSelectChange("city", val)}
                          placeholder="Select your city"
                          disabled={!formData.state || formDisabled}
                        />
                      </div>
                    )}

                    {/* Other city — India only when Other selected */}
                    {isIndia && formData.city === "Other" && (
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="customCity">Enter your city <span className="text-red-500">*</span></Label>
                        <Input id="customCity" name="customCity" value={formData.customCity} onChange={handleInputChange} className="h-12 bg-muted/50" placeholder="Type your city name" required disabled={formDisabled} />
                      </div>
                    )}

                    {/* City — International: text input */}
                    {!isIndia && (
                      <div className="space-y-2">
                        <Label htmlFor="intlCity">City <span className="text-red-500">*</span></Label>
                        <Input id="intlCity" name="intlCity" value={formData.intlCity} onChange={handleInputChange} className="h-12 bg-muted/50" placeholder="Enter your city" required disabled={formDisabled} />
                      </div>
                    )}

                    {/* Date of Birth */}
                    <div className="space-y-2">
                      <Label htmlFor="dob">Date of Birth <span className="text-red-500">*</span></Label>
                      <div className="relative">
                        <Input
                          id="dob"
                          type="text"
                          inputMode="numeric"
                          value={dobText}
                          onChange={handleDobTyping}
                          className={`h-12 bg-muted/50 pr-11 ${dobError ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                          placeholder="DD/MM/YYYY"
                          maxLength={10}
                          disabled={formDisabled}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            try { calendarRef.current?.showPicker?.(); }
                            catch { calendarRef.current?.click(); }
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                          tabIndex={-1}
                          aria-label="Open calendar"
                          disabled={formDisabled}
                        >
                          <CalendarDays className="w-5 h-5" />
                        </button>
                        <input
                          ref={calendarRef}
                          type="date"
                          min="1940-01-01"
                          max={new Date().toISOString().split("T")[0]}
                          onChange={handleCalendarChange}
                          className="sr-only"
                          tabIndex={-1}
                        />
                      </div>
                      {dobError
                        ? <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{dobError}</p>
                        : null
                      }
                    </div>

                    {/* Gender */}
                    <div id="field-gender" className="space-y-2">
                      <Label>Gender <span className="text-red-500">*</span></Label>
                      <Select
                        value={formData.gender}
                        onValueChange={val => {
                          handleSelectChange("gender", val);
                          setGenderMismatchError(null);
                        }}
                        required
                      >
                        <SelectTrigger className={`h-12 bg-muted/50 ${
                          eventGenderReq && formData.gender &&
                          (() => { const r = eventGenderReq.toLowerCase(); return r !== "any" && r !== "both" && formData.gender.toLowerCase() !== r; })()
                            ? "border-red-400 focus:ring-red-400" : ""
                        }`}>
                          <SelectValue placeholder="Select your gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                      {/* Inline mismatch warning — shown as soon as wrong gender is selected */}
                      {eventGenderReq && formData.gender && (() => {
                        const r = eventGenderReq.toLowerCase();
                        if (r !== "any" && r !== "both" && formData.gender.toLowerCase() !== r) {
                          return (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              <p className="text-xs font-medium leading-snug">
                                This event is for <strong>{eventGenderReq}</strong> candidates only. Please select the correct gender to continue.
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>

                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                  {/* I am — multi-select */}
                  <div id="field-categories" className="space-y-2">
                    <Label>I am <span className="text-red-500">*</span></Label>
                    <div className="rounded-xl border border-input bg-muted/50 p-3 space-y-2.5">
                      {ROLE_OPTIONS.map(role => {
                        const checked = formData.categories.includes(role);
                        return (
                          <label key={role} className="flex items-center gap-3 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? formData.categories.filter(c => c !== role)
                                  : [...formData.categories, role];
                                setFormData(prev => ({
                                  ...prev,
                                  categories: next,
                                  ...(role === "Other (Please specify)" && !next.includes(role) ? { customRole: "" } : {}),
                                }));
                              }}
                              className="h-4 w-4 shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
                            />
                            <span className={`text-sm font-medium transition-colors ${checked ? "text-primary" : "text-foreground group-hover:text-primary"}`}>{role}</span>
                          </label>
                        );
                      })}
                    </div>

                    {/* Selected role chips */}
                    {formData.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {formData.categories.map(cat => (
                          <span key={cat} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                            {cat === "Other (Please specify)" ? (formData.customRole.trim() || "Other") : cat}
                            <button type="button" onClick={() => setFormData(prev => ({
                              ...prev,
                              categories: prev.categories.filter(c => c !== cat),
                              ...(cat === "Other (Please specify)" ? { customRole: "" } : {}),
                            }))} className="hover:text-rose-500 transition-colors ml-0.5">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Warning for multiple roles */}
                    <AnimatePresence>
                      {formData.categories.length > 1 && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                          className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5"
                        >
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-800 leading-snug">
                            Selecting multiple roles may lead to profile rejection. You may be asked to provide proofs/photographs for each selected role after registration. Please choose carefully.
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Other specify input */}
                    <AnimatePresence>
                      {formData.categories.includes("Other (Please specify)") && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-1.5"
                        >
                          <Label htmlFor="customRole">Please specify your role <span className="text-red-500">*</span></Label>
                          <Input
                            id="customRole"
                            name="customRole"
                            value={formData.customRole}
                            onChange={handleInputChange}
                            placeholder="e.g. Dancer, Brand Ambassador..."
                            className="h-12 bg-muted/50"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div id="field-experience" className="space-y-2">
                    <Label>Experience Level <span className="text-red-500">*</span></Label>
                    <Select value={formData.experienceLevel} onValueChange={val => handleSelectChange("experienceLevel", val)} required>
                      <SelectTrigger className="h-12 bg-muted/50"><SelectValue placeholder="Select your experience level" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Fresher">Fresher (0 years)</SelectItem>
                        <SelectItem value="1-2 years">1-2 years</SelectItem>
                        <SelectItem value="2+ years">2+ years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div id="field-referral" className="space-y-2">
                    <Label htmlFor="referralSource">How did you hear about us? <span className="text-red-500">*</span></Label>
                    <select
                      id="referralSource"
                      name="referralSource"
                      value={formData.referralSource}
                      onChange={handleInputChange}
                      className="flex h-12 w-full rounded-xl border border-input bg-muted/50 px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="">Select option</option>
                      <option value="Instagram">Instagram</option>
                      <option value="Friend">Friend</option>
                      <option value="College Poster">College Poster</option>
                      <option value="Goteamcrew Website">Goteamcrew Website</option>
                      <option value="Goteamcrew Staff">Goteamcrew Staff</option>
                      <option value="Other">Other</option>
                    </select>
                    {formData.referralSource === "Other" && (
                      <Input
                        id="referralOther"
                        name="referralOther"
                        value={formData.referralOther}
                        onChange={handleInputChange}
                        className="h-12 bg-muted/50"
                        placeholder="Please specify"
                      />
                    )}
                  </div>
                  <div id="field-languages" className="space-y-2">
                    <Label>Languages Known <span className="text-red-500">*</span></Label>
                    <div className="flex flex-wrap gap-3 pt-1">
                      {["English", "Hindi", "Other"].map(lang => {
                        const checked = formData.languages.includes(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => {
                              const next = checked
                                ? formData.languages.filter(l => l !== lang)
                                : [...formData.languages, lang];
                              setFormData(prev => ({ ...prev, languages: next }));
                            }}
                            className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors duration-150 ${
                              checked
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/50 text-foreground border-border hover:border-primary/50"
                            }`}
                          >
                            {lang}
                          </button>
                        );
                      })}
                    </div>
                    {formData.languages.includes("Other") && (
                      <Input
                        value={formData.otherLanguage}
                        onChange={e => setFormData(prev => ({ ...prev, otherLanguage: e.target.value }))}
                        className="h-12 bg-muted/50 mt-2"
                        placeholder="Enter language"
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="height">Height <span className="text-red-500">*</span></Label>
                    <Input
                      id="height"
                      inputMode="numeric"
                      value={fmtHeight(heightRaw)}
                      placeholder={`Enter height in feet (e.g. 58 = 5'8")`}
                      className={`h-12 bg-muted/50 ${heightError ? "border-red-500" : ""}`}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace") {
                          e.preventDefault();
                          const next = heightRaw.slice(0, -1);
                          setHeightRaw(next);
                          setFormData(prev => ({ ...prev, height: fmtHeight(next) }));
                          setHeightError("");
                        }
                      }}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        if (digits.length <= heightRaw.length) return;
                        if (heightRaw.length >= 3) return;
                        const next = (heightRaw + digits.slice(-1)).slice(0, 3);
                        setHeightRaw(next);
                        setFormData(prev => ({ ...prev, height: fmtHeight(next) }));
                        setHeightError(next.length > 0 && parseInt(next[0]) < 5 ? "Minimum height should be 5 feet" : "");
                      }}
                    />
                    {heightError && <p className="text-xs text-red-500 mt-1">{heightError}</p>}
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">

                  {/* Identity Verification */}
                  <div className="space-y-5">
                    <h3 className="text-lg font-bold border-b pb-2">Identity Verification</h3>

                    {/* ID Type Dropdown */}
                    <div className="space-y-2">
                      <Label>Select ID Type <span className="text-red-500">*</span></Label>
                      <Select value={formData.idType} onValueChange={val => handleSelectChange("idType", val)} required>
                        <SelectTrigger className="h-12 bg-muted/50"><SelectValue placeholder="Select ID type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Aadhaar Card">Aadhaar Card</SelectItem>
                          <SelectItem value="College ID">College ID (for students)</SelectItem>
                          <SelectItem value="Driving License">Driving License</SelectItem>
                          <SelectItem value="Passport">Passport</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Single ID Upload — disabled until ID type is selected */}
                    <div className="space-y-2">
                      <Label className="text-base font-semibold">
                        {formData.idType ? `Upload your ${formData.idType}` : "Upload selected ID"} <span className="text-red-500">*</span>
                      </Label>
                      <div
                        className={`relative border-2 border-dashed rounded-xl p-6 transition-all text-center ${
                          !formData.idType
                            ? "border-border bg-muted/20 opacity-50 cursor-not-allowed"
                            : files.idFile
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50 hover:bg-muted/30"
                        }`}
                        onClick={() => {
                          if (!formData.idType) {
                            toast({ title: "Please select ID type first", description: "Choose an ID type from the dropdown above before uploading." });
                          }
                        }}
                      >
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          disabled={!formData.idType}
                          onChange={e => {
                            const picked = e.target.files?.[0];
                            if (picked) setFiles(prev => ({ ...prev, idFile: picked }));
                          }}
                          className={`absolute inset-0 w-full h-full opacity-0 ${formData.idType ? "cursor-pointer" : "cursor-not-allowed pointer-events-none"}`}
                        />
                        <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
                          {files.idFile ? (
                            <>
                              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                {files.idFile.type.includes("image") ? <FileImage className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
                              </div>
                              <div className="space-y-1">
                                <p className="font-medium text-foreground text-sm truncate max-w-[200px]">{files.idFile.name}</p>
                                <div className="flex items-center justify-center gap-1 text-xs text-green-600 font-medium">
                                  <CheckCircle className="w-3 h-3" /> Selected
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                <UploadCloud className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="font-medium text-foreground">
                                  {formData.idType ? "Tap or drag to upload" : "Select ID type to upload"}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formData.idType ? "Accepts images or PDFs" : "Choose an ID type above first"}
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Upload any one valid ID (clear image or PDF)</p>
                    </div>
                  </div>

                  {/* Live Selfie */}
                  <div className="space-y-3">
                    <h3 className="text-lg font-bold border-b pb-2">Live Selfie</h3>
                    <Label className="text-base font-semibold">Live Selfie <span className="text-red-500">*</span></Label>

                    {/* Pre-camera instructions */}
                    {!cameraOpen && !selfiePreview && !selfieValidating && !capturedTemp && (
                      <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 space-y-1.5">
                        <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                          <span>💡</span> Tips for a valid selfie
                        </p>
                        <ul className="space-y-0.5 text-xs text-blue-700 list-none">
                          <li>• Position your face inside the oval frame</li>
                          <li>• Ensure good, even lighting — no harsh shadows</li>
                          <li>• Look straight at the camera, no background distractions</li>
                          <li>• You will be asked to slightly move your head to confirm it is live</li>
                        </ul>
                      </div>
                    )}

                    {/* Camera permission error */}
                    {cameraError && !cameraOpen && !capturedTemp && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3">
                        <p className="text-sm text-red-600">{cameraError}</p>
                        <Button type="button" size="sm" variant="outline" onClick={openCamera} className="shrink-0">Retry</Button>
                      </div>
                    )}

                    {/* ── LIVE CAMERA VIEW ───────────────────────────────── */}
                    {cameraOpen && (
                      <div
                        className="rounded-2xl overflow-hidden border-2 shadow-xl"
                        style={{
                          borderColor: cameraLoading ? "#374151" : circleStatus.color,
                          opacity: cameraVisible ? 1 : 0,
                          transform: cameraVisible ? "scale(1)" : "scale(0.95)",
                          transition: "opacity 0.3s ease, transform 0.3s ease, border-color 0.4s ease",
                        }}
                      >
                        <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
                          <video ref={videoRef} autoPlay playsInline muted
                            className="w-full h-full object-cover"
                            style={{ transform: "scaleX(-1)" }}
                          />

                          {/* Loading */}
                          {cameraLoading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3 z-30">
                              <svg className="animate-spin w-10 h-10 text-white" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                              </svg>
                              <p className="text-white text-sm font-semibold">Preparing camera…</p>
                            </div>
                          )}

                          {/* Circle guide + overlays */}
                          {!cameraLoading && (
                            <>
                              {/* KYC scan sweep — z-9 sits below vignette; outside circle stays dark */}
                              <div className="absolute inset-0 pointer-events-none z-[9] overflow-hidden">
                                <div className="selfie-scan-sweep" />
                              </div>

                              {/* Vignette with perfect-circle cutout */}
                              <div className="absolute inset-0 pointer-events-none z-10">
                                <svg width="100%" height="100%" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice">
                                  <defs>
                                    <mask id="selfie-circle-cut">
                                      <rect width="320" height="240" fill="white" />
                                      <circle cx="160" cy="120" r="112" fill="black" />
                                    </mask>
                                  </defs>
                                  {/* Dark overlay outside the circle */}
                                  <rect width="320" height="240" fill="rgba(0,0,0,0.52)" mask="url(#selfie-circle-cut)" />
                                  {/* Circle border — colour + dash driven by real-time state */}
                                  <circle cx="160" cy="120" r="112"
                                    fill="none"
                                    stroke={circleStatus.color}
                                    strokeWidth="2.8"
                                    strokeDasharray={circleStatus.dash ? "7 5" : "0"}
                                    style={{ transition: "stroke 0.35s ease, stroke-dasharray 0.35s ease" }}
                                  />
                                </svg>
                              </div>

                              {/* Top instruction — dynamic KYC guidance */}
                              <div className="absolute top-3 left-0 right-0 text-center z-20 pointer-events-none">
                                <span className="text-white text-xs font-semibold drop-shadow bg-black/40 px-3 py-1 rounded-full"
                                  style={{ transition: "opacity 0.3s ease" }}>
                                  {topInstruction}
                                </span>
                              </div>

                              {/* Bottom status pill — real-time feedback */}
                              <div className="absolute bottom-3 left-0 right-0 flex justify-center z-20 pointer-events-none px-4">
                                <span
                                  className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-full shadow-md max-w-xs text-center leading-snug"
                                  style={{ backgroundColor: canCapture ? "rgba(22,163,74,0.88)" : "rgba(0,0,0,0.60)", transition: "background-color 0.35s ease" }}
                                >
                                  {canCapture
                                    ? <><CheckCircle className="w-3.5 h-3.5 shrink-0" />{circleStatus.msg}</>
                                    : <><span className="w-2 h-2 rounded-full shrink-0 animate-pulse inline-block" style={{ backgroundColor: circleStatus.color }} />{circleStatus.msg}</>
                                  }
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Anti-cheat warning + helper hint */}
                        {!cameraLoading && (
                          <div className="px-3 pt-2 pb-1 bg-gray-900 space-y-0.5">
                            <p className="text-xs text-amber-400 text-center leading-snug">
                              ⚠️ Fake or unclear selfies will lead to profile rejection
                            </p>
                            <p className="text-[10px] text-gray-500 text-center">
                              Ensure good lighting and no filters
                            </p>
                          </div>
                        )}

                        {/* Action bar */}
                        <div className="p-3 flex gap-2 bg-gray-900">
                          <Button
                            type="button"
                            onClick={capturePhoto}
                            disabled={!canCapture}
                            className="flex-1 h-11 font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                          >
                            {cameraLoading ? "Preparing…" : canCapture ? "📸 Take Photo" : logicalReady ? "Hold steady…" : "Waiting…"}
                          </Button>
                          <Button type="button" variant="outline" onClick={closeCamera} className="h-11 border-gray-600 text-gray-200 hover:bg-gray-800">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── VALIDATING OVERLAY (camera closed, checking selfie) ── */}
                    {selfieValidating && capturedTemp && (
                      <div className="rounded-2xl overflow-hidden border-2 border-indigo-400 shadow-xl">
                        <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
                          <img src={capturedTemp} alt="Captured frame" className="w-full h-full object-cover opacity-40" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
                            <svg className="animate-spin w-10 h-10 text-white" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            <p className="text-white text-sm font-semibold drop-shadow">Checking your selfie…</p>
                            <p className="text-white/60 text-xs">Face detection · Quality check</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── VALIDATION FAILED (error + retake) ───────────────── */}
                    {!selfieValidating && selfieValError && capturedTemp && (
                      <div className="rounded-2xl overflow-hidden border-2 border-red-400 shadow-xl">
                        <div className="relative bg-black" style={{ aspectRatio: "4/3" }}>
                          <img src={capturedTemp} alt="Captured frame" className="w-full h-full object-cover opacity-50" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 z-10">
                            <div className="w-12 h-12 rounded-full bg-red-500/90 flex items-center justify-center">
                              <X className="w-6 h-6 text-white" />
                            </div>
                            <p className="text-white text-sm font-semibold text-center drop-shadow leading-snug">{selfieValError}</p>
                          </div>
                        </div>
                        <div className="p-3 bg-red-950 flex gap-2">
                          <Button type="button" onClick={retakeSelfie} className="flex-1 h-11 font-semibold bg-red-500 hover:bg-red-600 text-white">
                            🔄 Retake Selfie
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── SELFIE CAPTURED — awaiting user confirmation ───────── */}
                    {selfiePreview && !selfieValidating && !selfieConfirmed && (
                      <div className="border-2 border-green-500 rounded-2xl overflow-hidden shadow-md">
                        <div className="bg-green-600 px-4 py-2.5 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-white shrink-0" />
                          <p className="text-white text-sm font-semibold">Selfie captured successfully</p>
                        </div>
                        <div className="bg-black" style={{ aspectRatio: "4/3" }}>
                          <img src={selfiePreview} alt="Your selfie" className="w-full h-full object-cover" />
                        </div>
                        <div className="p-3 flex gap-2 bg-gray-900">
                          <Button type="button" onClick={retakeSelfie} variant="outline"
                            className="flex-1 h-11 font-semibold border-gray-600 text-gray-200 hover:bg-gray-800">
                            🔄 Retake
                          </Button>
                          <Button type="button" onClick={() => setSelfieConfirmed(true)}
                            className="flex-1 h-11 font-semibold bg-green-600 hover:bg-green-700 text-white">
                            ✓ Confirm
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── SELFIE CONFIRMED ──────────────────────────────────── */}
                    {selfiePreview && !selfieValidating && selfieConfirmed && (
                      <div className="border-2 border-green-500 rounded-2xl overflow-hidden shadow-md">
                        <div className="bg-black" style={{ aspectRatio: "4/3" }}>
                          <img src={selfiePreview} alt="Your selfie" className="w-full h-full object-cover" />
                        </div>
                        <div className="p-3 flex items-center justify-between bg-green-50">
                          <div className="flex items-center gap-1.5 text-sm text-green-700 font-semibold">
                            <CheckCircle className="w-4 h-4" /> Selfie confirmed
                          </div>
                          <Button type="button" variant="ghost" size="sm" onClick={retakeSelfie}
                            className="text-xs h-7 text-gray-600 hover:text-gray-900">
                            Retake
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── INITIAL: no selfie yet, not in camera ─────────────── */}
                    {!cameraOpen && !selfiePreview && !selfieValidating && !capturedTemp && !selfieValError && (
                      <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 hover:bg-muted/30 transition-all">
                        <div className="flex flex-col items-center space-y-3">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                            <CameraIcon className="w-6 h-6" />
                          </div>
                          <Button type="button" onClick={openCamera} variant="outline" className="gap-2">
                            <CameraIcon className="w-4 h-4" /> Take Selfie
                          </Button>
                        </div>
                      </div>
                    )}

                    <canvas ref={captureCanvasRef} className="hidden" />
                  </div>

                  {/* Verification status block */}
                  {(!formData.idType || !files.idFile || !files.selfie) ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
                      <p className="text-sm font-semibold text-red-600">Please complete verification:</p>
                      <ul className="space-y-1">
                        {!formData.idType && <li className="text-sm text-red-500">• Select ID type</li>}
                        {!files.idFile && <li className="text-sm text-red-500">• Upload ID document</li>}
                        {!files.selfie && <li className="text-sm text-red-500">• Take live selfie</li>}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-xl border p-4" style={{ background: "#E6F9ED", borderColor: "#A8E6BD" }}>
                      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1E8E3E" }}>
                        <CheckCircle className="w-4 h-4" /> Verification Completed
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#1E8E3E" }}>Your ID and selfie have been successfully verified</p>
                    </div>
                  )}
                </motion.div>
              )}

              {step === 4 && (
                <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">

                  {/* Profile summary card */}
                  {(() => {
                    const initials = formData.name
                      ? formData.name.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
                      : "?";
                    return (
                      <div
                        className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden"
                        style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)" }}
                      >
                        {/* Header: avatar + name + edit */}
                        <div className="flex items-center gap-4 px-6 pt-6 pb-5">
                          {/* Avatar */}
                          <div
                            className="flex items-center justify-center shrink-0 rounded-full font-bold text-white select-none"
                            style={{
                              width: 46,
                              height: 46,
                              fontSize: 16,
                              background: "linear-gradient(135deg, #818cf8 0%, #7c3aed 100%)",
                              letterSpacing: "0.03em",
                            }}
                          >
                            {initials}
                          </div>
                          {/* Name + phone */}
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-foreground leading-tight" style={{ fontSize: 17 }}>{formData.name || "—"}</p>
                            <p className="text-sm text-muted-foreground mt-0.5">{formData.contactNumber || "—"}</p>
                          </div>
                          {/* Single edit */}
                          <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="shrink-0 text-xs font-semibold text-primary border border-primary/25 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
                          >
                            Edit
                          </button>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-black/[0.06] mx-6" />

                        {/* Detail rows */}
                        <div className="px-6 py-5 space-y-5">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#9ca3af" }}>Location</p>
                            <p className="text-sm font-medium text-foreground">
                              {[effectiveCity, isIndia ? formData.state : formData.country].filter(Boolean).join(", ") || "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: "#9ca3af" }}>Work</p>
                            <p className="text-sm font-medium text-foreground">
                              {[
                                formData.categories.map((c: string) => c === "Other (Please specify)" ? (formData.customRole.trim() || "Other") : c).join(", "),
                                formData.experienceLevel ? `${formData.experienceLevel} experience` : ""
                              ].filter(Boolean).join(" • ") || "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Identity verified */}
                  <div
                    className="rounded-2xl px-5 py-3.5 flex items-center gap-3"
                    style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
                  >
                    <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#16a34a" }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#15803d" }}>Identity Verified</p>
                      <p className="text-xs mt-0.5" style={{ color: "#166534" }}>ID &amp; selfie successfully verified</p>
                    </div>
                  </div>

                  {/* Terms checkbox */}
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={e => setTermsAccepted(e.target.checked)}
                      className="h-4 w-4 shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
                    />
                    <span className="text-xs text-muted-foreground">
                      I agree to the{" "}
                      <button type="button" onClick={() => setShowTerms(true)} className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80">
                        Terms &amp; Conditions
                      </button>
                    </span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            {step === 4 ? (
              <div className="mt-7 space-y-3">
                {genderMismatchError && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                    <p className="text-sm font-medium leading-snug">{genderMismatchError}</p>
                  </div>
                )}

                {/* Password missing warning — shown only on Step 4 */}
                {!formData.password && (
                  <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-800">Password required before submitting</p>
                      <p className="text-xs text-red-700 mt-0.5">
                        For security, passwords are not saved after refresh.{" "}
                        <button
                          type="button"
                          onClick={() => { setStep(1); setTimeout(() => document.getElementById("password")?.focus(), 300); }}
                          className="underline font-semibold hover:text-red-900 transition-colors"
                        >
                          Go to Step 1
                        </button>{" "}
                        and enter your password to continue.
                      </p>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting || !termsAccepted || !!genderMismatchError || !formData.password}
                  className="w-full rounded-xl text-white font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    height: "52px",
                    background: termsAccepted && !isSubmitting && formData.password ? "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)" : undefined,
                    boxShadow: termsAccepted && !isSubmitting && formData.password ? "0 4px 18px 0 rgba(99,102,241,0.35)" : undefined,
                  }}
                >
                  {isSubmitting ? "Submitting..." : "Submit Application"}
                </Button>
                <button
                  type="button"
                  onClick={prevStep}
                  disabled={isSubmitting}
                  className="w-full h-10 rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  style={{ border: "1px solid #e5e7eb" }}
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              </div>
            ) : (
              <div className="mt-10 pt-6 border-t border-border/50 space-y-3">
                {stepError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                    <span>⚠ {stepError}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={prevStep} className="h-12 px-6 rounded-xl">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                ) : <div />}
                <Button type="button" onClick={nextStep} disabled={
                  (step === 1 && !!eventGenderReq && !!formData.gender && (() => { const r = eventGenderReq.toLowerCase(); return r !== "any" && r !== "both" && formData.gender.toLowerCase() !== r; })()) ||
                  (step === 2 && !!heightError) ||
                  (step === 3 && (!formData.idType || !files.idFile || !files.selfie))
                } className="h-12 px-8 rounded-xl shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                  Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      <p className="text-center mt-6 text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">Login here</Link>
      </p>

      {/* Terms & Conditions Modal */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold text-foreground">Terms &amp; Conditions</h2>
              <button type="button" onClick={() => setShowTerms(false)} className="text-muted-foreground hover:text-foreground text-2xl leading-none">&times;</button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-6 py-5 space-y-5 text-sm text-foreground">
              <p className="text-muted-foreground">By registering on Goteamcrew, you agree to the following terms.</p>

              <div className="space-y-1">
                <p className="font-semibold">A) Information Accuracy</p>
                <p className="text-muted-foreground">Users must provide correct and genuine information. Fake or misleading details may lead to rejection.</p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold">B) Verification</p>
                <p className="text-muted-foreground">All users must complete ID and selfie verification. Goteamcrew reserves the right to approve or reject any profile.</p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold">C) Data Usage</p>
                <p className="text-muted-foreground">Your information will be used only for profile verification and job opportunities. We do NOT sell your data.</p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold">D) Profile Sharing</p>
                <p className="text-muted-foreground">Your profile may be shared with clients for event work. Only relevant details will be shared.</p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold">E) Account Responsibility</p>
                <p className="text-muted-foreground">Users are responsible for maintaining correct contact details. Updates will be sent via WhatsApp.</p>
              </div>

              <div className="space-y-1">
                <p className="font-semibold">F) Platform Rights</p>
                <p className="text-muted-foreground">Goteamcrew can suspend or remove accounts if needed. No guarantee of job assignments.</p>
              </div>

              <p className="text-muted-foreground italic">If you do not agree with these terms, please do not register.</p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border shrink-0">
              <Button
                type="button"
                className="w-full h-11 rounded-xl"
                onClick={() => { setTermsAccepted(true); setShowTerms(false); }}
              >
                I Agree
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
