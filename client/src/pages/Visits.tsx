import { useState, useMemo, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Stethoscope, Loader2, Flag } from "lucide-react";
import { PatientCombobox } from "@/components/PatientCombobox";
import { isDrugExpired, isDrugExpiringSoon } from "@shared/inventory";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { parseTierError } from "@shared/tiers";
import { EmptyState } from "@/components/EmptyState";

// ─── helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  pending: "bg-gray-100 text-gray-700",
};

// ─── Previous visit sidebar (shown to doctor during active visit) ─────────────

function PreviousVisitSidebar({ patientId }: { patientId: number }) {
  const { data: history } = trpc.patient.getFullHistory.useQuery({ patientId });

  return (
    <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-3">
      <p className="font-semibold text-gray-700">Patient Summary</p>
      {history?.patient?.allergies && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
          <p className="text-red-700 font-bold text-xs flex items-center gap-1">⚠️ ALLERGIES</p>
          <p className="text-red-800 text-sm font-medium mt-0.5">{history.patient.allergies}</p>
        </div>
      )}
      {history ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-xs text-center sm:grid-cols-3">
            <div className="bg-white rounded p-2">
              <p className="font-bold text-lg text-green-700">{history.totalVisits}</p>
              <p className="text-gray-500">Visits</p>
            </div>
            <div className="bg-white rounded p-2">
              <p className="font-bold text-sm text-blue-700">UGX {history.totalSpent.toLocaleString()}</p>
              <p className="text-gray-500">Paid</p>
            </div>
            <div className={`rounded p-2 ${history.totalOwed > 0 ? "bg-red-50" : "bg-white"}`}>
              <p className={`font-bold text-sm ${history.totalOwed > 0 ? "text-red-700" : "text-gray-400"}`}>
                UGX {history.totalOwed.toLocaleString()}
              </p>
              <p className="text-gray-500">Owes</p>
            </div>
          </div>
          {history.visits.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Last Visit</p>
              <div className="bg-white rounded p-2 text-xs">
                <p className="font-medium">{new Date(history.visits[0].visitDate).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" })}</p>
                {history.visits[0].diagnosis && <p className="text-gray-600">Dx: {history.visits[0].diagnosis}</p>}
                {history.visits[0].prescriptionNotes && <p className="text-gray-500 italic">Rx: {history.visits[0].prescriptionNotes}</p>}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-400 text-xs">Loading...</p>
      )}
    </div>
  );
}

// ─── Follow-up flag dialog ────────────────────────────────────────────────────

