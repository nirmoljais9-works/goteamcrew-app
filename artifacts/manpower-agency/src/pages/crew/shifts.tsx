import { useGetShifts, useGetCrewProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format, differenceInCalendarDays } from "date-fns";
import { MapPin, CalendarDays, ShieldX, Timer, Gift, Users } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

/**
 * SmartBannerImage
 *
 * Detects orientation on load and adapts:
 *  - Portrait  → height auto (image-driven), max 240 px, blurred background fills sides
 *  - Landscape → fixed 192 px, object-cover object-center
 */
function SmartBannerImage({ src, alt }: { src: string; alt: string }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | null>(null);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setOrientation(img.naturalHeight > img.naturalWidth ? "portrait" : "landscape");
  }

  const isPortrait = orientation === "portrait";
  const isLandscape = orientation === "landscape";

  return (
    <div
      className="relative w-full overflow-hidden"
      style={isPortrait
        ? { maxHeight: 240 }           // portrait: container shrinks to image
        : { height: isLandscape ? 192 : 220 } // landscape: fixed; null → default before load
      }
    >
      {/* Blurred background — fills container for portrait, hidden for landscape */}
      {!isLandscape && (
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover blur-lg brightness-75 scale-110"
        />
      )}

      {/* Main image */}
      {isPortrait ? (
        /* Portrait: let natural height drive the container, cap at 240 px */
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          className="relative z-10 block w-full object-contain object-center"
          style={{ maxHeight: 240, display: "block" }}
        />
      ) : (
        /* Landscape (or not-yet-loaded): fill fixed height */
        <img
          src={src}
          alt={alt}
          onLoad={handleLoad}
          className="w-full h-full object-cover object-center"
        />
      )}

      {/* Scrim for badge readability */}
      <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/35 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}

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
 * Strips booth/unit codes (e.g. "B-06/05", "A-12", "Gate-3") from a
 * comma-split address segment.
 */
function isBoothCode(segment: string): boolean {
  return /^[A-Za-z]-?\d+/i.test(segment) || /^\d+[A-Za-z]?$/.test(segment);
}

/**
 * formatLocation
 *
 * Converts a full address string into a clean "Venue, City" display.
 *
 * Examples:
 *   "B-06/05, India Expo Mart Greater Noida, UP"
 *     → "India Expo Mart, Greater Noida"
 *   "India Expo Mart, Knowledge Park II, Greater Noida, Uttar Pradesh, India"
 *     → "India Expo Mart, Greater Noida"
 *   "Connaught Place, New Delhi, Delhi, India"
 *     → "Connaught Place, New Delhi"
 *   "Mumbai, Maharashtra, India"
 *     → "Mumbai"
 */
function formatLocation(location: string | null | undefined): string {
  if (!location) return "";

  const capWords = (s: string) =>
    s
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  // 1. Split by comma, trim, strip booth codes
  let parts = location
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !isBoothCode(p));

  if (parts.length === 0) return "";

  // 2. For addresses with 3+ segments, use standard "first = venue, find city"
  if (parts.length >= 3) {
    const venue = parts[0];

    // Skip trailing segments that look like a country / state
    // (short abbreviations like "UP", "MH", or known state/country names)
    const stateCountryPattern =
      /^(India|UP|MH|DL|KA|GJ|RJ|HR|WB|TN|TS|AP|KL|BR|OR|PB|AS|HP|UK|MP|CG|JH|GA|MN|ML|MZ|NL|SK|TR|AR|JK|LA)$/i;
    const longStatePattern =
      /Pradesh|Maharashtra|Karnataka|Gujarat|Rajasthan|Haryana|Bengal|Tamil|Telangana|Andhra|Kerala|Bihar|Odisha|Punjab|Assam|Himachal|Uttarakhand|Madhya|Chhattisgarh|Jharkhand/i;

    let cityIdx = parts.length - 1;
    while (cityIdx > 1) {
      const p = parts[cityIdx];
      if (stateCountryPattern.test(p) || longStatePattern.test(p) || p.length <= 2) {
        cityIdx--;
      } else {
        break;
      }
    }

    const city = parts[Math.max(cityIdx, 1)];
    if (venue.toLowerCase() === city.toLowerCase()) return capWords(venue);

    const result = `${capWords(venue)}, ${capWords(city)}`;
    if (result.length > 32) return capWords(city);
    return result;
  }

  // 3. Two segments — if second is a state abbreviation, try keyword split on first
  if (parts.length === 2) {
    const first = parts[0];
    const second = parts[1];
    const isStateAbbrev =
      second.length <= 3 ||
      /^(UP|MH|DL|KA|GJ|RJ|HR|WB|TN|TS|AP|KL|BR|OR|PB|AS|HP|UK)$/i.test(second);

    if (isStateAbbrev) {
      const split = splitByVenueKeyword(first);
      if (split) return split;
      return capWords(first);
    }

    const result = `${capWords(first)}, ${capWords(second)}`;
    if (result.length > 32) return capWords(second);
    return result;
  }

  // 4. Single segment — try keyword split
  const split = splitByVenueKeyword(parts[0]);
  return split || capWords(parts[0]);
}

