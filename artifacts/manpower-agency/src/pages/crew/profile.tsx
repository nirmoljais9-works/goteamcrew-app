import { useGetCrewProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  User, Phone, MapPin, Briefcase, Star, Languages, Ruler,
  Instagram, CheckCircle2, Upload, X, CreditCard,
  FileText, Calendar, Info, XCircle, Loader2,
  Camera,
  Eye, Plus, Lock, Mail, Tag, Save,
  Trash2, Maximize2, ChevronLeft, ChevronRight, ChevronDown,
  ThumbsUp, ThumbsDown, AlertCircle, Download, RefreshCw,
  Pencil, Copy, Check,
  Video, Play, Zap,
} from "lucide-react";

// ── Brand roles ─────────────────────────────────────────────────────────────────
const ROLES = ["Model", "Hostess", "Promoter", "Anchor", "Crew", "Emcee"] as const;
const ROLE_COLORS: Record<string, string> = {
  Model:    "bg-pink-100 text-pink-700 border-pink-200",
  Hostess:  "bg-purple-100 text-purple-700 border-purple-200",
  Promoter: "bg-blue-100 text-blue-700 border-blue-200",
  Anchor:   "bg-amber-100 text-amber-700 border-amber-200",
  Crew:     "bg-green-100 text-green-700 border-green-200",
  Emcee:    "bg-rose-100 text-rose-700 border-rose-200",
};

// ── Types ────────────────────────────────────────────────────────────────────────
type FieldValidation = { error?: string; success?: string };

// ── Pure validators ──────────────────────────────────────────────────────────────
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_RE  = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function validateIfsc(val: string): FieldValidation {
  if (!val) return {};
  if (val.length < 11) return { error: `IFSC must be 11 characters (${val.length}/11)` };
  if (!IFSC_RE.test(val)) return { error: "Invalid format — e.g. SBIN0001234" };
  return { success: "Valid IFSC format" };
}
function validateAccount(val: string): FieldValidation {
  if (!val) return {};
  if (val.length < 9) return { error: `Too short — min 9 digits (${val.length}/9)` };
  return { success: "Valid account number" };
}
function validatePan(val: string): FieldValidation {
  if (!val) return {};
  if (val.length < 10) return { error: `PAN must be 10 characters (${val.length}/10)` };
  if (!PAN_RE.test(val)) return { error: "Invalid format — must be ABCDE1234F" };
  return { success: "Valid PAN format" };
}
function validateUpi(val: string): FieldValidation {
  if (!val) return {};
  if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{3,}$/.test(val)) return { error: "Enter a valid UPI ID" };
  return { success: "Valid UPI ID" };
}
function required(val: string): FieldValidation {
  return val.trim() ? {} : { error: "This field is required" };
}

// ── Masking helpers ──────────────────────────────────────────────────────────────
function maskAccount(num: string): string {
  if (!num) return "";
  if (num.length <= 4) return num;
  return "●●●●" + num.slice(-4);
}
function maskPan(pan: string): string {
  if (!pan || pan.length < 10) return pan;
  return pan.slice(0, 5) + "●●●●" + pan.slice(-1);
}

// ── FieldFeedback ────────────────────────────────────────────────────────────────
function FieldFeedback({ v, touched }: { v?: FieldValidation; touched?: boolean }) {
  if (!touched && !v?.error && !v?.success) return null;
  if (v?.error) return (
    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
      <XCircle className="w-3 h-3 shrink-0" /> {v.error}
    </p>
  );
  if (v?.success) return (
    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3 shrink-0" /> {v.success}
    </p>
  );
  return null;
}

// ── ReadField ────────────────────────────────────────────────────────────────────
function ReadField({ icon: Icon, label, value, mono }: { icon: any; label: string; value?: string | number | null; mono?: boolean }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-muted/20">
      <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-3 h-3 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">{label}</p>
        <p className={`text-xs font-semibold text-foreground leading-snug ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

// ── SectionHeading ───────────────────────────────────────────────────────────────
function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Input class helper ───────────────────────────────────────────────────────────
function cls(v?: FieldValidation, extra = "") {
  const state = v?.error
    ? "border-red-400 bg-red-50/30 focus-visible:ring-red-400"
    : v?.success
    ? "border-emerald-400 focus-visible:ring-emerald-400"
    : "border-border/50";
  return `bg-muted/30 rounded-xl h-11 ${state} ${extra}`;
}

// ── RoleBadge ────────────────────────────────────────────────────────────────────
function RoleBadges({ category }: { category?: string | null }) {
  if (!category) return null;
  const roles = category.split(",").map(r => r.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {roles.map(role => (
        <span key={role}
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[role] ?? "bg-muted text-foreground border-border"}`}>
          {role}
        </span>
      ))}
    </div>
  );
}

// ── Profile Strength helpers ──────────────────────────────────────────────────────
interface StrengthResult {
  strength: number;
  checklist: { label: string; done: boolean }[];
}

function calcProfileStrength(profile: any): StrengthResult {
  if (!profile) return { strength: 0, checklist: [] };

  const photos: string[] = (() => {
    try { return JSON.parse(profile.portfolioPhotos || "[]"); } catch { return []; }
  })();

  let score = 0;

  // Profile Details — 20% (name, phone, email, city, gender, category, languages, experience, age)
  const profileFields = [
    !!profile.name, !!profile.phone, !!profile.email, !!profile.city,
    !!profile.gender, !!profile.category, !!profile.languages, !!profile.experience, !!profile.age,
  ];
  score += (profileFields.filter(Boolean).length / profileFields.length) * 20;

  // Portfolio Photos — 35% (highest priority)
  if (photos.length >= 8) score += 35;
  else if (photos.length >= 4) score += 22;
  else if (photos.length >= 1) score += 10;

  // Intro Video — 25% (second highest priority)
  if (profile.introVideoUrl) score += 25;

  // PAN Card — 10%
  if (profile.panNumber) score += 10;

  // Bank Details — 10%
  if (profile.payHolderName && profile.payAccountNumber) score += 10;

  const checklist = [
    { label: "Add Portfolio Photos",  done: photos.length > 0,                                    priority: true },
    { label: "Add Intro Video",       done: !!profile.introVideoUrl,                              priority: true },
    { label: "Upload PAN Card",       done: !!profile.panNumber,                                  priority: false },
    { label: "Add Bank Details",      done: !!(profile.payHolderName && profile.payAccountNumber), priority: false },
  ];

  return { strength: Math.round(score), checklist };
}

// ── Profile Strength Bar ─────────────────────────────────────────────────────────
function ProfileStrengthBar({
  strength, checklist, approved,
}: {
  strength: number;
  checklist: { label: string; done: boolean; priority?: boolean }[];
  approved?: boolean;
}) {
  const color = approved || strength >= 90 ? "bg-emerald-500" : strength < 40 ? "bg-red-400" : "bg-amber-400";
  const label = approved ? "Approved" : strength < 40 ? "Needs attention" : strength < 70 ? "Good" : strength < 90 ? "Strong" : "Complete";

  if (approved) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm font-bold text-emerald-800">Profile Complete</p>
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">100%</span>
        </div>
        <div className="h-2 bg-emerald-200 rounded-full overflow-hidden mb-2">
          <div className="h-full rounded-full bg-emerald-500 w-full transition-all duration-700" />
        </div>
        <p className="text-xs text-emerald-700">All details verified and approved.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Profile Strength</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          strength < 40 ? "bg-red-50 text-red-600" :
          strength < 70 ? "bg-amber-50 text-amber-600" :
          "bg-emerald-50 text-emerald-700"
        }`}>{strength}% — {label}</span>
      </div>
      {/* Progress bar */}
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${strength}%` }} />
      </div>
      {/* Motivational text */}
      {checklist.some(i => i.priority && !i.done) ? (
        <p className="text-xs font-medium" style={{ color: "#B45309" }}>
          📸 Add photos &amp; video to increase your profile strength
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Complete your profile to increase your chances of getting shortlisted.
        </p>
      )}
      {/* Checklist */}
      {checklist.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-0.5">
          {checklist.map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <span className={`text-sm leading-none ${item.done ? "text-emerald-500" : "text-red-400"}`}>
                {item.done ? "✅" : "❌"}
              </span>
              <span className={`text-xs font-medium ${
                item.done ? "text-emerald-700" :
                item.priority ? "text-amber-700" : "text-gray-500"
              }`}>
                {item.label}
                {item.priority && !item.done && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-amber-600">High impact</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Bottom micro-copy */}
      {checklist.some(i => i.priority && i.done) && checklist.some(i => i.priority && !i.done) && (
        <p className="text-[10px] text-muted-foreground italic">Profiles with photos &amp; video get higher selection chances</p>
      )}
    </div>
  );
}


// ── Server-side photo upload ────────────────────────────────────────────────────
// Sends the raw File to the API server which compresses it with sharp (Node.js).
// Zero canvas / zero client-side memory pressure — safe on all iOS versions.
async function uploadPhotoToServer(file: File, baseUrl: string): Promise<string> {
  const form = new FormData();
  form.append("photo", file);
  const res = await fetch(`${baseUrl}/api/crew/portfolio/upload-photo`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed (${res.status})`);
  }
  const { dataUrl } = await res.json();
  if (!dataUrl) throw new Error("Server returned no image data");
  return dataUrl;
}

// ── Form state types ─────────────────────────────────────────────────────────────
const EMPTY_PAY = {
  payHolderName: "", payBankName: "", payBranchName: "",
  payAccountNumber: "", payIfscCode: "", payUpiId: "",
};
const EMPTY_DOCS = { panNumber: "" };
type PayKey = keyof typeof EMPTY_PAY;
type PayValidationState = Partial<Record<PayKey, FieldValidation>>;
type DocValidationState = { panNumber?: FieldValidation; panCard?: FieldValidation };
type Touched<T extends string> = Partial<Record<T, boolean>>;

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Video thumbnail generator ────────────────────────────────────────────────────
function generateVideoThumbnail(src: string): Promise<{ thumbnail: string; duration: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = src;
    let seeked = false;
    const doSeek = () => {
      if (seeked) return;
      const t = isFinite(video.duration) ? Math.min(1.5, video.duration * 0.1) : 1.5;
      video.currentTime = t;
    };
    video.addEventListener("loadedmetadata", doSeek);
    video.addEventListener("loadeddata", doSeek);
    video.addEventListener("seeked", () => {
      if (seeked) return;
      seeked = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("No canvas")); return; }
        ctx.drawImage(video, 0, 0, 160, 160);
        const dur = isFinite(video.duration)
          ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`
          : "";
        resolve({ thumbnail: canvas.toDataURL("image/jpeg", 0.75), duration: dur });
      } catch (e) { reject(e); }
    });
    video.addEventListener("error", () => reject(new Error("Video load error")));
    setTimeout(() => { if (!seeked) reject(new Error("Timeout")); }, 8000);
  });
}

