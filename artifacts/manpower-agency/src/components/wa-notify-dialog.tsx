import { MessageCircle, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface WaNotifyDialogProps {
  waUrl: string | null;
  name: string;
  action: "approve" | "reject";
  onSend: () => void;
  onSkip: () => void;
}

export function WaNotifyDialog({ waUrl, name, action, onSend, onSkip }: WaNotifyDialogProps) {
  return (
    <Dialog open={!!waUrl} onOpenChange={(open) => { if (!open) onSkip(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#25D366]/15 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4 text-[#25D366]" />
            </div>
            Send WhatsApp notification?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground px-1">
          {action === "approve"
            ? `Notify ${name} that their profile has been approved and they can now log in.`
            : `Notify ${name} that their profile was not approved, with a link to update and reapply.`}
        </p>
        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto gap-2 order-2 sm:order-1"
            onClick={onSkip}
          >
            <X className="w-3.5 h-3.5" /> Skip
          </Button>
          <Button
            className="w-full sm:w-auto gap-2 order-1 sm:order-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white"
            onClick={onSend}
          >
            <MessageCircle className="w-4 h-4" /> Send WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
