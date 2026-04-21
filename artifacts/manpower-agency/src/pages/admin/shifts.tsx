import { useGetShifts, useCreateShift, useDeleteShift, useGetEvents } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Plus, Trash2, Clock, ToggleLeft, ToggleRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

const ROLES = [
  "Model",
  "Emcee/Anchor",
  "Host/Promoter/Usher",
  "Supervisor",
  "Volunteer",
  "Other",
];

const formSchema = z.object({
  eventId: z.coerce.number().min(1, "Select an event"),
  role: z.string().min(1, "Required"),
  customRole: z.string().optional(),
  spotsTotal: z.coerce.number().min(1, "Required"),
  genderPreference: z.string().optional(),
  experienceRequired: z.string().optional(),
  startTime: z.string().min(1, "Required"),
  endTime: z.string().min(1, "Required"),
  payPerShift: z.coerce.number().min(0, "Required"),
  paymentType: z.string().optional(),
  dressCode: z.string().optional(),
  groomingInstructions: z.string().optional(),
  requirements: z.string().optional(),
  applicationsOpen: z.boolean().default(true),
}).refine(
  (d) => d.role !== "Other" || (d.customRole && d.customRole.trim().length > 0),
  { message: "Please specify the role", path: ["customRole"] }
);

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-2 pb-1 border-b border-border/60 mb-3">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</p>
    </div>
  );
}