// ── Profile page ─────────────────────────────────────────────────────────────────
export default function Profile() {
  const { data: profile, isLoading } = useGetCrewProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const panFileRef       = useRef<HTMLInputElement>(null);
  const portfolioFileRef  = useRef<HTMLInputElement>(null);
  const replacePhotoRef   = useRef<HTMLInputElement>(null);
  const replaceIdxRef     = useRef<number>(0);            // which index to replace, set before click()
  const initialized      = useRef(false);
  const ifscTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upiDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Payment form ──────────────────────────────────────────────────────────────
  const [pay, setPay]                       = useState(EMPTY_PAY);
  const [docs, setDocs]                     = useState(EMPTY_DOCS);
  const [panCardFile, setPanCardFile]       = useState<File | null>(null);
  const [panCardPreview, setPanCardPreview] = useState<string | null>(null);
  const [savingPay, setSavingPay]           = useState(false);
  const [payEditing, setPayEditing]         = useState(true);   // false = read-only display
  const [payEditModal, setPayEditModal]     = useState(false);
  const [copiedField, setCopiedField]       = useState<string | null>(null);
  const [savingDocs, setSavingDocs]         = useState(false);
  const [avatarError, setAvatarError]       = useState(false);
  const [ifscLoading, setIfscLoading]       = useState(false);
  const [docPreview, setDocPreview]         = useState<{ url: string; title: string } | null>(null);
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);
  const openDoc  = (url: string, title: string) => { setDocPreview({ url, title }); setDocPreviewLoading(true); };
  const closeDoc = () => { setDocPreview(null); setDocPreviewLoading(false); };

  const [payV, setPayV] = useState<PayValidationState>({});
  const [docV, setDocV] = useState<DocValidationState>({});
  const [payT, setPayT] = useState<Touched<PayKey>>({});
  const [docT, setDocT] = useState<Touched<"panNumber" | "panCard">>({});


  // ── Portfolio ─────────────────────────────────────────────────────────────────
  const [portfolioPhotos, setPortfolioPhotos] = useState<string[]>([]);
  const [photoQuality,    setPhotoQuality]    = useState<(string | null)[]>([]);

  // ── Intro Video ───────────────────────────────────────────────────────────────
  const [introVideoUrl,        setIntroVideoUrl]        = useState<string | null>(null);
  const [pendingVideoFile,     setPendingVideoFile]     = useState<File | null>(null);
  const [pendingVideoObjUrl,   setPendingVideoObjUrl]   = useState<string | null>(null);
  const [uploadingVideo,       setUploadingVideo]       = useState(false);
  const [uploadVideoProgress,  setUploadVideoProgress]  = useState(0);
  const [deletingVideo,        setDeletingVideo]        = useState(false);
  const [deleteVideoConfirm,   setDeleteVideoConfirm]   = useState(false);
  const [videoThumbnail,       setVideoThumbnail]       = useState<string | null>(null);
  const [videoDuration,        setVideoDuration]        = useState<string>("");
  const [videoModalOpen,       setVideoModalOpen]       = useState(false);
  const [videoModalVisible,    setVideoModalVisible]    = useState(false);
  const videoScrollY = useRef(0);
  const videoInputRef   = useRef<HTMLInputElement>(null);
  const videoModalRef   = useRef<HTMLVideoElement>(null);
  const [savingPortfolio, setSavingPortfolio]       = useState(false);
  const [uploadingPortfolio, setUploadingPortfolio] = useState(false);
  const [replacingPhoto,     setReplacingPhoto]     = useState(false);
  const [lightbox, setLightbox]                     = useState<string | null>(null);
  const [portfolioChanged, setPortfolioChanged]     = useState(false);
  // Portfolio lightbox (indexed — supports prev/next navigation)
  const [lightboxIdx, setLightboxIdx]   = useState<number | null>(null);
  const [lbVisible, setLbVisible]       = useState(false);          // drives CSS fade+scale
  // Swipe gesture — all refs, zero re-renders during drag
  const touchStartX     = useRef<number | null>(null);
  const touchStartY     = useRef<number | null>(null);
  const swipeDxRef      = useRef(0);
  const isSwipingRef    = useRef(false);
  const swipeWrapperRef = useRef<HTMLDivElement>(null);
  const lbPrevBtnRef    = useRef<HTMLButtonElement>(null);
  const lbNextBtnRef    = useRef<HTMLButtonElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  // Profile Details collapse
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // ── Pre-fill ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile || initialized.current) return;
    initialized.current = true;

    if (profile.payHolderName) {
      const src = {
        payHolderName:    profile.payHolderName    ?? "",
        payBankName:      profile.payBankName      ?? "",
        payBranchName:    profile.payBranchName    ?? "",
        payAccountNumber: profile.payAccountNumber ?? "",
        payIfscCode:      profile.payIfscCode      ?? "",
        payUpiId:         profile.payUpiId         ?? "",
      };
      setPay(src);
      setPayEditing(false);   // show read-only view when data already saved
      setPayV({
        payHolderName:    {},
        payBankName:      {},
        payBranchName:    {},
        payAccountNumber: validateAccount(src.payAccountNumber),
        payIfscCode:      validateIfsc(src.payIfscCode),
        payUpiId:         validateUpi(src.payUpiId),
      });
    }

    if (profile.panNumber) {
      setDocs({ panNumber: profile.panNumber });
      setDocV({ panNumber: validatePan(profile.panNumber) });
    }

    if (profile.portfolioPhotos) {
      try { setPortfolioPhotos(JSON.parse(profile.portfolioPhotos)); } catch {}
    }
    if (profile.photoQuality) {
      try { setPhotoQuality(JSON.parse(profile.photoQuality)); } catch {}
    }
    if (profile.introVideoUrl) {
      setIntroVideoUrl(profile.introVideoUrl);
    }
  }, [profile]);


  // ── Portfolio lightbox: fade+scale animation + keyboard navigation ────────────
  useEffect(() => {
    if (lightboxIdx !== null) {
      // Yield one frame so the DOM node is mounted before we start the transition
      const raf = requestAnimationFrame(() => setLbVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setLbVisible(false);
    }
  }, [lightboxIdx]);

  const closeLightbox = () => {
    setLbVisible(false);
    setTimeout(() => setLightboxIdx(null), 180);
  };

  // ── Video modal open / close — same fade pattern as portfolio lightbox ──────
  const openVideoModal = () => {
    videoScrollY.current = window.scrollY;
    setVideoModalOpen(true);
    // videoModalVisible is set to true by the useEffect below, after first paint
  };

  const closeVideoModal = () => {
    setVideoModalVisible(false);
    setTimeout(() => {
      setVideoModalOpen(false);
      requestAnimationFrame(() => {
        window.scrollTo(0, videoScrollY.current);
      });
    }, 210);
  };

  // ── Fade-in after mount + autoplay (mirrors lightbox lbVisible pattern) ──────
  useEffect(() => {
    if (!videoModalOpen) return;
    const raf = requestAnimationFrame(() => {
      setVideoModalVisible(true);
      videoModalRef.current?.play().catch(() => {});
    });
    return () => {
      cancelAnimationFrame(raf);
      setVideoModalVisible(false);
    };
  }, [videoModalOpen]);

  // ── Generate video thumbnail whenever source changes ───────────────────────────
  useEffect(() => {
    const src = pendingVideoObjUrl ?? (introVideoUrl ? `${BASE_URL}${introVideoUrl}` : null);
    if (!src) { setVideoThumbnail(null); setVideoDuration(""); return; }
    let cancelled = false;
    generateVideoThumbnail(src)
      .then(({ thumbnail, duration }) => {
        if (!cancelled) { setVideoThumbnail(thumbnail); setVideoDuration(duration); }
      })
      .catch(() => { if (!cancelled) { setVideoThumbnail(null); setVideoDuration(""); } });
    return () => { cancelled = true; };
  }, [introVideoUrl, pendingVideoObjUrl]);

  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft" && lightboxIdx > 0) setLightboxIdx(i => (i ?? 1) - 1);
      if (e.key === "ArrowRight" && lightboxIdx < portfolioPhotos.length - 1) setLightboxIdx(i => (i ?? 0) + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, portfolioPhotos.length]);

  // Reset wrapper to centre whenever we navigate to a new image
  useEffect(() => {
    if (swipeWrapperRef.current) {
      swipeWrapperRef.current.style.transition = "none";
      swipeWrapperRef.current.style.transform  = "translate3d(0,0,0)";
    }
    swipeDxRef.current   = 0;
    isSwipingRef.current = false;
  }, [lightboxIdx]);

  // ── Portfolio lightbox swipe handlers — direct DOM, zero re-renders ───────────
  const handleLbTouchStart = (e: React.TouchEvent) => {
    touchStartX.current  = e.touches[0].clientX;
    touchStartY.current  = e.touches[0].clientY;
    isSwipingRef.current = false;
    if (swipeWrapperRef.current) swipeWrapperRef.current.style.transition = "none";
  };

  const handleLbTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || lightboxIdx === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Ignore if the gesture is more vertical than horizontal
    if (!isSwipingRef.current && Math.abs(dy) > Math.abs(dx) + 8) return;
    isSwipingRef.current = true;
    // Edge resistance at first/last image
    const atStart = lightboxIdx === 0 && dx > 0;
    const atEnd   = lightboxIdx === portfolioPhotos.length - 1 && dx < 0;
    const resistDx = (atStart || atEnd) ? dx * 0.18 : dx;
    swipeDxRef.current = resistDx;
    // Direct DOM mutation — no setState, no re-render
    if (swipeWrapperRef.current)
      swipeWrapperRef.current.style.transform = `translate3d(${resistDx}px,0,0)`;
    // Fade out arrow buttons while dragging
    if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "0";
    if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "0";
  };

  const handleLbTouchEnd = () => {
    const dx = swipeDxRef.current;
    // Re-enable smooth transition for snap-back
    if (swipeWrapperRef.current)
      swipeWrapperRef.current.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
    if (Math.abs(dx) > 55 && lightboxIdx !== null) {
      if      (dx < 0 && lightboxIdx < portfolioPhotos.length - 1) setLightboxIdx(lightboxIdx + 1);
      else if (dx > 0 && lightboxIdx > 0)                          setLightboxIdx(lightboxIdx - 1);
      else if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    } else {
      if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    }
    swipeDxRef.current   = 0;
    isSwipingRef.current = false;
    touchStartX.current  = null;
    touchStartY.current  = null;
    // Restore arrow opacity after snap/navigate settles
    setTimeout(() => {
      if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "1";
      if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "1";
    }, 120);
  };

  // ── IFSC auto-fetch ───────────────────────────────────────────────────────────
  const fetchBankFromIfsc = (ifsc: string) => {
    if (ifscTimer.current) clearTimeout(ifscTimer.current);
    ifscTimer.current = setTimeout(async () => {
      setIfscLoading(true);
      try {
        const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
        if (res.ok) {
          const data = await res.json();
          setPay(p => ({
            ...p,
            payBankName:   data.BANK   || p.payBankName,
            payBranchName: data.BRANCH || p.payBranchName,
          }));
          setPayV(pv => ({
            ...pv,
            payIfscCode:   { success: `Valid — ${data.BANK}` },
            payBankName:   data.BANK   ? { success: "Auto-filled from IFSC" } : pv.payBankName,
            payBranchName: data.BRANCH ? { success: "Auto-filled from IFSC" } : pv.payBranchName,
          }));
        } else {
          setPayV(pv => ({ ...pv, payIfscCode: { error: "IFSC code not found in database" } }));
        }
      } catch {
        // Network error — keep format validation result
      } finally {
        setIfscLoading(false);
      }
    }, 700);
  };

  // ── PAN file ──────────────────────────────────────────────────────────────────
  const handlePanFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPanCardFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPanCardPreview(reader.result as string);
    reader.readAsDataURL(file);
    setDocV(dv => ({ ...dv, panCard: { success: `${file.name} selected` } }));
    setDocT(dt => ({ ...dt, panCard: true }));
  };
  const clearPanFile = () => {
    setPanCardFile(null);
    setPanCardPreview(null);
    if (panFileRef.current) panFileRef.current.value = "";
    setDocV(dv => ({ ...dv, panCard: undefined }));
  };

  // ── Submit: payment ───────────────────────────────────────────────────────────
  const handleSavePayment = async () => {
    const newV: PayValidationState = {
      payHolderName:    required(pay.payHolderName),
      payBankName:      required(pay.payBankName),
      payBranchName:    required(pay.payBranchName),
      payAccountNumber: pay.payAccountNumber.trim() ? validateAccount(pay.payAccountNumber) : { error: "This field is required" },
      payIfscCode:      pay.payIfscCode.trim() ? validateIfsc(pay.payIfscCode) : { error: "This field is required" },
      payUpiId:         pay.payUpiId.trim() ? validateUpi(pay.payUpiId) : { error: "This field is required" },
    };
    setPayV(newV);
    setPayT({ payHolderName: true, payBankName: true, payBranchName: true, payAccountNumber: true, payIfscCode: true, payUpiId: true });
    if (Object.values(newV).some(v => v?.error)) {
      toast({ variant: "destructive", title: "All fields are required", description: "Fix the errors above before submitting." });
      return;
    }
    setSavingPay(true);
    try {
      const fd = new FormData();
      fd.append("payHolderName",    pay.payHolderName.trim());
      fd.append("payBankName",      pay.payBankName.trim());
      fd.append("payBranchName",    pay.payBranchName.trim());
      fd.append("payAccountNumber", pay.payAccountNumber.trim());
      fd.append("payIfscCode",      pay.payIfscCode.trim().toUpperCase());
      fd.append("payUpiId",         pay.payUpiId.trim());
      const res = await fetch(`${BASE_URL}/api/crew/profile`, { method: "PUT", credentials: "include", body: fd });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to save payment details"); }
      await queryClient.invalidateQueries({ queryKey: ["/api/crew/profile"] });
      setPayEditing(false);
      setPayEditModal(false);
      toast({ title: "Payment details updated", description: "Your payment information has been saved." });
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setSavingPay(false);
    }
  };

  // ── Submit: documents ─────────────────────────────────────────────────────────
  const handleSaveDocs = async () => {
    const hasPanCardOnFile = profile?.panCardUrl;
    const newDocV: DocValidationState = {
      panNumber: docs.panNumber.trim() ? validatePan(docs.panNumber) : { error: "This field is required" },
      panCard:   (!panCardFile && !hasPanCardOnFile) ? { error: "PAN card image is required" } : undefined,
    };
    setDocV(newDocV);
    setDocT({ panNumber: true, panCard: true });
    if (Object.values(newDocV).some(v => v?.error)) {
      toast({ variant: "destructive", title: "All fields are required", description: "Fix the errors above before submitting." });
      return;
    }
    setSavingDocs(true);
    try {
      const fd = new FormData();
      fd.append("panNumber", docs.panNumber.trim().toUpperCase());
      if (panCardFile) fd.append("panCard", panCardFile);
      const res = await fetch(`${BASE_URL}/api/crew/profile`, { method: "PUT", credentials: "include", body: fd });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to save documents"); }
      await queryClient.invalidateQueries({ queryKey: ["/api/crew/profile"] });
      toast({ title: "Documents saved", description: "Your PAN details have been updated." });
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setSavingDocs(false);
    }
  };


  // ── Portfolio: add photos ─────────────────────────────────────────────────────
  // Photos are uploaded to the server (sharp compresses them there).
  // Zero client-side canvas — completely safe on iOS.
  const handlePortfolioAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Reset after extracting files so the same photo can be re-selected later
    e.target.value = "";
    if (!files.length) return;

    const remaining = 10 - portfolioPhotos.length;
    if (remaining <= 0) {
      toast({ variant: "destructive", title: "Maximum 10 photos allowed" });
      return;
    }

    // 20 MB server-side limit — no client-side processing needed
    const MAX_MB = 20;
    const toProcess = files.slice(0, remaining);
    const tooLarge = toProcess.filter(f => f.size > MAX_MB * 1024 * 1024);
    if (tooLarge.length) {
      toast({ variant: "destructive", title: `${tooLarge.length} photo(s) too large`, description: `Max file size is ${MAX_MB} MB.` });
    }
    const validFiles = toProcess.filter(f => f.size <= MAX_MB * 1024 * 1024);
    if (!validFiles.length) return;

    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    setUploadingPortfolio(true);
    const results: string[] = [];
    try {
      for (const file of validFiles) {
        try {
          const dataUrl = await uploadPhotoToServer(file, BASE_URL);
          results.push(dataUrl);
          toast({ title: "✓ Photo uploaded", description: "Added to your portfolio." });
        } catch (err: any) {
          toast({
            variant: "destructive",
            title: "Could not upload photo",
            description: err?.message ?? "Please try again.",
          });
        }
      }
    } finally {
      setUploadingPortfolio(false);
    }

    if (results.length) {
      setPortfolioPhotos(prev => [...prev, ...results]);
      setPortfolioChanged(true);
    }
  };

  const handlePortfolioDelete = (idx: number) => {
    setPortfolioPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoQuality(prev => prev.filter((_, i) => i !== idx));
    setPortfolioChanged(true);
  };

  const handlePhotoReplace = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!replacePhotoRef.current) return;
    replacePhotoRef.current.value = "";          // reset so same file can be picked again
    if (!file) return;
    setReplacingPhoto(true);
    try {
      const dataUrl = await uploadPhotoToServer(file, BASE_URL);
      setPortfolioPhotos(prev => prev.map((p, i) => i === idx ? dataUrl : p));
      setPhotoQuality(prev => prev.map((q, i) => i === idx ? null : q));
      setPortfolioChanged(true);
      toast({ title: "Photo replaced", description: "Click Save Photos to apply changes." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e.message || "Could not replace photo." });
    } finally {
      setReplacingPhoto(false);
    }
  };

  const downloadPhoto = async (src: string, idx: number) => {
    try {
      const res  = await fetch(src);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `crew-photo-${idx + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Photo downloaded" });
    } catch {
      toast({ variant: "destructive", title: "Download failed", description: "Could not download the photo." });
    }
  };

  const handlePortfolioSave = async () => {
    setSavingPortfolio(true);
    try {
      const fd = new FormData();
      fd.append("portfolioPhotos", JSON.stringify(portfolioPhotos));
      fd.append("photoQuality", JSON.stringify(photoQuality));
      const res = await fetch(`${BASE_URL}/api/crew/profile`, { method: "PUT", credentials: "include", body: fd });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed to save portfolio"); }
      await queryClient.invalidateQueries({ queryKey: ["/api/crew/profile"] });
      setPortfolioChanged(false);
      toast({ title: "Portfolio saved", description: `${portfolioPhotos.length} photo${portfolioPhotos.length !== 1 ? "s" : ""} saved to your profile.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: e.message });
    } finally {
      setSavingPortfolio(false);
    }
  };

  // ── Intro Video: select (stage only — no upload yet) ─────────────────────────
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (!file) return;

    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast({ variant: "destructive", title: "Video too large", description: `Max size is ${MAX_MB} MB.` });
      return;
    }

    // Revoke any previous object URL to avoid memory leaks
    if (pendingVideoObjUrl) URL.revokeObjectURL(pendingVideoObjUrl);
    const objUrl = URL.createObjectURL(file);
    setPendingVideoFile(file);
    setPendingVideoObjUrl(objUrl);
  };

  // ── Intro Video: cancel pending selection ─────────────────────────────────────
  const handleVideoCancelPending = () => {
    if (pendingVideoObjUrl) URL.revokeObjectURL(pendingVideoObjUrl);
    setPendingVideoFile(null);
    setPendingVideoObjUrl(null);
  };

  // ── Intro Video: save (actual upload) ─────────────────────────────────────────
  const handleVideoSave = async () => {
    if (!pendingVideoFile) return;
    setUploadingVideo(true);
    setUploadVideoProgress(0);

    try {
      const fd = new FormData();
      fd.append("video", pendingVideoFile);

      const videoUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BASE_URL}/api/crew/portfolio/upload-video`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadVideoProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText);
            resolve(data.videoUrl);
          } else {
            try { reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed")); }
            catch { reject(new Error("Upload failed")); }
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      });

      if (pendingVideoObjUrl) URL.revokeObjectURL(pendingVideoObjUrl);
      setPendingVideoFile(null);
      setPendingVideoObjUrl(null);
      setIntroVideoUrl(videoUrl);
      await queryClient.invalidateQueries({ queryKey: ["/api/crew/profile"] });
      toast({ title: "Video uploaded successfully", description: "Your intro video has been added to your profile." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message ?? "Please try again." });
    } finally {
      setUploadingVideo(false);
      setUploadVideoProgress(0);
    }
  };

  const handleVideoDelete = async () => {
    setDeletingVideo(true);
    try {
      const res = await fetch(`${BASE_URL}/api/crew/portfolio/delete-video`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Delete failed"); }
      setIntroVideoUrl(null);
      setDeleteVideoConfirm(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/crew/profile"] });
      toast({ title: "Video removed", description: "Your intro video has been deleted." });
    } catch (e: any) {
      toast({ variant: "destructive", title: e?.message ?? "Delete failed" });
    } finally {
      setDeletingVideo(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Profile strength
  const { strength, checklist } = calcProfileStrength(profile);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className={`max-w-3xl space-y-4 transition-[padding] duration-300 ${portfolioChanged ? "pb-28" : ""}`}>
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">My Profile</h1>
        <p className="text-muted-foreground mt-1">Your details and payment info</p>
      </div>

      {/* ── Identity card — photo, name, role ───────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 to-primary/5 px-5 py-4 flex items-center gap-4">
          {profile?.closeUpPhotoUrl && !avatarError ? (
            <button
              type="button"
              onClick={() => setLightbox(profile.closeUpPhotoUrl!)}
              className="w-16 h-16 rounded-full shrink-0 ring-4 ring-white shadow-md overflow-hidden focus:outline-none focus-visible:ring-primary"
            >
              <img
                src={profile.closeUpPhotoUrl}
                alt={profile.name ?? "Profile photo"}
                className="w-full h-full object-cover"
                onError={() => setAvatarError(true)}
              />
            </button>
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/20 ring-4 ring-white shadow-md flex items-center justify-center shrink-0">
              <User className="w-8 h-8 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground truncate leading-tight">{profile?.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{profile?.email}</p>
            <RoleBadges category={profile?.category} />
          </div>
        </div>
      </div>

      {/* ── Profile Strength card ───────────────────────────────────────────── */}
      <ProfileStrengthBar
        strength={strength}
        checklist={checklist}
        approved={false}
      />

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* Section 1: Portfolio Photos                                             */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4">
            {/* Portfolio header with count badge */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">Portfolio Photos</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full ${
                  portfolioPhotos.length === 0
                    ? "bg-muted text-muted-foreground"
                    : portfolioPhotos.length >= 10
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-primary/10 text-primary"
                }`}>
                  {portfolioPhotos.length} of 10 photos added
                </span>
                {portfolioPhotos.length >= 5 && portfolioPhotos.length < 10 && (
                  <span className="text-xs text-muted-foreground">Looking good!</span>
                )}
                {portfolioPhotos.length === 10 && (
                  <span className="text-xs text-emerald-600 font-medium">Portfolio complete!</span>
                )}
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="mb-2 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <span className="inline-block text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-1.5">
              Instructions
            </span>
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">📸 Clear full-length photos</p>
              <p className="text-xs font-semibold text-foreground">👔 Event-ready or model-ready outfits</p>
              <p className="text-xs font-semibold text-foreground">🚫 No selfies or blurry images</p>
            </div>
          </div>

          {/* Motivation line */}
          <p className="text-xs text-primary font-medium mb-2 leading-snug">
            Good photos increase your chances of getting shortlisted in events.
          </p>

          {/* Example photos — de-emphasised, smaller, guidance only */}
          <div className="mb-2 opacity-90">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Example photos</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg overflow-hidden border border-border/25 bg-muted/20">
                <div className="aspect-square overflow-hidden flex items-center justify-center bg-muted/20">
                  <img
                    src={`${import.meta.env.BASE_URL}images/example-full-length.jpg`}
                    alt="Example full-length event photo"
                    className="w-full h-full object-contain pointer-events-none select-none"
                    style={{ filter: "blur(2px)", opacity: 0.93 }}
                    draggable={false}
                  />
                </div>
                <p className="text-[9px] text-center text-muted-foreground py-0.5 font-medium">Full Photo</p>
              </div>
              <div className="rounded-lg overflow-hidden border border-border/25 bg-muted/20">
                <div className="aspect-square overflow-hidden flex items-center justify-center bg-muted/20">
                  <img
                    src={`${import.meta.env.BASE_URL}images/example-group.jpg`}
                    alt="Example formal event photo"
                    className="w-full h-full object-contain pointer-events-none select-none"
                    style={{ filter: "blur(2px)", opacity: 0.93 }}
                    draggable={false}
                  />
                </div>
                <p className="text-[9px] text-center text-muted-foreground py-0.5 font-medium">Event / Formal Look</p>
              </div>
            </div>
          </div>

          {/* Photo grid — compact 4-column thumbnails */}
          <div className="grid grid-cols-4 gap-1.5">
            {portfolioPhotos.map((src, idx) => (
              <div
                key={idx}
                onClick={() => setLightboxIdx(idx)}
                className={`relative aspect-square rounded-lg overflow-hidden border-2 bg-muted/20 cursor-pointer transition-all duration-150 active:scale-95 select-none ${
                  photoQuality[idx] === "rejected"
                    ? "border-red-400/60"
                    : photoQuality[idx] === "good"
                    ? "border-emerald-400/60"
                    : "border-border/40"
                }`}
              >
                {/* Photo */}
                <img
                  src={src}
                  alt={`Portfolio ${idx + 1}`}
                  className={`w-full h-full object-cover ${photoQuality[idx] === "rejected" ? "opacity-55" : ""}`}
                  loading="lazy"
                  decoding="async"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />

                {/* Red tint for rejected */}
                {photoQuality[idx] === "rejected" && (
                  <div className="absolute inset-0 bg-red-900/20 pointer-events-none" />
                )}

                {/* Bottom gradient */}
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

                {/* Number badge — bottom left */}
                <div className="absolute bottom-0.5 left-1 text-white text-[9px] font-bold leading-none drop-shadow-sm">
                  {idx + 1}
                </div>

                {/* Status dot — top right */}
                {photoQuality[idx] === "good" && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border border-white flex items-center justify-center shadow-sm">
                    <ThumbsUp className="w-2 h-2 text-white" />
                  </div>
                )}
                {photoQuality[idx] === "rejected" && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-red-500 border border-white flex items-center justify-center shadow-sm">
                    <AlertCircle className="w-2 h-2 text-white" />
                  </div>
                )}

                {/* Top-left: Replace (rejected) or Delete (unreviewed) */}
                {photoQuality[idx] === "rejected" ? (
                  <button
                    type="button"
                    disabled={replacingPhoto}
                    onClick={e => { e.stopPropagation(); replaceIdxRef.current = idx; replacePhotoRef.current?.click(); }}
                    onMouseDown={e => e.stopPropagation()}
                    onTouchStart={e => e.stopPropagation()}
                    className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center shadow-sm touch-manipulation disabled:opacity-50"
                    aria-label="Replace photo"
                  >
                    <RefreshCw className="w-2.5 h-2.5 text-white" />
                  </button>
                ) : photoQuality[idx] !== "good" ? (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setDeleteConfirm(idx); }}
                    className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/50 hover:bg-red-500/90 flex items-center justify-center shadow-sm transition-colors"
                    aria-label="Delete photo"
                  >
                    <Trash2 className="w-2.5 h-2.5 text-white" />
                  </button>
                ) : null}

                {/* Delete confirmation overlay */}
                {deleteConfirm === idx && (
                  <div
                    className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5 p-1.5 z-10"
                    onClick={e => e.stopPropagation()}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    <p className="text-white text-[9px] font-semibold text-center leading-tight">Delete?</p>
                    <div className="flex gap-1 w-full">
                      <button
                        type="button"
                        onClick={() => { handlePortfolioDelete(idx); setDeleteConfirm(null); }}
                        className="flex-1 py-1 bg-red-500 rounded text-white text-[9px] font-bold"
                      >Del</button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="flex-1 py-1 bg-white/15 rounded text-white text-[9px] font-bold"
                      >No</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Upload tile */}
            {portfolioPhotos.length < 10 && (
              <label
                htmlFor="portfolio-file-input"
                className={`aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-all ${
                  uploadingPortfolio
                    ? "border-primary/20 bg-primary/5 cursor-wait pointer-events-none"
                    : "border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 hover:border-primary/50"
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                  {uploadingPortfolio
                    ? <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    : <Plus className="w-3 h-3 text-primary" />
                  }
                </div>
                <p className="text-[9px] font-semibold text-primary text-center leading-tight px-0.5">
                  {uploadingPortfolio ? "Uploading…" : "Add"}
                </p>
              </label>
            )}
          </div>

          {/* File input: sr-only keeps it off-screen but still accessible/clickable via label */}
          <input
            id="portfolio-file-input"
            ref={portfolioFileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePortfolioAdd}
            disabled={uploadingPortfolio}
            className="sr-only"
          />

          {/* Hidden replace-photo input — triggered from lightbox or card Replace button */}
          <input
            ref={replacePhotoRef}
            type="file"
            accept="image/*"
            onChange={e => handlePhotoReplace(e, replaceIdxRef.current)}
            disabled={replacingPhoto}
            className="sr-only"
          />

          {/* Empty state */}
          {portfolioPhotos.length === 0 && (
            <div className="mt-3 flex items-center gap-2.5 p-3 rounded-xl bg-muted/20 border border-dashed border-border/60">
              <Camera className="w-6 h-6 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">No photos added yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add your best photos to strengthen your profile.</p>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* Section 1b: Introduction Video                                          */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-foreground">Introduction Video</h2>
                <span className="text-[9px] font-medium tracking-wide px-2 py-0.5 rounded-full" style={{ background: "#FEF3C7", color: "#B45309", border: "1px solid #FCD34D" }}>Recommended</span>
                <span className="text-[9px] font-medium tracking-wide px-2 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: "#DCFCE7", color: "#166534", border: "1px solid #86EFAC" }}><Zap className="w-2.5 h-2.5" />High Impact</span>
              </div>
              <p className="text-xs text-muted-foreground">Add a short intro video to increase your chances of getting selected</p>
            </div>
            {/* Status badge */}
            {introVideoUrl ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                <CheckCircle2 className="w-3 h-3" /> Added
              </span>
            ) : pendingVideoFile ? (
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                Unsaved
              </span>
            ) : (
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted/40 border border-border/50 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                Not added
              </span>
            )}
          </div>


          {/* ── Uploading progress ── */}
          {uploadingVideo && (
            <div className="border border-dashed border-border/60 rounded-xl p-5 flex flex-col items-center gap-3 bg-muted/10 mb-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <div className="w-full max-w-48">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${uploadVideoProgress}%` }} />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-1.5">Uploading… {uploadVideoProgress}%</p>
              </div>
            </div>
          )}

          {/* ── Pending / Saved: capsule card ── */}
          {!uploadingVideo && (pendingVideoObjUrl || introVideoUrl) && (
            <div className="mb-3 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Clickable thumbnail row */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => openVideoModal()}
                onKeyDown={e => e.key === "Enter" && openVideoModal()}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 active:scale-[0.99] transition-all select-none"
              >
                {/* Thumbnail */}
                <div className="relative w-[88px] h-[88px] rounded-xl overflow-hidden bg-gray-900 shrink-0">
                  {videoThumbnail ? (
                    <img src={videoThumbnail} alt="Video preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="w-7 h-7 text-gray-500" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                    </div>
                  </div>
                </div>
                {/* Meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Intro Video</p>
                  {videoDuration && (
                    <p className="text-xs mt-0.5" style={{ color: "#6B7280" }}>{videoDuration}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1.5">Tap to play</p>
                </div>
              </div>

              {/* Admin feedback badge + actions — inside the card, below a divider */}
              {(!pendingVideoObjUrl && introVideoUrl && profile?.introVideoQuality) || pendingVideoObjUrl || (!pendingVideoObjUrl && profile?.introVideoQuality !== "good") ? (
                <div className="border-t border-gray-100 px-3 py-2.5 space-y-2">
                  {/* Feedback badge */}
                  {!pendingVideoObjUrl && introVideoUrl && profile?.introVideoQuality && (
                    <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border ${
                      profile?.introVideoQuality === "good"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-amber-50 border-amber-200 text-amber-700"
                    }`}>
                      {profile?.introVideoQuality === "good" ? (
                        <><ThumbsUp className="w-3.5 h-3.5 shrink-0" /> Admin rated your video as <strong>Good</strong></>
                      ) : (
                        <><ThumbsDown className="w-3.5 h-3.5 shrink-0" /> Admin suggests your video <strong>can be improved</strong></>
                      )}
                    </div>
                  )}
                  {/* Actions */}
                  {pendingVideoObjUrl ? (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={handleVideoCancelPending}
                        className="flex-1 text-xs font-medium text-muted-foreground border border-border/50 rounded-lg py-2 hover:bg-muted/30 transition-colors">
                        Cancel
                      </button>
                      <button type="button" onClick={handleVideoSave}
                        className="flex-1 text-xs font-semibold text-white bg-primary rounded-lg py-2 hover:bg-primary/90 transition-colors">
                        Save Video
                      </button>
                    </div>
                  ) : profile?.introVideoQuality !== "good" ? (
                    <div className="flex items-center">
                      <button type="button" onClick={() => videoInputRef.current?.click()}
                        className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" /> Replace Video
                      </button>
                      {deleteVideoConfirm ? (
                        <span className="flex items-center gap-2 ml-auto">
                          <span className="text-xs text-muted-foreground">Remove?</span>
                          <button type="button" onClick={handleVideoDelete} disabled={deletingVideo}
                            className="text-xs font-semibold text-red-500 hover:text-red-600">
                            {deletingVideo ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                          </button>
                          <button type="button" onClick={() => setDeleteVideoConfirm(false)}
                            className="text-xs text-muted-foreground hover:text-foreground">No</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setDeleteVideoConfirm(true)}
                          className="text-xs text-muted-foreground hover:text-red-400 transition-colors flex items-center gap-1 ml-auto">
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {/* ── Empty: upload card ── */}
          {!uploadingVideo && !pendingVideoObjUrl && !introVideoUrl && (
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border/50 rounded-xl p-6 flex flex-col items-center gap-2 bg-muted/5 hover:bg-muted/20 hover:border-primary/40 transition-all cursor-pointer group mb-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                <Video className="w-6 h-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Upload Introduction Video</p>
                <p className="text-xs text-muted-foreground mt-0.5">Tell clients about yourself and your experience</p>
              </div>
              <span className="text-xs font-semibold text-primary border border-primary/30 rounded-lg px-3 py-1 mt-1 group-hover:bg-primary/5 transition-colors">
                Upload Video
              </span>
            </button>
          )}

          {/* Hidden file input */}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            onChange={handleVideoSelect}
            disabled={uploadingVideo}
            className="sr-only"
          />

          {/* Instructions */}
          <div className="mt-1 rounded-xl bg-muted/20 border border-border/40 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">What to include in your video</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {["Your name", "Age & height", "Education / Qualifications", "Work experience", "Why you want to join events? (if fresher)"].map(item => (
                <div key={item} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                  <span className="text-xs text-foreground">{item}</span>
                </div>
              ))}
            </div>
            <div className="pt-1.5 border-t border-border/30 flex flex-wrap gap-1.5">
              {[
                { label: "🎤 Clear voice",          bg: "#EEF2FF", color: "#4F46E5" },
                { label: "💡 Good lighting",         bg: "#ECFDF5", color: "#059669" },
                { label: "🧼 Clean background",      bg: "#F0FDF4", color: "#16A34A" },
                { label: "👔 Wear formals (optional)", bg: "#FFF7ED", color: "#EA580C" },
              ].map(({ label, bg, color }) => (
                <span key={label} className="text-[11px] font-medium rounded-full px-2.5 py-1 leading-none" style={{ background: bg, color }}>
                  {label}
                </span>
              ))}
            </div>
            <p className="text-[10px] pt-0.5" style={{ color: "#6B7280" }}>⏱ 30–60 sec  •  Up to 20MB</p>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* Section 2: Profile Details                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 pb-4 pt-3">
          <SectionHeading title="Profile Details" />
          <p className="text-xs text-muted-foreground -mt-2 mb-2.5">
            Need to update your details?{" "}
            <a
              href={`mailto:info@goteamcrew.in?subject=Profile Update Request – ${encodeURIComponent(profile?.name ?? "")}`}
              className="text-primary underline-offset-2 hover:underline font-medium"
            >
              Contact support
            </a>
          </p>

          {/* ── Read-only registration data ──────────────────────────────── */}

          {/* Always-visible key fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <ReadField icon={User}     label="Full Name"        value={profile?.name} />
            <ReadField icon={Phone}    label="Phone"            value={profile?.phone} />
            <ReadField icon={MapPin}   label="City"             value={profile?.city} />
            <ReadField icon={Tag}      label="Roles / Category" value={profile?.category} />
            <ReadField icon={Star}     label="Experience Level" value={profile?.experienceLevel} />
          </div>

          {/* Collapsible extra fields */}
          <div
            style={{
              maxHeight: detailsExpanded ? "1200px" : "0px",
              overflow: "hidden",
              transition: "max-height 0.35s ease",
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1.5">
              <ReadField icon={Mail}     label="Email"      value={profile?.email} />
              <ReadField icon={User}     label="Gender"     value={profile?.gender} />
              <ReadField icon={Calendar} label="Age"        value={profile?.age ? `${profile.age} years` : null} />
              <ReadField icon={Languages} label="Languages" value={profile?.languages} />
              <ReadField icon={Ruler}    label="Height"     value={profile?.height} />
              {profile?.experience && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-muted/20 sm:col-span-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Briefcase className="w-3 h-3 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">Experience / Bio</p>
                    <p className="text-xs font-semibold text-foreground leading-snug">{profile.experience}</p>
                  </div>
                </div>
              )}
              {profile?.instagramUrl && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-muted/20 sm:col-span-2">
                  <div className="w-6 h-6 rounded-lg bg-pink-100 flex items-center justify-center shrink-0">
                    <Instagram className="w-3 h-3 text-pink-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">Instagram</p>
                    <a href={profile.instagramUrl} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold text-pink-600 hover:underline leading-snug block">
                      {profile.instagramUrl}
                    </a>
                  </div>
                </div>
              )}
              {profile?.aadhaarCardUrl && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-muted/20">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-3 h-3 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">Aadhaar Card</p>
                    <button
                      type="button"
                      onClick={() => openDoc(profile.aadhaarCardUrl!, "Aadhaar Card")}
                      className="text-xs font-semibold text-primary flex items-center gap-1 hover:text-primary/80 transition-colors leading-snug"
                    >
                      <Eye className="w-3 h-3 shrink-0" /> View Document
                    </button>
                  </div>
                </div>
              )}
              {profile?.collegeIdUrl && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-xl bg-muted/20">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-3 h-3 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-0.5">College ID</p>
                    <a href={profile.collegeIdUrl} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 leading-snug">
                      <Eye className="w-3 h-3 shrink-0" /> View Document
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Expand / collapse toggle */}
          <button
            type="button"
            onClick={() => setDetailsExpanded(v => !v)}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 active:scale-95 transition-all"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-300 ${detailsExpanded ? "rotate-180" : ""}`}
            />
            {detailsExpanded ? "Show less" : "View full details"}
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* Section 2: Payment Details                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className={`px-5 pt-4 ${!payEditing && pay.payHolderName ? "pb-3" : "pb-4 border-b border-border/40"}`}>
          <SectionHeading
            title="Payment Details"
            subtitle={
              !payEditing && pay.payHolderName
                ? "Your approved bank details are shown below."
                : "All fields are required. Enter valid details to receive payments."
            }
            action={
              !payEditing && pay.payHolderName ? (
                <button
                  type="button"
                  onClick={() => setPayEditModal(true)}
                  className="p-2 rounded-lg text-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all"
                  aria-label="Edit payment details"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              ) : undefined
            }
          />
        </div>

        <div className={`px-5 pb-5 ${!payEditing && pay.payHolderName ? "pt-2" : "pt-4"}`}>
          {/* ── Read-only summary (saved state) ─────────────────────────── */}
          {!payEditing && pay.payHolderName ? (
            <div className="rounded-2xl border px-3 py-2.5 bg-[#EAF7F2] border-[#BFE8D9]">
              {/* Header */}
              <div className="flex items-center gap-1 mb-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#2E7D6B" }} />
                <span className="text-xs font-semibold tracking-wide" style={{ color: "#2E7D6B" }}>Approved Payment Details</span>
              </div>
              {/* 2-col grid: Holder/Bank, Branch/IFSC */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { label: "Holder", value: pay.payHolderName, mono: false },
                  { label: "Bank",   value: pay.payBankName,   mono: false },
                  { label: "Branch", value: pay.payBranchName, mono: false },
                  { label: "IFSC",   value: pay.payIfscCode,   mono: true  },
                ].map(({ label, value, mono }) => (
                  <div key={label}>
                    <p className="text-[9px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: "#7BA69A" }}>{label}</p>
                    <p className={`text-xs font-semibold leading-snug ${mono ? "font-mono" : ""}`} style={{ color: "#2E5F52" }}>{value}</p>
                  </div>
                ))}
              </div>
              {/* A/C + UPI — horizontal rows, full width so UPI never splits */}
              <div className="border-t border-[#BFE8D9] mt-2 pt-2 space-y-1.5">
                {/* Account No. */}
                <div className="flex items-center gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest w-16 flex-shrink-0" style={{ color: "#7BA69A" }}>Acct No.</p>
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <p className="text-xs font-semibold font-mono truncate" style={{ color: "#2E5F52" }}>{pay.payAccountNumber}</p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(pay.payAccountNumber);
                        setCopiedField("acc");
                        toast({ title: "Account number copied", duration: 2000 });
                        setTimeout(() => setCopiedField(null), 1500);
                      }}
                      className={`transition-all duration-150 flex-shrink-0 ${copiedField === "acc" ? "scale-110 gc-icon-done" : "scale-100 gc-icon"}`}
                    >
                      {copiedField === "acc" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                {/* UPI — full row, no awkward wrapping */}
                <div className="flex items-start gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest w-16 flex-shrink-0 pt-0.5" style={{ color: "#7BA69A" }}>UPI</p>
                  <div className="flex items-start gap-1 min-w-0 flex-1">
                    <p className="text-xs font-semibold break-all leading-snug" style={{ color: "#2E5F52" }}>{pay.payUpiId}</p>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(pay.payUpiId);
                        setCopiedField("upi");
                        toast({ title: "UPI ID copied", duration: 2000 });
                        setTimeout(() => setCopiedField(null), 1500);
                      }}
                      className={`transition-all duration-150 flex-shrink-0 mt-0.5 ${copiedField === "upi" ? "scale-110 gc-icon-done" : "scale-100 gc-icon"}`}
                    >
                      {copiedField === "upi" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Edit form ──────────────────────────────────────────────── */
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {/* Account Holder Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">Account Holder Name <span className="text-red-500">*</span></label>
                  <Input
                    className={cls(payT.payHolderName ? payV.payHolderName : undefined)}
                    placeholder="Full name"
                    value={pay.payHolderName}
                    onChange={e => {
                      const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                      setPay(p => ({ ...p, payHolderName: val }));
                      setPayV(pv => ({ ...pv, payHolderName: required(val) }));
                      setPayT(pt => ({ ...pt, payHolderName: true }));
                    }}
                  />
                  <FieldFeedback v={payT.payHolderName ? payV.payHolderName : undefined} touched={payT.payHolderName} />
                </div>

                {/* IFSC Code */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">IFSC Code <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input
                      className={`${cls(payT.payIfscCode ? payV.payIfscCode : undefined, "uppercase font-mono pr-9")}`}
                      placeholder="IFSC"
                      maxLength={11}
                      value={pay.payIfscCode}
                      onChange={e => {
                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                        setPay(p => ({ ...p, payIfscCode: val }));
                        const v = validateIfsc(val);
                        setPayV(pv => ({ ...pv, payIfscCode: v }));
                        setPayT(pt => ({ ...pt, payIfscCode: true }));
                        if (v.success) fetchBankFromIfsc(val);
                      }}
                    />
                    {ifscLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />}
                  </div>
                  <FieldFeedback v={payT.payIfscCode ? payV.payIfscCode : undefined} touched={payT.payIfscCode} />
                </div>

                {/* Bank Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">Bank Name <span className="text-red-500">*</span></label>
                  <Input
                    className={cls(payT.payBankName ? payV.payBankName : undefined)}
                    placeholder="Bank name"
                    value={pay.payBankName}
                    onChange={e => {
                      const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                      setPay(p => ({ ...p, payBankName: val }));
                      setPayV(pv => ({ ...pv, payBankName: required(val) }));
                      setPayT(pt => ({ ...pt, payBankName: true }));
                    }}
                  />
                  <FieldFeedback v={payT.payBankName ? payV.payBankName : undefined} touched={payT.payBankName} />
                </div>

                {/* Branch */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">Branch <span className="text-red-500">*</span></label>
                  <Input
                    className={cls(payT.payBranchName ? payV.payBranchName : undefined)}
                    placeholder="Branch"
                    value={pay.payBranchName}
                    onChange={e => {
                      const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                      setPay(p => ({ ...p, payBranchName: val }));
                      setPayV(pv => ({ ...pv, payBranchName: required(val) }));
                      setPayT(pt => ({ ...pt, payBranchName: true }));
                    }}
                  />
                  <FieldFeedback v={payT.payBranchName ? payV.payBranchName : undefined} touched={payT.payBranchName} />
                </div>

                {/* Account Number */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">Account Number <span className="text-red-500">*</span></label>
                  <Input
                    className={`${cls(payT.payAccountNumber ? payV.payAccountNumber : undefined)} font-mono`}
                    placeholder="Account number"
                    maxLength={18}
                    value={pay.payAccountNumber}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, "");
                      setPay(p => ({ ...p, payAccountNumber: val }));
                      setPayV(pv => ({ ...pv, payAccountNumber: val ? validateAccount(val) : { error: "This field is required" } }));
                      setPayT(pt => ({ ...pt, payAccountNumber: true }));
                    }}
                  />
                  <FieldFeedback v={payT.payAccountNumber ? payV.payAccountNumber : undefined} touched={payT.payAccountNumber} />
                </div>

                {/* UPI ID */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground">UPI ID <span className="text-red-500">*</span></label>
                  <Input
                    className={cls(payT.payUpiId ? payV.payUpiId : undefined)}
                    placeholder="UPI ID"
                    value={pay.payUpiId}
                    onChange={e => {
                      const val = e.target.value.toLowerCase();
                      setPay(p => ({ ...p, payUpiId: val }));
                      setPayV(pv => ({ ...pv, payUpiId: {} }));
                      setPayT(pt => ({ ...pt, payUpiId: false }));
                      if (upiDebounceRef.current) clearTimeout(upiDebounceRef.current);
                      upiDebounceRef.current = setTimeout(() => {
                        setPayV(pv => ({ ...pv, payUpiId: val ? validateUpi(val) : { error: "This field is required" } }));
                        setPayT(pt => ({ ...pt, payUpiId: true }));
                      }, 500);
                    }}
                  />
                  <FieldFeedback v={payT.payUpiId ? payV.payUpiId : undefined} touched={payT.payUpiId} />
                </div>

              </div>

              <p className="text-xs text-muted-foreground">
                <span className="text-red-500">*</span> All fields required. Entering IFSC auto-fills bank name and branch.
              </p>

              <div className="flex gap-3 pt-1">
                {pay.payHolderName && (
                  <Button variant="outline" size="lg" className="rounded-xl" onClick={() => setPayEditing(false)}>
                    Cancel
                  </Button>
                )}
                <Button
                  size="lg"
                  className="flex-1 rounded-xl"
                  onClick={handleSavePayment}
                  disabled={savingPay}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  {savingPay ? "Saving…" : "Save Payment Details"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* Section 3: Documents                                                    */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-4 border-b border-border/40">
          <SectionHeading
            title="Documents (PAN Card)"
            subtitle={
              profile?.panNumber
                ? "Submitted documents are reviewed by admin. Contact support to make changes."
                : "PAN number and card image are required for payment processing."
            }
          />
        </div>

        <div className="px-5 pt-4 pb-5">
          {profile?.panNumber ? (
            /* ── Approved read-only card ──────────────────────────────── */
            <div className="rounded-2xl border px-3 py-2.5 bg-[#EAF7F2] border-[#BFE8D9]">
              {/* Header + View button on same row */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#2E7D6B" }} />
                  <span className="text-xs font-semibold tracking-wide" style={{ color: "#2E7D6B" }}>Approved Documents</span>
                </div>
                {profile.panCardUrl && (
                  <button
                    type="button"
                    onClick={() => openDoc(profile.panCardUrl!, "PAN Card")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors flex-shrink-0"
                  >
                    <Eye className="w-3 h-3" /> View PAN
                  </button>
                )}
              </div>
              {/* PAN — horizontal row */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest w-10 flex-shrink-0" style={{ color: "#7BA69A" }}>PAN</p>
                <p className="text-xs font-semibold font-mono" style={{ color: "#2E5F52" }}>{profile.panNumber}</p>
              </div>
              {/* Support note — compact single line */}
              <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "#7BA69A" }}>
                To update, contact{" "}
                <a href="mailto:info@goteamcrew.in" className="font-semibold underline text-indigo-500 hover:text-indigo-700">
                  info@goteamcrew.in
                </a>
              </p>
            </div>
          ) : (
            /* ── Submit form ──────────────────────────────────────────── */
            <div className="space-y-5">
              {/* PAN Number */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">PAN Card Number <span className="text-red-500">*</span></label>
                <Input
                  className={`${cls(docT.panNumber ? docV.panNumber : undefined)} uppercase font-mono`}
                  placeholder="PAN number"
                  maxLength={10}
                  value={docs.panNumber}
                  onChange={e => {
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    setDocs(d => ({ ...d, panNumber: val }));
                    setDocV(dv => ({ ...dv, panNumber: val ? validatePan(val) : { error: "This field is required" } }));
                    setDocT(dt => ({ ...dt, panNumber: true }));
                  }}
                />
                <FieldFeedback v={docT.panNumber ? docV.panNumber : undefined} touched={docT.panNumber} />
                {!docT.panNumber && <p className="text-xs text-muted-foreground">Format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)</p>}
              </div>

              {/* PAN Card Image */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  PAN Card Image <span className="text-red-500">*</span>
                </label>
                {panCardPreview ? (
                  <div className="relative inline-block mt-1">
                    <img src={panCardPreview} alt="PAN preview"
                      className="h-32 rounded-xl border border-border/50 object-contain bg-muted/20" />
                    <button type="button" onClick={clearPanFile}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center shadow">
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <p className="text-xs text-muted-foreground mt-1">{panCardFile?.name}</p>
                  </div>
                ) : (
                  <div
                    onClick={() => panFileRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 h-28 rounded-xl border-2 border-dashed cursor-pointer hover:bg-muted/40 transition-colors mt-1 ${
                      docT.panCard && docV.panCard?.error ? "border-red-400 bg-red-50/30" : "border-border/60 bg-muted/20"
                    }`}
                  >
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload PAN card image or PDF</p>
                    <p className="text-xs text-muted-foreground/70">JPG, PNG or PDF — max 10MB</p>
                  </div>
                )}
                <FieldFeedback v={docT.panCard ? docV.panCard : undefined} touched={docT.panCard} />
                <input ref={panFileRef} type="file" accept="image/jpeg,image/jpg,image/png,application/pdf"
                  onChange={handlePanFile} className="hidden" />
              </div>

              <p className="text-xs text-muted-foreground">
                <span className="text-red-500">*</span> PAN number is required. Image required for first submission.
              </p>

              <div className="flex justify-end pt-1">
                <Button size="lg" className="rounded-xl px-8" onClick={handleSaveDocs} disabled={savingDocs}>
                  <FileText className="w-4 h-4 mr-2" />
                  {savingDocs ? "Saving…" : "Save Documents"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Payment Edit Modal ───────────────────────────────────────────────────── */}
      <Dialog open={payEditModal} onOpenChange={open => { if (!open) setPayEditModal(false); }}>
        <DialogContent className="sm:max-w-md w-full p-0 gap-0 rounded-2xl overflow-hidden flex flex-col max-h-[90dvh]">
          <DialogHeader className="px-5 pt-5 pb-4 border-b border-border/40 flex-shrink-0">
            <DialogTitle className="text-base font-bold">Edit Payment Details</DialogTitle>
          </DialogHeader>

          {/* Scrollable form body */}
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Account Holder Name <span className="text-red-500">*</span></label>
              <Input
                className={cls(payT.payHolderName ? payV.payHolderName : undefined)}
                placeholder="Full name"
                value={pay.payHolderName}
                onChange={e => {
                  const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                  setPay(p => ({ ...p, payHolderName: val }));
                  setPayV(pv => ({ ...pv, payHolderName: required(val) }));
                  setPayT(pt => ({ ...pt, payHolderName: true }));
                }}
              />
              <FieldFeedback v={payT.payHolderName ? payV.payHolderName : undefined} touched={payT.payHolderName} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">IFSC Code <span className="text-red-500">*</span></label>
              <div className="relative">
                <Input
                  className={`${cls(payT.payIfscCode ? payV.payIfscCode : undefined, "uppercase font-mono pr-9")}`}
                  placeholder="IFSC"
                  maxLength={11}
                  value={pay.payIfscCode}
                  onChange={e => {
                    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    setPay(p => ({ ...p, payIfscCode: val }));
                    const v = validateIfsc(val);
                    setPayV(pv => ({ ...pv, payIfscCode: v }));
                    setPayT(pt => ({ ...pt, payIfscCode: true }));
                    if (v.success) fetchBankFromIfsc(val);
                  }}
                />
                {ifscLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />}
              </div>
              <FieldFeedback v={payT.payIfscCode ? payV.payIfscCode : undefined} touched={payT.payIfscCode} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Bank Name <span className="text-red-500">*</span></label>
              <Input
                className={cls(payT.payBankName ? payV.payBankName : undefined)}
                placeholder="Bank name"
                value={pay.payBankName}
                onChange={e => {
                  const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                  setPay(p => ({ ...p, payBankName: val }));
                  setPayV(pv => ({ ...pv, payBankName: required(val) }));
                  setPayT(pt => ({ ...pt, payBankName: true }));
                }}
              />
              <FieldFeedback v={payT.payBankName ? payV.payBankName : undefined} touched={payT.payBankName} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Branch <span className="text-red-500">*</span></label>
              <Input
                className={cls(payT.payBranchName ? payV.payBranchName : undefined)}
                placeholder="Branch"
                value={pay.payBranchName}
                onChange={e => {
                  const val = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
                  setPay(p => ({ ...p, payBranchName: val }));
                  setPayV(pv => ({ ...pv, payBranchName: required(val) }));
                  setPayT(pt => ({ ...pt, payBranchName: true }));
                }}
              />
              <FieldFeedback v={payT.payBranchName ? payV.payBranchName : undefined} touched={payT.payBranchName} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Account Number <span className="text-red-500">*</span></label>
              <Input
                className={`${cls(payT.payAccountNumber ? payV.payAccountNumber : undefined)} font-mono`}
                placeholder="Account number"
                maxLength={18}
                value={pay.payAccountNumber}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, "");
                  setPay(p => ({ ...p, payAccountNumber: val }));
                  setPayV(pv => ({ ...pv, payAccountNumber: val ? validateAccount(val) : { error: "This field is required" } }));
                  setPayT(pt => ({ ...pt, payAccountNumber: true }));
                }}
              />
              <FieldFeedback v={payT.payAccountNumber ? payV.payAccountNumber : undefined} touched={payT.payAccountNumber} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">UPI ID <span className="text-red-500">*</span></label>
              <Input
                className={cls(payT.payUpiId ? payV.payUpiId : undefined)}
                placeholder="UPI ID"
                value={pay.payUpiId}
                onChange={e => {
                  const val = e.target.value.toLowerCase();
                  setPay(p => ({ ...p, payUpiId: val }));
                  setPayV(pv => ({ ...pv, payUpiId: {} }));
                  setPayT(pt => ({ ...pt, payUpiId: false }));
                  if (upiDebounceRef.current) clearTimeout(upiDebounceRef.current);
                  upiDebounceRef.current = setTimeout(() => {
                    setPayV(pv => ({ ...pv, payUpiId: val ? validateUpi(val) : { error: "This field is required" } }));
                    setPayT(pt => ({ ...pt, payUpiId: true }));
                  }, 500);
                }}
              />
              <FieldFeedback v={payT.payUpiId ? payV.payUpiId : undefined} touched={payT.payUpiId} />
            </div>

            <p className="text-xs text-muted-foreground pb-1">
              Entering IFSC auto-fills bank name and branch.
            </p>
          </div>

          {/* Sticky footer actions */}
          <div className="flex gap-3 px-5 py-4 border-t border-border/40 flex-shrink-0 bg-background">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={() => setPayEditModal(false)} disabled={savingPay}>
              Cancel
            </Button>
            <Button className="flex-1 rounded-xl" onClick={handleSavePayment} disabled={savingPay}>
              {savingPay ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Intro Video Modal ─────────────────────────────────────────────────── */}
      {videoModalOpen && createPortal(
        <div
          style={{
            transition: "opacity 0.2s ease",
            opacity: videoModalVisible ? 1 : 0,
          }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85"
          onClick={closeVideoModal}
        >
          <div className="relative w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={closeVideoModal}
              className="absolute -top-9 right-0 text-white/70 hover:text-white transition-colors flex items-center gap-1 text-xs"
            >
              <X className="w-4 h-4" /> Close
            </button>
            <video
              ref={videoModalRef}
              src={pendingVideoObjUrl ?? (introVideoUrl ? `${BASE_URL}${introVideoUrl}` : "")}
              controls
              playsInline
              controlsList="nodownload"
              className="w-full rounded-2xl bg-black"
              preload="auto"
            />
          </div>
        </div>,
        document.body
      )}

      {/* ── Portfolio Lightbox — full-screen preview with swipe navigation ─────── */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center select-none"
          style={{
            transition: "opacity 0.18s ease",
            opacity: lbVisible ? 1 : 0,
          }}
          onClick={closeLightbox}
          onTouchStart={handleLbTouchStart}
          onTouchMove={handleLbTouchMove}
          onTouchEnd={handleLbTouchEnd}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/95" />

          {/* Preload adjacent images for flicker-free swipe */}
          {lightboxIdx > 0 && (
            <link rel="preload" as="image" href={portfolioPhotos[lightboxIdx - 1]} />
          )}
          {lightboxIdx < portfolioPhotos.length - 1 && (
            <link rel="preload" as="image" href={portfolioPhotos[lightboxIdx + 1]} />
          )}

          {/* Top-right controls: Download + Close */}
          <div
            className="absolute top-4 right-4 z-20 flex items-center gap-2"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => downloadPhoto(portfolioPhotos[lightboxIdx], lightboxIdx)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center transition-colors touch-manipulation"
              aria-label="Download photo"
            >
              <Download className="w-[18px] h-[18px] text-white" />
            </button>
            <button
              type="button"
              onClick={closeLightbox}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Photo counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/50 text-white text-sm font-semibold px-3 py-1 rounded-full tabular-nums pointer-events-none">
            {lightboxIdx + 1} / {portfolioPhotos.length}
          </div>

          {/* Swipe wrapper — direct DOM transform, zero re-renders ─────────────── */}
          <div
            ref={swipeWrapperRef}
            className="relative z-10"
            style={{ transform: "translate3d(0,0,0)", willChange: "transform" }}
            onClick={e => e.stopPropagation()}
          >
            <img
              key={lightboxIdx}
              src={portfolioPhotos[lightboxIdx]}
              alt={`Portfolio photo ${lightboxIdx + 1}`}
              className="max-w-[90vw] max-h-[82vh] rounded-xl object-contain shadow-2xl"
              style={{
                transition: "transform 0.18s ease, opacity 0.18s ease",
                transform: lbVisible ? "scale(1)" : "scale(0.94)",
                opacity: lbVisible ? 1 : 0,
              }}
              draggable={false}
            />
            {/* Quality badge overlay — bottom-right of the image (Approved only) */}
            {photoQuality[lightboxIdx] === "good" && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-emerald-500/90 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg pointer-events-none backdrop-blur-sm">
                <ThumbsUp className="w-3.5 h-3.5" />
                <span>Approved</span>
              </div>
            )}
          </div>

          {/* Not Usable notice + Replace button — positioned above thumbnail strip / nav dots */}
          {photoQuality[lightboxIdx] === "rejected" && (
            <div
              className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            >
              {/* Status pill */}
              <div className="flex items-center gap-1.5 bg-red-950/90 border border-red-500/30 text-red-300 text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm shadow-lg whitespace-nowrap pointer-events-none">
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span>Not Usable</span>
              </div>
              {/* Replace button */}
              <button
                type="button"
                disabled={replacingPhoto}
                onClick={e => { e.stopPropagation(); replaceIdxRef.current = lightboxIdx ?? 0; replacePhotoRef.current?.click(); }}
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 active:bg-white/30 border border-white/20 text-white text-xs font-semibold px-4 py-2 rounded-full backdrop-blur-sm shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap touch-manipulation"
              >
                {replacingPhoto
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Uploading…</span></>
                  : <><Upload className="w-3.5 h-3.5" /><span>Replace Photo</span></>
                }
              </button>
            </div>
          )}

          {/* Previous arrow */}
          {lightboxIdx > 0 && (
            <button
              ref={lbPrevBtnRef}
              type="button"
              onClick={e => { e.stopPropagation(); setLightboxIdx(i => Math.max(0, (i ?? 1) - 1)); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors touch-manipulation"
              style={{ transition: "opacity 0.15s" }}
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Next arrow */}
          {lightboxIdx < portfolioPhotos.length - 1 && (
            <button
              ref={lbNextBtnRef}
              type="button"
              onClick={e => { e.stopPropagation(); setLightboxIdx(i => Math.min(portfolioPhotos.length - 1, (i ?? 0) + 1)); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors touch-manipulation"
              style={{ transition: "opacity 0.15s" }}
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Dot indicators — primary position indicator */}
          {portfolioPhotos.length > 1 && (
            <div
              className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-1.5"
              onClick={e => e.stopPropagation()}
            >
              {portfolioPhotos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightboxIdx(i)}
                  className="touch-manipulation"
                  aria-label={`Go to photo ${i + 1}`}
                >
                  <span
                    className={`block rounded-full transition-all duration-200 ${
                      i === lightboxIdx
                        ? "w-5 h-2 bg-white"
                        : "w-2 h-2 bg-white/40 hover:bg-white/70"
                    }`}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Thumbnail strip — secondary navigation, scrollable */}
          {portfolioPhotos.length > 1 && (
            <div
              className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 max-w-[80vw] overflow-x-auto px-2 pb-1 scrollbar-none"
              style={{ scrollbarWidth: "none" }}
              onClick={e => e.stopPropagation()}
            >
              {portfolioPhotos.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLightboxIdx(i)}
                  className={`w-9 h-9 rounded-md overflow-hidden shrink-0 transition-all touch-manipulation ${
                    i === lightboxIdx
                      ? "ring-2 ring-white scale-110 opacity-100"
                      : "opacity-35 hover:opacity-60"
                  }`}
                  aria-label={`Go to photo ${i + 1}`}
                >
                  <img src={s} alt="" className="w-full h-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Avatar/single-photo lightbox ─────────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img
            src={lightbox}
            alt="Photo preview"
            className="max-w-full max-h-[90vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Sticky Portfolio Save Bar ─────────────────────────────────────────── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-30 transition-all duration-300 ${portfolioChanged ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-full opacity-0 pointer-events-none"}`}
      >
        <div className="bg-white/95 backdrop-blur border-t border-border/60 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <p className="text-xs text-amber-600 font-medium flex items-center gap-1.5 mb-2">
            <Info className="w-3.5 h-3.5 shrink-0" /> You have unsaved changes
          </p>
          <Button
            className="w-full h-11 text-sm font-semibold rounded-xl gap-2"
            onClick={handlePortfolioSave}
            disabled={savingPortfolio}
          >
            {savingPortfolio
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><Save className="w-4 h-4" /> Save Photos</>
            }
          </Button>
        </div>
      </div>

      {/* ── Document preview modal (Aadhaar, PAN, etc.) ──────────────────────── */}
      {docPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={closeDoc}
        >
          <div
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">{docPreview.title}</span>
              </div>
              <button
                type="button"
                onClick={closeDoc}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="relative min-h-[280px] flex items-center justify-center bg-gray-50">
              {docPreviewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              )}
              {docPreview.url.toLowerCase().includes(".pdf") || docPreview.url.includes("application/pdf") ? (
                <iframe
                  src={docPreview.url}
                  title={docPreview.title}
                  className="w-full h-[60vh]"
                  onLoad={() => setDocPreviewLoading(false)}
                />
              ) : (
                <img
                  src={docPreview.url}
                  alt={docPreview.title}
                  className="max-w-full max-h-[60vh] object-contain p-3"
                  onLoad={() => setDocPreviewLoading(false)}
                  onError={() => setDocPreviewLoading(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
