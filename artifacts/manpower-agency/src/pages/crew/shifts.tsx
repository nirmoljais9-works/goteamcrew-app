import { useGetShifts, useGetCrewProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format, differenceInCalendarDays } from "date-fns";
import { MapPin, CalendarDays, ShieldX, Timer, Gift } from "lucide-react";
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

/**
 * formatLocation — extracts "Venue, City" from a full Google Maps address.
 *
 * Examples:
 *   "India Expo Mart, Greater Noida, Uttar Pradesh, India" → "India Expo Mart, Greater Noida"
 *   "Connaught Place, New Delhi, Delhi, India"             → "Connaught Place, New Delhi"
 *   "Mumbai, Maharashtra, India"                           → "Mumbai"
 *   "Expo Mart Greater Noida, UP"                         → "Greater Noida" (too long, city only)
 *
 * If the result exceeds 30 chars, returns city only.
 */
function formatLocation(loc: string | null | undefined): string {
  if (!loc || loc.trim() === "" || loc === "TBD") return "Location TBD";

  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 1) {
    const s = parts[0];
    return s.length > 30 ? s.slice(0, 28) + "…" : s;
  }

  const venue = parts[0];

  // For Indian addresses the typical structure is:
  //   Venue, [Area,] City, State, Country
  // City is therefore 3rd from end for 4+ parts, or 2nd part for 2–3 parts.
  let city: string;
  if (parts.length >= 4) {
    city = parts[parts.length - 3];
  } else if (parts.length === 3) {
    city = parts[1];
  } else {
    city = parts[1];
  }

  if (venue.toLowerCase() === city.toLowerCase()) {
    return venue.length > 30 ? venue.slice(0, 28) + "…" : venue;
  }

  const combined = `${venue}, ${city}`;
  if (combined.length > 30) {
    return city.length > 30 ? city.slice(0, 28) + "…" : city;
  }
  return combined;
}

/** Deterministic gradient per event title for the card banner */
const GRADIENTS = [
  "from-violet-500 to-indigo-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-emerald-500 to-teal-600",
  "from-sky-500 to-blue-600",
  "from-fuchsia-500 to-purple-600",
];

function getGradient(title: string | undefined): string {
  if (!title) return GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
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
            const gender = s.eventGenderRequired || s.genderPreference;
            const genderBoth = !gender || gender === "both" || gender === "any";
            const eligible = isGenderEligible(profileGender, gender);
            const referralReward = s.eventReferralReward ? parseFloat(s.eventReferralReward) : null;
            const eventStart = s.eventStartDate || shift.startTime;
            const referralOpen = eventStart ? new Date() < new Date(eventStart) : true;

            const eventDays = (() => {
              if (s.eventStartDate && s.eventEndDate) {
                return differenceInCalendarDays(new Date(s.eventEndDate), new Date(s.eventStartDate)) + 1;
              }
              return 1;
            })();

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

            const location = formatLocation(shift.eventLocation);
            const gradient = getGradient(shift.eventTitle);
            const initials = (shift.eventTitle || "E")
              .split(" ")
              .slice(0, 2)
              .map((w: string) => w[0]?.toUpperCase() ?? "")
              .join("");

            return (
              <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => navigate(`/shifts/${shift.id}`)}
                className={`group bg-white rounded-2xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col overflow-hidden ${
                  eligible ? "border-slate-200" : "border-violet-200"
                }`}
              >
                {/* Event image / gradient banner */}
                <div className={`relative h-28 bg-gradient-to-br ${gradient} flex items-center justify-center overflow-hidden`}>
                  {/* Decorative circles */}
                  <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
                  <div className="absolute -bottom-6 -left-4 w-28 h-28 rounded-full bg-white/10" />

                  {/* Initials */}
                  <span className="relative z-10 text-4xl font-black text-white/40 select-none tracking-tight">
                    {initials}
                  </span>

                  {/* Not eligible ribbon */}
                  {!eligible && (
                    <div className="absolute top-2.5 left-3 bg-white/90 backdrop-blur-sm text-violet-700 text-[10px] font-bold px-2.5 py-1 rounded-full">
                      {getGenderLabel(gender)}
                    </div>
                  )}

                  {/* Multi-day pill */}
                  {eventDays > 1 && (
                    <div className="absolute top-2.5 right-3 bg-black/30 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
                      {eventDays} days
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="p-4 flex-1 flex flex-col gap-2.5">

                  {/* Event title */}
                  <h3 className="text-[16px] font-bold text-foreground leading-snug line-clamp-2">
                    {shift.eventTitle}
                  </h3>

                  {/* Location */}
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="line-clamp-1">{location}</span>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 font-medium">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span>{dateLabel}</span>
                  </div>

                  {/* Referral badge */}
                  {referralReward && referralReward > 0 && referralOpen && (
                    <div className="mt-auto pt-1">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">
                        <Gift className="w-3 h-3" />
                        ₹{referralReward.toLocaleString("en-IN")} referral bonus
                      </span>
                    </div>
                  )}
                </div>

                {/* CTA footer */}
                <div className="px-4 pb-4">
                  <div className="pt-3 border-t border-slate-100">
                    {eligible ? (
                      <div className={`flex items-center justify-center h-10 rounded-xl text-sm font-bold gap-1.5 transition-colors ${
                        gradient.includes("violet") || gradient.includes("indigo") || gradient.includes("purple")
                          ? "bg-primary text-white group-hover:bg-primary/90"
                          : "bg-primary text-white group-hover:bg-primary/90"
                      }`}>
                        View Details
                        <span className="group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                      </div>
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
