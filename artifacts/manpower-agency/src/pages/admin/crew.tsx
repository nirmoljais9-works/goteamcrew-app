import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { useAdminGetAllCrew, useAdminApproveCrew } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Search, Download, Check, X, Ban, ChevronUp, ChevronDown, ChevronsUpDown, Trash2, RotateCcw, MoreVertical, AlertTriangle, MapPin, CalendarDays, Briefcase, Users, Gift, ExternalLink } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { CrewProfileModal } from "./crew-profile-modal";
import { WaNotifyDialog } from "@/components/wa-notify-dialog";

function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  if (phone.startsWith("+91")) {
    return phone.slice(3);
  }
  return phone;
}

type SortKey = "name" | "city" | "category" | "experienceLevel" | "status" | "createdAt";
type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<string, string> = {
  pending:      "bg-amber-100 text-amber-800 border-amber-200",
  approved:     "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected:     "bg-red-100 text-red-700 border-red-200",
  resubmitted:  "bg-orange-100 text-orange-800 border-orange-200",
  blacklisted:  "bg-gray-900 text-white border-gray-700",
  active:       "bg-blue-100 text-blue-800 border-blue-200",
  removed:      "bg-rose-100 text-rose-800 border-rose-200",
};

const STATUS_LABELS: Record<string, string> = {
  resubmitted: "Updated",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground border-border"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function CrewAvatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const [broken, setBroken] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase();

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        className="w-10 h-10 rounded-full object-cover border border-gray-200 ring-2 ring-white shadow-sm shrink-0"
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 ring-2 ring-white shadow-sm flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-primary">{initial}</span>
    </div>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
}