/**
 * Tries to split a single-segment venue string like "India Expo Mart Greater Noida"
 * into "India Expo Mart, Greater Noida" using venue-type keywords.
 */
function splitByVenueKeyword(segment: string): string | null {
  const capWords = (arr: string[]) =>
    arr
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const venueKeywords = [
    "expo", "mart", "ground", "hall", "center", "centre",
    "complex", "arena", "stadium", "palace", "garden",
  ];

  const words = segment.split(" ").filter(Boolean);
  let venue: string[] = [];
  let city: string[] = [];

  words.forEach((word, i) => {
    if (venueKeywords.includes(word.toLowerCase())) {
      venue = words.slice(0, i + 1);
      city = words.slice(i + 1);
    }
  });

  if (venue.length && city.length) {
    const result = `${capWords(venue)}, ${capWords(city)}`;
    if (result.length > 32) return capWords(city);
    return result;
  }
  return null;
}

/** Parse roleConfigs JSON and sum all slot counts */
function getTotalSlots(eventRoleConfigs: string | null | undefined, fallbackSlots: number | null | undefined): number | null {
  if (eventRoleConfigs) {
    try {
      const configs: any[] = typeof eventRoleConfigs === "string"
        ? JSON.parse(eventRoleConfigs)
        : eventRoleConfigs;
      const sum = configs.reduce((acc, c) => acc + (parseInt(c.slots) || 0), 0);
      if (sum > 0) return sum;
    } catch {}
  }
  return fallbackSlots ?? null;
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
          <p className="text-red-800 max-w-md">
            Your account is restricted. You cannot browse or apply for new events.
            Contact support at{" "}
            <a href="mailto:info@goteamcrew.in" className="underline font-medium">
              info@goteamcrew.in
            </a>{" "}
            if you believe this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const openShifts = (shifts?.filter((s) => {
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
                w.OneSignalDeferred.push(async function (OneSignal: any) {
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

            const totalSlots = getTotalSlots(s.eventRoleConfigs, s.spotsTotal);

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
                {/* Banner — image if available, gradient fallback */}
                <div className="relative overflow-hidden rounded-t-2xl">
                  {s.eventImage ? (
                    <SmartBannerImage src={s.eventImage} alt={shift.eventTitle} />
                  ) : (
                    <div className={`w-full h-44 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                      <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
                      <div className="absolute -bottom-6 -left-4 w-28 h-28 rounded-full bg-white/10" />
                      <span className="relative z-10 text-4xl font-black text-white/40 select-none tracking-tight">
                        {initials}
                      </span>
                    </div>
                  )}

                  {/* Not eligible ribbon */}
                  {!eligible && (
                    <div className="absolute top-2.5 left-3 z-30 bg-white/90 backdrop-blur-sm text-violet-700 text-[10px] font-bold px-2.5 py-1 rounded-full">
                      {getGenderLabel(gender)}
                    </div>
                  )}

                  {/* Multi-day pill */}
                  {eventDays > 1 && (
                    <div className="absolute top-2.5 right-3 z-30 bg-black/40 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
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
                  {location && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="line-clamp-1">{location}</span>
                    </div>
                  )}

                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 font-medium">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span>{dateLabel}</span>
                  </div>

                  {/* Badges row */}
                  {(referralReward && referralReward > 0 && referralOpen) || totalSlots ? (
                    <div className="mt-auto pt-1 flex flex-wrap gap-1.5">
                      {referralReward && referralReward > 0 && referralOpen && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">
                          <Gift className="w-3 h-3" />
                          ₹{referralReward.toLocaleString("en-IN")} referral
                        </span>
                      )}
                      {totalSlots && totalSlots > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                          <Users className="w-3 h-3" />
                          {totalSlots} slots
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* CTA footer */}
                <div className="px-4 pb-4">
                  <div className="pt-3 border-t border-slate-100">
                    {eligible ? (
                      <div className="flex items-center justify-center h-10 rounded-xl bg-primary text-white text-sm font-bold gap-1.5 group-hover:bg-primary/90 transition-colors">
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
