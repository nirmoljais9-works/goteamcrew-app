import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { generateVideoThumbnail } from "@/lib/utils";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApproveCrew } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Check, X, Ban, Phone, Mail, MapPin, User, Calendar, Ruler,
  Languages, Star, Award, FileText, MessageCircle, ExternalLink,
  Shield, CheckCircle, Clock, AlertTriangle, Instagram, CreditCard,
  Images, Wallet, Building2, Hash, Eye, Megaphone, ChevronLeft, ChevronRight, Trash2,
  ThumbsUp, ThumbsDown, Download, Play, Video, Users,
} from "lucide-react";
import { WaNotifyDialog } from "@/components/wa-notify-dialog";
import { format } from "date-fns";

const STATUS_STYLES: Record<string, { bg: string; ring: string; text: string; label: string; icon: any }> = {
  pending:      { bg: "bg-amber-50",   ring: "ring-amber-200",   text: "text-amber-700",  label: "Pending Review",          icon: Clock },
  approved:     { bg: "bg-emerald-50", ring: "ring-emerald-200", text: "text-emerald-700",label: "Approved",                 icon: CheckCircle },
  active:       { bg: "bg-blue-50",    ring: "ring-blue-200",    text: "text-blue-700",   label: "Active",                  icon: CheckCircle },
  rejected:     { bg: "bg-red-50",     ring: "ring-red-200",     text: "text-red-700",    label: "Rejected",                 icon: X },
  resubmitted:  { bg: "bg-orange-50",  ring: "ring-orange-200",  text: "text-orange-700", label: "Updated — Awaiting Review",icon: AlertTriangle },
  blacklisted:  { bg: "bg-gray-900",   ring: "ring-gray-700",    text: "text-white",      label: "Blacklisted",              icon: Shield },
};

