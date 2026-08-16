import { useState, useMemo, useEffect } from "react";
import { exportCsv } from "@/lib/csv";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldAlert, Building2, Users, Stethoscope, CheckCircle, XCircle,
  AlertTriangle, Loader2, TrendingUp, Clock, Eye, Search, Filter, LogOut, Database,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { TIER_LIMITS } from "@shared/tiers";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-muted text-muted-foreground",
  suspended: "bg-red-100 text-red-700",
};

type ClinicFilter = "all" | "active" | "suspended" | "churn_risk" | "trial_ending" | "free" | "clinic" | "pro";

export default function OwnerDashboard() {
  const [, navigate] = useLocation();
  const [confirmAction, setConfirmAction] = useState<{ clinicId: number; name: string; action: "active" | "suspended" } | null>(null);
  const [filter, setFilter] = useState<ClinicFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedClinic, setSelectedClinic] = useState<any | null>(null);

  const { user, logout } = useAuth();

  // Redirect non-admins away immediately — the tRPC procedures also enforce
  // this server-side, but this prevents non-admins from seeing the shell.
  useEffect(() => {
    if (user && user.role !== "admin") {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.admin.getStats.useQuery(undefined, { enabled: user?.role === "admin" });
  const { data: clinics, isLoading: clinicsLoading, refetch } = trpc.admin.getAllClinics.useQuery(undefined, { enabled: user?.role === "admin" });

  const updateStatus = trpc.admin.updateStatus.useMutation({
    onSuccess: () => { toast.success("Clinic status updated"); setConfirmAction(null); refetch(); refetchStats(); },
    onError: (e) => toast.error(e.message),
  });

  const impersonateMutation = trpc.admin.impersonate.useMutation({
    onSuccess: async (data) => {
      toast.success(`Now viewing as ${data.targetName} (${data.targetRole})`);
      navigate("/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateTierMutation = trpc.admin.updateClinicTier.useMutation({
    onSuccess: () => { toast.success("Tier updated"); refetch(); refetchStats(); },
    onError: (e) => toast.error(e.message),
  });

  const promoteMutation = trpc.admin.promoteToAdmin.useMutation({
    onSuccess: () => { toast.success("Promoted to admin"); setSelectedClinic(null); },
    onError: (e) => toast.error(e.message),
  });

  const messageMutation = trpc.admin.messageClinic.useMutation({
    onSuccess: () => toast.success("Message sent"),
    onError: (e) => toast.error(e.message),
  });

  const backupMutation = trpc.admin.triggerBackup.useMutation({
    onSuccess: (data) => {
      const tableCount = Object.keys(data.tables).length;
      const rowCount = Object.values(data.tables).reduce((s, n) => s + n, 0);
      toast.success(`Backup complete — ${tableCount} tables, ${rowCount.toLocaleString()} rows, written to R2`);
    },
    onError: (e) => toast.error(e.message),
  });

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => toast.success("Password changed"),
    onError: (e) => toast.error(e.message),
  });

  const utils = trpc.useUtils();
  const { data: billingIssues } = trpc.admin.getBillingIssues.useQuery(undefined, { enabled: user?.role === "admin" });
  const resolveIssueMutation = trpc.admin.resolveBillingIssue.useMutation({
    onSuccess: () => { toast.success("Marked resolved"); utils.admin.getBillingIssues.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const [showAuditLog, setShowAuditLog] = useState(false);
  const { data: auditLog } = trpc.admin.getAuditLog.useQuery(undefined, { enabled: showAuditLog && user?.role === "admin" });

  const [messagingClinic, setMessagingClinic] = useState<any | null>(null);

  const filteredClinics = useMemo(() => {
    let list = clinics ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c: any) => c.name.toLowerCase().includes(q) || c.city?.toLowerCase().includes(q));
    }
    if (filter === "active") list = list.filter((c: any) => c.subscriptionStatus === "active");
    else if (filter === "suspended") list = list.filter((c: any) => c.subscriptionStatus === "suspended");
    else if (filter === "churn_risk") list = list.filter((c: any) => c.churnRisk);
    else if (filter === "trial_ending") list = list.filter((c: any) => c.trialEndingSoon);
    else if (filter === "free" || filter === "clinic" || filter === "pro") list = list.filter((c: any) => c.subscriptionTier === filter);
    return list;
  }, [clinics, filter, search]);

  // Most active clinics by visit count
  const mostActive = useMemo(() =>
    [...(clinics ?? [])].sort((a: any, b: any) => b.visitCount - a.visitCount).slice(0, 3),
    [clinics]
  );

  // Tier breakdown + MRR — derived client-side from the clinics list already
  // fetched for the table below, so no extra backend query needed. MRR is
  // CareDesk's OWN subscription revenue (what clinics pay YOU) — completely
  // different from "Total Revenue Processed" above, which is how much money
  // clinics' own patients paid THEM. Conflating the two would badly overstate
  // the actual health of the SaaS business.
  const tierBreakdown = useMemo(() => {
    const list = clinics ?? [];
    const counts = { free: 0, clinic: 0, pro: 0 };
    for (const c of list as any[]) {
      const t = c.subscriptionTier as "free" | "clinic" | "pro";
      if (t in counts) counts[t]++;
    }
    const mrr = counts.clinic * TIER_LIMITS.clinic.priceUgx + counts.pro * TIER_LIMITS.pro.priceUgx;
    return { ...counts, mrr, payingCount: counts.clinic + counts.pro };
  }, [clinics]);

  // Grace period: suspended clinics still within their post-failed-payment
  // window are meaningfully different from ones fully cut off — worth
  // distinguishing since one needs a follow-up nudge, the other doesn't.
  const graceClinics = useMemo(() =>
    (clinics ?? []).filter((c: any) =>
      c.subscriptionStatus === "suspended" && c.gracePeriodEndsAt && new Date(c.gracePeriodEndsAt) > new Date()
    ),
    [clinics]
  );
  function daysLeft(d: string | Date) {
    return Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 86400000));
  }

  function fmtDate(d: Date | string | null) {
    if (!d) return "Never";
    return new Date(d).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" });
  }

  function exportClinicsCsv() {
    const rows = filteredClinics as any[];
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    const headers = ["Name", "City", "Phone", "Email", "Tier", "Status", "Patients", "Visits", "Total Revenue (UGX)", "Registered"];
    exportCsv(
      `caredesk-clinics-${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows.map((c) => [
        c.name ?? "", c.city ?? "", c.phone ?? "", c.email ?? "", c.subscriptionTier, c.subscriptionStatus,
        c.patientCount, c.visitCount, c.totalRevenue, fmtDate(c.createdAt),
      ])
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 p-2 rounded-lg">
              <ShieldAlert className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Owner Dashboard</h1>
              <p className="text-muted-foreground text-sm">Platform-wide visibility across all clinics</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={backupMutation.isPending} onClick={() => backupMutation.mutate()}>
              {backupMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Database className="w-4 h-4 mr-1" />}
              Back up now
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAuditLog(true)}>
              <Clock className="w-4 h-4 mr-1" /> Audit Log
            </Button>
          </div>
        </div>

        {/* Account — deliberately a plain always-visible card, not hidden in a
            dropdown or menu, so there's no ambiguity about whether it's reachable. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="destructive" size="sm" onClick={logout}>
                <LogOut className="w-4 h-4 mr-1" /> Sign out
              </Button>
            </div>
            <ChangePasswordForm
              onSubmit={(currentPassword, newPassword) => changePasswordMutation.mutate({ currentPassword, newPassword })}
              pending={changePasswordMutation.isPending}
            />
          </CardContent>
        </Card>

        {/* Billing issues needing attention — previously invisible unless someone
            was tailing Render logs at the exact moment a webhook hit an edge case */}
        {billingIssues && billingIssues.length > 0 && (
          <Card className="border-red-300 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-800 flex items-center gap-2 text-base">
                <AlertTriangle className="w-4 h-4" /> {billingIssues.length} billing issue{billingIssues.length > 1 ? "s" : ""} need attention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {billingIssues.map((issue: any) => (
                <div key={issue.id} className="bg-card rounded-lg border border-red-200 p-3 text-sm flex justify-between items-start gap-3">
                  <div>
                    <p className="font-medium">{issue.clinicName} · <span className="text-red-700">{issue.eventType.replace(/_/g, " ")}</span></p>
                    {issue.note && <p className="text-xs text-muted-foreground mt-0.5">{issue.note}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(issue.createdAt).toLocaleString()}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0"
                    disabled={resolveIssueMutation.isPending}
                    onClick={() => resolveIssueMutation.mutate({ id: issue.id })}>
                    Mark resolved
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* MRR — CareDesk's own subscription revenue, the number that actually
            matters for the SaaS business, distinct from clinic billing volume below */}
        {!statsLoading && (
          <Card className="border-emerald-300 bg-gradient-to-br from-emerald-50 to-white">
            <CardContent className="pt-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-xs text-emerald-700 font-medium uppercase tracking-wide">Monthly Recurring Revenue</p>
                  <p className="text-3xl font-bold text-emerald-800">UGX {tierBreakdown.mrr.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tierBreakdown.payingCount} paying clinic{tierBreakdown.payingCount !== 1 ? "s" : ""} of {stats?.totalClinics || 0} total</p>
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <p className="text-lg font-bold text-muted-foreground">{tierBreakdown.free}</p>
                    <p className="text-[10px] text-gray-400 uppercase">Free</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-blue-600">{tierBreakdown.clinic}</p>
                    <p className="text-[10px] text-gray-400 uppercase">Clinic</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-purple-600">{tierBreakdown.pro}</p>
                    <p className="text-[10px] text-gray-400 uppercase">Pro</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Platform stats */}
        {statsLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card><CardContent className="pt-5">
              <Building2 className="w-5 h-5 text-blue-600 mb-2" />
              <p className="text-2xl font-bold">{stats?.totalClinics || 0}</p>
              <p className="text-xs text-muted-foreground">Total Clinics</p>
              <p className="text-xs text-green-600 mt-1">+{stats?.newThisWeek || 0} this week · +{stats?.newThisMonth || 0} this month</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <CheckCircle className="w-5 h-5 text-green-600 mb-2" />
              <p className="text-2xl font-bold text-green-600">{stats?.activeClinics || 0}</p>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xs text-red-500 mt-1">{stats?.suspendedClinics || 0} suspended{graceClinics.length > 0 ? ` (${graceClinics.length} in grace period)` : ""}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <Users className="w-5 h-5 text-purple-600 mb-2" />
              <p className="text-2xl font-bold">{stats?.totalPatients || 0}</p>
              <p className="text-xs text-muted-foreground">Total Patients</p>
            </CardContent></Card>
            <Card><CardContent className="pt-5">
              <TrendingUp className="w-5 h-5 text-orange-600 mb-2" />
              <p className="text-xl font-bold text-orange-700">UGX {(stats?.totalRevenue || 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Platform Billing Volume</p>
              <p className="text-[10px] text-gray-400 mt-1">Clinics' own patient billing — not your revenue</p>
            </CardContent></Card>
            <Card className={((stats?.cancelledThisMonth || 0) + (stats?.downgradedThisMonth || 0)) > 0 ? "border-amber-300" : ""}>
              <CardContent className="pt-5">
                <XCircle className="w-5 h-5 text-red-500 mb-2" />
                <p className="text-2xl font-bold">{(stats?.cancelledThisMonth || 0) + (stats?.downgradedThisMonth || 0)}</p>
                <p className="text-xs text-muted-foreground">Churned this month</p>
                <p className="text-xs text-gray-400 mt-1">{stats?.cancelledThisMonth || 0} cancelled · {stats?.downgradedThisMonth || 0} downgraded · {stats?.upgradedThisMonth || 0} upgraded</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Most active clinics */}
        {mostActive.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Most Active Clinics</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {mostActive.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                    <Building2 className="w-4 h-4 text-green-600" />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-green-700 font-bold">{c.visitCount} visits</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts section */}
        {clinics && (clinics as any[]).some((c) => c.churnRisk || c.trialEndingSoon || c.subscriptionStatus === "suspended") && (
          <Card className="border-orange-200 bg-orange-50">
            <CardHeader>
              <CardTitle className="text-orange-800 flex items-center gap-2 text-base">
                <AlertTriangle className="w-4 h-4" /> Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {(clinics as any[]).filter(c => c.subscriptionStatus === "suspended" && (!c.gracePeriodEndsAt || new Date(c.gracePeriodEndsAt) <= new Date())).map((c) => (
                <p key={c.id} className="text-red-700">⛔ <strong>{c.name}</strong> is suspended — fully cut off</p>
              ))}
              {graceClinics.map((c: any) => (
                <p key={c.id} className="text-amber-700">🕐 <strong>{c.name}</strong> — payment failed, {daysLeft(c.gracePeriodEndsAt)} day{daysLeft(c.gracePeriodEndsAt) !== 1 ? "s" : ""} left in grace period</p>
              ))}
              {(clinics as any[]).filter(c => c.trialEndingSoon && c.subscriptionStatus === "active").map((c) => (
                <p key={c.id} className="text-yellow-700">⏳ <strong>{c.name}</strong> — trial ending within 3 days</p>
              ))}
              {(clinics as any[]).filter(c => c.churnRisk && c.subscriptionStatus === "active").map((c) => (
                <p key={c.id} className="text-orange-700">📉 <strong>{c.name}</strong> — no activity in 7+ days</p>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Clinics table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
              <div>
                <CardTitle>All Clinics ({filteredClinics.length})</CardTitle>
                <CardDescription>Search, filter, and manage all registered clinics</CardDescription>
              </div>
              <div className="flex gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
                  <Input placeholder="Search clinics..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-44 text-sm" />
                </div>
                <Button variant="outline" size="sm" className="text-xs h-9" onClick={exportClinicsCsv}>
                  Export CSV
                </Button>
                <Select value={filter} onValueChange={(v) => setFilter(v as ClinicFilter)}>
                  <SelectTrigger className="w-40 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clinics</SelectItem>
                    <SelectItem value="active">Active Only</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="churn_risk">Churn Risk</SelectItem>
                    <SelectItem value="trial_ending">Trial Ending</SelectItem>
                    <SelectItem value="free">Free Tier</SelectItem>
                    <SelectItem value="clinic">Clinic Tier</SelectItem>
                    <SelectItem value="pro">Pro Tier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {clinicsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : filteredClinics.length === 0 ? (
              <div className="text-center py-8">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-muted-foreground">No clinics match this filter</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-b">
                    <tr>
                      <th className="text-left py-3 px-4">Clinic</th>
                      <th className="text-center py-3 px-4">Patients</th>
                      <th className="text-center py-3 px-4">Visits</th>
                      <th className="text-right py-3 px-4">Revenue</th>
                      <th className="text-left py-3 px-4">Last Active</th>
                      <th className="text-left py-3 px-4">Tier</th>
                      <th className="text-left py-3 px-4">Status</th>
                      <th className="text-left py-3 px-4">Joined</th>
                      <th className="text-left py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredClinics.map((clinic: any) => (
                      <tr key={clinic.id} className={`hover:bg-muted ${clinic.subscriptionStatus === "suspended" ? "bg-red-50" : clinic.churnRisk ? "bg-orange-50" : ""}`}>
                        <td className="py-3 px-4">
                          <div className="font-medium">{clinic.name}</div>
                          {clinic.phone && <div className="text-xs text-muted-foreground">{clinic.phone}</div>}
                          {clinic.churnRisk && <span className="text-xs text-orange-600">⚠ Low activity</span>}
                          {clinic.trialEndingSoon && <span className="text-xs text-yellow-600"> ⏳ Trial ending</span>}
                        </td>
                        <td className="py-3 px-4 text-center font-medium">
                          {clinic.patientCount}
                          {clinic.subscriptionTier === "free" && clinic.patientsThisMonth >= 24 && (
                            <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${clinic.patientsThisMonth >= 30 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              {clinic.patientsThisMonth}/30 mo
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center font-medium">
                          {clinic.visitCount}
                          {clinic.subscriptionTier === "free" && clinic.visitsThisMonth >= 24 && (
                            <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${clinic.visitsThisMonth >= 30 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              {clinic.visitsThisMonth}/30 mo
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-green-700 font-medium">UGX {clinic.totalRevenue.toLocaleString()}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {fmtDate(clinic.lastActiveAt)}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            clinic.subscriptionTier === "pro" ? "bg-purple-100 text-purple-700" :
                            clinic.subscriptionTier === "clinic" ? "bg-blue-100 text-blue-700" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {clinic.subscriptionTier}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[clinic.subscriptionStatus] || ""}`}>
                            {clinic.subscriptionStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{fmtDate(clinic.createdAt)}</td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1 flex-wrap">
                            <Button size="sm" variant="ghost" className="text-xs text-purple-700 p-1 h-7"
                              title="View clinic details"
                              onClick={() => setSelectedClinic(clinic)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs text-blue-700 p-1 h-7"
                              title="View clinic details and impersonate"
                              disabled={impersonateMutation.isPending}
                              onClick={() => setSelectedClinic(clinic)}>
                              👤
                            </Button>
                            {clinic.subscriptionStatus !== "active" && (
                              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-xs h-7"
                                onClick={() => setConfirmAction({ clinicId: clinic.id, name: clinic.name, action: "active" })}>
                                Activate
                              </Button>
                            )}
                            {clinic.subscriptionStatus === "active" && (
                              <Button size="sm" variant="outline" className="text-red-600 border-red-300 text-xs h-7"
                                onClick={() => setConfirmAction({ clinicId: clinic.id, name: clinic.name, action: "suspended" })}>
                                Suspend
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clinic detail panel */}
      {selectedClinic && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl w-full max-w-lg shadow-2xl space-y-4 p-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold">{selectedClinic.name}</h2>
                <p className="text-sm text-muted-foreground">{selectedClinic.city || "No city"} · {selectedClinic.phone || "No phone"}</p>
              </div>
              <button onClick={() => setSelectedClinic(null)} className="text-gray-400 hover:text-muted-foreground text-2xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-sm">
              <div className="bg-green-50 rounded-lg p-3"><p className="text-2xl font-bold text-green-700">{selectedClinic.patientCount}</p><p className="text-xs text-muted-foreground">Patients</p></div>
              <div className="bg-blue-50 rounded-lg p-3"><p className="text-2xl font-bold text-blue-700">{selectedClinic.visitCount}</p><p className="text-xs text-muted-foreground">Visits</p></div>
              <div className="bg-purple-50 rounded-lg p-3"><p className="text-sm font-bold text-purple-700">UGX {selectedClinic.totalRevenue.toLocaleString()}</p><p className="text-xs text-muted-foreground">Revenue</p></div>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[selectedClinic.subscriptionStatus]}`}>{selectedClinic.subscriptionStatus}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last Active</span><span>{selectedClinic.lastActiveAt ? new Date(selectedClinic.lastActiveAt).toLocaleDateString() : "Never"}</span></div>
              {selectedClinic.trialEndsAt && <div className="flex justify-between"><span className="text-muted-foreground">Trial Ends</span><span className={selectedClinic.trialEndingSoon ? "text-yellow-600 font-medium" : ""}>{new Date(selectedClinic.trialEndsAt).toLocaleDateString()}</span></div>}
              {selectedClinic.lsSubscriptionId && <div className="flex justify-between"><span className="text-muted-foreground">LS Subscription</span><span className="font-mono text-xs">{selectedClinic.lsSubscriptionId}</span></div>}
            </div>
            <div className="pt-2 border-t space-y-1">
              <p className="text-xs text-muted-foreground">Subscription tier</p>
              <div className="flex gap-2">
                <Select
                  value={selectedClinic.subscriptionTier}
                  onValueChange={(v) => updateTierMutation.mutate({ clinicId: selectedClinic.id, tier: v as "free" | "clinic" | "pro" })}
                >
                  <SelectTrigger className="text-sm flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="clinic">Clinic — UGX 90,000/mo</SelectItem>
                    <SelectItem value="pro">Pro — UGX 180,000/mo</SelectItem>
                  </SelectContent>
                </Select>
                {updateTierMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mt-2" />}
              </div>
              <p className="text-[11px] text-gray-400">Manual correction only — doesn't touch their actual LemonSqueezy subscription. Use when a webhook edge case needs fixing (see Billing issues above).</p>
            </div>

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Impersonate a staff member at this clinic to see what they see:</p>
              <ImpersonatePicker
                clinicId={selectedClinic.id}
                onImpersonate={(uid) => {
                  if (!window.confirm("Your session will be replaced. Continue?")) return;
                  impersonateMutation.mutate({ userId: uid });
                }}
                pending={impersonateMutation.isPending}
              />
            </div>

            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Grant platform-admin access to a staff member at this clinic:</p>
              <PromotePicker
                clinicId={selectedClinic.id}
                onPromote={(uid, name) => {
                  if (!window.confirm(`Give ${name} full platform-admin access? This can't be easily undone from the UI.`)) return;
                  promoteMutation.mutate({ userId: uid });
                }}
                pending={promoteMutation.isPending}
              />
            </div>

            <div className="pt-2 border-t">
              <Button variant="outline" size="sm" className="w-full" onClick={() => setMessagingClinic(selectedClinic)}>
                Message this clinic
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Message clinic dialog */}
      {messagingClinic && (
        <MessageClinicDialog
          clinic={messagingClinic}
          onClose={() => setMessagingClinic(null)}
          onSend={(payload) => messageMutation.mutate({ clinicId: messagingClinic.id, ...payload })}
          pending={messageMutation.isPending}
        />
      )}

      {/* Audit log */}
      {showAuditLog && (
        <AuditLogDialog entries={auditLog} onClose={() => setShowAuditLog(false)} />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h2 className="text-lg font-bold">
              {confirmAction.action === "active" ? "✅ Activate Clinic" : "⛔ Suspend Clinic"}
            </h2>
            <p className="text-muted-foreground text-sm">
              {confirmAction.action === "active"
                ? `Activate "${confirmAction.name}"? Their staff will regain full access immediately.`
                : `Suspend "${confirmAction.name}"? They will lose access until reactivated.`}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                className={`flex-1 ${confirmAction.action === "active" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                disabled={updateStatus.isPending}
                onClick={() => updateStatus.mutate({ clinicId: confirmAction.clinicId, status: confirmAction.action })}
              >
                {updateStatus.isPending ? "Saving..." : confirmAction.action === "active" ? "Yes, Activate" : "Yes, Suspend"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function ImpersonatePicker({
  clinicId,
  onImpersonate,
  pending,
}: {
  clinicId: number;
  onImpersonate: (userId: number) => void;
  pending: boolean;
}) {
  const { data: staff, isLoading } = trpc.admin.getClinicStaff.useQuery({ clinicId });
  const [selected, setSelected] = useState<string>("");

  if (isLoading) return <p className="text-xs text-gray-400">Loading staff…</p>;
  const activeStaff = (staff ?? []).filter((s) => s.role !== "admin");
  if (activeStaff.length === 0) return <p className="text-xs text-gray-400">No staff at this clinic yet.</p>;

  return (
    <div className="flex gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="text-sm"><SelectValue placeholder="Choose a staff member" /></SelectTrigger>
        <SelectContent>
          {activeStaff.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name} — {s.role}{!s.isActive ? " (deactivated)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="bg-blue-600 hover:bg-blue-700 text-xs shrink-0"
        disabled={pending || !selected}
        onClick={() => onImpersonate(parseInt(selected, 10))}
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Impersonate"}
      </Button>
    </div>
  );
}

function PromotePicker({
  clinicId,
  onPromote,
  pending,
}: {
  clinicId: number;
  onPromote: (userId: number, name: string) => void;
  pending: boolean;
}) {
  const { data: staff, isLoading } = trpc.admin.getClinicStaff.useQuery({ clinicId });
  const [selected, setSelected] = useState<string>("");

  if (isLoading) return <p className="text-xs text-gray-400">Loading staff…</p>;
  const activeStaff = (staff ?? []).filter((s) => s.role !== "admin" && s.isActive);
  if (activeStaff.length === 0) return <p className="text-xs text-gray-400">No eligible staff at this clinic.</p>;
  const selectedStaff = activeStaff.find((s) => String(s.id) === selected);

  return (
    <div className="flex gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="text-sm"><SelectValue placeholder="Choose a staff member" /></SelectTrigger>
        <SelectContent>
          {activeStaff.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>{s.name} — {s.role}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        className="text-xs shrink-0"
        disabled={pending || !selected}
        onClick={() => selectedStaff && onPromote(selectedStaff.id, selectedStaff.name)}
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Promote"}
      </Button>
    </div>
  );
}

function MessageClinicDialog({
  clinic,
  onClose,
  onSend,
  pending,
}: {
  clinic: any;
  onClose: () => void;
  onSend: (payload: { subject: string; message: string; channel: "email" | "sms" | "both" }) => void;
  pending: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "both">(clinic.email ? "email" : "sms");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-md shadow-2xl space-y-4 p-6">
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold">Message {clinic.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-muted-foreground text-2xl leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Send via</label>
            <Select value={channel} onValueChange={(v) => setChannel(v as "email" | "sms" | "both")}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {clinic.email && <SelectItem value="email">Email only</SelectItem>}
                {clinic.phone && <SelectItem value="sms">SMS only</SelectItem>}
                {clinic.email && clinic.phone && <SelectItem value="both">Both</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {(channel === "email" || channel === "both") && (
            <Input placeholder="Subject (email only)" value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}
          <textarea
            className="w-full border rounded-md p-2 text-sm min-h-[100px]"
            placeholder="Message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-[11px] text-gray-400">SMS has no subject line — keep it short if sending via SMS.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            disabled={pending || !message.trim() || ((channel === "email" || channel === "both") && !subject.trim())}
            onClick={() => onSend({ subject: subject || "Message from CareDesk", message, channel })}
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AuditLogDialog({ entries, onClose }: { entries: any[] | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-2xl shadow-2xl p-6 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h2 className="text-lg font-bold">Admin audit log</h2>
            <p className="text-xs text-muted-foreground">Every impersonation, status change, tier override, and promotion — across all clinics</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-muted-foreground text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto space-y-2">
          {!entries ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No admin actions recorded yet.</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="border rounded-lg p-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{e.action.replace(/^ADMIN_/, "").replace(/_/g, " ")}</span>
                  <span className="text-xs text-gray-400">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  By {e.adminName ?? "Unknown"} · {e.clinicName}
                </p>
                {e.changes && <p className="text-xs text-gray-400 mt-1 font-mono break-all">{e.changes}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ChangePasswordForm({
  onSubmit,
  pending,
}: {
  onSubmit: (currentPassword: string, newPassword: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change password
      </Button>
    );
  }

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <div className="space-y-2 border-t pt-3">
      <Input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input type="password" placeholder="New password (min 8 characters)" value={next} onChange={(e) => setNext(e.target.value)} />
      <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {mismatch && <p className="text-xs text-red-600">Passwords don't match</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => { setOpen(false); setCurrent(""); setNext(""); setConfirm(""); }}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canSubmit || pending}
          onClick={() => {
            onSubmit(current, next);
            setOpen(false); setCurrent(""); setNext(""); setConfirm("");
          }}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update password"}
        </Button>
      </div>
    </div>
  );
}