export default function AdminCrew() {
  const { data: crewMembers, isLoading } = useAdminGetAllCrew();
  const approveMutation = useAdminApproveCrew();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [profileModalId, setProfileModalId] = useState<number | null>(null);

  const [blacklistTarget, setBlacklistTarget] = useState<{ id: number; name: string } | null>(null);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [blacklistLoading, setBlacklistLoading] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<{ id: number; name: string; phone: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [pendingWa, setPendingWa] = useState<{ url: string; action: "approve" | "reject"; name: string } | null>(null);

  const [removeTarget, setRemoveTarget] = useState<{ id: number; name: string } | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [pendingPaymentTarget, setPendingPaymentTarget] = useState<{ id: number; name: string } | null>(null);


  const [undoConfirmTarget, setUndoConfirmTarget] = useState<{ id: number; name: string; fromStatus: string } | null>(null);
  const [setPendingLoading, setSetPendingLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Referral context drawer
  const [referralDrawerCrew, setReferralDrawerCrew] = useState<(typeof crewMembers extends (infer T)[] | undefined ? T : never) | null>(null);
  const [referralCtx, setReferralCtx] = useState<any>(null);
  const [referralCtxLoading, setReferralCtxLoading] = useState(false);

  useEffect(() => {
    if (!referralDrawerCrew) { setReferralCtx(null); return; }
    setReferralCtxLoading(true);
    const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    fetch(`${BASE_URL}/api/admin/referral-context?crewId=${referralDrawerCrew.id}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(setReferralCtx)
      .catch(() => setReferralCtx(null))
      .finally(() => setReferralCtxLoading(false));
  }, [referralDrawerCrew?.id]);

  const uniqueCities = useMemo(() => {
    if (!crewMembers) return [];
    return Array.from(new Set(crewMembers.map(c => c.city).filter(Boolean) as string[])).sort();
  }, [crewMembers]);

  const filtered = useMemo(() => {
    let list = crewMembers ?? [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || c.phone.includes(s));
    }
    if (statusFilter !== "all") list = list.filter(c => c.status === statusFilter);
    if (categoryFilter !== "all") list = list.filter(c => c.category === categoryFilter);
    if (cityFilter !== "all") list = list.filter(c => c.city === cityFilter);
    return [...list].sort((a, b) => {
      const va = String((a as any)[sortKey] ?? "");
      const vb = String((b as any)[sortKey] ?? "");
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [crewMembers, search, statusFilter, categoryFilter, cityFilter, sortKey, sortDir]);

  const counts = useMemo(() => {
    const all = crewMembers ?? [];
    return {
      all: all.length,
      pending: all.filter(c => c.status === "pending").length,
      approved: all.filter(c => c.status === "approved" || c.status === "active").length,
      rejected: all.filter(c => c.status === "rejected").length,
      resubmitted: all.filter(c => c.status === "resubmitted").length,
      blacklisted: all.filter(c => c.status === "blacklisted").length,
      removed: all.filter(c => c.status === "removed").length,
    };
  }, [crewMembers]);

  const handleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(col); setSortDir("asc"); }
  };

  const formatWaPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) return digits;
    return "91" + digits;
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

  const handleApprove = (crewId: number, name: string, phone: string) => {
    approveMutation.mutate({ id: crewId }, {
      onSuccess: () => {
        toast({ title: `✓ ${name} approved` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
        setPendingWa({ url: buildWaApproveUrl(phone, name), action: "approve", name });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Failed to approve" });
      },
    });
  };

  const handleDoReject = async () => {
    if (!rejectTarget) return;
    setRejectLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${rejectTarget.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      toast({ title: `${rejectTarget.name} rejected` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      const waUrl = buildWaRejectUrl(rejectTarget.phone, rejectTarget.name, rejectReason.trim(), data.editLink);
      const { name } = rejectTarget;
      setRejectTarget(null);
      setRejectReason("");
      setPendingWa({ url: waUrl, action: "reject", name });
    } catch {
      toast({ variant: "destructive", title: "Failed to reject" });
    } finally {
      setRejectLoading(false);
    }
  };

  const handleSetPending = async () => {
    if (!undoConfirmTarget) return;
    setSetPendingLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${undoConfirmTarget.id}/set-pending`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      toast({ title: `↩ ${undoConfirmTarget.name} moved back to Pending` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setUndoConfirmTarget(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally {
      setSetPendingLoading(false);
    }
  };

  const handleBlacklist = async () => {
    if (!blacklistTarget) return;
    setBlacklistLoading(true);
    try {
      const res = await fetch(`/api/admin/crew/${blacklistTarget.id}/blacklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: blacklistReason }),
      });
      if (!res.ok) throw new Error();
      toast({ title: `⛔ ${blacklistTarget.name} blacklisted` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setBlacklistTarget(null);
      setBlacklistReason("");
    } catch {
      toast({ variant: "destructive", title: "Failed to blacklist" });
    } finally {
      setBlacklistLoading(false);
    }
  };

  const handleRemove = async (force = false) => {
    const target = force ? pendingPaymentTarget : removeTarget;
    if (!target) return;
    setRemoveLoading(true);
    try {
      const res = await fetch(`/api/admin/crew/${target.id}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "PENDING_PAYMENTS") {
          setRemoveTarget(null);
          setPendingPaymentTarget(target);
          return;
        }
        throw new Error();
      }
      toast({ title: `${target.name} has been removed` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setRemoveTarget(null);
      setPendingPaymentTarget(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to remove crew member" });
    } finally {
      setRemoveLoading(false);
    }
  };


  const handleDeleteCrew = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${BASE_URL}/api/admin/crew/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: data.error === "Incorrect password" ? "Incorrect password" : "Failed to delete crew member" });
        return;
      }
      toast({ title: `${deleteTarget.name} has been permanently deleted` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crew"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDeleteTarget(null);
      setDeletePassword("");
    } catch {
      toast({ variant: "destructive", title: "Failed to delete crew member" });
    } finally {
      setDeleteLoading(false);
    }
  };

  const Th = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      <div className="flex items-center gap-1.5">
        {label}
        <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </div>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Crew Management</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Review registrations, approve and manage talent pool</p>
        </div>
        <Button
          variant="outline"
          className="h-9 text-sm"
          onClick={() => window.open("/api/admin/crew/export", "_blank")}
        >
          <Download className="w-4 h-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "resubmitted", "approved", "rejected", "blacklisted", "removed"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            }`}
          >
            {s === "resubmitted" ? "Updated" : s.charAt(0).toUpperCase() + s.slice(1)}
            <span className={`ml-1.5 text-xs ${statusFilter === s ? "opacity-80" : "opacity-60"}`}>
              ({counts[s as keyof typeof counts] ?? 0})
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone…"
            className="pl-9 h-9 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-full sm:w-44 text-sm">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="Promoter">Promoter</SelectItem>
            <SelectItem value="Hostess">Hostess</SelectItem>
            <SelectItem value="Model">Model</SelectItem>
            <SelectItem value="Anchor">Anchor</SelectItem>
            <SelectItem value="Event Crew">Event Crew</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cityFilter} onValueChange={setCityFilter}>
          <SelectTrigger className="h-9 w-full sm:w-44 text-sm">
            <SelectValue placeholder="All Cities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cities</SelectItem>
            {uniqueCities.map(city => (
              <SelectItem key={city} value={city}>{city}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">Loading crew data…</div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border/60">
                <tr>
                  <Th col="name" label="Name" />
                  <Th col="city" label="City" />
                  <Th col="category" label="Role" />
                  <Th col="status" label="Status" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Referred By</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map(crew => (
                  <tr
                    key={crew.id}
                    className={`hover:bg-muted/30 transition-colors ${crew.status === "pending" ? "bg-amber-50/40" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <CrewAvatar name={crew.name} photoUrl={(crew as any).closeUpPhotoUrl} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              className="font-semibold text-foreground hover:text-primary hover:underline text-left transition-colors leading-tight"
                              onClick={() => setProfileModalId(crew.id)}
                            >
                              {crew.name}
                            </button>
                            <button
                              onClick={() => setProfileModalId(crew.id)}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-normal transition-opacity hover:opacity-75 shrink-0"
                              style={{ background: "#F5F3FF", color: "#7C3AED", border: "1px solid #E9D5FF" }}
                            >
                              View Profile
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{crew.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{crew.city || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
                        {crew.category || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={crew.status} /></td>
                    <td className="px-4 py-3 text-xs">
                      {(crew as any).referredByName ? (
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => setReferralDrawerCrew(crew as any)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap cursor-pointer transition-opacity hover:opacity-70 underline-offset-2 hover:underline"
                            style={{ background: "#F0FDF4", color: "#166534", border: "1px solid #BBF7D0" }}
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                            {(crew as any).referredByName}
                          </button>
                          {(crew as any).referredEventName && (
                            <span className="text-[10px] text-muted-foreground/70 truncate max-w-[130px]" title={(crew as any).referredEventName}>
                              for: {(crew as any).referredEventName}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {/* 3-dot actions menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreVertical className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg border border-border/60 bg-white p-1">
                            {crew.status === "removed" ? (
                              <DropdownMenuItem
                                className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                                onClick={() => setUndoConfirmTarget({ id: crew.id, name: crew.name, fromStatus: "removed" })}
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Undo Remove
                              </DropdownMenuItem>
                            ) : (
                              <>
                                {/* Approve */}
                                {(crew.status === "approved" || crew.status === "active") ? (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-emerald-700 bg-emerald-50 hover:bg-emerald-100 focus:bg-emerald-100 font-medium"
                                    onClick={() => setUndoConfirmTarget({ id: crew.id, name: crew.name, fromStatus: crew.status })}
                                  >
                                    <Check className="w-3.5 h-3.5" /> Approved ✓
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-emerald-700 hover:bg-emerald-50 focus:bg-emerald-50"
                                    onClick={() => handleApprove(crew.id, crew.name, crew.phone)}
                                  >
                                    <Check className="w-3.5 h-3.5" /> Approve
                                  </DropdownMenuItem>
                                )}
                                {/* Reject */}
                                {crew.status === "rejected" || crew.status === "resubmitted" ? (
                                  <DropdownMenuItem
                                    className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer font-medium ${crew.status === "resubmitted" ? "text-orange-700 bg-orange-50 hover:bg-orange-100 focus:bg-orange-100" : "text-red-700 bg-red-50 hover:bg-red-100 focus:bg-red-100"}`}
                                    onClick={() => setUndoConfirmTarget({ id: crew.id, name: crew.name, fromStatus: crew.status })}
                                  >
                                    <X className="w-3.5 h-3.5" /> {crew.status === "resubmitted" ? "Resubmitted" : "Rejected"} ✓
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-red-600 hover:bg-red-50 focus:bg-red-50"
                                    onClick={() => { setRejectTarget({ id: crew.id, name: crew.name, phone: crew.phone }); setRejectReason(""); }}
                                  >
                                    <X className="w-3.5 h-3.5" /> Reject
                                  </DropdownMenuItem>
                                )}
                                {/* Blacklist */}
                                {crew.status === "blacklisted" ? (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-gray-800 bg-gray-100 hover:bg-gray-200 focus:bg-gray-200 font-medium"
                                    onClick={() => setUndoConfirmTarget({ id: crew.id, name: crew.name, fromStatus: "blacklisted" })}
                                  >
                                    <Ban className="w-3.5 h-3.5" /> Blacklisted ✓
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-gray-600 hover:bg-gray-100 focus:bg-gray-100"
                                    onClick={() => { setBlacklistTarget({ id: crew.id, name: crew.name }); setBlacklistReason(""); }}
                                  >
                                    <Ban className="w-3.5 h-3.5" /> Blacklist
                                  </DropdownMenuItem>
                                )}
                                {/* Divider + Remove */}
                                <div className="my-1 border-t border-border/50" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
                                  onClick={() => setRemoveTarget({ id: crew.id, name: crew.name })}
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Remove
                                </DropdownMenuItem>
                                {/* Delete Crew — permanent */}
                                <div className="my-1 border-t border-border/50" />
                                <DropdownMenuItem
                                  className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 cursor-pointer text-red-700 hover:bg-red-50 focus:bg-red-50 font-semibold"
                                  onClick={() => { setDeleteTarget({ id: crew.id, name: crew.name }); setDeletePassword(""); }}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" /> Delete Crew
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                      <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No crew members found</p>
                      <p className="text-xs mt-1">Try adjusting filters or search</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-border/40 bg-muted/20 text-xs text-muted-foreground">
            Showing {filtered.length} of {crewMembers?.length ?? 0} members
          </div>
        </div>
      )}

      {/* Crew Profile Modal */}
      <CrewProfileModal
        crewId={profileModalId}
        onClose={() => setProfileModalId(null)}
      />

      {/* Move to Pending Confirmation Dialog (shared for all toggle-backs) */}
      <Dialog open={!!undoConfirmTarget} onOpenChange={() => setUndoConfirmTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <RotateCcw className="w-5 h-5" /> Move back to Pending?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <p className="text-sm text-muted-foreground">
              {undoConfirmTarget?.fromStatus === "blacklisted"
                ? <>Remove the blacklist from <span className="font-semibold text-foreground">{undoConfirmTarget.name}</span> and move them back to <span className="font-semibold">Pending</span>?</>
                : undoConfirmTarget?.fromStatus === "rejected"
                ? <>Reverse the rejection for <span className="font-semibold text-foreground">{undoConfirmTarget?.name}</span> and move them back to <span className="font-semibold">Pending</span>?</>
                : undoConfirmTarget?.fromStatus === "resubmitted"
                ? <>Move the updated profile of <span className="font-semibold text-foreground">{undoConfirmTarget?.name}</span> back to <span className="font-semibold">Pending</span>?</>
                : undoConfirmTarget?.fromStatus === "removed"
                ? <>Restore <span className="font-semibold text-foreground">{undoConfirmTarget?.name}</span>'s account and move them back to <span className="font-semibold">Pending</span> for review?</>
                : <>Move <span className="font-semibold text-foreground">{undoConfirmTarget?.name}</span> back to <span className="font-semibold">Pending</span>? They will lose approved access until re-approved.</>}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUndoConfirmTarget(null)}>Cancel</Button>
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

      {/* Remove Confirmation Dialog */}
      <Dialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <Trash2 className="w-5 h-5" /> Remove {removeTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to remove this crew member? They will no longer be able to log in. All historical data (events, payments, attendance) will be kept and this action can be reversed.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => handleRemove(false)}
              disabled={removeLoading}
            >
              {removeLoading ? "Removing…" : "Confirm Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Payments Warning Dialog */}
      <Dialog open={!!pendingPaymentTarget} onOpenChange={() => setPendingPaymentTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              ⚠️ Pending Payments
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              <strong>{pendingPaymentTarget?.name}</strong> has pending payments. It's recommended to clear all payments before removing. Do you want to proceed anyway?
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingPaymentTarget(null)}>Cancel</Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={() => handleRemove(true)}
              disabled={removeLoading}
            >
              {removeLoading ? "Removing…" : "Remove Anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Reject with Reason Modal */}
      <Dialog open={!!rejectTarget} onOpenChange={() => { setRejectTarget(null); setRejectReason(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <X className="w-5 h-5 text-red-600" /> Reject {rejectTarget?.name}
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
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
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

      {/* ── Referral Context Drawer ─────────────────────────────────────────── */}
      <Sheet open={!!referralDrawerCrew} onOpenChange={open => { if (!open) setReferralDrawerCrew(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col gap-0">
          <SheetHeader className="px-5 py-3.5 border-b shrink-0">
            <SheetTitle className="text-base font-semibold">Referral Context</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {referralCtxLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
            ) : !referralCtx ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No referral data found.</div>
            ) : (
              <div className="divide-y divide-border/50">

                {/* A — Referrer Info */}
                {referralCtx.referrer && (
                  <div className="px-5 py-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Referred by</p>
                    <div className="flex items-center gap-3">
                      <CrewAvatar name={referralCtx.referrer.name} photoUrl={referralCtx.referrer.closeUpPhotoUrl} />
                      <div className="min-w-0">
                        <button
                          onClick={() => { setReferralDrawerCrew(null); setProfileModalId(referralCtx.referrer.id); }}
                          className="font-semibold text-sm text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors cursor-pointer text-left"
                        >
                          {referralCtx.referrer.name}
                        </button>
                        {referralCtx.referrer.category && (
                          <p className="text-xs text-muted-foreground">{referralCtx.referrer.category}</p>
                        )}
                        {referralCtx.referrer.stats?.total > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Users className="w-3 h-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">{referralCtx.referrer.stats.total} referral{referralCtx.referrer.stats.total !== 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {referralCtx.referral.rewardAmount && (
                      <div className="flex items-center gap-1.5">
                        <Gift className="w-3.5 h-3.5 text-green-600" />
                        <span className="text-xs text-green-700 font-medium">₹{parseFloat(referralCtx.referral.rewardAmount).toLocaleString("en-IN")} reward on selection</span>
                      </div>
                    )}
                  </div>
                )}

                {/* B — Event Details */}
                <div className="px-5 py-4 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Event</p>
                  <p className="font-semibold text-sm text-foreground leading-snug">{referralCtx.event.title}</p>
                  <div className="space-y-1.5">
                    {referralCtx.event.role && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Briefcase className="w-3.5 h-3.5 shrink-0" />
                        <span>Role: <span className="font-medium text-foreground">{referralCtx.event.role}</span></span>
                      </div>
                    )}
                    {(referralCtx.event.city || referralCtx.event.location) && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span>{[referralCtx.event.location, referralCtx.event.city].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {referralCtx.event.startDate && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {format(new Date(referralCtx.event.startDate), "d MMM yyyy")}
                          {referralCtx.event.endDate && referralCtx.event.endDate !== referralCtx.event.startDate
                            ? ` – ${format(new Date(referralCtx.event.endDate), "d MMM yyyy")}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">
                    Referred {format(new Date(referralCtx.referral.createdAt), "d MMM yyyy 'at' h:mm a")}
                  </p>
                </div>

                {/* C — Candidate Snapshot */}
                {referralDrawerCrew && (
                  <div className="px-5 py-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Candidate</p>
                    <div className="flex items-center gap-3">
                      <CrewAvatar name={referralDrawerCrew.name} photoUrl={(referralDrawerCrew as any).closeUpPhotoUrl} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm text-foreground">{referralDrawerCrew.name}</p>
                          <StatusBadge status={referralDrawerCrew.status} />
                        </div>
                        {referralDrawerCrew.category && (
                          <p className="text-xs text-muted-foreground">{referralDrawerCrew.category}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 mt-0.5">
                          {referralDrawerCrew.city && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{referralDrawerCrew.city}
                            </span>
                          )}
                          {(referralDrawerCrew as any).experienceLevel && (
                            <span className="text-xs text-muted-foreground">{(referralDrawerCrew as any).experienceLevel}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => { setReferralDrawerCrew(null); setProfileModalId(referralDrawerCrew.id); }}
                    >
                      View full profile →
                    </button>
                  </div>
                )}

              </div>
            )}
          </div>

          {/* Quick Actions — only for pending/resubmitted candidates */}
          {referralDrawerCrew && (referralDrawerCrew.status === "pending" || referralDrawerCrew.status === "resubmitted") && (
            <div className="border-t px-5 py-4 shrink-0 flex gap-3 bg-background">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                onClick={() => {
                  handleApprove(referralDrawerCrew.id, referralDrawerCrew.name, referralDrawerCrew.phone);
                  setReferralDrawerCrew(null);
                }}
              >
                <Check className="w-4 h-4" /> Approve
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 gap-1.5"
                onClick={() => {
                  setRejectTarget({ id: referralDrawerCrew.id, name: referralDrawerCrew.name, phone: referralDrawerCrew.phone });
                  setReferralDrawerCrew(null);
                }}
              >
                <X className="w-4 h-4" /> Reject
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Crew Modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeletePassword(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" /> Permanently Delete Crew
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 space-y-1">
              <p className="text-sm font-semibold text-red-800">⚠️ This action is permanent and cannot be undone.</p>
              <p className="text-sm text-red-700">
                Deleting <span className="font-semibold">{deleteTarget?.name}</span> will permanently remove their account, profile, and all associated data from the system.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Enter your admin password to confirm</label>
              <form autoComplete="off">
                <Input
                  type="password"
                  name="admin_confirm_password"
                  placeholder="Admin password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && deletePassword) handleDeleteCrew(); }}
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </form>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeletePassword(""); }}>Cancel</Button>
            <Button
              className="bg-red-700 hover:bg-red-800 text-white"
              onClick={handleDeleteCrew}
              disabled={!deletePassword || deleteLoading}
            >
              {deleteLoading ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blacklist Modal */}
      <Dialog open={!!blacklistTarget} onOpenChange={() => setBlacklistTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Ban className="w-5 h-5 text-gray-600" /> Blacklist {blacklistTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will permanently block the user from future access. Provide a reason for record-keeping.
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
            <Button variant="outline" onClick={() => setBlacklistTarget(null)}>Cancel</Button>
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
    </div>
  );
}