export default function AdminShifts() {
  const { data: shifts, isLoading: sLoading } = useGetShifts();
  const { data: events, isLoading: eLoading } = useGetEvents();
  const createMutation = useCreateShift();
  const deleteMutation = useDeleteShift();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/shifts/${id}/toggle-applications`, {
        method: "PATCH",
        credentials: "include",
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/shifts`] }),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      role: "", customRole: "", spotsTotal: 1, startTime: "", endTime: "",
      payPerShift: 0, applicationsOpen: true,
    }
  });

  const startTime = form.watch("startTime");
  const endTime = form.watch("endTime");
  const selectedRole = form.watch("role");

  const getDuration = () => {
    if (!startTime || !endTime) return null;
    const diff = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (diff <= 0) return null;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  const duration = getDuration();

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const finalRole = values.role === "Other" ? (values.customRole || "").trim() : values.role;
    const payload = {
      ...values,
      role: finalRole,
      startTime: new Date(values.startTime).toISOString(),
      endTime: new Date(values.endTime).toISOString(),
    };
    createMutation.mutate({ data: payload as any }, {
      onSuccess: () => {
        toast({ title: "Shift created" });
        setOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: [`/api/shifts`] });
      },
      onError: () => toast({ variant: "destructive", title: "Failed to create shift" }),
    });
  };

  const handleDelete = (id: number) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId === null) return;
    deleteMutation.mutate({ id: deleteId }, {
      onSuccess: () => {
        toast({ title: "Shift deleted" });
        setDeleteId(null);
        queryClient.invalidateQueries({ queryKey: [`/api/shifts`] });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Failed to delete shift" });
        setDeleteId(null);
      },
    });
  };

  if (sLoading) return <div className="p-8 text-center">Loading shifts...</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Shift Management</h1>
          <p className="text-muted-foreground mt-1">Create roles and assign capacity for events.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl h-12 shadow-md">
              <Plus className="w-5 h-5 mr-2" /> Add Shift
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl rounded-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Create Shift</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">

                <SectionHeading>Event</SectionHeading>
                <FormField control={form.control} name="eventId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Event</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value?.toString()}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Choose an event..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        {events?.map(e => (
                          <SelectItem key={e.id} value={e.id.toString()}>
                            {e.title} — {e.city || (e as any).location} ({format(new Date(e.startDate), "MMM d")})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <SectionHeading>Job Details</SectionHeading>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <FormField control={form.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role Required</FormLabel>
                        <Select onValueChange={(val) => { field.onChange(val); if (val !== "Other") form.setValue("customRole", ""); }} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {selectedRole === "Other" && (
                      <FormField control={form.control} name="customRole" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Please specify role</FormLabel>
                          <FormControl><Input placeholder="Enter role" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </div>
                  <FormField control={form.control} name="spotsTotal" render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. of People Required</FormLabel>
                      <FormControl><Input type="number" min="1" placeholder="e.g. 5" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="genderPreference" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender Preference <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="female">Female only</SelectItem>
                          <SelectItem value="male">Male only</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="experienceRequired" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Experience Required</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Any level" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="fresher">Fresher (0 exp)</SelectItem>
                          <SelectItem value="6months">6+ months</SelectItem>
                          <SelectItem value="1year">1+ year</SelectItem>
                          <SelectItem value="2years">2+ years</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <SectionHeading>Timing</SectionHeading>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="startTime" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date & Time</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="endTime" render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date & Time</FormLabel>
                      <FormControl><Input type="datetime-local" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                {duration && (
                  <div className="flex items-center gap-2 text-sm text-primary font-medium bg-primary/5 rounded-lg px-4 py-2">
                    <Clock className="w-4 h-4" /> Total Duration: {duration}
                  </div>
                )}

                <SectionHeading>Payment</SectionHeading>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="payPerShift" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pay Per Shift (₹)</FormLabel>
                      <FormControl><Input type="number" min="0" step="50" placeholder="e.g. 1500" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="paymentType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Timeline</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="same_day">Same Day</SelectItem>
                          <SelectItem value="7_days">Within 7 Days</SelectItem>
                          <SelectItem value="15_days">Within 15 Days</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <SectionHeading>Requirements & Appearance</SectionHeading>
                <FormField control={form.control} name="dressCode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dress Code</FormLabel>
                    <FormControl><Input placeholder="e.g. All black formals, no sneakers" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="groomingInstructions" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grooming Instructions</FormLabel>
                    <FormControl><Input placeholder="e.g. Hair tied, minimal makeup, no visible tattoos" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="requirements" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Skills / Additional Requirements</FormLabel>
                    <FormControl><Textarea rows={2} placeholder="e.g. Fluent English, comfortable with crowds, knows basic bartending..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <SectionHeading>Applications</SectionHeading>
                <FormField control={form.control} name="applicationsOpen" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <div>
                        <FormLabel>Accept Applications</FormLabel>
                        <p className="text-xs text-muted-foreground mt-0.5">Crew can apply when this is ON</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                          field.value
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {field.value ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        {field.value ? "Open" : "Closed"}
                      </button>
                    </div>
                  </FormItem>
                )} />

                <Button type="submit" className="w-full h-12 mt-2" disabled={createMutation.isPending || eLoading}>
                  {createMutation.isPending ? "Creating..." : "Save Shift"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card rounded-2xl border border-border/60 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border/60 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="p-4 pl-6">Role & Event</th>
              <th className="p-4">Time</th>
              <th className="p-4">Pay & Spots</th>
              <th className="p-4">Status</th>
              <th className="p-4">Apps</th>
              <th className="p-4 pr-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {shifts?.map((shift: any) => (
              <tr key={shift.id} className="hover:bg-muted/20">
                <td className="p-4 pl-6">
                  <div className="font-bold text-foreground text-base">{shift.role}</div>
                  <div className="text-sm text-muted-foreground max-w-[200px] truncate">{shift.eventTitle}</div>
                  {shift.genderPreference && shift.genderPreference !== "any" && (
                    <div className="text-xs text-muted-foreground mt-0.5 capitalize">{shift.genderPreference} only</div>
                  )}
                </td>
                <td className="p-4 text-sm text-muted-foreground whitespace-nowrap">
                  <div>{format(new Date(shift.startTime), "MMM d, yyyy")}</div>
                  <div className="text-xs">{format(new Date(shift.startTime), "h:mm a")} – {format(new Date(shift.endTime), "h:mm a")}</div>
                </td>
                <td className="p-4 text-sm">
                  <div className="font-semibold text-foreground">₹{shift.totalPay.toFixed(0)}</div>
                  <div className="text-xs text-muted-foreground">{shift.spotsFilled}/{shift.spotsTotal} filled</div>
                </td>
                <td className="p-4">
                  <StatusBadge status={shift.status} />
                </td>
                <td className="p-4">
                  <button
                    onClick={() => toggleMutation.mutate(shift.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                      shift.applicationsOpen !== false
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {shift.applicationsOpen !== false ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {shift.applicationsOpen !== false ? "Open" : "Closed"}
                  </button>
                </td>
                <td className="p-4 pr-6 text-right">
                  <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-700 hover:bg-rose-50" onClick={() => handleDelete(shift.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {(!shifts || shifts.length === 0) && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No shifts found. Create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the shift and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
