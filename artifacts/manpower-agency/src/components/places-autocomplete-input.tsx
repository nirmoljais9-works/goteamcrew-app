import { useRef, useState, useCallback, useEffect } from "react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export type PlaceResult = {
  name: string;
  lat: string;
  lng: string;
  formatted: string;
};

type Prediction = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

type Props = {
  defaultValue?: string;
  onPlaceSelected: (place: PlaceResult) => void;
  onInputChange?: (value: string, isFromPlaceSelection?: boolean) => void;
  placeholder?: string;
  className?: string;
};

export function PlacesAutocompleteInput({
  defaultValue = "",
  onPlaceSelected,
  onInputChange,
  placeholder = "Search venue, shop, hall, restaurant…",
  className = "",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [inputValue, setInputValue] = useState(defaultValue);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndexRef = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);

  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onPlaceSelectedRef.current = onPlaceSelected;
  const onInputChangeRef = useRef(onInputChange);
  onInputChangeRef.current = onInputChange;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const fetchPredictions = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }

    // Cancel previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/places/autocomplete?q=${encodeURIComponent(query)}`,
        { signal: abortRef.current.signal, credentials: "include" }
      );
      const data = await res.json();
      const results: any[] = data.predictions || [];

      if (!results.length) {
        setPredictions([]);
        setShowDropdown(false);
        return;
      }

      setPredictions(
        results.map((r: any) => ({
          placeId: r.place_id,
          description: r.description,
          mainText: r.structured_formatting?.main_text ?? r.description,
          secondaryText: r.structured_formatting?.secondary_text ?? "",
        }))
      );
      setShowDropdown(true);
    } catch (err: any) {
      if (err.name === "AbortError") return; // cancelled — don't clear loading yet
      setPredictions([]);
      setShowDropdown(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    onInputChangeRef.current?.(val, false);

    // Detect Google Maps URL paste
    if (val.includes("google.com/maps") || val.includes("maps.google")) {
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 300);
  };

  const selectPrediction = useCallback(async (prediction: Prediction) => {
    setInputValue(prediction.description);
    setShowDropdown(false);
    setPredictions([]);

    try {
      const res = await fetch(
        `${BASE_URL}/api/places/details?place_id=${encodeURIComponent(prediction.placeId)}`,
        { credentials: "include" }
      );
      const data = await res.json();
      if (data.lat == null || data.lng == null) return;

      const formatted = data.formatted_address || data.name || prediction.description;
      setInputValue(formatted);
      onInputChangeRef.current?.(formatted, true);
      onPlaceSelectedRef.current({
        name: data.name || formatted,
        lat: String(data.lat),
        lng: String(data.lng),
        formatted,
      });
    } catch {
      // details failed — keep typed text, no coords
    }
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => {
          if (predictions.length > 0) setShowDropdown(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
      />

      {showDropdown && predictions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          {predictions.map((p, i) => (
            <button
              key={p.placeId}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectPrediction(p)}
              onTouchEnd={(e) => {
                e.preventDefault();
                selectPrediction(p);
              }}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0 ${
                i === activeIndexRef.current ? "bg-muted" : ""
              }`}
            >
              <svg
                className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{p.mainText}</p>
                {p.secondaryText && (
                  <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                )}
              </div>
            </button>
          ))}
          <div className="px-3 py-1 flex justify-end bg-muted/20">
            <span className="text-[10px] text-muted-foreground">powered by Google</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
