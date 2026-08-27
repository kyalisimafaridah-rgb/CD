import { useState } from "react";
import { WifiOff, RefreshCw, AlertTriangle, X, Loader2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOutbox } from "@/hooks/useOutbox";
import { useAuth } from "@/_core/hooks/useAuth";
import { retryItem, discardItem } from "@/lib/syncEngine";

/**
 * Fixed banner shown whenever there's something the user should know:
 *  - offline right now (grey)
 *  - items queued and syncing (blue)
 *  - items queued by a different staff member on this shared device,
 *    waiting for them to sign back in before they'll sync (slate) — this
 *    is deliberate, not stuck: syncing under the wrong session would
 *    misattribute the write in the activity log
 *  - items that need a human decision because the server rejected them —
 *    e.g. someone else took the appointment slot, or drug stock ran out
 *    (amber, with a tap-through panel to resolve each one)
 *
 * Mount this once near the top of the app shell.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const { user } = useAuth();
  const { pending, needsReview } = useOutbox();
  const [panelOpen, setPanelOpen] = useState(false);

  const blockedByOtherUser = pending.filter((i) => user && i.queuedByUserId !== user.id);
  const ownPending = pending.filter((i) => !user || i.queuedByUserId === user.id);

  if (isOnline && pending.length === 0 && needsReview.length === 0) return null;

  return (
    <>
      <div
        className={`w-full px-4 py-2 text-sm flex items-center justify-between gap-2 ${
          needsReview.length > 0
            ? "bg-amber-100 text-amber-900"
            : !isOnline
            ? "bg-slate-200 text-slate-700"
            : "bg-blue-100 text-blue-900"
        }`}
      >
        <div className="flex items-center gap-2">
          {!isOnline ? (
            <>
              <WifiOff className="w-4 h-4" />
              <span>You're offline — changes are being saved on this device.</span>
            </>
          ) : needsReview.length > 0 ? (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>{needsReview.length} item{needsReview.length > 1 ? "s" : ""} need your review before syncing.</span>
            </>
          ) : ownPending.length === 0 && blockedByOtherUser.length > 0 ? (
            <>
              <UserX className="w-4 h-4" />
              <span>{blockedByOtherUser.length} item{blockedByOtherUser.length > 1 ? "s" : ""} waiting for a colleague to sign back in.</span>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Syncing {ownPending.length} change{ownPending.length > 1 ? "s" : ""}...</span>
            </>
          )}
        </div>
        {(pending.length > 0 || needsReview.length > 0) && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPanelOpen(true)}>
            {pending.length + needsReview.length} pending
          </Button>
        )}
      </div>

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sync status</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {needsReview.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-700">Needs review</p>
                {needsReview.map((item) => (
                  <div key={item.id} className="border border-amber-200 bg-amber-50 rounded-md p-3 text-sm">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-amber-700 text-xs mt-1">{item.lastError}</div>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" variant="outline" onClick={() => retryItem(item.id)}>
                        <RefreshCw className="w-3 h-3 mr-1" /> Retry
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => discardItem(item.id)}>
                        <X className="w-3 h-3 mr-1" /> Discard
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ownPending.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-600">Waiting to sync</p>
                {ownPending.map((item) => (
                  <div key={item.id} className="border rounded-md p-3 text-sm flex items-center justify-between">
                    <span>{item.label}</span>
                    <Badge variant="secondary">{item.status === "syncing" ? "Syncing…" : "Queued"}</Badge>
                  </div>
                ))}
              </div>
            )}
            {blockedByOtherUser.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-600">Queued by a colleague</p>
                {blockedByOtherUser.map((item) => (
                  <div key={item.id} className="border rounded-md p-3 text-sm flex items-center justify-between">
                    <div>
                      <div>{item.label}</div>
                      <div className="text-xs text-slate-500">By {item.queuedByUserName} — will sync once they sign back in on this device</div>
                    </div>
                    <Badge variant="outline">Waiting</Badge>
                  </div>
                ))}
              </div>
            )}
            {pending.length === 0 && needsReview.length === 0 && (
              <p className="text-sm text-slate-500">Nothing pending — everything's synced.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
