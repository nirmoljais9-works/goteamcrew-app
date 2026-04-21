import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Country {
  name: string;
  code: string;
  dial: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: "India",                        code: "IN",  dial: "+91",   flag: "🇮🇳" },
  { name: "UAE",                          code: "AE",  dial: "+971",  flag: "🇦🇪" },
  { name: "USA",                          code: "US",  dial: "+1",    flag: "🇺🇸" },
  { name: "United Kingdom",              code: "GB",  dial: "+44",   flag: "🇬🇧" },
  { name: "Canada",                       code: "CA",  dial: "+1",    flag: "🇨🇦" },
  { name: "Australia",                    code: "AU",  dial: "+61",   flag: "🇦🇺" },
  { name: "Saudi Arabia",                code: "SA",  dial: "+966",  flag: "🇸🇦" },
  { name: "Qatar",                        code: "QA",  dial: "+974",  flag: "🇶🇦" },
  { name: "Kuwait",                       code: "KW",  dial: "+965",  flag: "🇰🇼" },
  { name: "Bahrain",                      code: "BH",  dial: "+973",  flag: "🇧🇭" },
  { name: "Oman",                         code: "OM",  dial: "+968",  flag: "🇴🇲" },
  { name: "Singapore",                    code: "SG",  dial: "+65",   flag: "🇸🇬" },
  { name: "Malaysia",                     code: "MY",  dial: "+60",   flag: "🇲🇾" },
  { name: "New Zealand",                 code: "NZ",  dial: "+64",   flag: "🇳🇿" },
  { name: "Germany",                      code: "DE",  dial: "+49",   flag: "🇩🇪" },
  { name: "France",                       code: "FR",  dial: "+33",   flag: "🇫🇷" },
  { name: "Netherlands",                 code: "NL",  dial: "+31",   flag: "🇳🇱" },
  { name: "Italy",                        code: "IT",  dial: "+39",   flag: "🇮🇹" },
  { name: "Spain",                        code: "ES",  dial: "+34",   flag: "🇪🇸" },
  { name: "Sweden",                       code: "SE",  dial: "+46",   flag: "🇸🇪" },
  { name: "Norway",                       code: "NO",  dial: "+47",   flag: "🇳🇴" },
  { name: "Denmark",                      code: "DK",  dial: "+45",   flag: "🇩🇰" },
  { name: "Switzerland",                 code: "CH",  dial: "+41",   flag: "🇨🇭" },
  { name: "Japan",                        code: "JP",  dial: "+81",   flag: "🇯🇵" },
  { name: "South Korea",                 code: "KR",  dial: "+82",   flag: "🇰🇷" },
  { name: "China",                        code: "CN",  dial: "+86",   flag: "🇨🇳" },
  { name: "Hong Kong",                   code: "HK",  dial: "+852",  flag: "🇭🇰" },
  { name: "Nepal",                        code: "NP",  dial: "+977",  flag: "🇳🇵" },
  { name: "Bangladesh",                   code: "BD",  dial: "+880",  flag: "🇧🇩" },
  { name: "Sri Lanka",                   code: "LK",  dial: "+94",   flag: "🇱🇰" },
  { name: "Pakistan",                     code: "PK",  dial: "+92",   flag: "🇵🇰" },
  { name: "South Africa",               code: "ZA",  dial: "+27",   flag: "🇿🇦" },
  { name: "Nigeria",                      code: "NG",  dial: "+234",  flag: "🇳🇬" },
  { name: "Kenya",                        code: "KE",  dial: "+254",  flag: "🇰🇪" },
  { name: "Brazil",                       code: "BR",  dial: "+55",   flag: "🇧🇷" },
  { name: "Mexico",                       code: "MX",  dial: "+52",   flag: "🇲🇽" },
  { name: "Indonesia",                    code: "ID",  dial: "+62",   flag: "🇮🇩" },
  { name: "Philippines",                 code: "PH",  dial: "+63",   flag: "🇵🇭" },
  { name: "Thailand",                     code: "TH",  dial: "+66",   flag: "🇹🇭" },
  { name: "Vietnam",                      code: "VN",  dial: "+84",   flag: "🇻🇳" },
  { name: "Mauritius",                    code: "MU",  dial: "+230",  flag: "🇲🇺" },
  { name: "Ireland",                      code: "IE",  dial: "+353",  flag: "🇮🇪" },
  { name: "Portugal",                     code: "PT",  dial: "+351",  flag: "🇵🇹" },
  { name: "Russia",                       code: "RU",  dial: "+7",    flag: "🇷🇺" },
  { name: "Turkey",                       code: "TR",  dial: "+90",   flag: "🇹🇷" },
  { name: "Israel",                       code: "IL",  dial: "+972",  flag: "🇮🇱" },
  { name: "Jordan",                       code: "JO",  dial: "+962",  flag: "🇯🇴" },
  { name: "Egypt",                        code: "EG",  dial: "+20",   flag: "🇪🇬" },
];