function InfoItem({ icon: Icon, label, value }: { icon: any; label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium text-foreground mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

interface CrewProfileModalProps {
  crewId: number | null;
  onClose: () => void;
}

export function CrewProfileModal({ crewId, onClose }: CrewProfileModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const approveMutation = useAdminApproveCrew();

  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  const [videoDuration,  setVideoDuration]  = useState<string>("");
  const adminVideoRef = useRef<HTMLVideoElement>(null);
  const [pendingWa, setPendingWa] = useState<{ url: string; action: "approve" | "reject"; name: string } | null>(null);

  // ── Portfolio indexed lightbox — state & refs ─────────────────────────────
  const [lbIdx,     setLbIdx]     = useState<number | null>(null);
  const [lbVisible, setLbVisible] = useState(false);
  const touchStartX     = useRef<number | null>(null);
  const touchStartY     = useRef<number | null>(null);
  const mouseStartX     = useRef<number | null>(null);
  const swipeDxRef      = useRef(0);
  const isSwipingRef    = useRef(false);
  const swipeWrapperRef = useRef<HTMLDivElement>(null);
  const lbPrevBtnRef    = useRef<HTMLButtonElement>(null);
  const lbNextBtnRef    = useRef<HTMLButtonElement>(null);
  const closeLbTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: crew, isLoading } = useQuery({
    queryKey: [`/api/admin/crew/${crewId}`],
    queryFn: async () => {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: !!crewId,
    staleTime: 0,
  });

  const { data: referralStats } = useQuery({
    queryKey: [`/api/admin/crew/${crewId}/referral-stats`],
    queryFn: async () => {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}/referral-stats`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ registered: number; selected: number; confirmed: number; rejected: number; successRate: number }>;
    },
    enabled: !!crewId,
    staleTime: 30_000,
  });

  // portfolioPhotos MUST be defined before the useEffects that reference it
  const portfolioPhotos = useMemo<string[]>(() => {
    try { return JSON.parse(crew?.portfolioPhotos || "[]"); } catch { return []; }
  }, [crew?.portfolioPhotos]);

  // Parallel quality array: "good" | "rejected" | null per photo index
  const photoQuality = useMemo<(string | null)[]>(() => {
    try {
      const q = JSON.parse(crew?.photoQuality || "[]");
      return Array.isArray(q) ? q : [];
    } catch { return []; }
  }, [crew?.photoQuality]);

  const [lbDeleteConfirm,  setLbDeleteConfirm]  = useState(false);
  const [lbDeleting,       setLbDeleting]        = useState(false);
  const [lbQualitySaving,  setLbQualitySaving]   = useState<"good" | "rejected" | null>(null);

  const [videoQuality,     setVideoQuality]      = useState<"good" | "can_be_improved" | null>(null);
  const [videoQualitySaving, setVideoQualitySaving] = useState(false);

  // Sync videoQuality when crew data loads/changes
  useEffect(() => {
    setVideoQuality((crew?.introVideoQuality as "good" | "can_be_improved" | null) ?? null);
  }, [crew?.introVideoQuality]);

  // Auto-play modal video when it opens
  useEffect(() => {
    if (!videoModalOpen) return;
    const raf = requestAnimationFrame(() => {
      adminVideoRef.current?.play().catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [videoModalOpen]);

  // Generate thumbnail when crew video URL is available
  useEffect(() => {
    const src = crew?.introVideoUrl;
    if (!src) { setVideoThumbnail(null); setVideoDuration(""); return; }
    let cancelled = false;
    generateVideoThumbnail(src)
      .then(({ thumbnail, duration }) => {
        if (!cancelled) { setVideoThumbnail(thumbnail); setVideoDuration(duration); }
      })
      .catch(() => { if (!cancelled) { setVideoThumbnail(null); setVideoDuration(""); } });
    return () => { cancelled = true; };
  }, [crew?.introVideoUrl]);

  const openLb  = (i: number) => { setLbIdx(i); setLbDeleteConfirm(false); };
  const closeLb = () => {
    setLbVisible(false);
    setLbDeleteConfirm(false);
    // Clear any in-flight close timer to prevent races (e.g. double-click X + delete)
    if (closeLbTimer.current) clearTimeout(closeLbTimer.current);
    closeLbTimer.current = setTimeout(() => { setLbIdx(null); closeLbTimer.current = null; }, 200);
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
      toast({ variant: "destructive", title: "Download failed" });
    }
  };

  const handleLbDelete = async () => {
    if (lbIdx === null || !crewId) return;
    setLbDeleting(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}/portfolio/${lbIdx}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete photo");
      const { portfolioPhotos: updated, photoQuality: updatedQ } = await res.json();
      // Instant cache update — no refetch needed
      queryClient.setQueryData([`/api/admin/crew/${crewId}`], (old: any) =>
        old ? { ...old, portfolioPhotos: JSON.stringify(updated), photoQuality: JSON.stringify(updatedQ ?? []) } : old
      );
      setLbDeleteConfirm(false);
      // Stay on same position (or move back if we deleted the last photo)
      const newLen = updated.length;
      if (newLen === 0) closeLb();
      else setLbIdx(Math.min(lbIdx, newLen - 1));
    } catch {
      toast({ title: "Error", description: "Could not delete photo. Please try again.", variant: "destructive" });
    } finally {
      setLbDeleting(false);
    }
  };

  const handleSetQuality = async (quality: "good" | "rejected" | null) => {
    if (lbIdx === null || !crewId) return;
    // Toggle off if already set to the same quality
    const current = photoQuality[lbIdx] ?? null;
    const next = current === quality ? null : quality;
    setLbQualitySaving(next ?? quality); // show spinner on the button being tapped
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}/portfolio/${lbIdx}/quality`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: next }),
      });
      if (!res.ok) throw new Error("Failed to set quality");
      const { photoQuality: updatedQ } = await res.json();
      queryClient.setQueryData([`/api/admin/crew/${crewId}`], (old: any) =>
        old ? { ...old, photoQuality: JSON.stringify(updatedQ) } : old
      );
    } catch {
      toast({ title: "Error", description: "Could not update photo quality.", variant: "destructive" });
    } finally {
      setLbQualitySaving(null);
    }
  };

  // Fade-in on open
  useEffect(() => {
    if (lbIdx !== null) {
      const raf = requestAnimationFrame(() => setLbVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setLbVisible(false);
    }
  }, [lbIdx]);

  // Reset wrapper to centre on each navigation
  useEffect(() => {
    if (swipeWrapperRef.current) {
      swipeWrapperRef.current.style.transition = "none";
      swipeWrapperRef.current.style.transform  = "translate3d(0,0,0)";
    }
    swipeDxRef.current   = 0;
    isSwipingRef.current = false;
  }, [lbIdx]);

  // Keyboard navigation
  useEffect(() => {
    if (lbIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      closeLb();
      if (e.key === "ArrowLeft"  && lbIdx > 0)                           setLbIdx(i => Math.max(0, (i ?? 1) - 1));
      if (e.key === "ArrowRight" && lbIdx < portfolioPhotos.length - 1)  setLbIdx(i => Math.min(portfolioPhotos.length - 1, (i ?? 0) + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lbIdx, portfolioPhotos.length]);

  // ── Touch handlers ─────────────────────────────────────────────────────────
  const handleLbTouchStart = (e: React.TouchEvent) => {
    touchStartX.current  = e.touches[0].clientX;
    touchStartY.current  = e.touches[0].clientY;
    isSwipingRef.current = false;
    if (swipeWrapperRef.current) swipeWrapperRef.current.style.transition = "none";
  };
  const handleLbTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || lbIdx === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - (touchStartY.current ?? 0);
    if (!isSwipingRef.current && Math.abs(dy) > Math.abs(dx) + 8) return;
    isSwipingRef.current = true;
    const atStart = lbIdx === 0 && dx > 0;
    const atEnd   = lbIdx === portfolioPhotos.length - 1 && dx < 0;
    const rdx = (atStart || atEnd) ? dx * 0.18 : dx;
    swipeDxRef.current = rdx;
    if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = `translate3d(${rdx}px,0,0)`;
    if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "0";
    if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "0";
  };
  const handleLbTouchEnd = () => {
    const dx = swipeDxRef.current;
    if (swipeWrapperRef.current)
      swipeWrapperRef.current.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
    if (Math.abs(dx) > 55 && lbIdx !== null) {
      if      (dx < 0 && lbIdx < portfolioPhotos.length - 1) setLbIdx(lbIdx + 1);
      else if (dx > 0 && lbIdx > 0)                          setLbIdx(lbIdx - 1);
      else if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    } else {
      if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    }
    swipeDxRef.current = 0; isSwipingRef.current = false;
    touchStartX.current = null; touchStartY.current = null;
    setTimeout(() => {
      if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "1";
      if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "1";
    }, 120);
  };

  // ── Mouse drag handlers (desktop) ─────────────────────────────────────────
  const handleLbMouseDown = (e: React.MouseEvent) => {
    mouseStartX.current  = e.clientX;
    isSwipingRef.current = false;
    if (swipeWrapperRef.current) swipeWrapperRef.current.style.transition = "none";
  };
  const handleLbMouseMove = (e: React.MouseEvent) => {
    if (mouseStartX.current === null || lbIdx === null || !(e.buttons & 1)) return;
    const dx = e.clientX - mouseStartX.current;
    isSwipingRef.current = true;
    const atStart = lbIdx === 0 && dx > 0;
    const atEnd   = lbIdx === portfolioPhotos.length - 1 && dx < 0;
    const rdx = (atStart || atEnd) ? dx * 0.18 : dx;
    swipeDxRef.current = rdx;
    if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = `translate3d(${rdx}px,0,0)`;
    if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "0";
    if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "0";
  };
  const handleLbMouseUp = () => {
    if (!isSwipingRef.current) { mouseStartX.current = null; return; }
    const dx = swipeDxRef.current;
    if (swipeWrapperRef.current)
      swipeWrapperRef.current.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
    if (Math.abs(dx) > 55 && lbIdx !== null) {
      if      (dx < 0 && lbIdx < portfolioPhotos.length - 1) setLbIdx(lbIdx + 1);
      else if (dx > 0 && lbIdx > 0)                          setLbIdx(lbIdx - 1);
      else if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    } else {
      if (swipeWrapperRef.current) swipeWrapperRef.current.style.transform = "translate3d(0,0,0)";
    }
    swipeDxRef.current = 0; isSwipingRef.current = false; mouseStartX.current = null;
    setTimeout(() => {
      if (lbPrevBtnRef.current) lbPrevBtnRef.current.style.opacity = "1";
      if (lbNextBtnRef.current) lbNextBtnRef.current.style.opacity = "1";
    }, 120);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/admin/crew/${crewId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  };

  const formatPhoneDisplay = (phone: string): string => {
    if (!phone) return phone;
    if (phone.startsWith("+91")) {
      return phone.slice(3);
    }
    return phone;
  };

  const formatWaPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) return digits;
    return "91" + digits;
  };

  const openDoc = (url: string | null | undefined) => {
    if (!url) return;
    const lower = url.toLowerCase();
    if (lower.includes(".pdf") || lower.includes("%2fpdf") || lower.includes("application%2fpdf")) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      setLightboxSrc(url);
    }
  };

  const handleSetVideoQuality = async (quality: "good" | "can_be_improved" | null) => {
    if (!crew?.id || videoQualitySaving) return;
    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    const next = videoQuality === quality ? null : quality;
    setVideoQuality(next);
    setVideoQualitySaving(true);
    try {
      await fetch(`${BASE_URL}/api/admin/crew/${crew.id}/intro-video-quality`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: next }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/crew/${crew.id}`] });
    } catch {
      setVideoQuality(videoQuality);
    } finally {
      setVideoQualitySaving(false);
    }
  };

  const buildWaApproveUrl = (phone: string, name: string) => {
    const waPhone = formatWaPhone(phone);
    const msg = `Hi ${name},\n\nYour profile has been approved.\n\nYou can now view and apply for event opportunities here:\nhttps://goteamcrew.com/login\n\n\u2013 Goteamcrew`;
    return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
  };

  const buildWaRejectUrl = (phone: string, name: string, reason: string, editLink: string) => {
    const waPhone = formatWaPhone(phone);
    const msg = `Hi ${name},\n\nThank you for applying to Goteamcrew.\n\nUnfortunately, your profile was not approved for the following reason:\n\n"${reason}"\n\nYou can update your details and reapply using this link:\n${editLink}\n\nIf you have any questions, feel free to contact us at info@goteamcrew.in\n\n– Team Goteamcrew`;
    return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
  };

  const handleApprove = () => {
    if (!crew) return;
    approveMutation.mutate({ id: crew.id }, {
      onSuccess: () => {
        toast({ title: `✓ ${crew.name} approved` });
        invalidate();
        setPendingWa({ url: buildWaApproveUrl(crew.phone, crew.name), action: "approve", name: crew.name });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Failed to approve" });
      },
    });
  };

  const handleDoReject = async () => {
    if (!crew) return;
    setRejectLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crew.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      toast({ title: `${crew.name} rejected` });
      invalidate();
      const waUrl = buildWaRejectUrl(crew.phone, crew.name, rejectReason.trim(), data.editLink);
      setRejectOpen(false);
      setRejectReason("");
      setPendingWa({ url: waUrl, action: "reject", name: crew.name });
    } catch {
      toast({ variant: "destructive", title: "Failed to reject" });
    } finally {
      setRejectLoading(false);
    }
  };

  const handleBlacklist = async () => {
    if (!crew) return;
    setBlacklistLoading(true);
    try {
      const res = await fetch(`/api/admin/crew/${crew.id}/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: blacklistReason }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `⛔ ${crew.name} blacklisted` });
      invalidate();
      setBlacklistOpen(false);
      setBlacklistReason("");
    } catch {
      toast({ variant: "destructive", title: "Failed to blacklist" });
    } finally {
      setBlacklistLoading(false);
    }
  };

  const statusStyle = crew ? (STATUS_STYLES[crew.status] ?? STATUS_STYLES.pending) : STATUS_STYLES.pending;
  const StatusIcon = statusStyle.icon;

  return (
    <>
      {/* Dialog is closed while lightbox is open — Radix modal blocks outside pointer events */}
      <Dialog open={!!crewId && !blacklistOpen && !lightboxSrc && lbIdx === null && !videoModalOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading profile…</p>
            </div>
          ) : !crew ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertTriangle className="w-10 h-10 text-destructive" />
              <p className="font-semibold">Profile not found</p>
            </div>
          ) : (
            <>
              {/* Hero header */}
              <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-8 pb-6">
                <div className="flex items-start gap-5">
                  {/* Profile photo — circular */}
                  <div className="shrink-0">
                    {crew.closeUpPhotoUrl && !photoError ? (
                      <button
                        onClick={() => setLightboxSrc(crew.closeUpPhotoUrl)}
                        className="w-20 h-20 rounded-full ring-4 ring-white shadow-lg overflow-hidden focus:outline-none"
                      >
                        <img
                          src={crew.closeUpPhotoUrl}
                          alt={crew.name}
                          className="w-full h-full object-cover"
                          onError={() => setPhotoError(true)}
                        />
                      </button>
                    ) : (
                      <div className="w-20 h-20 rounded-full ring-4 ring-white shadow-lg bg-primary/10 flex items-center justify-center">
                        <User className="w-9 h-9 text-primary/60" />
                      </div>
                    )}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0 pt-1">
                    <h2 className="text-xl font-bold text-foreground leading-tight">{crew.name}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{crew.email}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {/* Status badge */}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${statusStyle.bg} ${statusStyle.ring} ${statusStyle.text}`}>
                        <StatusIcon className="w-3 h-3" />
                        {statusStyle.label}
                      </span>
                      {crew.category && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                          {crew.category}
                        </span>
                      )}
                      {crew.city && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" />{crew.city}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Registered {format(new Date(crew.createdAt), "dd MMM yyyy")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Blacklist reason banner */}
              {crew.status === "blacklisted" && crew.blacklistReason && (
                <div className="mx-6 mt-2 flex gap-3 p-3 bg-gray-900 text-white rounded-lg text-sm">
                  <Shield className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-xs uppercase tracking-wide text-gray-400">Blacklist Reason</p>
                    <p className="text-gray-200 mt-0.5">{crew.blacklistReason}</p>
                  </div>
                </div>
              )}

              {/* Rejection reason banner */}
              {(crew.status === "rejected" || crew.status === "resubmitted") && crew.rejectionReason && (
                <div className={`mx-6 mt-2 flex gap-3 p-3 rounded-lg text-sm ${crew.status === "resubmitted" ? "bg-orange-50 border border-orange-200" : "bg-red-50 border border-red-200"}`}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${crew.status === "resubmitted" ? "text-orange-500" : "text-red-500"}`} />
                  <div>
                    <p className={`font-semibold text-xs uppercase tracking-wide ${crew.status === "resubmitted" ? "text-orange-600" : "text-red-600"}`}>
                      {crew.status === "resubmitted" ? "Previous Rejection Reason" : "Rejection Reason"}
                    </p>
                    <p className={`mt-0.5 ${crew.status === "resubmitted" ? "text-orange-800" : "text-red-800"}`}>{crew.rejectionReason}</p>
                  </div>
                </div>
              )}

              {/* Details grid */}
              <div className="px-6 py-5 space-y-5">
                {/* Personal */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    Personal Info
                    <span className="h-px flex-1 bg-border" />
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <InfoItem icon={Phone} label="Phone" value={formatPhoneDisplay(crew.phone)} />
                    <InfoItem icon={User} label="Gender" value={crew.gender} />
                    <InfoItem icon={Calendar} label="Age" value={crew.age ? `${crew.age} years` : null} />
                    <InfoItem icon={MapPin} label="City" value={crew.city} />
                    <InfoItem icon={Ruler} label="Height" value={crew.height} />
                    <InfoItem icon={Languages} label="Languages" value={crew.languages} />
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Megaphone className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-muted-foreground tracking-wider">How did you hear about us?</p>
                        <p className="text-sm font-medium text-foreground mt-0.5 break-words">{crew.source || "Not provided"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Professional */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    Professional
                    <span className="h-px flex-1 bg-border" />
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <InfoItem icon={Star} label="Role" value={crew.category} />
                    <InfoItem icon={Award} label="Experience" value={crew.experienceLevel} />
                    <InfoItem icon={CheckCircle} label="Shifts Done" value={crew.completedShifts != null ? String(crew.completedShifts) : null} />
                    <InfoItem icon={Star} label="Total Earnings" value={crew.totalEarnings != null && parseFloat(crew.totalEarnings) > 0 ? `₹${parseFloat(crew.totalEarnings).toFixed(0)}` : null} />
                  </div>
                  {crew.instagramUrl && (
                    <a
                      href={crew.instagramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm text-pink-600 hover:text-pink-700 font-medium"
                    >
                      <Instagram className="w-4 h-4" /> {crew.instagramUrl}
                    </a>
                  )}
                </div>

                {/* Referral Performance — only if this crew member has made referrals */}
                {referralStats && referralStats.registered > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="h-px flex-1 bg-border" />
                      <Users className="w-3 h-3" /> Referral Performance
                      <span className="h-px flex-1 bg-border" />
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="bg-muted/40 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-foreground">{referralStats.registered}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Referred</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">{referralStats.selected + referralStats.confirmed}</p>
                        <p className="text-[11px] text-emerald-600 mt-0.5">Selected</p>
                      </div>
                      <div className="bg-red-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-red-600">{referralStats.rejected}</p>
                        <p className="text-[11px] text-red-500 mt-0.5">Rejected</p>
                      </div>
                      <div className="bg-indigo-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-indigo-700">{referralStats.successRate}%</p>
                        <p className="text-[11px] text-indigo-500 mt-0.5">Success Rate</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Portfolio Photos */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    <Images className="w-3 h-3" /> Portfolio Photos
                    {portfolioPhotos.length > 0 && (
                      <span className="font-normal normal-case text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{portfolioPhotos.length} photo{portfolioPhotos.length !== 1 ? "s" : ""}</span>
                    )}
                    <span className="h-px flex-1 bg-border" />
                  </h3>
                  {portfolioPhotos.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No photos uploaded</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {portfolioPhotos.map((src, i) => {
                        const q = photoQuality[i] ?? null;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => openLb(i)}
                            className={`relative aspect-square rounded-lg overflow-hidden border bg-muted/20 group focus:outline-none transition-all ${
                              q === "good"     ? "border-emerald-400 ring-1 ring-emerald-400/50 hover:ring-emerald-400"
                            : q === "rejected" ? "border-rose-400 ring-1 ring-rose-400/50 hover:ring-rose-400"
                            : "border-border/50 hover:ring-2 hover:ring-primary/40"
                            }`}
                          >
                            <img
                              src={src}
                              alt={`Portfolio ${i + 1}`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                              decoding="async"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <Eye className="w-4 h-4 text-white drop-shadow" />
                            </div>
                            {/* Photo number */}
                            <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[9px] font-bold px-1 rounded-full leading-none py-0.5">{i + 1}</div>
                            {/* Quality badge */}
                            {q === "good" && (
                              <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow">
                                <ThumbsUp className="w-2 h-2 text-white" />
                              </div>
                            )}
                            {q === "rejected" && (
                              <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center shadow">
                                <ThumbsDown className="w-2 h-2 text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Intro Video */}
                {crew?.introVideoUrl && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="h-px flex-1 bg-border" />
                      <Video className="w-3 h-3" /> Intro Video
                      <span className="h-px flex-1 bg-border" />
                    </h3>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setVideoModalOpen(true)}
                      onKeyDown={e => e.key === "Enter" && setVideoModalOpen(true)}
                      className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-2xl shadow-sm cursor-pointer hover:bg-gray-50 active:scale-[0.99] transition-all select-none"
                    >
                      {/* Thumbnail */}
                      <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-gray-900">
                        {videoThumbnail ? (
                          <img src={videoThumbnail} alt="Video thumbnail" className="w-full h-full object-cover" />
                        ) : (
                          <Video className="absolute inset-0 m-auto w-6 h-6 text-white/30" />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
                            <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">Intro Video</p>
                        {videoDuration && <p className="text-xs text-muted-foreground mt-0.5">{videoDuration}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">Tap to play</p>
                      </div>
                    </div>
                    {/* Video quality rating */}
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        disabled={videoQualitySaving}
                        onClick={() => handleSetVideoQuality("good")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          videoQuality === "good"
                            ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" /> Good
                      </button>
                      <button
                        type="button"
                        disabled={videoQualitySaving}
                        onClick={() => handleSetVideoQuality("can_be_improved")}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          videoQuality === "can_be_improved"
                            ? "bg-amber-50 border-amber-300 text-amber-700"
                            : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <ThumbsDown className="w-3.5 h-3.5" /> Can Be Improved
                      </button>
                    </div>
                  </div>
                )}

                {/* Full length photo thumbnail */}
                {crew.fullLengthPhotoUrl && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="h-px flex-1 bg-border" />
                      Full Length Photo
                      <span className="h-px flex-1 bg-border" />
                    </h3>
                    <button
                      onClick={() => setLightboxSrc(crew.fullLengthPhotoUrl)}
                      className="w-24 h-32 rounded-xl overflow-hidden border-2 border-border shadow-sm focus:outline-none group"
                    >
                      <img
                        src={crew.fullLengthPhotoUrl}
                        alt="Full length"
                        className="w-full h-full object-contain bg-muted/20 group-hover:scale-105 transition-transform duration-200"
                      />
                    </button>
                  </div>
                )}

                {/* Documents */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    <FileText className="w-3 h-3" /> Documents
                    <span className="h-px flex-1 bg-border" />
                  </h3>
                  <div className="space-y-2">
                    {/* All doc buttons in one row */}
                    <div className="flex flex-wrap gap-2">
                      {crew.aadhaarCardUrl && (
                        <button
                          type="button"
                          onClick={() => openDoc(crew.aadhaarCardUrl)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-primary" /> {crew.idType || "ID Document"}
                        </button>
                      )}
                      {crew.collegeIdUrl && (
                        <button
                          type="button"
                          onClick={() => openDoc(crew.collegeIdUrl)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-primary" /> College ID
                        </button>
                      )}
                      {crew.panCardUrl && (
                        <button
                          type="button"
                          onClick={() => openDoc(crew.panCardUrl)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-primary" /> PAN Card
                        </button>
                      )}
                    </div>
                    {!crew.aadhaarCardUrl && !crew.collegeIdUrl && !crew.panCardUrl && (
                      <p className="text-xs text-muted-foreground italic">No documents submitted</p>
                    )}
                  </div>
                </div>

                <div className="border-t border-border/50" />

                {/* Payment Details */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-border" />
                    <Wallet className="w-3 h-3" /> Payment Details
                    <span className="h-px flex-1 bg-border" />
                  </h3>
                  {crew.payHolderName || crew.payAccountNumber || crew.payUpiId ? (
                    <div className="rounded-xl border border-border/60 bg-muted/20 divide-y divide-border/40 text-sm">
                      {crew.payHolderName && (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><User className="w-3 h-3" /> Account Holder</span>
                          <span className="font-medium">{crew.payHolderName}</span>
                        </div>
                      )}
                      {crew.payBankName && (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 className="w-3 h-3" /> Bank</span>
                          <span className="font-medium">{crew.payBankName}{crew.payBranchName ? ` — ${crew.payBranchName}` : ""}</span>
                        </div>
                      )}
                      {crew.payIfscCode && (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Hash className="w-3 h-3" /> IFSC</span>
                          <span className="font-mono font-medium">{crew.payIfscCode}</span>
                        </div>
                      )}
                      {crew.payAccountNumber && (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CreditCard className="w-3 h-3" /> Account No.</span>
                          <span className="font-mono font-medium">{crew.payAccountNumber}</span>
                        </div>
                      )}
                      {crew.payUpiId && (
                        <div className="flex items-center justify-between px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="w-3 h-3" /> UPI ID</span>
                          <span className="font-medium text-xs">{crew.payUpiId}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Payment details not added</p>
                  )}
                </div>
              </div>

              {/* Action footer */}
              <div className="sticky bottom-0 bg-background border-t border-border/60 px-6 py-4 flex flex-wrap items-center gap-2">
                {crew.status !== "approved" && crew.status !== "active" && (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-9 text-sm"
                    onClick={handleApprove}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="w-4 h-4" />
                    {approveMutation.isPending ? "Approving…" : "Approve"}
                  </Button>
                )}
                {crew.phone && (
                  <a href={`https://wa.me/${formatWaPhone(crew.phone)}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="border-green-200 text-green-700 hover:bg-green-50 gap-1.5 h-9 text-sm">
                      <MessageCircle className="w-4 h-4" /> WhatsApp
                    </Button>
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Blacklist confirmation dialog */}
      <Dialog open={blacklistOpen} onOpenChange={setBlacklistOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-5 h-5 text-gray-600" /> Blacklist {crew?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will block the user from future access. Provide a reason for record-keeping.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <textarea
                className="w-full border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[90px]"
                placeholder="e.g. No-show at event, misconduct, duplicate account…"
                value={blacklistReason}
                onChange={e => setBlacklistReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBlacklistOpen(false)}>Cancel</Button>
            <Button
              className="bg-gray-900 hover:bg-black text-white"
              onClick={handleBlacklist}
              disabled={blacklistLoading}
            >
              {blacklistLoading ? "Blacklisting…" : "Confirm Blacklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with Reason Dialog */}
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!open) { setRejectOpen(false); setRejectReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="w-5 h-5 text-red-600" /> Reject {crew?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Optionally add a reason. After rejecting, you'll be asked whether to notify them via WhatsApp.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Rejection Reason <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                className="min-h-[90px]"
                placeholder="e.g. Blurry or missing photo, incomplete details, ineligible age…"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectOpen(false); setRejectReason(""); }}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDoReject}
              disabled={rejectLoading}
            >
              {rejectLoading ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WaNotifyDialog
        waUrl={pendingWa?.url ?? null}
        name={pendingWa?.name ?? ""}
        action={pendingWa?.action ?? "approve"}
        onSend={() => { window.open(pendingWa!.url, "_blank"); setPendingWa(null); }}
        onSkip={() => setPendingWa(null)}
      />

      {/* Single-image lightbox (docs, close-up, full-length) */}
      <Dialog open={!!lightboxSrc} onOpenChange={() => setLightboxSrc(null)}>
        <DialogContent className="max-w-3xl bg-black/90 border-none p-2">
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          {lightboxSrc && (
            <img src={lightboxSrc} alt="Preview" className="w-full max-h-[85vh] object-contain rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Portfolio swipe lightbox — full-screen, GPU-accelerated ───────────── */}
      {lbIdx !== null && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center select-none cursor-grab active:cursor-grabbing"
          style={{ transition: "opacity 0.18s ease", opacity: lbVisible ? 1 : 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) closeLb(); }}
          onTouchStart={handleLbTouchStart}
          onTouchMove={handleLbTouchMove}
          onTouchEnd={handleLbTouchEnd}
          onMouseDown={handleLbMouseDown}
          onMouseMove={handleLbMouseMove}
          onMouseUp={handleLbMouseUp}
          onMouseLeave={handleLbMouseUp}
        >
          {/* Backdrop — always shown for smooth fade-out; click to close */}
          <div className="absolute inset-0 bg-black/95" onClick={closeLb} />

          {/* All inner content guarded: only render when index is valid */}
          {lbIdx !== null && lbIdx < portfolioPhotos.length && portfolioPhotos.length > 0 && (<>

          {/* Preload adjacent images */}
          {lbIdx > 0 && <link rel="preload" as="image" href={portfolioPhotos[lbIdx - 1]} />}
          {lbIdx < portfolioPhotos.length - 1 && <link rel="preload" as="image" href={portfolioPhotos[lbIdx + 1]} />}

          {/* Counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/50 text-white text-sm font-semibold px-3 py-1 rounded-full tabular-nums pointer-events-none">
            {lbIdx + 1} / {portfolioPhotos.length}
          </div>

          {/* Action pill — top-left: Delete | Good | Rejected */}
          <div
            className="absolute top-4 left-4 z-20 flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-full p-1"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            {/* Delete */}
            <button
              type="button"
              onClick={() => setLbDeleteConfirm(c => !c)}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors touch-manipulation ${
                lbDeleteConfirm ? "bg-red-500 text-white" : "hover:bg-red-500/60 text-white/80 hover:text-white"
              }`}
              aria-label="Delete photo"
              title="Delete photo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-white/20 rounded" />

            {/* Good */}
            <button
              type="button"
              onClick={() => handleSetQuality("good")}
              disabled={lbQualitySaving !== null}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors touch-manipulation ${
                photoQuality[lbIdx] === "good"
                  ? "bg-emerald-500 text-white"
                  : "hover:bg-emerald-500/60 text-white/80 hover:text-white"
              }`}
              aria-label="Mark as good"
              title="Mark as good"
            >
              {lbQualitySaving === "good"
                ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <ThumbsUp className="w-3.5 h-3.5" />
              }
            </button>

            {/* Not usable */}
            <button
              type="button"
              onClick={() => handleSetQuality("rejected")}
              disabled={lbQualitySaving !== null}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors touch-manipulation ${
                photoQuality[lbIdx] === "rejected"
                  ? "bg-rose-500 text-white"
                  : "hover:bg-rose-500/60 text-white/80 hover:text-white"
              }`}
              aria-label="Mark as not usable"
              title="Mark as not usable"
            >
              {lbQualitySaving === "rejected"
                ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <ThumbsDown className="w-3.5 h-3.5" />
              }
            </button>
          </div>

          {/* Top-right controls: Download + Close */}
          <div
            className="absolute top-4 right-4 z-20 flex items-center gap-2"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => downloadPhoto(portfolioPhotos[lbIdx], lbIdx)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center transition-colors touch-manipulation"
              aria-label="Download photo"
            >
              <Download className="w-[18px] h-[18px] text-white" />
            </button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); closeLb(); }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Swipe wrapper — direct DOM, zero re-renders */}
          <div
            ref={swipeWrapperRef}
            className="relative z-10"
            style={{ transform: "translate3d(0,0,0)", willChange: "transform" }}
            onClick={e => e.stopPropagation()}
          >
            <img
              key={lbIdx}
              src={portfolioPhotos[lbIdx]}
              alt={`Portfolio ${lbIdx + 1}`}
              className="max-w-[92vw] max-h-[82vh] rounded-xl object-contain shadow-2xl"
              style={{
                transition: "transform 0.18s ease, opacity 0.18s ease",
                transform: lbVisible ? "scale(1)" : "scale(0.94)",
                opacity: lbVisible ? 1 : 0,
              }}
              draggable={false}
            />
            {/* Quality badge overlay on image */}
            {photoQuality[lbIdx] === "good" && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-emerald-500/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg pointer-events-none">
                <ThumbsUp className="w-2.5 h-2.5" /> Good
              </div>
            )}
            {photoQuality[lbIdx] === "rejected" && (
              <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-rose-500/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg pointer-events-none">
                <ThumbsDown className="w-2.5 h-2.5" /> Not Usable
              </div>
            )}
          </div>

          {/* Prev arrow */}
          {lbIdx > 0 && (
            <button
              ref={lbPrevBtnRef}
              type="button"
              onClick={e => { e.stopPropagation(); setLbDeleteConfirm(false); setLbIdx(i => Math.max(0, (i ?? 1) - 1)); }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors touch-manipulation"
              style={{ transition: "opacity 0.15s" }}
              aria-label="Previous"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Next arrow */}
          {lbIdx < portfolioPhotos.length - 1 && (
            <button
              ref={lbNextBtnRef}
              type="button"
              onClick={e => { e.stopPropagation(); setLbDeleteConfirm(false); setLbIdx(i => Math.min(portfolioPhotos.length - 1, (i ?? 0) + 1)); }}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors touch-manipulation"
              style={{ transition: "opacity 0.15s" }}
              aria-label="Next"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Dot indicators */}
          {portfolioPhotos.length > 1 && (
            <div
              className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-1.5"
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            >
              {portfolioPhotos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLbIdx(i)}
                  className="touch-manipulation"
                  aria-label={`Go to photo ${i + 1}`}
                >
                  <span className={`block rounded-full transition-all duration-200 ${
                    i === lbIdx ? "w-5 h-2 bg-white" : "w-2 h-2 bg-white/40 hover:bg-white/70"
                  }`} />
                </button>
              ))}
            </div>
          )}

          {/* Thumbnail strip */}
          {portfolioPhotos.length > 1 && !lbDeleteConfirm && (
            <div
              className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 max-w-[80vw] overflow-x-auto px-2 pb-1"
              style={{ scrollbarWidth: "none" }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
            >
              {portfolioPhotos.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLbIdx(i)}
                  className={`w-9 h-9 rounded-md overflow-hidden shrink-0 transition-all touch-manipulation ${
                    i === lbIdx ? "ring-2 ring-white scale-110 opacity-100" : "opacity-35 hover:opacity-60"
                  }`}
                  aria-label={`Photo ${i + 1}`}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}

          {/* Inline delete confirm bar */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-200 ${
              lbDeleteConfirm ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
            }`}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
          >
            <div className="bg-red-950/95 backdrop-blur border-t border-red-500/30 px-4 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-sm font-medium text-white">Delete this photo?</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setLbDeleteConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  disabled={lbDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLbDelete}
                  disabled={lbDeleting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 hover:bg-red-400 active:bg-red-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {lbDeleting ? (
                    <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Deleting…</>
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* End of valid-index guard */}
          </>)}
        </div>
      )}

      {/* ── Intro Video Modal — portalled to body so Radix Dialog can't intercept clicks ── */}
      {videoModalOpen && crew?.introVideoUrl && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85"
          onClick={() => setVideoModalOpen(false)}
        >
          {/* Top controls: Download + Close */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <a
              href={crew.introVideoUrl}
              download={`${crew.name?.replace(/\s+/g, "_") ?? "intro"}_video.mp4`}
              onClick={e => e.stopPropagation()}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center transition-colors"
              aria-label="Download video"
              title="Download video"
            >
              <Download className="w-5 h-5 text-white" />
            </a>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setVideoModalOpen(false); }}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center transition-colors"
              aria-label="Close video"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
          <div className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <video
              ref={adminVideoRef}
              src={crew.introVideoUrl}
              controls
              autoPlay
              playsInline
              className="w-full rounded-2xl bg-black"
              preload="auto"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
