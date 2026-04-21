import { useGetShifts, useGetCrewProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { MapPin, CalendarDays, Users, ShieldX, Timer, ChevronRight, Gift } from "lucide-react";
import { motion } from "framer-motion";

function isGenderEligible(profileGender: string | null | undefined, eventGenderRequired: string | null | undefined): boolean {
  if (!eventGenderRequired || eventGenderRequired === "both" || eventGenderRequired === "Both" || eventGenderRequired === "any") return true;
  if (!profileGender) return true;
  return profileGender.toLowerCase() === eventGenderRequired.toLowerCase();
}

function getGenderLabel(gender: string | null | undefined): string {
  if (!gender || gender === "both" || gender === "any") return "Open for All";
  if (gender.toLowerCase() === "male") return "Male Only";
  if (gender.toLowerCase() === "female") return "Female Only";
  return `${gender} Only`;
}

type RoleConfig = { gender: string; role: string; task?: string; minPay?: string | number; maxPay?: string | number; pay?: string | number };

function parseRoleConfigs(raw: any): RoleConfig[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function getCardDisplayData(s: any, profile: any): { roles: string[]; payLabel: string | null; genderRequired: string | null } {
  const profileGender = (profile?.gender || "").toLowerCase();
  const configs = parseRoleConfigs(s.eventRoleConfigs);

  if (configs.length > 0) {
    // Filter configs relevant to this crew member's gender
    const relevant = configs.filter(c => {
      if (!c.gender || c.gender === "both") return true;
      if (!profileGender) return true;
      return c.gender.toLowerCase() === profileGender;
    });
    const display = relevant.length > 0 ? relevant : configs;

    // All unique role names
    const roles = [...new Set(display.map(c => c.role).filter(Boolean))];

    // Collect all minPay / maxPay values
    const allMins = display.map(c => parseFloat(String(c.minPay ?? c.pay ?? ""))).filter(v => !isNaN(v));
    const allMaxes = display.map(c => parseFloat(String(c.maxPay ?? c.pay ?? ""))).filter(v => !isNaN(v));
    const lo = allMins.length ? Math.min(...allMins) : null;
    const hi = allMaxes.length ? Math.max(...allMaxes) : null;

    let payLabel: string | null = null;
    if (lo !== null && hi !== null && lo !== hi) {
      payLabel = `₹${lo.toLocaleString("en-IN")}–₹${hi.toLocaleString("en-IN")}`;
    } else if (lo !== null) {
      payLabel = `₹${lo.toLocaleString("en-IN")}`;
    } else if (hi !== null) {
      payLabel = `₹${hi.toLocaleString("en-IN")}`;
    }

    // Overall gender requirement derived from configs
    const genders = [...new Set(configs.map(c => c.gender?.toLowerCase()).filter(Boolean))];
    const genderRequired = genders.length === 1 && genders[0] !== "both" ? genders[0] : null;

    return { roles, payLabel, genderRequired };
  }

  // Fallback to legacy fields
  const legacyRole = s.eventRole || s.role;
  const payFemaleMin = s.eventPayFemale != null ? parseFloat(s.eventPayFemale) : null;
  const payFemaleMax = s.eventPayFemaleMax != null ? parseFloat(s.eventPayFemaleMax) : null;
  const payMaleMin = s.eventPayMale != null ? parseFloat(s.eventPayMale) : null;
  const payMaleMax = s.eventPayMaleMax != null ? parseFloat(s.eventPayMaleMax) : null;
  const payFresher = s.eventPayFresher != null ? parseFloat(s.eventPayFresher) : null;
  const payBase = s.eventPayPerDay != null ? parseFloat(s.eventPayPerDay) : null;

  let payMin: number | null = payBase;
  let payMax: number | null = null;
  if (profileGender === "female" && payFemaleMin != null) {
    payMin = payFemaleMin;
    payMax = payFemaleMax !== payFemaleMin ? payFemaleMax : null;
  } else if (profileGender === "male" && payMaleMin != null) {
    payMin = payMaleMin;
    payMax = payMaleMax !== payMaleMin ? payMaleMax : null;
  } else if ((profile?.experienceLevel || "").toLowerCase() === "fresher" && payFresher != null) {
    payMin = payFresher;
  }

  let payLabel: string | null = null;
  if (payMin !== null && payMax !== null) {
    payLabel = `₹${payMin.toLocaleString("en-IN")}–₹${payMax.toLocaleString("en-IN")}`;
  } else if (payMin !== null) {
    payLabel = `₹${payMin.toLocaleString("en-IN")}`;
  }

  return { roles: legacyRole ? [legacyRole] : [], payLabel, genderRequired: s.eventGenderRequired || s.genderPreference || null };
}

export default function BrowseShifts() {
  const { data: shifts, isLoading } = useGetShifts({ status: "open", query: { refetchInterval: 30_000 } } as any);
  const { data: profile } = useGetCrewProfile();
  const [, navigate] = useLocation();

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading shifts...</div>;

  const p = profile as any;

  if (p?.status === "blacklisted") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Browse Events</h1>
          <p className="text-muted-foreground mt-2">Find and apply for available work opportunities.</p>
        </div>
        <div className="bg-red-50 border border-red-300 rounded-2xl p-10 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-xl font-bold text-red-900">Access Restricted</h3>
          <p className="text-red-800 max-w-md">Your account is restricted. You cannot browse or apply for new events. Contact support at <a href="mailto:info@goteamcrew.in" className="underline font-medium">info@goteamcrew.in</a> if you believe this is a mistake.</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const openShifts = (shifts?.filter(s => {
    if (s.status !== "open" || s.claimedByMe) return false;
    const eventStart = (s as any).eventStartDate || s.startTime;
    if (eventStart && new Date(eventStart) <= now) return false;
    return true;
  }) || []) as any[];
  const isApproved = p?.status === "approved";
  const profileGender = p?.gender || null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Browse Events</h1>
        <p className="text-muted-foreground mt-2">Find and apply for available work opportunities.</p>
      </div>

      {!isApproved && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm font-medium flex items-start gap-3">
          <Timer className="w-5 h-5 shrink-0 mt-0.5" />
          <span>You can browse shifts but cannot apply until your profile is approved by an administrator.</span>
        </div>
      )}

      {openShifts.length === 0 ? (
        <div className="text-center py-20 bg-card rounded-3xl border border-dashed flex flex-col items-center gap-5 px-6">
          <div className="text-5xl">📭</div>
          <div className="space-y-2">
            <p className="text-foreground font-semibold text-lg">No events live right now</p>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              New opportunities will be posted soon — check back regularly!
            </p>
          </div>
          <button
            onClick={() => {
              try {
                const w = window as any;
                w.OneSignalDeferred = w.OneSignalDeferred || [];
                w.OneSignalDeferred.push(async function(OneSignal: any) {
                  await OneSignal.showNativePrompt();
                });
              } catch {}
            }}
            className="inline-flex items-center gap-2 bg-primary text-white font-semibold text-sm px-6 py-3 rounded-2xl shadow-md hover:bg-primary/90 active:scale-95 transition-all duration-150"
          >
            🔔 Notify me for upcoming events
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {openShifts.map((shift, i) => {
            const s = shift as any;
            const { roles: displayRoles, payLabel, genderRequired: derivedGender } = getCardDisplayData(s, p);
            const gender = derivedGender || s.eventGenderRequired || s.genderPreference;
            const genderBoth = !gender || gender === "both" || gender === "any";
            const eligible = isGenderEligible(profileGender, gender);
            const spotsLeft = (shift.spotsTotal || 0) - (shift.spotsFilled || 0);
            const fewSpots = spotsLeft > 0 && spotsLeft <= 3;
            const referralReward = s.eventReferralReward ? parseFloat(s.eventReferralReward) : null;
            const eventStart = s.eventStartDate || shift.startTime;
            const referralOpen = eventStart ? new Date() < new Date(eventStart) : true;

            const dateLabel = (() => {
              if (s.eventStartDate && s.eventEndDate) {
                const sd = new Date(s.eventStartDate);
                const ed = new Date(s.eventEndDate);
                const sameDayStr = format(sd, "yyyy-MM-dd") === format(ed, "yyyy-MM-dd");
                if (sameDayStr) {
                  return `${format(sd, "d MMM yyyy")} | ${format(sd, "h:mm a")} – ${format(ed, "h:mm a")}`;
                }
                return `${format(sd, "d MMM")} – ${format(ed, "d MMM yyyy")}`;
              }
              return format(new Date(shift.startTime), "EEE, MMM d, yyyy");
            })();

            return (
              <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => navigate(`/shifts/${shift.id}`)}
                className={`group bg-white rounded-2xl border shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col overflow-hidden ${
                  eligible ? "border-slate-200" : "border-violet-200 opacity-90"
                }`}
              >
                {/* Not eligible banner */}
                {!eligible && (
                  <div className="bg-violet-50 px-4 py-2 flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-violet-700">
                      {getGenderLabel(gender)}
                      {referralOpen
                        ? <> · You can refer &amp; earn{referralReward ? ` ₹${referralReward.toLocaleString("en-IN")}` : ""}</>
                        : " · Referral closed"}
                    </span>
                  </div>
                )}

                {/* Card body */}
                <div className="p-5 flex-1 space-y-3">

                  {/* Top row: Role tag(s) + Pay */}
                  <div className="flex items-start justify-between gap-3">
                    {displayRoles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {displayRoles.map(r => (
                          <span key={r} className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full leading-none">
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span />
                    )}
                    {payLabel ? (
                      <div className="text-right shrink-0">
                        <div className="text-base font-display font-bold text-foreground leading-tight">
                          {payLabel}
                        </div>
                        <div className="text-[10px] font-normal text-muted-foreground">/day</div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground shrink-0">Pay TBD</span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-[17px] font-bold text-foreground leading-snug line-clamp-2">
                    {shift.eventTitle}
                  </h3>

                  {/* Location */}
                  {shift.eventLocation && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="line-clamp-1">{shift.eventLocation}</span>
                    </div>
                  )}

                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 font-medium">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span>{dateLabel}</span>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {spotsLeft <= 0 ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600">
                        <Users className="w-3 h-3" />
                        Full
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                        fewSpots
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        <Users className="w-3 h-3" />
                        {fewSpots ? `Only ${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left` : `${spotsLeft} spots left`}
                      </span>
                    )}
                    {!genderBoth && gender && (
                      <span className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                        eligible ? "bg-violet-50 text-violet-700" : "bg-violet-100 text-violet-800"
                      } capitalize`}>
                        {gender.toLowerCase() === "male" ? (
                          <><span className="leading-none">🚹</span>Male Only</>
                        ) : gender.toLowerCase() === "female" ? (
                          <><span className="text-sm font-bold leading-none">♀</span>Female Only</>
                        ) : `${gender} Only`}
                      </span>
                    )}
                    <span className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full ${
                      s.eventFoodProvided
                        ? "bg-emerald-50 text-emerald-700 font-semibold"
                        : "text-gray-400 font-normal"
                    }`}>
                      🍽 {s.eventFoodProvided
                        ? (s.eventMealsProvided || "Food Included")
                        : "Self-arranged"}
                    </span>
                    {s.eventIncentives && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                        🎯 Incentives
                      </span>
                    )}
                    {referralReward && referralReward > 0 && referralOpen && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                        <Gift className="w-3 h-3" />
                        Earn ₹{referralReward.toLocaleString("en-IN")} per referral
                      </span>
                    )}
                  </div>
                </div>

                {/* CTA footer */}
                <div className="px-5 pb-4">
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    {eligible ? (
                      <>
                        <span className="text-xs text-muted-foreground">Tap to see full details</span>
                        <span className="flex items-center gap-0.5 text-sm font-semibold text-indigo-600 group-hover:gap-1.5 transition-all duration-150">
                          View Details <ChevronRight className="w-4 h-4" />
                        </span>
                      </>
                    ) : referralOpen ? (
                      <>
                        <span className="text-xs text-muted-foreground">Not for your profile</span>
                        <span className="flex items-center gap-1 text-sm font-semibold text-violet-600 group-hover:gap-1.5 transition-all duration-150">
                          <Gift className="w-4 h-4" /> Refer & Earn
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">Not for your profile</span>
                        <span className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
                          Referral Closed
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
