import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdminApproveCrew } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Check, X, Ban, Phone, Mail, MapPin, User, Calendar, Ruler, 
  Languages, Star, Award, FileText, Image as ImageIcon, MessageCircle,
  AlertTriangle, CheckCircle, Clock, Shield, RotateCcw, Megaphone,
  Video, Play, Download, CreditCard, Hash, Landmark, Wallet
} from "lucide-react";
import { WaNotifyDialog } from "@/components/wa-notify-dialog";
import { format } from "date-fns";

function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  if (phone.startsWith("+91")) {
    return phone.slice(3);
  }
  return phone;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: any; label: string }> = {
  pending:      { bg: "bg-amber-50 border-amber-200",     text: "text-amber-800",   icon: Clock,        label: "Pending Review" },
  approved:     { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", icon: CheckCircle,  label: "Approved" },
  active:       { bg: "bg-blue-50 border-blue-200",       text: "text-blue-800",    icon: CheckCircle,  label: "Active" },
  rejected:     { bg: "bg-red-50 border-red-200",         text: "text-red-800",     icon: X,            label: "Rejected" },
  resubmitted:  { bg: "bg-orange-50 border-orange-200",   text: "text-orange-800",  icon: RotateCcw,    label: "Updated — Awaiting Review" },
  blacklisted:  { bg: "bg-gray-900 border-gray-700",      text: "text-white",       icon: Shield,       label: "Blacklisted" },
};

function PhotoCard({
  url, label, onClick, fallback,
}: { url?: string | null; label: string; onClick: (src: string) => void; fallback: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div
        className="rounded-2xl border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-muted-foreground"
        style={{ aspectRatio: "3/4" }}
      >
        <div className="text-center p-4">
          <User className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-xs">{broken ? "Image unavailable" : fallback}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="relative rounded-2xl overflow-hidden border-2 border-border shadow-md cursor-pointer group"
      style={{ aspectRatio: "3/4" }}
      onClick={() => onClick(url)}
    >
      <img
        src={url}
        alt={label}
        className="w-full h-full object-cover"
        onError={() => setBroken(true)}
      />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <ImageIcon className="w-8 h-8 text-white" />
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 p-3">
        <p className="text-white text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
      </div>
    </div>
  );
}

export default function CrewDetail() {
  const [, params] = useRoute("/admin/crew/:id");
  const crewId = params?.id;
  const [, setLocation] = useLocation();
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
  const [undoPendingFrom, setUndoPendingFrom] = useState<string | null>(null);
  const [setPendingLoading, setSetPendingLoading] = useState(false);
  const [pendingWa, setPendingWa] = useState<{ url: string; action: "approve" | "reject"; name: string } | null>(null);

  const { data: crew, isLoading, error } = useQuery({
    queryKey: [`/api/admin/crew/${crewId}`],
    queryFn: async () => {
      const res = await fetch(`/api/admin/crew/${crewId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: !!crewId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/admin/crew/${crewId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  };

  const handleApprove = () => {
    approveMutation.mutate({ id: Number(crewId) }, {
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
    setRejectLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}/reject`, {
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

  const handleSetPending = async () => {
    setSetPendingLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${crewId}/set-pending`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      toast({ title: `↩ ${crew.name} moved back to Pending` });
      invalidate();
      setUndoPendingFrom(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally {
      setSetPendingLoading(false);
    }
  };

  const handleBlacklist = async () => {
    setBlacklistLoading(true);
    try {
      const res = await fetch(`/api/admin/crew/${crewId}/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: blacklistReason }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `⛔ ${crew.name} blacklisted` });
      invalidate();
      setBlacklistOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Failed to blacklist" });
    } finally {
      setBlacklistLoading(false);
    }
  };

  const formatWaPhone = (phone: string) => {
    // Remove everything except digits
    const digits = phone.replace(/\D/g, "");
    // If already has country code (12 digits starting with 91), use as-is
    if (digits.length === 12 && digits.startsWith("91")) return digits;
    // Otherwise prepend India country code
    return "91" + digits;
  };

  const waLink = (phone: string) => {
    return `https://wa.me/${formatWaPhone(phone)}`;
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

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Loading profile…
      </div>
    );
  }

  if (error || !crew) {
    return (
      <div className="p-12 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="font-semibold">Profile not found</p>
        <Link href="/admin/crew"><Button variant="outline" className="mt-4"><ArrowLeft className="w-4 h-4 mr-2" /> Back to list</Button></Link>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[crew.status] ?? STATUS_STYLES.pending;
  const StatusIcon = statusStyle.icon;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Link href="/admin/crew">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Crew
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{crew.name}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Registered {format(new Date(crew.createdAt), "dd MMMM yyyy")}</p>
        </div>
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
          <StatusIcon className="w-4 h-4" />
          {statusStyle.label}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3 p-4 bg-card rounded-xl border border-border/60 shadow-sm">
        {/* Approve — filled when approved/active, ghost when not */}
        {(crew.status === "approved" || crew.status === "active") ? (
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            onClick={() => setUndoPendingFrom(crew.status)}
            disabled={setPendingLoading}
          >
            <Check className="w-4 h-4" /> Approved
          </Button>
        ) : (
          <Button
            variant="outline"
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-2"
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            <Check className="w-4 h-4" /> Approve
          </Button>
        )}
        {/* Reject — filled when rejected/resubmitted, ghost when not */}
        {crew.status === "rejected" || crew.status === "resubmitted" ? (
          <Button
            className={`gap-2 text-white ${crew.status === "resubmitted" ? "bg-orange-500 hover:bg-orange-600" : "bg-red-600 hover:bg-red-700"}`}
            onClick={() => setUndoPendingFrom(crew.status)}
            disabled={setPendingLoading}
          >
            <X className="w-4 h-4" /> {crew.status === "resubmitted" ? "Resubmitted" : "Rejected"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50 gap-2"
            onClick={() => { setRejectOpen(true); setRejectReason(""); }}
            disabled={rejectLoading}
          >
            <X className="w-4 h-4" /> Reject
          </Button>
        )}
        {/* Blacklist — filled when blacklisted, ghost when not */}
        {crew.status === "blacklisted" ? (
          <Button
            className="bg-gray-800 hover:bg-gray-900 text-white gap-2"
            onClick={() => setUndoPendingFrom("blacklisted")}
            disabled={setPendingLoading}
          >
            <Ban className="w-4 h-4" /> Blacklisted
          </Button>
        ) : (
          <Button
            variant="outline"
            className="border-gray-300 text-gray-700 hover:bg-gray-100 gap-2"
            onClick={() => { setBlacklistOpen(true); setBlacklistReason(""); }}
          >
            <Ban className="w-4 h-4" /> Blacklist
          </Button>
        )}
        <div className="flex-1" />
        {crew.phone && (
          <>
            <a href={buildWaApproveUrl(crew.phone, crew.name)} target="_blank" rel="noreferrer">
              <Button variant="outline" className="border-green-200 text-green-700 hover:bg-green-50 gap-2">
                <MessageCircle className="w-4 h-4" /> WhatsApp Approve Msg
              </Button>
            </a>
          </>
        )}
      </div>

      {/* Blacklist reason banner */}
      {crew.status === "blacklisted" && crew.blacklistReason && (
        <div className="flex gap-3 p-4 bg-gray-900 text-white rounded-xl border border-gray-700">
          <Shield className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Blacklist Reason</p>
            <p className="text-gray-300 text-sm mt-0.5">{crew.blacklistReason}</p>
          </div>
        </div>
      )}

      {/* Rejection reason banner */}
      {(crew.status === "rejected" || crew.status === "resubmitted") && crew.rejectionReason && (
        <div className={`flex gap-3 p-4 rounded-xl border ${crew.status === "resubmitted" ? "bg-orange-50 border-orange-200" : "bg-red-50 border-red-200"}`}>
          <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${crew.status === "resubmitted" ? "text-orange-500" : "text-red-500"}`} />
          <div>
            <p className={`font-semibold text-sm ${crew.status === "resubmitted" ? "text-orange-800" : "text-red-800"}`}>
              {crew.status === "resubmitted" ? "Previous Rejection Reason (profile updated)" : "Rejection Reason"}
            </p>
            <p className={`text-sm mt-0.5 ${crew.status === "resubmitted" ? "text-orange-700" : "text-red-700"}`}>{crew.rejectionReason}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Selfie */}
        <div className="lg:col-span-1 space-y-4">
          <PhotoCard
            url={crew.closeUpPhotoUrl}
            label="Live Selfie"
            onClick={setLightboxSrc}
            fallback="No selfie uploaded"
          />

          {/* Full length photo */}
          {crew.fullLengthPhotoUrl && (
            <PhotoCard
              url={crew.fullLengthPhotoUrl}
              label="Full Length Photo"
              onClick={setLightboxSrc}
              fallback="No full length photo"
            />
          )}
        </div>

        {/* Right: Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Info */}
          <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
            <h2 className="text-base font-bold mb-4 pb-2 border-b border-border/50">Personal Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={User} label="Full Name" value={crew.name} />
              <InfoRow icon={Mail} label="Email" value={crew.email} />
              <InfoRow icon={Phone} label="Phone" value={formatPhoneDisplay(crew.phone)} />
              <InfoRow icon={MapPin} label="City" value={crew.city} />
              <InfoRow icon={Calendar} label="Age" value={crew.age ? `${crew.age} years` : null} />
              <InfoRow icon={User} label="Gender" value={crew.gender} />
              <InfoRow icon={Ruler} label="Height" value={crew.height} />
              <InfoRow icon={Languages} label="Languages" value={crew.languages} />
              {/* How did you hear about us — no uppercase override */}
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Megaphone className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium tracking-wide">How did you hear about us?</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{(crew as any).source || "Not provided"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Professional Info */}
          <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
            <h2 className="text-base font-bold mb-4 pb-2 border-b border-border/50">Professional Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow icon={Star} label="Role / Category" value={crew.category} />
              <InfoRow icon={Award} label="Experience Level" value={crew.experienceLevel} />
              <InfoRow icon={CheckCircle} label="Completed Shifts" value={crew.completedShifts != null ? String(crew.completedShifts) : null} />
              <InfoRow icon={Star} label="Total Earnings" value={crew.totalEarnings != null ? `₹${parseFloat(crew.totalEarnings).toFixed(2)}` : null} />
              {crew.instagramUrl && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Star className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Instagram</p>
                    <a href={crew.instagramUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline mt-0.5 block">
                      {crew.instagramUrl}
                    </a>
                  </div>
                </div>
              )}
            </div>
            {/* Skills */}
            {crew.skills && crew.skills.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray(crew.skills) ? crew.skills : [crew.skills]).map((s: string, i: number) => (
                    <span key={i} className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {/* Experience bio */}
            {crew.experience && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Experience / Bio</p>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{crew.experience}</p>
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
            <h2 className="text-base font-bold mb-4 pb-2 border-b border-border/50">Documents</h2>
            <div className="flex flex-wrap gap-3">
              {crew.aadhaarCardUrl && (
                <a
                  href={crew.aadhaarCardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-sm font-medium transition-colors"
                >
                  <FileText className="w-4 h-4 text-primary" /> View {crew.idType || "ID Document"}
                </a>
              )}
              {crew.collegeIdUrl && (
                <a
                  href={crew.collegeIdUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-sm font-medium transition-colors"
                >
                  <FileText className="w-4 h-4 text-primary" /> View College ID
                </a>
              )}
              {crew.panCardUrl && (
                <a
                  href={crew.panCardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-sm font-medium transition-colors"
                >
                  <FileText className="w-4 h-4 text-primary" /> View PAN Card
                </a>
              )}
              {!crew.aadhaarCardUrl && !crew.collegeIdUrl && !crew.panCardUrl && (
                <p className="text-sm text-muted-foreground">No documents uploaded</p>
              )}
            </div>
            {/* PAN Number */}
            {crew.panNumber && (
              <div className="mt-4 pt-4 border-t border-border/50 flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Hash className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">PAN Number</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5 font-mono tracking-widest">{crew.panNumber}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Payment Details ─────────────────────────────────────────────────────── */}
      {(crew.payHolderName || crew.payAccountNumber || crew.payUpiId) && (
        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
          <h2 className="text-base font-bold mb-4 pb-2 border-b border-border/50">Payment Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {crew.payHolderName && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Account Holder</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{crew.payHolderName}</p>
                </div>
              </div>
            )}
            {crew.payBankName && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Landmark className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Bank</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{crew.payBankName}</p>
                </div>
              </div>
            )}
            {crew.payBranchName && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Branch</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{crew.payBranchName}</p>
                </div>
              </div>
            )}
            {crew.payAccountNumber && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <CreditCard className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Account Number</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5 font-mono tracking-wider">{crew.payAccountNumber}</p>
                </div>
              </div>
            )}
            {crew.payIfscCode && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Hash className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">IFSC Code</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5 font-mono tracking-widest">{crew.payIfscCode}</p>
                </div>
              </div>
            )}
            {crew.payUpiId && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Wallet className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">UPI ID</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{crew.payUpiId}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Intro Video ──────────────────────────────────────────────────────────── */}
      {crew.introVideoUrl && (
        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-border/50">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" /> Intro Video
            </h2>
            <a
              href={crew.introVideoUrl}
              download={`${crew.name?.replace(/\s+/g, "_") ?? "intro"}_video.mp4`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </div>
          <video
            src={crew.introVideoUrl}
            controls
            playsInline
            className="w-full max-w-lg rounded-xl bg-black"
            preload="metadata"
          />
        </div>
      )}

      {/* ── Portfolio Photos ─────────────────────────────────────────────────────── */}
      {crew.portfolioPhotos && Array.isArray(crew.portfolioPhotos) && crew.portfolioPhotos.length > 0 && (
        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm">
          <h2 className="text-base font-bold mb-4 pb-2 border-b border-border/50">
            Portfolio Photos <span className="text-muted-foreground font-normal text-sm ml-1">({crew.portfolioPhotos.length})</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {crew.portfolioPhotos.map((url: string, idx: number) => (
              <div
                key={idx}
                className="relative aspect-square rounded-xl overflow-hidden border border-border cursor-pointer group shadow-sm"
                onClick={() => setLightboxSrc(url)}
              >
                <img
                  src={url}
                  alt={`Portfolio ${idx + 1}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-[10px] rounded px-1.5 py-0.5 font-medium">
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reject with Reason Dialog */}
      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!open) { setRejectOpen(false); setRejectReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="w-5 h-5 text-red-600" /> Reject {crew.name}
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

      {/* Blacklist Dialog */}
      <Dialog open={blacklistOpen} onOpenChange={setBlacklistOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="w-5 h-5 text-gray-600" /> Blacklist {crew.name}
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
            <Button className="bg-gray-900 hover:bg-black text-white" onClick={handleBlacklist} disabled={blacklistLoading}>
              {blacklistLoading ? "Blacklisting…" : "Confirm Blacklist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Pending Confirmation Dialog (shared for all toggle-backs) */}
      <Dialog open={!!undoPendingFrom} onOpenChange={() => setUndoPendingFrom(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <RotateCcw className="w-5 h-5" /> Move back to Pending?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              {undoPendingFrom === "blacklisted"
                ? <>Remove the blacklist from <span className="font-semibold text-foreground">{crew.name}</span> and move them back to <span className="font-semibold">Pending</span>?</>
                : undoPendingFrom === "rejected"
                ? <>Reverse the rejection for <span className="font-semibold text-foreground">{crew.name}</span> and move them back to <span className="font-semibold">Pending</span>?</>
                : undoPendingFrom === "resubmitted"
                ? <>Move the updated profile of <span className="font-semibold text-foreground">{crew.name}</span> back to <span className="font-semibold">Pending</span>? The previous rejection reason will be cleared.</>
                : <>Move <span className="font-semibold text-foreground">{crew.name}</span> back to <span className="font-semibold">Pending</span>? They will lose approved access until re-approved.</>}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUndoPendingFrom(null)}>Cancel</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={handleSetPending}
              disabled={setPendingLoading}
            >
              {setPendingLoading ? "Updating…" : "Yes, Move to Pending"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Lightbox */}
      <Dialog open={!!lightboxSrc} onOpenChange={() => setLightboxSrc(null)}>
        <DialogContent className="max-w-3xl bg-black/90 border-none p-2">
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          {lightboxSrc && (
            <img src={lightboxSrc} alt="Preview" className="w-full max-h-[85vh] object-contain rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