function FollowUpDialog({ visitId, onSaved }: { visitId: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");

  const mutation = trpc.visit.flagFollowUp.useMutation({
    onSuccess: () => {
      toast.success("Follow-up scheduled — SMS sent to patient");
      setOpen(false);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-orange-600 text-xs">
          <Flag className="w-3.5 h-3.5 mr-1" />Follow-up
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule Follow-up</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Follow-up Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={new Date().toISOString().split("T")[0]} />
          <p className="text-xs text-muted-foreground">Patient will receive an SMS reminder with this date.</p>
        </div>
        <DialogFooter>
          <Button
            className="bg-green-600 hover:bg-green-700"
            disabled={mutation.isPending || !date}
            onClick={() => mutation.mutate({ id: visitId, followUpFlag: true, followUpDate: date })}
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Schedule & Notify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New Visit form ───────────────────────────────────────────────────────────

function NewVisitDialog({ onCreated }: { onCreated: () => void }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [consultationFee, setConsultationFee] = useState(0);
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [prescriptionNotes, setPrescriptionNotes] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [labTests, setLabTests] = useState<{ testName: string; cost: number }[]>([]);
  const [prescribedDrugs, setPrescribedDrugs] = useState<{ drugId?: number; drugName: string; quantity: number; costPerUnit: number; dosage: string; unit: string }[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);

  const { data: patients } = trpc.patient.list.useQuery();
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const drugInventoryEnabled = tierStatus?.limits?.drugInventory ?? false;
  const { data: drugs } = trpc.drug.list.useQuery(undefined, {
    enabled: drugInventoryEnabled,
    // Don't surface a tier error toast here — free tier simply gets no autocomplete
    onError: () => {},
  });

  // This is the longest, most interruption-prone form in the app — patient,
  // diagnosis, notes, and a growing list of drugs/lab tests, all typed while
  // a receptionist is fielding a busy front desk. Warn before an accidental
  // tab close/reload throws all of that away. Doesn't catch in-app nav (tab
  // switches within the app don't reload the page, so there's nothing for
  // beforeunload to intercept there) — just the "phone locked and reloaded
  // the page" / "hit refresh by habit" cases, which cost the most rework.
  useEffect(() => {
    if (!open) return;
    const hasUnsavedWork =
      !!selectedPatientId || !!diagnosis || !!chiefComplaint || !!clinicalNotes ||
      !!prescriptionNotes || labTests.length > 0 || prescribedDrugs.length > 0;
    if (!hasUnsavedWork) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, selectedPatientId, diagnosis, chiefComplaint, clinicalNotes, prescriptionNotes, labTests.length, prescribedDrugs.length]);
  const { data: serviceTemplates } = trpc.clinic.getServiceTemplates.useQuery(undefined, { onError: () => {} });
  const labTemplates = serviceTemplates?.filter((t: any) => t.category === "lab");

  // Tier status — visit limit pre-check and warning badge, mirrors Patients.tsx
  const visitLimit = tierStatus?.limits?.maxVisitsPerMonth ?? null;
  const visitsThisMonth = tierStatus?.usage?.visitsThisMonth ?? 0;
  const atVisitLimit = visitLimit !== null && visitsThisMonth >= visitLimit;
  const nearVisitLimit = visitLimit !== null && visitsThisMonth >= Math.floor(visitLimit * 0.8);

  const totalLabCost = labTests.reduce((s, t) => s + (t.cost || 0), 0);
  const totalDrugCost = prescribedDrugs.reduce((s, d) => s + (d.costPerUnit * d.quantity || 0), 0);
  const grandTotal = consultationFee + totalLabCost + totalDrugCost;

  const mutation = useOfflineMutation({
    procedure: "visit.create",
    label: (input) => {
      const p = patients?.find((pt: any) => pt.id === input.patientId);
      return `Visit: ${p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : "Patient"}${
        (input.prescribedDrugs as unknown[] | undefined)?.length ? " (+ drugs dispensed)" : ""
      }`;
    },
  });

  const reset = () => {
    setSelectedPatientId(""); setConsultationFee(0); setChiefComplaint("");
    setClinicalNotes(""); setPrescriptionNotes(""); setDiagnosis("");
    setLabTests([]); setPrescribedDrugs([]); setShowSidebar(false);
  };

  const drugFromInventory = (index: number, drugId: string) => {
    const drug = drugs?.find((d: any) => d.id.toString() === drugId);
    if (!drug) return;
    const updated = [...prescribedDrugs];
    updated[index] = { ...updated[index], drugId: drug.id, drugName: drug.drugName, costPerUnit: Number(drug.sellingPrice), unit: drug.unit };
    setPrescribedDrugs(updated);
  };

  const handleSubmit = async () => {
    if (!selectedPatientId) { toast.error("Please select a patient"); return; }

    // Drug stock isn't re-checked against the server until this syncs, so a
    // device that's been offline for a while could be dispensing against a
    // stale count. The atomic deduct at sync time protects the database
    // (it will never go negative), but the nurse should know the number
    // they're looking at right now might already be wrong.
    if (!mutation.isOnline && prescribedDrugs.length > 0) {
      const ok = window.confirm(
        "You're offline and this visit includes drugs. Stock counts on this screen may be out of date — " +
        "if someone else already dispensed the last units elsewhere, this will need review once it syncs.\n\nContinue?"
      );
      if (!ok) return;
    }

    try {
      const result = await mutation.mutate({
        patientId: parseInt(selectedPatientId),
        visitDate: new Date().toISOString(),
        chiefComplaint: chiefComplaint || undefined,
        clinicalNotes: clinicalNotes || undefined,
        prescriptionNotes: prescriptionNotes || undefined,
        diagnosis: diagnosis || undefined,
        consultationFee,
        labTests: labTests.length ? labTests : undefined,
        prescribedDrugs: prescribedDrugs.length ? prescribedDrugs : undefined,
      });
      if (result.queued) {
        toast.success("Saved offline — visit will be recorded and bill generated once you're back online.");
      } else {
        toast.success("Visit recorded — bill generated");
      }
      setOpen(false);
      reset();
      onCreated();
      // Without this, the visit-limit badge and disabled-at-limit button state
      // (added above) go stale immediately — someone could cross the 30-visit
      // cap, still see the button green and "29/30", and hit a confusing
      // rejection on their next attempt instead of the intended proactive block.
      utils.clinic.getTierStatus.invalidate();
    } catch (e: any) {
      if (!parseTierError(e?.message ?? "")) {
        toast.error(e?.message ?? "Failed to record visit");
      }
    }
  };

  return (
    <div className="flex items-center gap-3">
      {nearVisitLimit && visitLimit && (
        <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${atVisitLimit ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
          {visitsThisMonth}/{visitLimit} visits this month
        </span>
      )}
      <Dialog open={open} onOpenChange={(o) => {
        if (o && atVisitLimit) {
          toast.error(`You've reached the ${visitLimit}-visit monthly limit on the Free plan. Upgrade to Clinic (UGX 90,000/mo) for unlimited visits.`);
          return;
        }
        setOpen(o); if (!o) reset();
      }}>
      <DialogTrigger asChild>
        <Button
          className={atVisitLimit ? "bg-gray-400 cursor-not-allowed hover:bg-gray-400" : "bg-green-600 hover:bg-green-700"}
        >
          <Plus className="w-4 h-4 mr-2" />New Visit
        </Button>
      </DialogTrigger>
      <DialogContent className={`max-h-[95dvh] overflow-y-auto w-full ${showSidebar ? "sm:max-w-3xl" : "sm:max-w-2xl"}`}>
        <DialogHeader><DialogTitle>Register New Visit</DialogTitle></DialogHeader>

        <div className={`gap-4 ${showSidebar && selectedPatientId ? "grid grid-cols-1 lg:grid-cols-3" : ""}`}>
          <div className="col-span-2 space-y-4">
            {/* Patient select */}
            <div className="space-y-1">
              <Label>Patient *</Label>
              <PatientCombobox
                patients={patients}
                value={selectedPatientId}
                onChange={(id) => { setSelectedPatientId(id); setShowSidebar(true); }}
              />
            </div>

            <div className="space-y-1">
              <Label>Consultation Fee (UGX) *</Label>
              <Input type="number" value={consultationFee === 0 ? "" : consultationFee}
                placeholder="e.g. 20000"
                onChange={(e) => setConsultationFee(e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)} />
            </div>

            <div className="space-y-1">
              <Label>Chief Complaint</Label>
              <Input value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} placeholder="Main reason for visit" />
            </div>

            <div className="space-y-1">
              <Label>Clinical Notes</Label>
              <textarea value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none h-20"
                placeholder="Clinical observations..." />
            </div>

            <div className="space-y-1">
              <Label>Prescription Notes <span className="text-xs text-muted-foreground">(visible to billing clerk)</span></Label>
              <textarea value={prescriptionNotes} onChange={(e) => setPrescriptionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none h-16"
                placeholder="Amoxicillin 500mg x2/day x5 days..." />
            </div>

            <div className="space-y-1">
              <Label>Diagnosis</Label>
              <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Diagnosis" />
            </div>

            {/* Lab Tests */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Lab Tests</Label>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setLabTests([...labTests, { testName: "", cost: 0 }])}>
                  <Plus className="w-3 h-3 mr-1" />Add
                </Button>
              </div>
              {labTemplates && labTemplates.length > 0 && (
                <select
                  className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600"
                  value=""
                  onChange={(e) => {
                    const t = labTemplates.find((t: any) => String(t.id) === e.target.value);
                    if (t) setLabTests([...labTests, { testName: t.name, cost: Number(t.price) }]);
                  }}
                >
                  <option value="">+ Add from catalog...</option>
                  {labTemplates.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name} — UGX {Number(t.price).toLocaleString()}</option>
                  ))}
                </select>
              )}
              {labTests.length > 0 && (
                <div className="flex gap-2 mb-1 px-1">
                  <span className="flex-1 text-[11px] font-medium text-gray-500">Test name</span>
                  <span className="w-28 text-[11px] font-medium text-gray-500">Cost (UGX)</span>
                  <span className="w-9" />{/* spacer matching the delete button's width */}
                </div>
              )}
              {labTests.map((test, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <Input placeholder="Test name" aria-label="Test name" value={test.testName}
                    onChange={(e) => { const u = [...labTests]; u[i].testName = e.target.value; setLabTests(u); }}
                    className="flex-1" />
                  <Input type="number" placeholder="Cost" aria-label="Cost (UGX)"
                    value={test.cost === 0 ? "" : test.cost}
                    onChange={(e) => { const u = [...labTests]; u[i].cost = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0; setLabTests(u); }}
                    className="w-28" />
                  <Button type="button" variant="ghost" size="sm"
                    onClick={() => setLabTests(labTests.filter((_, idx) => idx !== i))}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Prescribed Drugs */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Prescribed Drugs</Label>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => setPrescribedDrugs([...prescribedDrugs, { drugName: "", quantity: 1, costPerUnit: 0, dosage: "", unit: "tablets" }])}>
                  <Plus className="w-3 h-3 mr-1" />Add
                </Button>
              </div>
              {prescribedDrugs.map((drug, i) => (
                <div key={i} className="border rounded p-3 mb-2 space-y-2">
                  <div className="flex gap-2">
                    <select className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      onChange={(e) => drugFromInventory(i, e.target.value)}>
                      <option value="">From inventory</option>
                      {drugs?.filter((d: any) => !isDrugExpired(d.expiryDate)).map((d: any) => {
                        const expiringSoon = isDrugExpiringSoon(d.expiryDate);
                        return (
                          <option key={d.id} value={d.id}>
                            {d.drugName} (Stock: {d.quantity}){expiringSoon ? ` — expires ${new Date(d.expiryDate).toLocaleDateString()}` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => setPrescribedDrugs(prescribedDrugs.filter((_, idx) => idx !== i))}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="space-y-0.5">
                      <span className="block text-[11px] font-medium text-gray-500">Drug name</span>
                      <Input placeholder="Drug name" aria-label="Drug name" value={drug.drugName}
                        onChange={(e) => { const u = [...prescribedDrugs]; u[i].drugName = e.target.value; setPrescribedDrugs(u); }} />
                    </div>
                    <div className="space-y-0.5">
                      <span className="block text-[11px] font-medium text-gray-500">Quantity</span>
                      <Input type="number" placeholder="Qty" aria-label="Quantity"
                        value={drug.quantity === 0 ? "" : drug.quantity}
                        onChange={(e) => { const u = [...prescribedDrugs]; u[i].quantity = e.target.value === "" ? 0 : parseInt(e.target.value) || 0; setPrescribedDrugs(u); }} />
                    </div>
                    <div className="space-y-0.5">
                      <span className="block text-[11px] font-medium text-gray-500">Price/unit (UGX)</span>
                      <Input type="number" placeholder="Price/unit" aria-label="Price per unit (UGX)"
                        value={drug.costPerUnit === 0 ? "" : drug.costPerUnit}
                        onChange={(e) => { const u = [...prescribedDrugs]; u[i].costPerUnit = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0; setPrescribedDrugs(u); }} />
                    </div>
                  </div>
                  {!drug.drugId && drug.drugName && (
                    <p className="text-xs text-amber-600">Typed manually — won't deduct from Drug Inventory stock.</p>
                  )}
                  <div className="space-y-0.5">
                    <span className="block text-[11px] font-medium text-gray-500">Dosage instructions</span>
                    <Input placeholder="Dosage instructions" aria-label="Dosage instructions" value={drug.dosage}
                      onChange={(e) => { const u = [...prescribedDrugs]; u[i].dosage = e.target.value; setPrescribedDrugs(u); }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Consultation:</span><span>UGX {consultationFee.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Lab Tests:</span><span>UGX {totalLabCost.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Drugs:</span><span>UGX {totalDrugCost.toLocaleString()}</span></div>
              <div className="flex justify-between font-bold border-t pt-1"><span>Grand Total:</span><span>UGX {grandTotal.toLocaleString()}</span></div>
            </div>

            <Button className="w-full bg-green-600 hover:bg-green-700" disabled={mutation.isPending} onClick={handleSubmit}>
              {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</> : "Save Visit & Generate Bill"}
            </Button>
          </div>

          {/* Previous visits sidebar */}
          {showSidebar && selectedPatientId && (
            <div className="col-span-1">
              <PreviousVisitSidebar patientId={parseInt(selectedPatientId)} />
            </div>
          )}
        </div>
      </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Visits() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const { data: visits, isLoading, refetch } = trpc.visit.list.useQuery();
  const { data: patients } = trpc.patient.list.useQuery();

  const canCreate = user?.role === "doctor" || user?.role === "manager" || user?.role === "admin" || user?.role === "receptionist";

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return visits ?? [];
    return (visits ?? []).filter((v: any) => {
      const p = patients?.find((x: any) => x.id === v.patientId);
      return (
        (p?.firstName ?? "").toLowerCase().includes(q) ||
        (p?.lastName ?? "").toLowerCase().includes(q) ||
        (v.diagnosis ?? "").toLowerCase().includes(q) ||
        (v.chiefComplaint ?? "").toLowerCase().includes(q)
      );
    });
  }, [visits, patients, search]);

  function patientName(patientId: number) {
    const p = patients?.find((x: any) => x.id === patientId);
    return p ? `${p.firstName} ${p.lastName ?? ""}`.trim() : `Patient #${patientId}`;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Visit Registration</h1>
            <p className="text-gray-600 mt-1">Record patient consultations and treatments</p>
          </div>
          {canCreate && <NewVisitDialog onCreated={refetch} />}
        </div>

        <Card className="p-4">
          <Input
            placeholder="Search by patient name or diagnosis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Visits ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Stethoscope}
                title={search ? "No visits match your search" : "No visits yet"}
                description={
                  search
                    ? "Try a different patient name or clear the search."
                    : "Start a visit from the button above. You can record consultation notes, prescribe medicines, and generate a bill in one step."
                }
              />
            ) : (
              <>
                {/* ── Mobile cards ─────────────────────── */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {filtered.map((visit: any) => (
                    <div key={visit.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{patientName(visit.patientId)}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(visit.visitDate).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" })}
                            {visit.chiefComplaint ? ` · ${visit.chiefComplaint}` : ""}
                          </p>
                          {visit.diagnosis && <p className="text-xs text-gray-700 mt-0.5">Dx: {visit.diagnosis}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-gray-900">UGX {Number(visit.consultationFee).toLocaleString()}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[visit.status ?? "completed"]}`}>
                            {visit.status ?? "completed"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 items-center">
                        {visit.followUpFlag && <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">follow-up {visit.followUpDate ? `· ${new Date(visit.followUpDate).toLocaleDateString("en-UG", { day: "numeric", month: "short" })}` : ""}</span>}
                        {visit.prescriptionNotes && <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">Rx</span>}
                        {/* Every visit is created with status "completed" (routers.ts
                            visit.create) — a "not completed yet" gate here meant this
                            button could never render. Follow-up scheduling makes sense
                            for any visit that doesn't already have one flagged. */}
                        {!visit.followUpFlag && (
                          <FollowUpDialog visitId={visit.id} onSaved={refetch} />
                        )}
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
                        <th className="text-left py-3 px-4">Date</th>
                        <th className="text-left py-3 px-4">Complaint</th>
                        <th className="text-left py-3 px-4">Diagnosis</th>
                        <th className="text-left py-3 px-4">Fee</th>
                        <th className="text-left py-3 px-4">Status</th>
                        <th className="text-left py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((visit: any) => (
                        <tr key={visit.id} className="hover:bg-gray-50">
                          <td className="py-3 px-4 font-medium">{patientName(visit.patientId)}</td>
                          <td className="py-3 px-4">{new Date(visit.visitDate).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="py-3 px-4 text-gray-600 max-w-[150px] truncate">{visit.chiefComplaint || "—"}</td>
                          <td className="py-3 px-4 text-gray-600 max-w-[150px] truncate">{visit.diagnosis || "—"}</td>
                          <td className="py-3 px-4">UGX {Number(visit.consultationFee).toLocaleString()}</td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[visit.status ?? "completed"]}`}>{visit.status ?? "completed"}</span>
                              {visit.followUpFlag && <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">follow-up</span>}
                              {visit.prescriptionNotes && <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700" title={visit.prescriptionNotes}>Rx</span>}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {!visit.followUpFlag && <FollowUpDialog visitId={visit.id} onSaved={refetch} />}
                            {visit.followUpFlag && <span className="text-xs text-orange-600">📅 {visit.followUpDate ? new Date(visit.followUpDate).toLocaleDateString("en-UG", { day: "numeric", month: "short" }) : "No date"}</span>}
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
    </DashboardLayout>
  );
}
