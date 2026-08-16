import { useState, useMemo } from "react";
import { exportCsv } from "@/lib/csv";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Receipt, Loader2, CheckCircle, Clock, Plus, Trash2, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { parseTierError } from "@shared/tiers";
import { EmptyState } from "@/components/EmptyState";

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_BG: Record<string, string> = {
  paid:    "bg-green-100 text-green-700",
  partial: "bg-yellow-100 text-yellow-700",
  unpaid:  "bg-red-100 text-red-700",
};

function esc(v: unknown) {
  const E: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(v ?? "").replace(/[&<>"']/g, (c) => E[c] ?? c);
}

function daysAgo(date: string | Date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function ageBucket(date: string | Date) {
  const d = daysAgo(date);
  if (d <= 30) return "0–30 days";
  if (d <= 60) return "31–60 days";
  return "60+ days";
}

function ageBucketColor(date: string | Date) {
  const d = daysAgo(date);
  if (d <= 30) return "bg-yellow-100 text-yellow-700";
  if (d <= 60) return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

// ─── Print receipt ────────────────────────────────────────────────────────────

function buildReceipt(bill: any, patient: any, clinic: any) {
  const cn = esc(clinic?.name || "Clinic");
  const ca = clinic?.address ? `<p style="margin:2px 0;font-size:11px;opacity:.75;">${esc(clinic.address)}</p>` : "";
  const cp = clinic?.phone ? `<p style="margin:2px 0;font-size:11px;opacity:.75;">Tel: ${esc(clinic.phone)}</p>` : "";
  return `<!DOCTYPE html><html><head><title>Receipt - ${esc(bill.billNumber)}</title>
<style>body{font-family:Arial,sans-serif;padding:24px;}@media print{body{padding:0;}}</style></head>
<body><div style="max-width:500px;margin:0 auto;border:2px solid #16a34a;border-radius:8px;overflow:hidden;">
<div style="background:#16a34a;color:white;padding:16px 24px;text-align:center;">
<h1 style="margin:0;font-size:18px;">PAYMENT RECEIPT</h1>
<p style="margin:4px 0 0;font-size:12px;opacity:.85;">${cn}</p>${ca}${cp}</div>
<div style="padding:16px 24px;">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
<div><p style="margin:0;font-size:11px;color:#6b7280;">PATIENT</p><p style="margin:0;font-weight:700;">${esc(patient?.firstName)} ${esc(patient?.lastName || "")}</p></div>
<div><p style="margin:0;font-size:11px;color:#6b7280;">BILL NO.</p><p style="margin:0;font-weight:700;">${esc(bill.billNumber)}</p></div>
<div><p style="margin:0;font-size:11px;color:#6b7280;">PATIENT ID</p><p style="margin:0;">${esc(patient?.patientId)}</p></div>
<div><p style="margin:0;font-size:11px;color:#6b7280;">DATE</p><p style="margin:0;">${new Date(bill.billDate).toLocaleDateString()}</p></div>
</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;">Item</th><th style="padding:8px;text-align:right;">Amount</th></tr>
<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px;">Consultation</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.consultationFee).toLocaleString()}</td></tr>
${Number(bill.labTotal) > 0 ? `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px;">Lab Tests</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.labTotal).toLocaleString()}</td></tr>` : ""}
${Number(bill.drugTotal) > 0 ? `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:8px;">Drugs</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.drugTotal).toLocaleString()}</td></tr>` : ""}
<tr style="font-weight:bold;"><td style="padding:8px;">Grand Total</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.grandTotal).toLocaleString()}</td></tr>
<tr style="color:#16a34a;"><td style="padding:8px;">Amount Paid</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.amountPaid).toLocaleString()}</td></tr>
<tr style="color:${Number(bill.balanceAmount) > 0 ? "#dc2626" : "#16a34a"};font-weight:bold;"><td style="padding:8px;">Balance</td><td style="padding:8px;text-align:right;">UGX ${Number(bill.balanceAmount).toLocaleString()}</td></tr>
</table>
<div style="text-align:center;margin-top:16px;">
<span style="background:${bill.paymentStatus === "paid" ? "#dcfce7" : bill.paymentStatus === "partial" ? "#fef9c3" : "#fee2e2"};color:${bill.paymentStatus === "paid" ? "#166534" : bill.paymentStatus === "partial" ? "#92400e" : "#991b1b"};padding:4px 16px;border-radius:20px;font-weight:bold;font-size:13px;">${bill.paymentStatus.toUpperCase()}</span>
</div></div>
<div style="background:#f9fafb;padding:10px 24px;text-align:center;font-size:11px;color:#6b7280;">Thank you for visiting ${cn}</div>
</div><script>window.onload=()=>window.print();</script></body></html>`;
}

/**
 * window.open() returns null when the popup is blocked — common on mobile
 * Chrome/Android WebView, especially inside an installed PWA. Without this
 * check, clicking "Print" silently did nothing: no error, no receipt, no
 * indication anything was wrong. For a receptionist with a patient waiting
 * at the counter, that's the worst kind of failure — the button visibly
 * exists and visibly does nothing.
 */
function openReceiptWindow(bill: any, patient: any, clinic: any) {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Couldn't open the receipt — your browser blocked the popup. Allow popups for this site and try again.");
    return;
  }
  w.document.write(buildReceipt(bill, patient, clinic));
  w.document.close();
}

// ─── Void dialog ──────────────────────────────────────────────────────────────

function VoidDialog({ bill, onVoided }: { bill: any; onVoided: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = trpc.bill.void.useMutation({
    onSuccess: () => { toast.success("Bill voided"); setOpen(false); setReason(""); onVoided(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-xs text-red-600">Void</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Void Bill — {bill.billNumber}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This sets the bill total to zero and records an audit entry. This cannot be undone.</p>
        <div className="space-y-1">
          <Label>Reason *</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate entry" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700" disabled={mutation.isPending || !reason.trim()}
            onClick={() => mutation.mutate({ billId: bill.id, reason })}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Void Bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Service templates manager ────────────────────────────────────────────────

function ServiceTemplatesPanel({ onPick }: { onPick?: (name: string, price: number, category: string) => void }) {
  const utils = trpc.useUtils();
  const { data: templates } = trpc.clinic.getServiceTemplates.useQuery();
  const { user } = useAuth();
  const canManage = user?.role === "manager" || user?.role === "admin";
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<"consultation" | "lab" | "drug" | "other">("other");

  const addMutation = trpc.clinic.addServiceTemplate.useMutation({
    onSuccess: () => { utils.clinic.getServiceTemplates.invalidate(); setName(""); setPrice(""); },
    onError: (e) => toast.error(e.message),
  });
  const delMutation = trpc.clinic.deleteServiceTemplate.useMutation({
    onSuccess: () => utils.clinic.getServiceTemplates.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service Templates</CardTitle>
        <CardDescription>Common services with standard prices</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {templates?.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs capitalize">{t.category}</Badge>
              <span>{t.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">UGX {Number(t.price).toLocaleString()}</span>
              {onPick && (
                <Button size="sm" variant="outline" className="text-xs" onClick={() => onPick(t.name, Number(t.price), t.category)}>
                  Add to Bill
                </Button>
              )}
              {canManage && (
                <Button size="sm" variant="ghost" className="text-red-500 p-1"
                  onClick={() => delMutation.mutate({ templateId: t.id })}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {canManage && (
          <div className="pt-2 border-t space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add Template</p>
            <div className="flex gap-2">
              <Input placeholder="Service name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 text-sm" />
              <Input placeholder="Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-28 text-sm" />
            </div>
            <div className="flex gap-2">
              <Select value={category} onValueChange={(v) => setCategory(v as any)}>
                <SelectTrigger className="flex-1 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultation">Consultation</SelectItem>
                  <SelectItem value="lab">Lab</SelectItem>
                  <SelectItem value="drug">Drug</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="bg-green-600 hover:bg-green-700"
                disabled={addMutation.isPending || !name || !price}
                onClick={() => addMutation.mutate({ name, price: parseFloat(price), category })}>
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Daily reconciliation ─────────────────────────────────────────────────────

function DailyReconciliation() {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const { data } = trpc.bill.dailyCash.useQuery({ date });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Cash Reconciliation</CardTitle>
        <CardDescription>Payments collected by method</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today} className="w-44" />
        {data ? (
          <div className="space-y-2 text-sm">
            {[
              { label: "Cash", value: data.cash },
              { label: "MTN MoMo", value: data.mtnMomo },
              { label: "Bank Transfer", value: data.bankTransfer },
              { label: "Cheque", value: data.cheque },
            ].map((row) => (
              <div key={row.label} className="flex justify-between">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">UGX {row.value.toLocaleString()}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold border-t pt-2">
              <span>Total ({data.paymentCount} payments)</span>
              <span className="text-green-700">UGX {data.total.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "bills" | "debtors" | "cash" | "templates";

export default function Billing() {
  const { user } = useAuth();
  const canManage = user?.role === "manager" || user?.role === "admin";

  const [activeTab, setActiveTab] = useState<Tab>("bills");
  const [filterStatus, setFilterStatus] = useState<"all" | "paid" | "unpaid" | "partial">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [payingBill, setPayingBill] = useState<any>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<"cash" | "mtn_momo" | "bank_transfer" | "cheque">("cash");
  const [billsLimit, setBillsLimit] = useState(100);

  const utils = trpc.useUtils();
  const { data: bills, isLoading, refetch } = trpc.bill.list.useQuery({ limit: billsLimit });
  const { data: clinic } = trpc.clinic.get.useQuery();
  const { data: debtors, isLoading: debtorsLoading } = trpc.patient.getDebtors.useQuery();
  const { data: patients } = trpc.patient.list.useQuery();

  const sendReminderMutation = trpc.patient.sendDebtReminder.useMutation({
    onSuccess: (data) => { if (data.sent) toast.success("SMS reminder sent"); else toast.error(data.reason || "Could not send SMS"); },
    onError: (e) => toast.error(e.message),
  });

  const markPaidMutation = useOfflineMutation({
    procedure: "bill.markAsPaid",
    label: (input) => `Payment: UGX ${input.amountPaid} on bill #${input.billId}`,
  });

  const handleMarkPaid = async () => {
    // Payments are money, and this device's picture of the bill balance
    // could be stale if it's been offline a while (someone else may have
    // already collected part of this debt from a different terminal).
    // Queue it, but make sure whoever's tapping Confirm knows that.
    if (!markPaidMutation.isOnline) {
      const ok = window.confirm(
        "You're offline. This payment will be recorded once you're back online — " +
        "the balance shown may not reflect payments made elsewhere in the meantime.\n\nContinue?"
      );
      if (!ok) return;
    }
    try {
      const result = await markPaidMutation.mutate({ billId: payingBill.id, amountPaid: payAmount, paymentMethod: payMethod });
      if (result.queued) {
        toast.success("Saved offline — payment will sync once you're back online.");
      } else {
        toast.success("Payment recorded");
      }
      setPayingBill(null);
      refetch();
      // Bills and Debtors are two tabs of this same page — a payment changes
      // balanceAmount, which the Debtors tab's own separate query depends on.
      // Without this, a patient who just paid still shows as owing money the
      // moment staff switch tabs, risking a duplicate collection attempt or
      // an unnecessary debt-reminder SMS to someone who already paid.
      utils.patient.getDebtors.invalidate();
    } catch (e: any) {
      if (!parseTierError(e?.message ?? "")) {
        toast.error(e?.message ?? "Failed to record payment");
      }
    }
  };

  const filteredBills = useMemo(() => {
    return (bills ?? []).filter((b: any) => {
      const p = patients?.find((x: any) => x.id === b.patientId);
      const name = p ? `${p.firstName} ${p.lastName || ""}`.toLowerCase() : "";
      const matchSearch = !searchTerm || name.includes(searchTerm.toLowerCase()) || b.billNumber.includes(searchTerm);
      const matchStatus = filterStatus === "all" || b.paymentStatus === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [bills, patients, searchTerm, filterStatus]);

  const totalRevenue = useMemo(() =>
    (bills ?? []).filter((b: any) => b.paymentStatus === "paid").reduce((s: number, b: any) => s + Number(b.grandTotal), 0),
    [bills]);

  const totalOutstanding = useMemo(() =>
    (bills ?? []).filter((b: any) => b.paymentStatus !== "paid").reduce((s: number, b: any) => s + Number(b.balanceAmount), 0),
    [bills]);

  const collectionRate = bills && bills.length > 0
    ? Math.round((totalRevenue / ((bills as any[]).reduce((s, b) => s + Number(b.grandTotal), 0))) * 100)
    : 0;

  function patientOf(patientId: number) {
    return patients?.find((p: any) => p.id === patientId);
  }

  function handleExportBills() {
    exportCsv("bills.csv",
      ["Bill No.", "Patient", "Date", "Total", "Paid", "Balance", "Status"],
      filteredBills.map((b: any) => {
        const p = patientOf(b.patientId);
        return [b.billNumber, p ? `${p.firstName} ${p.lastName || ""}` : "", new Date(b.billDate).toLocaleDateString(), Number(b.grandTotal), Number(b.amountPaid), Number(b.balanceAmount), b.paymentStatus];
      })
    );
  }

  function handleExportDebtors() {
    if (!debtors) return;
    exportCsv("debtors.csv",
      ["Patient", "Phone", "Bills", "Amount Owed", "Age"],
      debtors.map((d: any) => [
        `${d.patient.firstName} ${d.patient.lastName || ""}`,
        d.patient.phone || "",
        d.billCount,
        d.totalOwed,
        ageBucket(d.oldestBill),
      ])
    );
  }

  const TAB_LABELS: { id: Tab; label: string; mgr?: boolean }[] = [
    { id: "bills", label: "All Bills" },
    { id: "debtors", label: `Debtors${debtors && debtors.length > 0 ? ` (${debtors.length})` : ""}` },
    { id: "cash", label: "Daily Cash", mgr: true },
    { id: "templates", label: "Service Templates", mgr: true },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Billing</h1>
          <p className="text-gray-600 mt-1">Manage bills, payments, and revenue</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          {TAB_LABELS.filter((t) => !t.mgr || canManage).map((t) => (
            <Button key={t.id}
              variant={activeTab === t.id ? "default" : "outline"}
              className={activeTab === t.id && t.id === "debtors" ? "bg-red-600 hover:bg-red-700" : ""}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {/* BILLS TAB */}
        {activeTab === "bills" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Total Bills</p><p className="text-2xl font-bold">{bills?.length ?? 0}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Revenue Collected</p><p className="text-xl font-bold text-green-600">UGX {totalRevenue.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Outstanding</p><p className="text-xl font-bold text-red-600">UGX {totalOutstanding.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Collection Rate</p><p className="text-2xl font-bold">{collectionRate}%</p></CardContent></Card>
            </div>

            <Card>
              <CardContent className="pt-4">
                <div className="flex gap-3 flex-wrap items-center">
                  <Input placeholder="Search patient or bill number..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="max-w-xs" />
                  {(["all", "unpaid", "partial", "paid"] as const).map((s) => (
                    <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"}
                      className={filterStatus === s && s !== "all" ? s === "paid" ? "bg-green-600" : s === "unpaid" ? "bg-red-600" : "bg-yellow-600" : ""}
                      onClick={() => setFilterStatus(s)}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" onClick={handleExportBills}>
                    <Download className="w-3.5 h-3.5 mr-1" />CSV
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Bills ({filteredBills.length})</CardTitle></CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                ) : filteredBills.length === 0 ? (
                  <EmptyState
                    icon={Receipt}
                    title="No bills found"
                    description="Bills are created automatically when you complete a visit, or you can create one manually. Clear filters if you expected to see results."
                  />
                ) : (
                  <>
                    {/* ── Mobile bill cards ──────────────── */}
                    <div className="sm:hidden divide-y divide-gray-100">
                      {filteredBills.map((bill: any) => {
                        const patient = patientOf(bill.patientId);
                        const isVoided = bill.isVoided;
                        return (
                          <div key={bill.id} className={`p-4 space-y-2 ${isVoided ? "opacity-50" : ""}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm">{patient ? `${patient.firstName} ${patient.lastName || ""}` : "—"}</p>
                                <p className="text-xs text-gray-500">{bill.billNumber} · {new Date(bill.billDate).toLocaleDateString()}{isVoided && <span className="ml-1 text-red-500">VOIDED</span>}</p>
                              </div>
                              <div className="shrink-0 text-right space-y-0.5">
                                <p className="text-sm font-bold">UGX {Number(bill.grandTotal).toLocaleString()}</p>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_BG[bill.paymentStatus]}`}>{bill.paymentStatus}</span>
                              </div>
                            </div>
                            {Number(bill.balanceAmount) > 0 && (
                              <p className="text-xs text-red-600 font-medium">Balance: UGX {Number(bill.balanceAmount).toLocaleString()}</p>
                            )}
                            <div className="flex gap-1 flex-wrap pt-1">
                              {bill.paymentStatus !== "paid" && !isVoided && (
                                <Button size="sm" variant="outline" className="text-green-700 border-green-300 text-xs h-7"
                                  onClick={() => { setPayingBill(bill); setPayAmount(Number(bill.balanceAmount)); }}>Pay</Button>
                              )}
                              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => openReceiptWindow(bill, patient, clinic)}>Print</Button>
                              {canManage && bill.paymentStatus !== "paid" && !isVoided && (
                                <VoidDialog bill={bill} onVoided={() => { refetch(); utils.patient.getDebtors.invalidate(); }} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* ── Desktop table ────────────────────── */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="text-left py-3 px-4">Bill No.</th>
                            <th className="text-left py-3 px-4">Patient</th>
                            <th className="text-left py-3 px-4">Date</th>
                            <th className="text-right py-3 px-4">Total</th>
                            <th className="text-right py-3 px-4">Paid</th>
                            <th className="text-right py-3 px-4">Balance</th>
                            <th className="text-left py-3 px-4">Status</th>
                            <th className="text-left py-3 px-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredBills.map((bill: any) => {
                            const patient = patientOf(bill.patientId);
                            const isVoided = bill.isVoided;
                            return (
                              <tr key={bill.id} className={`hover:bg-gray-50 ${isVoided ? "opacity-50" : ""}`}>
                                <td className="py-3 px-4 font-medium">{bill.billNumber}{isVoided && <span className="ml-1 text-xs text-red-500">VOIDED</span>}</td>
                                <td className="py-3 px-4">{patient ? `${patient.firstName} ${patient.lastName || ""}` : "—"}</td>
                                <td className="py-3 px-4">{new Date(bill.billDate).toLocaleDateString()}</td>
                                <td className="py-3 px-4 text-right">UGX {Number(bill.grandTotal).toLocaleString()}</td>
                                <td className="py-3 px-4 text-right text-green-700">UGX {Number(bill.amountPaid).toLocaleString()}</td>
                                <td className="py-3 px-4 text-right text-red-700">UGX {Number(bill.balanceAmount).toLocaleString()}</td>
                                <td className="py-3 px-4">
                                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BG[bill.paymentStatus]}`}>
                                    {bill.paymentStatus === "paid" ? <CheckCircle className="w-3 h-3 inline mr-1" /> : <Clock className="w-3 h-3 inline mr-1" />}
                                    {bill.paymentStatus}
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex gap-1 flex-wrap">
                                    {bill.paymentStatus !== "paid" && !isVoided && (
                                      <Button size="sm" variant="outline" className="text-green-700 border-green-300 text-xs"
                                        onClick={() => { setPayingBill(bill); setPayAmount(Number(bill.balanceAmount)); }}>Pay</Button>
                                    )}
                                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => openReceiptWindow(bill, patient, clinic)}>Print</Button>
                                    {canManage && bill.paymentStatus !== "paid" && !isVoided && (
                                      <VoidDialog bill={bill} onVoided={() => { refetch(); utils.patient.getDebtors.invalidate(); }} />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {bills && bills.length >= billsLimit && (
                      <div className="p-4 text-center border-t">
                        <Button variant="outline" size="sm" onClick={() => setBillsLimit((n) => n + 100)}>
                          Load more bills
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* DEBTORS TAB */}
        {activeTab === "debtors" && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
              <p className="text-red-800 text-sm font-medium">
                Total Outstanding: <strong>UGX {((debtors ?? []) as any[]).reduce((s, d) => s + d.totalOwed, 0).toLocaleString()}</strong>
                &nbsp;·&nbsp;{debtors?.length ?? 0} patients
              </p>
              <Button size="sm" variant="outline" onClick={handleExportDebtors}>
                <Download className="w-3.5 h-3.5 mr-1" />Export CSV
              </Button>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Outstanding Balances</CardTitle>
                <CardDescription>Debt aging and one-click SMS reminders</CardDescription>
              </CardHeader>
              <CardContent>
                {debtorsLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                ) : !debtors || debtors.length === 0 ? (
                  <div className="text-center py-8 text-green-600 font-medium">🎉 No outstanding debts</div>
                ) : (
                  <>
                    {/* ── Mobile debtor cards ─────────────── */}
                    <div className="sm:hidden divide-y divide-gray-100">
                      {(debtors as any[]).sort((a, b) => b.totalOwed - a.totalOwed).map((d) => (
                        <div key={d.patient.id} className="p-4 flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-0.5">
                            <p className="font-semibold text-sm">{d.patient.firstName} {d.patient.lastName || ""}</p>
                            <p className="text-xs text-gray-500">{d.patient.phone || "No phone"} · {d.billCount} bill{d.billCount !== 1 ? "s" : ""}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ageBucketColor(d.oldestBill)}`}>{ageBucket(d.oldestBill)}</span>
                          </div>
                          <div className="shrink-0 text-right space-y-1.5">
                            <p className="text-sm font-bold text-red-700">UGX {d.totalOwed.toLocaleString()}</p>
                            <Button size="sm" variant="outline" className="text-xs text-blue-700 border-blue-300 h-7 block"
                              disabled={!d.patient.phone || sendReminderMutation.isPending}
                              onClick={() => sendReminderMutation.mutate({ patientId: d.patient.id, amount: d.totalOwed })}>
                              {d.patient.phone ? "Send SMS" : "No Phone"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* ── Desktop table ────────────────────── */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="text-left py-3 px-4">Patient</th>
                            <th className="text-left py-3 px-4">Phone</th>
                            <th className="text-center py-3 px-4">Bills</th>
                            <th className="text-right py-3 px-4">Owed</th>
                            <th className="text-left py-3 px-4">Age</th>
                            <th className="text-left py-3 px-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(debtors as any[]).sort((a, b) => b.totalOwed - a.totalOwed).map((d) => (
                            <tr key={d.patient.id} className="hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium">{d.patient.firstName} {d.patient.lastName || ""}</td>
                              <td className="py-3 px-4 text-gray-600">{d.patient.phone || "—"}</td>
                              <td className="py-3 px-4 text-center">{d.billCount}</td>
                              <td className="py-3 px-4 text-right font-bold text-red-700">UGX {d.totalOwed.toLocaleString()}</td>
                              <td className="py-3 px-4"><span className={`text-xs px-2 py-1 rounded-full font-medium ${ageBucketColor(d.oldestBill)}`}>{ageBucket(d.oldestBill)}</span></td>
                              <td className="py-3 px-4">
                                <Button size="sm" variant="outline" className="text-xs text-blue-700 border-blue-300"
                                  disabled={!d.patient.phone || sendReminderMutation.isPending}
                                  onClick={() => sendReminderMutation.mutate({ patientId: d.patient.id, amount: d.totalOwed })}>
                                  {d.patient.phone ? "Send SMS" : "No Phone"}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* DAILY CASH TAB */}
        {activeTab === "cash" && canManage && <DailyReconciliation />}

        {/* SERVICE TEMPLATES TAB */}
        {activeTab === "templates" && canManage && <ServiceTemplatesPanel />}
      </div>

      {/* Payment dialog */}
      {payingBill && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h2 className="text-lg font-bold">Record Payment — {payingBill.billNumber}</h2>
            <p className="text-sm text-gray-600">Balance due: <strong>UGX {Number(payingBill.balanceAmount).toLocaleString()}</strong></p>
            <div className="space-y-1">
              <Label>Amount Received (UGX)</Label>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mtn_momo">MTN Mobile Money</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPayingBill(null)}>Cancel</Button>
              <Button className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={markPaidMutation.isPending || payAmount <= 0}
                onClick={handleMarkPaid}>
                {markPaidMutation.isPending ? "Saving..." : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
