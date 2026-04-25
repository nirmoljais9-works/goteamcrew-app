import { useGetShifts, useGetCrewProfile } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format, differenceInCalendarDays } from "date-fns";
import { MapPin, CalendarDays, ShieldX, Timer, Gift, Zap } from "lucide-react";
import { motion } from "framer-motion";

function isGenderEligible(
  profileGender: string | null | undefined,
  eventGenderRequired: string | null | undefined,
): boolean {
  if (!eventGenderRequired || eventGenderRequired === "both" || eventGenderRequired === "any") return true;
  if (!profileGender) return true;
  return profileGender.toLowerCase() === eventGenderRequired.toLowerCase();
}

/** Extract just the city from a location string.
 *  Handles two formats:
 *    "Greater Noida – India Expo Mart, …"  → "Greater Noida"
 *    "India Expo Mart, Knowledge Park, Greater Noida, UP, India" → "Greater Noida"
 */
function extractCity(loc: string | null | undefined): string {
  if (!loc || loc.trim() === "" || loc === "TBD") return "Location TBD";

  // Format stored as "City – Venue" by the admin form
  if (loc.includes(" – ")) return loc.split(" – ")[0].trim();
  if (loc.includes(" - "))  return loc.split(" - ")[0].trim();

  // Google Maps full address: "Venue, Area, City, State, Country"
  // City is typically the 2nd-to-last meaningful segment
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[0];

  return loc.length > 28 ? loc.slice(0, 26) + "…" : loc;
}

export default function BrowseShifts() {
  const { data: shifts, isLoading } = useGetShifts({
    status: "open",
    query: { refetchInterval: 30_000 },
  } as any);
  const { data: profile } = useGetCrewProfile();
  const [, navigate] = useLocation();

  if (isLoading)
    return <div className="p-8 text-center text-muted-foreground">Loading shifts…</div>;

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
            Your account is restricted. You cannot browse or apply for new events. Contact support at{" "}
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
  const openShifts = (
    shifts?.filter((s) => {
      if (s.status !== "open" || s.claimedByMe) return false;
      const eventStart = (s as any).eventStartDate || s.startTime;
      if (eventStart && new Date(eventStart) <= now) return false;
      return true;
    }) || []
  ) as any[];

  const isApproved = p?.status === "approved";
  const profileGender = (p?.gender || "").toLowerCase() || null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Browse Events</h1>
        <p className="text-muted-foreground mt-2">Find and apply for available work opportunities.</p>
      </div>

      {!isApproved && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm font-medium flex items-start gap-3">
          <Timer className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            You can browse shifts but cannot apply until your profile is approved by an administrator.
          </span>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {openShifts.map((shift, i) => {
            const s = shift as any;
            const gender = s.eventGenderRequired || s.genderPreference || null;
            const genderBoth =
              !gender || gender === "both" || gender === "Both" || gender === "any";
            const eligible = isGenderEligible(profileGender, gender);

            const spotsLeft = Math.max(0, (shift.spotsTotal || 0) - (shift.spotsFilled || 0));
            const isFull = spotsLeft <= 0;
            const isUrgent = !isFull && spotsLeft <= 3;

            const referralReward = s.eventReferralReward
              ? parseFloat(s.eventReferralReward)
              : null;
            const eventStart = s.eventStartDate || shift.startTime;
            const referralOpen = eventStart ? new Date() < new Date(eventStart) : true;

            // City only
            const city = extractCity(s.eventLocation || shift.eventLocation);

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
              return format(new Date(shift.startTime), "EEE, d MMM");
            })();

            const eventDays = (() => {
              if (s.eventStartDate && s.eventEndDate) {
                return (
                  differenceInCalendarDays(
                    new Date(s.eventEndDate),
                    new Date(s.eventStartDate),
                  ) + 1
                );
              }
              return 1;
            })();

            return (
              <motion.div
                key={shift.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => navigate(`/shifts/${shift.id}`)}
                className="group bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden"
              >
                {/* Top colour accent */}
                <div className="h-1 bg-gradient-to-r from-primary via-violet-500 to-indigo-400" />

                <div className="p-5 flex flex-col gap-4">
                  {/* Badges row — only urgency / gender restriction */}
                  {(isUrgent || !genderBoth || (referralReward && referralReward > 0 && !eligible && referralOpen)) && (
                    <div className="flex flex-wrap gap-1.5">
                      {isUrgent && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <Zap className="w-3 h-3" /> Filling fast
                        </span>
                      )}
                      {!genderBoth && gender && (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700">
                          {gender.toLowerCase() === "male"
                            ? "🚹 Male Only"
                            : gender.toLowerCase() === "female"
                            ? "♀ Female Only"
                            : `${gender} Only`}
                        </span>
                      )}
                      {referralReward && referralReward > 0 && !eligible && referralOpen && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">
                          <Gift className="w-3 h-3" />
                          Refer ₹{referralReward.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Event title */}
                  <h3 className="text-[17px] font-bold text-foreground leading-snug line-clamp-2">
                    {shift.eventTitle}
                  </h3>

                  {/* City + date */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="font-medium">{city}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span>{dateLabel}</span>
                      {eventDays > 1 && (
                        <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                          {eventDays}d
                        </span>
                      )}
                    </div>
                  </div>

                  {/* CTA button */}
                  {eligible ? (
                    isFull ? (
                      <div className="flex items-center justify-center h-10 rounded-xl bg-slate-100 text-slate-400 text-sm font-semibold">
                        All Slots Filled
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1 h-10 rounded-xl bg-primary text-white text-sm font-bold group-hover:bg-primary/90 transition-colors">
                        Apply Now
                        <span className="group-hover:translate-x-0.5 transition-transform duration-150">→</span>
                      </div>
                    )
                  ) : referralOpen ? (
                    <div className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-semibold">
                      <Gift className="w-4 h-4" /> Refer &amp; Earn
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-10 rounded-xl bg-slate-100 text-slate-400 text-sm font-semibold">
                      Not Eligible
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
