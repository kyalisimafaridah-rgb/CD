import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { mutationErrorToast } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { Download, Zap, CheckCircle, Lock, Loader2, KeyRound, Smartphone } from "lucide-react";
import { TIER_FEATURES, TIER_LABELS, type SubscriptionTier } from "@shared/tiers";
import { exportCsv } from "@/lib/csv";

const SMS_STATUS_COLORS: Record<string, string> = {
  sent: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-muted text-muted-foreground",
};

const TIER_COLORS: Record<SubscriptionTier, string> = {
  free: "bg-muted text-muted-foreground",
  clinic: "bg-blue-100 text-blue-700",
  pro: "bg-purple-100 text-purple-700",
};

function SubscriptionCard() {
  const utils = trpc.useUtils();
  const { data: tierStatus, isLoading } = trpc.clinic.getTierStatus.useQuery();
  const { data: clinicInfo } = trpc.clinic.get.useQuery();
  const [activationCode, setActivationCode] = useState("");
  const [payForm, setPayForm] = useState({
    tier: "clinic" as "clinic" | "pro",
    durationMonths: 1,
    mtnTransactionId: "",
  });
  const { data: myRequests, refetch: refetchRequests } = trpc.clinic.listMyPaymentRequests.useQuery();
  const requestPayMutation = trpc.clinic.requestSubscriptionPayment.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setPayForm((f) => ({ ...f, mtnTransactionId: "" }));
      refetchRequests();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelRequestMutation = trpc.clinic.cancelMyPaymentRequest.useMutation({
    onSuccess: () => { toast.success("Request cancelled"); refetchRequests(); },
    onError: (e) => toast.error(e.message),
  });
  const redeemMutation = trpc.clinic.redeemActivationCode.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Activated ${data.tier} plan until ${new Date(data.appliedUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
      );
      setActivationCode("");
      utils.clinic.getTierStatus.invalidate();
      refetchRequests();
    },
    onError: (e) => toast.error(e.message),
  });
  const expectedAmount =
    (payForm.tier === "pro" ? 180000 : 90000) * payForm.durationMonths;
  const pendingRequest = myRequests?.find((r) => r.status === "pending");
  const checkoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e) => toast.error(e.message),
  });
  const portalMutation = trpc.clinic.getBillingPortalUrl.useMutation({
    onSuccess: ({ url }) => { window.open(url, "_blank"); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return null;
  if (!tierStatus) return null;

  const { tier, limits, usage } = tierStatus;
  const renewsAt = tierStatus.subscriptionRenewsAt ? new Date(tierStatus.subscriptionRenewsAt) : null;
  const warning = (tierStatus as any).warning as string | null | undefined;
  const paidActive = (tierStatus as any).paidPeriodActive as boolean | undefined;
  const isManager = true; // Settings page is already manager-gated

  const patientPct = limits.maxPatientsPerMonth
    ? Math.min(100, Math.round((usage.patientsThisMonth / limits.maxPatientsPerMonth) * 100))
    : null;

  const visitPct = limits.maxVisitsPerMonth
    ? Math.min(100, Math.round((usage.visitsThisMonth / limits.maxVisitsPerMonth) * 100))
    : null;

  const staffPct = limits.maxStaff
    ? Math.min(100, Math.round((usage.activeStaff / limits.maxStaff) * 100))
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Your current plan and usage</CardDescription>
          </div>
          <Badge className={TIER_COLORS[tier as SubscriptionTier]}>
            {TIER_LABELS[tier as SubscriptionTier]} Plan
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Usage bars */}
        {patientPct !== null && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Patients this month</span>
              <span className={`font-medium ${patientPct >= 90 ? "text-red-600" : "text-muted-foreground"}`}>
                {usage.patientsThisMonth} / {limits.maxPatientsPerMonth}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${patientPct >= 90 ? "bg-red-500" : patientPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${patientPct}%` }}
              />
            </div>
            {patientPct >= 90 && (
              <p className="text-xs text-red-600 mt-1">Approaching limit — upgrade to register unlimited patients</p>
            )}
          </div>
        )}

        {visitPct !== null && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Visits this month</span>
              <span className={`font-medium ${visitPct >= 90 ? "text-red-600" : "text-muted-foreground"}`}>
                {usage.visitsThisMonth} / {limits.maxVisitsPerMonth}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${visitPct >= 90 ? "bg-red-500" : visitPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${visitPct}%` }}
              />
            </div>
            {visitPct >= 90 && (
              <p className="text-xs text-red-600 mt-1">Approaching limit — upgrade for unlimited visits</p>
            )}
          </div>
        )}

        {staffPct !== null && (
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Staff members</span>
              <span className={`font-medium ${staffPct >= 100 ? "text-red-600" : "text-muted-foreground"}`}>
                {usage.activeStaff} / {limits.maxStaff}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${staffPct >= 100 ? "bg-red-500" : staffPct >= 70 ? "bg-yellow-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(staffPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {renewsAt && paidActive && (
          <p className={`text-xs ${warning === "subscription_ending" ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
            Paid until {renewsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            {warning === "subscription_ending" ? " — renew soon to keep this plan" : ""}
          </p>
        )}
        {warning === "subscription_expired" && (
          <p className="text-xs text-red-700 font-medium">
            Your paid period has ended. You are on the Free plan until you pay again.
          </p>
        )}

        {/* What's included in current plan */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">What's included:</p>
          <ul className="space-y-1">
            {TIER_FEATURES[tier as SubscriptionTier].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Self-service MTN MoMo */}
        <div className="border-t pt-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-green-600" />
              Upgrade with MTN Mobile Money
            </p>
            <ol className="mt-2 text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Choose your plan and months below.</li>
              <li>Send the exact amount via MTN MoMo to the CareDesk number (ask support if needed).</li>
              <li>For the MoMo <strong>reason / reference</strong>, type your clinic name <strong>exactly</strong> as registered in CareDesk (shown below).</li>
              <li>Submit this form — we match the payment to your clinic and activate your plan.</li>
            </ol>
            {clinicInfo?.name && (
              <div className="mt-3 rounded-md border border-green-200 bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Use this as MoMo reason</p>
                <p className="font-semibold text-green-800 text-sm break-all">{clinicInfo.name}</p>
                <button
                  type="button"
                  className="text-[11px] text-green-700 underline mt-1"
                  onClick={() => {
                    navigator.clipboard.writeText(clinicInfo.name);
                    toast.success("Clinic name copied");
                  }}
                >
                  Copy name
                </button>
              </div>
            )}
          </div>

          {pendingRequest ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">Payment request pending</p>
              <p className="text-xs text-amber-800">
                {pendingRequest.tier} · {pendingRequest.durationMonths} month(s) · UGX {Number(pendingRequest.amountUgx).toLocaleString()} · reason: {pendingRequest.payerPhone}
              </p>
              <p className="text-xs text-amber-700">Submitted {new Date(pendingRequest.createdAt).toLocaleString()}. You will get access as soon as it is confirmed.</p>
              <Button size="sm" variant="outline" disabled={cancelRequestMutation.isPending}
                onClick={() => cancelRequestMutation.mutate({ id: pendingRequest.id })}>
                Cancel request
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border bg-green-50/40 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Plan</label>
                  <Select value={payForm.tier} onValueChange={(v) => setPayForm((f) => ({ ...f, tier: v as "clinic" | "pro" }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="clinic">Clinic — UGX 90,000/mo</SelectItem>
                      <SelectItem value="pro">Pro — UGX 180,000/mo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Months</label>
                  <Select value={String(payForm.durationMonths)} onValueChange={(v) => setPayForm((f) => ({ ...f, durationMonths: Number(v) }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 6, 12].map((m) => (
                        <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? "s" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">MTN transaction ID (optional but helps matching)</label>
                  <Input className="h-9" placeholder="If you already paid" value={payForm.mtnTransactionId}
                    onChange={(e) => setPayForm((f) => ({ ...f, mtnTransactionId: e.target.value }))} />
                </div>
              </div>
              <p className="text-sm font-semibold text-foreground">
                Amount to send: <span className="text-green-700">UGX {expectedAmount.toLocaleString()}</span>
              </p>
              <Button
                className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                disabled={requestPayMutation.isPending || !clinicInfo?.name}
                onClick={() => requestPayMutation.mutate({
                  tier: payForm.tier,
                  durationMonths: payForm.durationMonths,
                  mtnTransactionId: payForm.mtnTransactionId.trim() || undefined,
                })}
              >
                {requestPayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Submit payment request
              </Button>
            </div>
          )}

          {myRequests && myRequests.some((r) => r.status !== "pending") && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-muted-foreground">Recent requests</p>
              {myRequests.filter((r) => r.status !== "pending").slice(0, 5).map((r) => (
                <p key={r.id}>
                  {r.tier} · {r.durationMonths} mo · {r.status}
                  {r.appliedUntil ? ` · until ${new Date(r.appliedUntil).toLocaleDateString()}` : ""}
                  {r.reviewNote ? ` — ${r.reviewNote}` : ""}
                </p>
              ))}
            </div>
          )}

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-muted-foreground">Have an activation code instead?</summary>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <Input
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                placeholder="CD-CLN-XXXX-XXXX"
                className="font-mono tracking-wide h-9"
              />
              <Button
                variant="outline" className="shrink-0"
                disabled={redeemMutation.isPending || activationCode.trim().length < 8}
                onClick={() => redeemMutation.mutate({ code: activationCode.trim() })}
              >
                {redeemMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem code"}
              </Button>
            </div>
          </details>
        </div>

{tier === "clinic" && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium">Need more branches or unlimited staff?</p>
            <p className="text-xs text-muted-foreground mt-1">
              Pay for Pro (UGX 180,000/month) via MTN MoMo and redeem a Pro activation code above.
            </p>
          </div>
        )}

        {tier === "pro" && (
          <p className="text-sm text-purple-700 font-medium">✓ You're on the Pro plan — all features unlocked.</p>
        )}

        {tier !== "free" && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-muted-foreground">Manage subscription</p>
            <p className="text-xs text-muted-foreground mt-1">
              Paid via MTN MoMo activation codes. To renew or change plan, pay again and redeem a new code above.
              Contact support if you need help.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SmsLogCard() {
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const smsLogsEnabled = tierStatus?.limits?.smsLogs ?? true;
  const { data: smsLog } = trpc.clinic.getSmsLog.useQuery(undefined, { enabled: smsLogsEnabled });
  const checkoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e) => toast.error(e.message),
  });
  const handleExport = () => {
    if (!smsLog) return;
    exportCsv("sms-log.csv",
      ["Date", "Phone", "Type", "Status", "Message"],
      smsLog.map((s) => [new Date(s.createdAt).toLocaleString(), s.recipientPhone, s.messageType, s.status, s.messageContent])
    );
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div><CardTitle>SMS Delivery Log</CardTitle><CardDescription>Last 100 SMS messages sent from this clinic</CardDescription></div>
          {smsLogsEnabled && (
            <Button size="sm" variant="outline" onClick={handleExport} disabled={!smsLog?.length}>
              <Download className="w-3.5 h-3.5 mr-1" />CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {tierStatus && !smsLogsEnabled ? (
          <div className="flex flex-col items-center py-6 text-center gap-3">
            <Lock className="w-8 h-8 text-gray-300" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">SMS logs require the Clinic plan</p>
              <p className="text-xs text-muted-foreground mt-1">Track every SMS sent to patients — appointment reminders, payment receipts, and debt reminders.</p>
            </div>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 mt-1"
              disabled={checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate({ plan: "clinic" })}>
              Upgrade to Clinic — UGX 90,000/mo
            </Button>
          </div>
        ) : !smsLog || smsLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No SMS messages sent yet</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {smsLog.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-2 rounded border text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.recipientPhone}</p>
                  <p className="text-muted-foreground truncate">{s.messageContent}</p>
                  {s.failureReason && <p className="text-red-600 truncate">⚠ {s.failureReason}</p>}
                </div>
                <div className="text-right flex-shrink-0 space-y-1">
                  <Badge className={`text-xs ${SMS_STATUS_COLORS[s.status] ?? "bg-muted"}`}>{s.status}</Badge>
                  <p className="text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SENSITIVE_ACTIONS = new Set(["VOID_BILL", "UPDATE_STAFF_ROLE", "DEACTIVATE_STAFF", "DELETE_PATIENT"]);

function ActivityLogCard() {
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const activityLogEnabled = tierStatus?.limits?.activityLog ?? true;
  const { data: log } = trpc.clinic.getActivityLog.useQuery(undefined, { enabled: activityLogEnabled });
  const checkoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e) => toast.error(e.message),
  });
  const handleExport = () => {
    if (!log) return;
    exportCsv("activity-log.csv",
      ["Date", "Action", "Entity", "Entity ID"],
      log.map((l) => [new Date(l.createdAt).toLocaleString(), l.action, l.entityType || "", l.entityId || ""])
    );
  };
  function humanize(action: string) {
    return action.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div><CardTitle>Activity Log</CardTitle><CardDescription>Audit trail of all key actions in this clinic</CardDescription></div>
          {activityLogEnabled && (
            <Button size="sm" variant="outline" onClick={handleExport} disabled={!log?.length}>
              <Download className="w-3.5 h-3.5 mr-1" />CSV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {tierStatus && !activityLogEnabled ? (
          <div className="flex flex-col items-center py-6 text-center gap-3">
            <Lock className="w-8 h-8 text-gray-300" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Activity audit log requires the Clinic plan</p>
              <p className="text-xs text-muted-foreground mt-1">See every action taken in your clinic — who created records, updated roles, voided bills, and more.</p>
            </div>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 mt-1"
              disabled={checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate({ plan: "clinic" })}>
              Upgrade to Clinic — UGX 90,000/mo
            </Button>
          </div>
        ) : !log || log.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity logged yet</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {log.map((entry) => (
              <div key={entry.id} className={`flex items-center justify-between gap-3 p-2 rounded text-xs ${SENSITIVE_ACTIONS.has(entry.action) ? "bg-red-50 border border-red-100" : "border"}`}>
                <div className="flex-1 min-w-0">
                  <span className={`font-medium ${SENSITIVE_ACTIONS.has(entry.action) ? "text-red-700" : ""}`}>
                    {SENSITIVE_ACTIONS.has(entry.action) && "⚠ "}
                    {humanize(entry.action)}
                  </span>
                  {entry.entityType && <span className="text-muted-foreground ml-1">· {entry.entityType} #{entry.entityId || "—"}</span>}
                </div>
                <span className="text-muted-foreground flex-shrink-0">
                  {new Date(entry.createdAt).toLocaleDateString("en-UG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BranchManagementCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const branchesEnabled = tierStatus?.limits?.maxBranches === null;
  const { data: allBranches } = trpc.clinic.getMyBranches.useQuery(undefined, { enabled: branchesEnabled });
  // Exclude the branch the user is currently on — offering a "switch" button
  // to the branch you're already viewing is pointless and just wastes a
  // session-version bump + full page reload if clicked.
  const branches = allBranches?.filter((b) => b.id !== user?.clinicId);
  const currentBranch = allBranches?.find((b) => b.id === user?.clinicId);
  const [newName, setNewName] = useState("");

  const checkoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: (data) => { window.location.href = data.url; },
  });

  const addMutation = trpc.clinic.addBranch.useMutation({
    onSuccess: () => {
      utils.clinic.getMyBranches.invalidate();
      setNewName("");
      toast.success("Branch added");
    },
    onError: (e) => mutationErrorToast(e),
  });

  const switchMutation = trpc.clinic.switchBranch.useMutation({
    onSuccess: () => window.location.reload(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic Branches</CardTitle>
        <CardDescription>Manage multiple clinic locations under one account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {tierStatus && !branchesEnabled ? (
          <div className="flex flex-col items-center py-6 text-center gap-3">
            <Lock className="w-8 h-8 text-gray-300" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Multiple branches require the Pro plan</p>
              <p className="text-xs text-muted-foreground mt-1">Add separate locations under one owner login and switch between them instantly. Each branch keeps its own patients, staff, and billing — for shared cross-branch patient records, contact us.</p>
            </div>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 mt-1"
              disabled={checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate({ plan: "pro" })}>
              Upgrade to Pro — UGX 180,000/mo
            </Button>
          </div>
        ) : (
          <>
            {currentBranch && (
              <div className="flex items-center justify-between p-2 border rounded text-sm bg-green-50 border-green-200">
                <span className="font-medium">{currentBranch.name}</span>
                <span className="text-xs text-green-700 font-medium">Current branch</span>
              </div>
            )}
            {!branches || branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add another branch below.</p>
            ) : (
              <div className="space-y-2">
                {branches.map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-2 border rounded text-sm">
                    <span className="font-medium">{b.name}</span>
                    <Button size="sm" variant="outline" className="text-xs"
                      onClick={() => switchMutation.mutate({ clinicId: b.id })}>
                      Switch to this branch
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t">
              <Input placeholder="New branch name" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 text-sm" />
              <Button size="sm" className="bg-green-600 hover:bg-green-700"
                disabled={addMutation.isPending || !newName.trim()}
                onClick={() => addMutation.mutate({ name: newName })}>
                {addMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add Branch"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const canManage = user?.role === "manager" || user?.role === "admin";
  const [, navigate] = useLocation();

  const { data: clinic, refetch } = trpc.clinic.get.useQuery();
  const { data: tierStatusForUpgrade } = trpc.clinic.getTierStatus.useQuery();
  const utils = trpc.useUtils();
  const smsBalanceQuery = trpc.clinic.getSmsBalance.useQuery(undefined, { enabled: canManage });
  const { data: integrationStatus } = trpc.clinic.getIntegrationStatus.useQuery(undefined, { enabled: canManage });
  const updateMutation = trpc.clinic.update.useMutation({
    onSuccess: () => { toast.success("Settings saved"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const autoCheckoutMutation = trpc.clinic.getCheckoutUrl.useMutation({
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e) => toast.error(e.message),
  });

  // Arrived via a "Get started" click on a specific paid tier from the
  // landing page — offer that plan's checkout right away instead of leaving
  // the person to find it manually below.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get("upgrade");
    if (
      (requestedPlan === "clinic" || requestedPlan === "pro") &&
      canManage &&
      tierStatusForUpgrade?.tier === "free" &&
      !autoCheckoutMutation.isPending
    ) {
      window.history.replaceState({}, "", "/settings");
      autoCheckoutMutation.mutate({ plan: requestedPlan });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierStatusForUpgrade, canManage]);

  // Detect return from Lemonsqueezy checkout (?upgraded=1).
  // Poll the tier status until it's no longer "free", then redirect to dashboard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("upgraded")) return;

    // Remove the query param from the URL without a full reload
    window.history.replaceState({}, "", "/settings");

    toast.loading("Activating your plan...", { id: "upgrade" });

    let attempts = 0;
    const MAX_ATTEMPTS = 20; // poll for up to ~40 seconds

    const interval = setInterval(async () => {
      attempts++;
      await utils.clinic.getTierStatus.invalidate();
      const tierData = utils.clinic.getTierStatus.getData();

      if (tierData && tierData.tier !== "free") {
        clearInterval(interval);
        toast.dismiss("upgrade");
        toast.success(`You're now on the ${tierData.tier.charAt(0).toUpperCase() + tierData.tier.slice(1)} plan! 🎉`);
        setTimeout(() => navigate("/dashboard"), 1500);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        toast.dismiss("upgrade");
        toast.error("Plan activation is taking longer than expected. Please refresh in a moment.");
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", address: "", city: "", country: "Uganda",
    consultationFee: 0, mtnMomoNumber: "",
  });

  useEffect(() => {
    if (clinic) {
      setForm({
        name: clinic.name || "",
        phone: clinic.phone || "",
        email: clinic.email || "",
        address: clinic.address || "",
        city: clinic.city || "",
        country: clinic.country || "Uganda",
        consultationFee: Number(clinic.consultationFee) || 0,
        mtnMomoNumber: clinic.mtnMomoNumber || "",
      });
    }
  }, [clinic]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage clinic settings and preferences</p>
        </div>

        {canManage && (integrationStatus?.smsSandbox || integrationStatus?.emailSandbox) && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="pt-6 text-sm text-red-800">
              <p className="font-semibold mb-1">⚠️ Messaging is running on test credentials</p>
              <ul className="list-disc list-inside space-y-0.5">
                {integrationStatus.smsSandbox && (
                  <li>SMS (reminders, receipts, OTP login) is on Africa's Talking sandbox — it will not reach real phone numbers.</li>
                )}
                {integrationStatus.emailSandbox && (
                  <li>Email (invites, password resets, welcome emails) is on Resend's test sender — it will not reach real inboxes other than the account owner's.</li>
                )}
              </ul>
              <p className="mt-1 text-red-700">This needs production API credentials set as environment variables — it isn't something that can be fixed from this page.</p>
            </CardContent>
          </Card>
        )}

        {/* Clinic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Clinic Information</CardTitle>
            <CardDescription>These details appear on all receipts and reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Clinic Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canManage} placeholder="e.g. Kampala Medical Clinic" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">City</label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} disabled={!canManage} placeholder="e.g. Kampala" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Country</label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })} disabled={!canManage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Uganda">Uganda</SelectItem>
                    <SelectItem value="Kenya">Kenya</SelectItem>
                    <SelectItem value="Nigeria">Nigeria</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Determines the dial code used for SMS to patients and staff</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Phone</label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canManage} placeholder="+256..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Email</label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canManage} placeholder="clinic@email.com" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-muted-foreground mb-1">Address</label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={!canManage} placeholder="Street address" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Billing Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Billing & Payments</CardTitle>
            <CardDescription>Default fees and payment options</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Default Consultation Fee (UGX)</label>
                <Input type="number" value={form.consultationFee} onChange={(e) => setForm({ ...form, consultationFee: parseFloat(e.target.value) || 0 })} disabled={!canManage} />
                <p className="text-xs text-muted-foreground mt-1">Pre-filled when registering a new visit</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">MTN MoMo Number</label>
                <Input value={form.mtnMomoNumber} onChange={(e) => setForm({ ...form, mtnMomoNumber: e.target.value })} disabled={!canManage} placeholder="256..." />
                <p className="text-xs text-muted-foreground mt-1">Displayed on receipts for mobile payments</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SMS Notifications */}
        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>SMS Notifications</CardTitle>
              <CardDescription>Africa's Talking account balance, used for appointment reminders and payment receipts</CardDescription>
            </CardHeader>
            <CardContent>
              {smsBalanceQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Checking balance...</p>
              ) : smsBalanceQuery.data ? (
                <p className="text-lg font-semibold">{smsBalanceQuery.data.balance}</p>
              ) : (
                <p className="text-sm text-muted-foreground">SMS isn't configured yet. Set up Africa's Talking to send appointment reminders and payment receipts.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* SMS Delivery Log */}
        {canManage && <SmsLogCard />}

        {/* Activity Log */}
        {canManage && <ActivityLogCard />}

        {/* Branch Management */}
        {canManage && <BranchManagementCard />}

        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle>Your Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Name:</span><span className="font-medium">{user?.name}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Email:</span><span className="font-medium">{user?.email || "—"}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Role:</span><span className="font-medium capitalize">{user?.role}</span></div>
          </CardContent>
        </Card>

        <SubscriptionCard />

        {canManage && (
          <Button className="bg-green-600 hover:bg-green-700" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate(form)}>
            {updateMutation.isPending ? "Saving..." : "Save All Settings"}
          </Button>
        )}
        {!canManage && (
          <p className="text-sm text-muted-foreground">Only managers can edit clinic settings.</p>
        )}
      </div>
    </DashboardLayout>
  );
}
