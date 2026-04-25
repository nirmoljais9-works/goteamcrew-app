import { useGetShifts, useGetCrewProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format, differenceInCalendarDays } from "date-fns";
import { MapPin, CalendarDays, Users, ShieldX, Timer, Gift, Zap, IndianRupee } from "lucide-react";
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

type RoleConfig = {
  gender: string;
  role: string;
  task?: string;
  slots?: number;
  // new format
  payMale?: string | null;
  payFemale?: string | null;
  // legacy format
  minPay?: string | number;
  maxPay?: string | number;
  pay?: string | number;
};

function parseRoleConfigs(raw: any): RoleConfig[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Parse "1000" or "1000-4000" into { min, max } */
function parsePayStr(val: any): { min: number | null; max: number | null } {
  if (!val && val !== 0) return { min: null, max: null };
  const s = String(val).replace(/[–—]/g, "-").trim();
  const parts = s.split("-").map((p: string) => p.trim()).filter(Boolean);
  const min = parseFloat(parts[0]);
  const max = parts[1] ? parseFloat(parts[1]) : NaN;
  return {
    min: !isNaN(min) ? min : null,
    max: !isNaN(max) ? max : !isNaN(min) ? min : null,
  };
}

/** Extract pay range from a single role config, respecting gender preference */
function getRolePayRange(c: RoleConfig, profileGender?: string): { min: number | null; max: number | null } {
  // New format: payMale / payFemale are range strings
  if (c.payMale || c.payFemale) {
    if (profileGender === "male" && c.payMale) return parsePayStr(c.payMale);
    if (profileGender === "female" && c.payFemale) return parsePayStr(c.payFemale);
    // No gender preference or "both" — use widest range
    const mR = c.payMale ? parsePayStr(c.payMale) : { min: null, max: null };
    const fR = c.payFemale ? parsePayStr(c.payFemale) : { min: null, max: null };
    const mins = [mR.min, fR.min].filter((v): v is number => v !== null);
    const maxs = [mR.max, fR.max].filter((v): v is number => v !== null);
    return {
      min: mins.length ? Math.min(...mins) : null,
      max: maxs.length ? Math.max(...maxs) : null,
    };
  }
  // Legacy format: minPay / maxPay / pay
  const lMin = parsePayStr(c.minPay ?? c.pay);
  const lMax = parsePayStr(c.maxPay ?? c.pay);
  return { min: lMin.min, max: lMax.max ?? lMin.max };
}

/** Friendly pay display for a range */
function fmtPay(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const lo = min ?? max!;
  const hi = max ?? min!;
  if (lo === hi) return `₹${lo.toLocaleString("en-IN")}`;
  return `₹${lo.toLocaleString("en-IN")}–₹${hi.toLocaleString("en-IN")}`;
}

/** Shorten a long venue address to the most meaningful part */
function shortenLocation(loc: string | null | undefined): string {
  if (!loc || loc === "TBD") return "Location TBD";
  const parts = loc.split(",").map((p: string) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // Return last 2 comma-parts (usually area + city)
    return parts.slice(-2).join(", ");
  }
  if (parts.length === 2) return parts.join(", ");
  return loc.length > 32 ? loc.slice(0, 30) + "…" : loc;
}

interface CardData {
  roles: string[];
  overallMin: number | null;
  overallMax: number | null;
  genderRequired: string | null;
  rolePayRows: Array<{ role: string; payStr: string | null }>;
  roleSlotsRows: Array<{ role: string; slots: number }>;
}

function getCardData(s: any, profile: any): CardData {
  const profileGender = (profile?.gender || "").toLowerCase();
  const configs = parseRoleConfigs(s.eventRoleConfigs);

  if (configs.length > 0) {
    const relevant = configs.filter(c => {
      if (!c.gender || c.gender === "both") return true;
      if (!profileGender) return true;
      return c.gender.toLowerCase() === profileGender;
    });
    const display = relevant.length > 0 ? relevant : configs;

    const roles = [...new Set(configs.map(c => c.role).filter(Boolean))];

    // Overall pay range (all relevant roles)
    const allMins: number[] = [];
    const allMaxs: number[] = [];
    for (const c of display) {
      const r = getRolePayRange(c, profileGender);
      if (r.min !== null) allMins.push(r.min);
      if (r.max !== null) allMaxs.push(r.max);
    }
    const overallMin = allMins.length ? Math.min(...allMins) : null;
    const overallMax = allMaxs.length ? Math.max(...allMaxs) : null;

    // Per-role pay rows (all configs, grouped by role)
    const seenRoles = new Set<string>();
    const rolePayRows: Array<{ role: string; payStr: string | null }> = [];
    for (const c of configs) {
      if (!c.role || seenRoles.has(c.role)) continue;
      seenRoles.add(c.role);
      const r = getRolePayRange(c, profileGender);
      rolePayRows.push({ role: c.role, payStr: fmtPay(r.min, r.max) });
    }

    // Per-role slot rows
    const roleSlotsRows: Array<{ role: string; slots: number }> = [];
    for (const c of configs) {
      if (!c.role || !c.slots || c.slots <= 0) continue;
      const existing = roleSlotsRows.find(r => r.role === c.role);
      if (existing) {
        existing.slots += c.slots;
      } else {
        roleSlotsRows.push({ role: c.role, slots: c.slots });
      }
    }

    const genders = [...new Set(configs.map(c => c.gender?.toLowerCase()).filter(Boolean))];
    const genderRequired = genders.length === 1 && genders[0] !== "both" ? genders[0] : null;

    return { roles, overallMin, overallMax, genderRequired, rolePayRows, roleSlotsRows };
  }

  // Fallback to legacy shift-level fields
  const legacyRole = s.eventRole || s.role;
  const pFemMin = s.eventPayFemale != null ? parseFloat(s.eventPayFemale) : null;
  const pFemMax = s.eventPayFemaleMax != null ? parseFloat(s.eventPayFemaleMax) : null;
  const pMalMin = s.eventPayMale != null ? parseFloat(s.eventPayMale) : null;
  const pMalMax = s.eventPayMaleMax != null ? parseFloat(s.eventPayMaleMax) : null;
  const pBase  = s.eventPayPerDay != null ? parseFloat(s.eventPayPerDay) : null;

  let lo: number | null = pBase;
  let hi: number | null = null;
  if (profileGender === "female" && pFemMin !== null) { lo = pFemMin; hi = pFemMax !== pFemMin ? pFemMax : null; }
  else if (profileGender === "male" && pMalMin !== null) { lo = pMalMin; hi = pMalMax !== pMalMin ? pMalMax : null; }

  const allVals: number[] = [pBase, pFemMin, pFemMax, pMalMin, pMalMax].filter((v): v is number => v !== null);
  const overallMin = allVals.length ? Math.min(...allVals) : lo;
  const overallMax = allVals.length ? Math.max(...allVals) : hi;

  return {
    roles: legacyRole ? [legacyRole] : [],
    overallMin,
    overallMax,
    genderRequired: s.eventGenderRequired || s.genderPreference || null,
    rolePayRows: [],
    roleSlotsRows: [],
  };
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
            const { roles, overallMin, overallMax, genderRequired: derivedGender, rolePayRows, roleSlotsRows } = getCardData(s, p);
            const gender = derivedGender || s.eventGenderRequired || s.genderPreference;
            const genderBoth = !gender || gender === "both" || gender === "any";
            const eligible = isGenderEligible(profileGender, gender);
            const spotsLeft = Math.max(0, (shift.spotsTotal || 0) - (shift.spotsFilled || 0));
            const isFull = spotsLeft <= 0;
            const isUrgent = !isFull && spotsLeft <= 2;
            const referralReward = s.eventReferralReward ? parseFloat(s.eventReferralReward) : null;
            const eventStart = s.eventStartDate || shift.startTime;
            const referralOpen = eventStart ? new Date() < new Date(eventStart) : true;

            // Event duration in days
            const eventDays = (() => {
              if (s.eventStartDate && s.eventEndDate) {
                const diff = differenceInCalendarDays(new Date(s.eventEndDate), new Date(s.eventStartDate));
                return diff + 1;
              }
              return 1;
            })();

            // Max total earnings = eventDays × overallMax
            const maxEarnings = overallMax !== null && eventDays > 1
              ? overallMax * eventDays
              : null;

            // Date label
            const dateLabel = (() => {
              if (s.eventStartDate && s.eventEndDate) {
                const sd = new Date(s.eventStartDate);
                const ed = new Date(s.eventEndDate);
                if (format(sd, "yyyy-MM-dd") === format(ed, "yyyy-MM-dd")) {
                  return format(sd, "d MMM yyyy");
                }
                return `${format(sd, "d MMM")} – ${format(ed, "d MMM yyyy")}`;
              }
              return format(new Date(shift.startTime), "EEE, MMM d");
            })();

            // Pay label (headline)
            const payLabel = fmtPay(overallMin, overallMax);
            const hasPayRange = overallMin !== null && overallMax !== null && overallMin !== overallMax;

            // Multiple role-pay rows worth showing?
            const showRolePayBreakdown = rolePayRows.length > 1 && rolePayRows.some(r => r.payStr);
            const showRoleSlots = roleSlotsRows.length > 0;

            // Short location
            const shortLocation = shortenLocation(shift.eventLocation);

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
                {/* Top gradient accent */}
                <div className="h-1 bg-gradient-to-r from-primary via-violet-500 to-indigo-400" />

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

                  {/* Role tags */}
                  {roles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {roles.map(r => (
                        <span key={r} className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full leading-none">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Event title */}
                  <h3 className="text-[17px] font-bold text-foreground leading-snug line-clamp-2">
                    {shift.eventTitle}
                  </h3>

                  {/* Earnings highlight (only for multi-day events) */}
                  {maxEarnings !== null && (
                    <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                      <span className="text-lg">🔥</span>
                      <span className="text-sm font-bold text-emerald-800">
                        Earn up to ₹{maxEarnings.toLocaleString("en-IN")}
                      </span>
                    </div>
                  )}

                  {/* Pay range headline */}
                  {payLabel && (
                    <div className="flex items-center gap-1.5">
                      <IndianRupee className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="text-[15px] font-bold text-foreground">
                        {payLabel}
                        <span className="text-xs font-normal text-muted-foreground ml-1">/day</span>
                      </span>
                    </div>
                  )}

                  {/* Location */}
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="line-clamp-1">{shortLocation}</span>
                  </div>

                  {/* Date + duration */}
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 font-medium">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span>
                      {dateLabel}
                      {eventDays > 1 && (
                        <span className="ml-1.5 text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                          {eventDays} days
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Role-wise pay breakdown */}
                  {showRolePayBreakdown && (
                    <div className="bg-slate-50 rounded-xl px-3 py-2 space-y-1">
                      {rolePayRows.filter(r => r.payStr).map(r => (
                        <div key={r.role} className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-500">{r.role}</span>
                          <span className="text-[11px] font-bold text-slate-700">{r.payStr}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Role-wise slots */}
                  {showRoleSlots && (
                    <div className={`rounded-xl px-3 py-2 space-y-1 ${isFull ? "bg-red-50" : "bg-slate-50"}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Openings</p>
                      {roleSlotsRows.map(r => (
                        <div key={r.role} className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-500">{r.role}</span>
                          <span className={`text-[11px] font-bold ${isFull ? "text-red-500" : "text-indigo-600"}`}>
                            {r.slots} slot{r.slots !== 1 ? "s" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Badges row */}
                  <div className="flex flex-wrap gap-1.5">
                    {/* Urgency / spots */}
                    {isFull ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600">
                        <Users className="w-3 h-3" /> Full
                      </span>
                    ) : isUrgent ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        <Zap className="w-3 h-3" />
                        Only {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
                      </span>
                    ) : !showRoleSlots ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                        <Users className="w-3 h-3" /> {spotsLeft} spots left
                      </span>
                    ) : null}

                    {/* Gender restriction */}
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

                    {/* Food */}
                    {s.eventFoodProvided && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                        🍽 {s.eventMealsProvided ? (() => {
                          const map: Record<string, string> = { "1_meal": "1 Meal", "2_meals": "2 Meals", "3_meals": "3 Meals", "snacks_only": "Snacks" };
                          return map[s.eventMealsProvided] || s.eventMealsProvided;
                        })() : "Food Included"}
                      </span>
                    )}

                    {/* Incentives */}
                    {s.eventIncentives && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                        🎯 Incentives
                      </span>
                    )}

                    {/* Referral */}
                    {referralReward && referralReward > 0 && referralOpen && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                        <Gift className="w-3 h-3" />
                        ₹{referralReward.toLocaleString("en-IN")} referral
                      </span>
                    )}
                  </div>
                </div>

                {/* CTA footer */}
                <div className="px-5 pb-4">
                  <div className="pt-3 border-t border-slate-100">
                    {eligible ? (
                      isFull ? (
                        <div className="flex items-center justify-center h-10 rounded-xl bg-slate-100 text-slate-400 text-sm font-semibold">
                          All Slots Filled
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-10 rounded-xl bg-primary text-white text-sm font-bold gap-1.5 group-hover:bg-primary/90 transition-colors">
                          Apply Now
                          <span className="group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                        </div>
                      )
                    ) : referralOpen ? (
                      <div className="flex items-center justify-center h-10 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-semibold gap-1.5">
                        <Gift className="w-4 h-4" /> Refer &amp; Earn
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-10 rounded-xl bg-slate-50 text-slate-400 text-sm font-medium">
                        Not for your profile
                      </div>
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
