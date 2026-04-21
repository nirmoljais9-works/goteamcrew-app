import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variants: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200",
    approved: "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200",
    rejected: "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200",
    revoked: "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200",
    active: "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200",
    upcoming: "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200",
    ongoing: "bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-200",
    completed: "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200",
    cancelled: "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200",
    open: "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200",
    claimed: "bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200",
    processing: "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200",
    paid: "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200",
    failed: "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-200",
  };

  const variantClass = variants[status.toLowerCase()] || "bg-slate-100 text-slate-800 border-slate-200";

  return (
    <Badge variant="outline" className={`capitalize font-medium px-2.5 py-0.5 shadow-sm ${variantClass}`}>
      {status}
    </Badge>
  );
}
