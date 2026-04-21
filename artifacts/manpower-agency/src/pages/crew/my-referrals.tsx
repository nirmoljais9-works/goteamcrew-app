import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Gift, Copy, MessageCircle, CheckCircle2, Wallet,
  ArrowRight, Users, Star, ClipboardCheck,
  Calendar, IndianRupee, ChevronRight,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Referral {
  id: number;
  eventId: number;
  eventTitle: string;
  eventDate: string | null;
  referralCode: string;
  referredPhone: string | null;
  referredUserName: string | null;
  status: string;
  rewardAmount: string | null;
  rewardPaid: string;
  referralLink: string;
  createdAt: string;
}

interface MyReferralsResponse {
  walletBalance: string;
  pendingEarnings: string;
  totalReferrals: number;
  successfulReferrals: number;
  referrals: Referral[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:          { label: "Link Shared",   color: "bg-amber-50 text-amber-700 border-amber-200" },
  joined:           { label: "Registered",    color: "bg-blue-50 text-blue-700 border-blue-200" },
  selected:         { label: "Selected",      color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  pending_approval: { label: "Under Review",  color: "bg-orange-50 text-orange-700 border-orange-200" },
  successful:       { label: "Completed",     color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  paid:             { label: "Paid",          color: "bg-green-50 text-green-700 border-green-200" },
  confirmed:        { label: "Completed",     color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected:         { label: "Not Eligible",  color: "bg-red-50 text-red-700 border-red-200" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function personName(r: Referral): string {
  return r.referredUserName || (r.referredPhone ? r.referredPhone.replace(/(\d{3})\d{4}(\d{3})/, "$1****$2") : "Unknown");
}

type SheetType = "selected" | "completed" | "earnings" | null;

/* ── Sheet: Selected ─────────────────────────────────────── */
function SelectedSheet({ items }: { items: Referral[] }) {
  return (
    <>
      {items.length === 0 ? (
        <EmptySheetState message="No one selected for events yet." />
      ) : (
        <div className="px-5 pt-4 pb-8 space-y-3">
          {items.map(r => (
            <div key={r.id} className="bg-card border border-border/60 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                    <Users className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <p className="font-semibold text-sm text-foreground truncate">{personName(r)}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${(STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending).color}`}>
                  {(STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending).label}
                </span>
              </div>
              <div className="pl-10 space-y-1">
                <p className="text-xs text-foreground font-medium line-clamp-1">{r.eventTitle}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>{formatDate(r.eventDate)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Sheet: Completed ─────────────────────────────────────── */
function CompletedSheet({ items }: { items: Referral[] }) {
  return (
    <>
      {items.length === 0 ? (
        <EmptySheetState message="No completed referrals yet." />
      ) : (
        <div className="px-5 pt-4 pb-8 space-y-3">
          {items.map(r => (
            <div key={r.id} className="bg-card border border-border/60 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <p className="font-semibold text-sm text-foreground truncate">{personName(r)}</p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                  Completed
                </span>
              </div>
              <div className="pl-10 space-y-1">
                <p className="text-xs text-foreground font-medium line-clamp-1">{r.eventTitle}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span>{formatDate(r.eventDate)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── Sheet: Earnings ─────────────────────────────────────── */
function EarningsSheet({ items }: { items: Referral[] }) {
  const total = items.reduce((sum, r) => {
    const amt = r.rewardAmount ? parseFloat(r.rewardAmount) : 0;
    return sum + amt;
  }, 0);
  const paid = items.filter(r => r.status === "paid" || r.rewardPaid === "yes").reduce((sum, r) => {
    return sum + (r.rewardAmount ? parseFloat(r.rewardAmount) : 0);
  }, 0);

  return (
    <>
      {items.length === 0 ? (
        <EmptySheetState message="No earnings yet — referrals will show here once approved." />
      ) : (
        <div className="px-5 pt-4 pb-8 space-y-3">
          {items.map(r => {
            const amt = r.rewardAmount ? parseFloat(r.rewardAmount) : 0;
            const isPaid = r.status === "paid" || r.rewardPaid === "yes";
            return (
              <div key={r.id} className="bg-card border border-border/60 rounded-2xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground flex-1 min-w-0 line-clamp-2">{r.eventTitle}</p>
                  <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${isPaid ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                    {isPaid ? "Paid" : "Pending"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-lg bg-green-50 flex items-center justify-center">
                    <IndianRupee className="w-3 h-3 text-green-600" />
                  </div>
                  <span className="text-sm font-bold text-green-700">₹{amt.toLocaleString("en-IN")}</span>
                </div>
              </div>
            );
          })}

          {/* Total row */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Earned</p>
              <p className="text-xl font-display font-bold text-green-700 mt-0.5">
                ₹{paid.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium">Pending Payout</p>
              <p className="text-base font-bold text-amber-600 mt-0.5">
                ₹{(total - paid).toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EmptySheetState({ message }: { message: string }) {
  return (
    <div className="py-14 text-center px-8">
      <Gift className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function MyReferrals() {
  const { toast } = useToast();
  const [data, setData] = useState<MyReferralsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [openSheet, setOpenSheet] = useState<SheetType>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BASE_URL}/api/crew/referrals`, { credentials: "include" });
        if (res.ok) setData(await res.json());
      } catch {
        toast({ variant: "destructive", title: "Failed to load referrals" });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const copyLink = async (link: string, id: number) => {
    const msg = `Hey 👋\n\nThere's a paid event opportunity on Goteamcrew.\n\nYou'll need to register first (takes 1–2 mins), then you can view details and apply.\n\nHere's the link:\n${link}\n\nLet me know if you need help 🙂`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ title: "Could not copy", description: "Please copy the link manually." });
    }
  };

  const whatsappShare = (ref: Referral) => {
    const msg = `Hey 👋\n\nThere's a paid event opportunity on Goteamcrew.\n\nYou'll need to register first (takes 1–2 mins), then you can view details and apply.\n\nHere's the link:\n${ref.referralLink}\n\nLet me know if you need help 🙂`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="space-y-6 pb-8 animate-pulse">
        <div className="h-8 bg-muted rounded w-40" />
        <div className="h-44 bg-muted rounded-3xl" />
        <div className="space-y-3">
          <div className="h-28 bg-muted rounded-2xl" />
          <div className="h-28 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  const allReferrals = data?.referrals ?? [];

  const registeredCount = allReferrals.filter(r => r.referredUserName || r.referredPhone).length;
  // Cumulative: Selected = everyone who reached "selected" stage or beyond (includes completed)
  const selectedList    = allReferrals.filter(r => ["selected", "pending_approval", "successful", "confirmed", "paid"].includes(r.status));
  // Cumulative: Completed = subset of selected who finished the event
  const completedList   = allReferrals.filter(r => ["successful", "confirmed", "paid"].includes(r.status));
  const earningsList    = allReferrals.filter(r => r.rewardAmount && parseFloat(r.rewardAmount) > 0);

  const totalEarnings = allReferrals
    .filter(r => (r.status === "paid" || r.rewardPaid === "yes") && r.rewardAmount)
    .reduce((sum, r) => sum + parseFloat(r.rewardAmount!), 0);

  type StepDef = {
    key: SheetType | "registered";
    label: string;
    helper: string;
    value: number | null;
    amount?: number;
    icon: typeof Users;
    color: string;
    bg: string;
    clickable: boolean;
  };

  const steps: StepDef[] = [
    {
      key: "registered",
      label: "Registered",
      helper: "Filled the form",
      value: registeredCount,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
      clickable: false,
    },
    {
      key: "selected",
      label: "Selected",
      helper: "Chosen for event",
      value: selectedList.length,
      icon: Star,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      clickable: true,
    },
    {
      key: "completed",
      label: "Completed",
      helper: "Attended & approved",
      value: completedList.length,
      icon: ClipboardCheck,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      clickable: true,
    },
    {
      key: "earnings",
      label: "Earnings",
      helper: "Paid to your wallet",
      value: null,
      amount: totalEarnings,
      icon: Wallet,
      color: "text-green-600",
      bg: "bg-green-50",
      clickable: true,
    },
  ];

  const SHEET_CONFIG: Record<NonNullable<SheetType>, { title: string; content: React.ReactNode }> = {
    selected: {
      title: "Selected Crew",
      content: <SelectedSheet items={selectedList} />,
    },
    completed: {
      title: "Completed Crew",
      content: <CompletedSheet items={completedList} />,
    },
    earnings: {
      title: "Earnings Breakdown",
      content: <EarningsSheet items={earningsList} />,
    },
  };

  return (
    <>
      <div className="space-y-6 pb-8">
        {/* Page header */}
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Refer & Earn</h1>
          <p className="text-muted-foreground mt-1">
            Share events with friends. Earn ₹100 for each friend who completes a shift.
          </p>
        </div>

        {/* Progress Flow card */}
        <div className="bg-card border border-border/60 rounded-3xl p-5 space-y-4">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Your Earnings Progress
          </p>

          <div className="flex items-start gap-1">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const isClickable = step.clickable;

              const inner = (
                <div className="flex-1 min-w-0 flex flex-col items-center text-center gap-1.5">
                  <div className={`w-9 h-9 rounded-2xl ${step.bg} flex items-center justify-center shrink-0 ${isClickable ? "group-hover:scale-105 transition-transform" : ""}`}>
                    <Icon className={`w-4 h-4 ${step.color}`} />
                  </div>
                  <p className="text-xl font-display font-bold text-foreground leading-none">
                    {step.amount !== undefined
                      ? `₹${step.amount.toLocaleString("en-IN")}`
                      : step.value}
                  </p>
                  <p className={`text-[11px] font-semibold leading-tight flex items-center gap-0.5 ${isClickable ? step.color : "text-foreground"}`}>
                    {step.label}
                    {isClickable && <ChevronRight className="w-2.5 h-2.5" />}
                  </p>
                </div>
              );

              return (
                <div key={step.key} className="flex items-start flex-1 min-w-0">
                  {isClickable ? (
                    <button
                      type="button"
                      onClick={() => setOpenSheet(step.key as SheetType)}
                      className="flex-1 min-w-0 group active:scale-95 transition-transform duration-100"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="flex-1 min-w-0">{inner}</div>
                  )}

                  {i < steps.length - 1 && (
                    <div className="mt-3.5 px-0.5 shrink-0">
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Helper text row */}
          <div className="border-t border-border/50 pt-3 grid grid-cols-4 gap-2">
            {steps.map(step => (
              <p key={step.key} className="text-[10px] text-muted-foreground text-center leading-tight">
                {step.helper}
              </p>
            ))}
          </div>
        </div>

        {/* Referral cards */}
        {allReferrals.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-base font-display font-bold text-foreground">My Referrals</h2>
            {allReferrals.map(r => {
              const config = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending;
              const rewardAmt = r.rewardAmount ? parseFloat(r.rewardAmount) : 0;
              const canShare = r.status === "pending";

              return (
                <div key={r.id} className="bg-card border border-border/60 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-sm text-foreground leading-snug flex-1 min-w-0 line-clamp-2">
                      {r.eventTitle}
                    </p>
                    <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${config.color}`}>
                      {config.label}
                    </span>
                  </div>

                  {rewardAmt > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Gift className="w-3.5 h-3.5 text-green-600 shrink-0" />
                      <span className="text-sm font-semibold text-green-700">
                        ₹{rewardAmt.toLocaleString("en-IN")} reward
                        {r.status === "paid" || r.rewardPaid === "yes"
                          ? " — paid to wallet"
                          : r.status === "successful" || r.status === "confirmed"
                          ? " — payout pending"
                          : ""}
                      </span>
                    </div>
                  )}

                  {canShare && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 rounded-xl gap-1.5 text-xs"
                        onClick={() => copyLink(r.referralLink, r.id)}
                      >
                        {copiedId === r.id
                          ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />Copied!</>
                          : <><Copy className="w-3.5 h-3.5" />Copy Link</>}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 rounded-xl gap-1.5 text-xs bg-[#25D366] hover:bg-[#20bd5a] text-white"
                        onClick={() => whatsappShare(r)}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />Share
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-2xl border border-dashed">
            <Gift className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold text-foreground">No referrals yet</p>
            <p className="text-sm text-muted-foreground mt-1">Open an event shift and tap "Refer & Earn" to start.</p>
          </div>
        )}
      </div>

      {/* Bottom sheets */}
      {(["selected", "completed", "earnings"] as NonNullable<SheetType>[]).map(type => {
        const cfg = SHEET_CONFIG[type];
        return (
          <Sheet key={type} open={openSheet === type} onOpenChange={o => !o && setOpenSheet(null)}>
            <SheetContent side="bottom" className="max-h-[82vh] rounded-t-3xl px-0 pb-0">
              <SheetHeader className="px-5 pb-3 border-b border-border/60">
                <SheetTitle className="text-left text-lg font-display">{cfg.title}</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto" style={{ maxHeight: "calc(82vh - 76px)" }}>
                {cfg.content}
              </div>
            </SheetContent>
          </Sheet>
        );
      })}
    </>
  );
}
