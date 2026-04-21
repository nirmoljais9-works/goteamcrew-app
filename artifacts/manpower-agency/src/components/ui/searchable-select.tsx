import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchableSelectProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const handleSelect = useCallback((option: string) => {
    onChange(option);
    setOpen(false);
    setQuery("");
  }, [onChange]);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
  };

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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          "w-full h-12 px-4 flex items-center justify-between rounded-md border border-input bg-muted/50 text-sm transition-colors",
          "hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30",
          open && "border-primary ring-2 ring-primary/30",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
          value ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 ml-2 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg",
            "animate-in fade-in-0 slide-in-from-top-2 duration-150"
          )}
        >
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/60 border border-border/50">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            className="max-h-52 overflow-y-auto overscroll-contain py-1"
            style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            {filtered.length > 0 ? (
              filtered.map(option => (
                <li key={option}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); handleSelect(option); }}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors",
                      "hover:bg-primary/10 hover:text-primary",
                      value === option && "bg-primary/10 text-primary font-medium"
                    )}
                  >
                    <span>{option}</span>
                    {value === option && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-muted-foreground text-center">
                No results found
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