function validatePhone(number: string, country: Country): string {
  const digits = number.replace(/\D/g, "");
  if (!digits) return "Phone number is required";
  if (country.code === "IN") {
    if (digits.length !== 10) return "Enter valid 10-digit mobile number";
    if (!/^[6-9]/.test(digits)) return "Enter valid 10-digit mobile number";
  } else {
    if (digits.length < 6 || digits.length > 15) return "Enter valid phone number";
  }
  return "";
}

interface PhoneInputProps {
  value: string;
  onChange: (fullNumber: string) => void;
  error?: string;
  onValidationError?: (err: string) => void;
}

export function PhoneInput({ value, onChange, onValidationError }: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.dial.includes(query)
      )
    : COUNTRIES;

  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setOpen(false);
    setQuery("");
    const err = validatePhone(phoneNumber, country);
    onValidationError?.(err);
    if (!err && phoneNumber) {
      onChange(`${country.dial}${phoneNumber.replace(/\D/g, "")}`);
    } else {
      onChange("");
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    const maxLen = selectedCountry.code === "IN" ? 10 : 15;
    const trimmed = raw.slice(0, maxLen);
    setPhoneNumber(trimmed);
    const err = validatePhone(trimmed, selectedCountry);
    onValidationError?.(err);
    if (!err) {
      onChange(`${selectedCountry.dial}${trimmed}`);
    } else {
      onChange("");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Unified field container */}
      <div className={cn(
        "flex h-12 rounded-md border border-input bg-muted/50 overflow-hidden transition-colors",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30",
        open && "border-primary ring-2 ring-primary/30"
      )}>
        {/* Country selector button */}
        <button
          type="button"
          onClick={() => setOpen(prev => !prev)}
          className="flex items-center gap-1.5 px-3 border-r border-input bg-muted/30 hover:bg-muted/60 transition-colors shrink-0 min-w-[90px]"
        >
          <span className="text-lg leading-none">{selectedCountry.flag}</span>
          <span className="text-sm font-medium text-foreground">{selectedCountry.dial}</span>
          <ChevronDown className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
            open && "rotate-180"
          )} />
        </button>

        {/* Phone number input */}
        <input
          type="tel"
          value={phoneNumber}
          onChange={handlePhoneChange}
          placeholder="Enter phone number"
          className="flex-1 px-3 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
          inputMode="numeric"
        />
      </div>

      {/* Country dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg animate-in fade-in-0 slide-in-from-top-2 duration-150">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border/50">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search country..."
                className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          {/* List */}
          <ul
            className="max-h-52 overflow-y-auto overscroll-contain py-1"
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {filtered.length > 0 ? filtered.map(country => (
              <li key={`${country.code}-${country.dial}`}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); handleCountrySelect(country); }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors",
                    "hover:bg-primary/10 hover:text-primary",
                    selectedCountry.code === country.code && selectedCountry.dial === country.dial
                      ? "bg-primary/10 text-primary font-medium"
                      : ""
                  )}
                >
                  <span className="text-base leading-none">{country.flag}</span>
                  <span className="flex-1">{country.name}</span>
                  <span className="text-muted-foreground text-xs font-mono">{country.dial}</span>
                </button>
              </li>
            )) : (
              <li className="px-4 py-3 text-sm text-muted-foreground text-center">No results found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
