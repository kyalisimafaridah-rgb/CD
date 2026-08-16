import { useState, useMemo, useEffect, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Users, Plus, Search, Trash2, Edit2, History, Loader2, Flag, X, Clock, ChevronRight, Download,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOfflineMutation } from "@/hooks/useOfflineMutation";
import { parseTierError } from "@shared/tiers";
import { exportCsv } from "@/lib/csv";
import { EmptyState } from "@/components/EmptyState";

// ─── Types ───────────────────────────────────────────────────────────────────

type Patient = {
  id: number;
  patientId: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
  village?: string | null;
  nextOfKin?: string | null;
  nextOfKinPhone?: string | null;
  medicalHistory?: string | null;
  allergies?: string | null;
  flags?: string | null;
  smsOptOut?: boolean;
  isActive?: boolean;
  createdAt?: Date | string | null;
};

type PatientFlag = "chronic" | "vip" | "owes_money" | "follow_up";

const FLAG_LABELS: Record<PatientFlag, string> = {
  chronic: "Chronic",
  vip: "VIP",
  owes_money: "Owes Money",
  follow_up: "Follow-up",
};

const FLAG_COLORS: Record<PatientFlag, string> = {
  chronic: "bg-orange-100 text-orange-700",
  vip: "bg-purple-100 text-purple-700",
  owes_money: "bg-red-100 text-red-700",
  follow_up: "bg-blue-100 text-blue-700",
};

function parseFlags(flags: string | null | undefined): PatientFlag[] {
  if (!flags) return [];
  return flags.split(",").filter((f): f is PatientFlag => f in FLAG_LABELS);
}

function serializeFlags(flags: PatientFlag[]): string {
  return [...new Set(flags)].join(",");
}

function PatientFlagBadges({ flags }: { flags: string | null | undefined }) {
  const parsed = parseFlags(flags);
  if (!parsed.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.map((f) => (
        <span key={f} className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${FLAG_COLORS[f]}`}>
          {FLAG_LABELS[f]}
        </span>
      ))}
    </div>
  );
}

// ─── Register / Edit form ─────────────────────────────────────────────────────

const patientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  age: z.number().min(0).max(150).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  village: z.string().optional(),
  nextOfKin: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  medicalHistory: z.string().optional(),
  allergies: z.string().optional(),
  forceCreate: z.boolean().optional(),
});

type PatientFormData = z.infer<typeof patientSchema>;

function PatientForm({
  defaultValues,
  onSubmit,
  isPending,
  submitLabel = "Register Patient",
  quickMode = false,
}: {
  defaultValues?: Partial<PatientFormData>;
  onSubmit: (data: PatientFormData) => void;
  isPending: boolean;
  submitLabel?: string;
  quickMode?: boolean;
}) {
  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<PatientFormData>({
    resolver: zodResolver(patientSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>First Name *</Label>
          <Input {...register("firstName")} placeholder="John" />
          {errors.firstName && <p className="text-xs text-red-600">{errors.firstName.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Last Name</Label>
          <Input {...register("lastName")} placeholder="Doe" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Phone</Label>
        <Input {...register("phone")} placeholder="07XXXXXXXX" />
      </div>
      {!quickMode && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Date of Birth</Label>
              <Input
                type="date"
                {...register("dateOfBirth")}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setValue("dateOfBirth", e.target.value);
                  if (e.target.value) {
                    const dob = new Date(e.target.value);
                    const years = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                    setValue("age", years);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">Preferred if known — auto-fills Age and stays accurate every year</p>
            </div>
            <div className="space-y-1">
              <Label>Age {watch("dateOfBirth") && <span className="text-xs text-gray-400">(auto)</span>}</Label>
              <Input {...register("age", { valueAsNumber: true })} type="number" min={0} max={150} disabled={!!watch("dateOfBirth")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Gender</Label>
            <Select onValueChange={(v) => setValue("gender", v as "male" | "female" | "other")}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Village / Address</Label>
            <Input {...register("village")} placeholder="Village name" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Next of Kin *</Label>
              <Input {...register("nextOfKin")} placeholder="Name" />
            </div>
            <div className="space-y-1">
              <Label>Next of Kin Phone *</Label>
              <Input {...register("nextOfKinPhone")} placeholder="07XXXXXXXX" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Medical History</Label>
            <textarea
              {...register("medicalHistory")}
              placeholder="Pre-existing conditions, past surgeries..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none h-20"
            />
          </div>
          <div className="space-y-1">
            <Label>Allergies</Label>
            <Input {...register("allergies")} placeholder="e.g. Penicillin" />
          </div>
        </>
      )}
      <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={isPending}>
        {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}

// ─── Patient Profile Panel ────────────────────────────────────────────────────

function SmsOptOutToggle({ patient }: { patient: Patient }) {
  const utils = trpc.useUtils();
  const mutation = trpc.patient.updateSmsOptOut.useMutation({
    onSuccess: () => { toast.success("Preference saved"); utils.patient.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="flex items-center justify-between text-sm bg-muted rounded-lg p-3">
      <div>
        <p className="font-medium text-muted-foreground">SMS notifications</p>
        <p className="text-xs text-muted-foreground">Appointment reminders, payment receipts, and debt reminders</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{patient.smsOptOut ? "Opted out" : "Enabled"}</span>
        <Switch
          checked={!patient.smsOptOut}
          disabled={mutation.isPending}
          onCheckedChange={(checked) => mutation.mutate({ id: patient.id, smsOptOut: !checked })}
        />
      </div>
    </div>
  );
}

function PatientProfile({
  patient,
  onClose,
  onEdit,
}: {
  patient: Patient;
  onClose: () => void;
  onEdit: (p: Patient) => void;
}) {
  const { data: history, isLoading } = trpc.patient.getFullHistory.useQuery(
    { patientId: patient.id },
    { enabled: !!patient.id }
  );

  const flags = parseFlags(patient.flags);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-green-700 text-white px-6 py-4 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold">{patient.firstName} {patient.lastName || ""}</h2>
            <p className="text-green-200 text-sm">{patient.patientId} · {patient.phone || "No phone"}</p>
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {flags.map((f) => (
                  <span key={f} className="text-xs bg-card/20 px-1.5 py-0.5 rounded-full">
                    {FLAG_LABELS[f]}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => onEdit(patient)} className="text-green-200 hover:text-white text-sm underline">Edit</button>
            <button onClick={onClose} className="text-white hover:text-green-200 text-2xl leading-none ml-2">×</button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-green-400" /></div>
        ) : history ? (
          <div className="overflow-y-auto flex-1 p-6 space-y-5">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{history.totalVisits}</p>
                <p className="text-xs text-muted-foreground">Visits</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-sm font-bold text-blue-700">UGX {history.totalSpent.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Paid</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${history.totalOwed > 0 ? "bg-red-50" : "bg-muted"}`}>
                <p className={`text-sm font-bold ${history.totalOwed > 0 ? "text-red-700" : "text-muted-foreground"}`}>
                  UGX {history.totalOwed.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Outstanding</p>
              </div>
            </div>

            {(patient.nextOfKin || patient.nextOfKinPhone) && (
              <div className="text-sm bg-muted rounded-lg p-3">
                <p className="font-medium text-muted-foreground mb-1">Next of Kin</p>
                <p>{patient.nextOfKin || "—"} · {patient.nextOfKinPhone || "—"}</p>
              </div>
            )}

            {(patient.medicalHistory || patient.allergies) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
                {patient.medicalHistory && <p><strong>Medical History:</strong> {patient.medicalHistory}</p>}
                {patient.allergies && <p className="mt-1 text-red-700"><strong>⚠️ Allergies:</strong> {patient.allergies}</p>}
              </div>
            )}

            {patient.phone && <SmsOptOutToggle patient={patient} />}

            <div>
              <h3 className="font-semibold text-foreground mb-3">Visit History</h3>
              {history.visits.length === 0 ? (
                <p className="text-muted-foreground text-sm">No visits recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {history.visits.map((visit: any) => (
                    <div key={visit.id} className="border rounded-lg p-4 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-semibold">
                            {new Date(visit.visitDate).toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                          </p>
                          {visit.chiefComplaint && <p className="text-muted-foreground">Complaint: {visit.chiefComplaint}</p>}
                          {visit.diagnosis && <p className="text-muted-foreground font-medium">Diagnosis: {visit.diagnosis}</p>}
                        </div>
                        <div className="text-right">
                          <p className="font-bold">UGX {Number(visit.consultationFee).toLocaleString()}</p>
                          {visit.bill && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${visit.bill.paymentStatus === "paid" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {visit.bill.paymentStatus}
                            </span>
                          )}
                        </div>
                      </div>
                      {visit.labTests?.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground"><strong>Lab:</strong> {visit.labTests.map((t: any) => t.testName).join(", ")}</p>
                      )}
                      {visit.drugs?.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground"><strong>Drugs:</strong> {visit.drugs.map((d: any) => `${d.drugName} ×${d.quantity}`).join(", ")}</p>
                      )}
                      {visit.clinicalNotes && (
                        <p className="mt-2 text-xs text-muted-foreground italic">Notes: {visit.clinicalNotes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-muted-foreground">Could not load patient history</div>
        )}
      </div>
    </div>
  );
}

// ─── Flags Editor ─────────────────────────────────────────────────────────────

function FlagsEditor({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [active, setActive] = useState<PatientFlag[]>(parseFlags(patient.flags));

  const mutation = trpc.patient.updateFlags.useMutation({
    onSuccess: () => {
      utils.patient.list.invalidate();
      toast.success("Flags updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggle = (f: PatientFlag) =>
    setActive((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg p-6 w-full max-w-sm shadow-xl space-y-4">
        <h2 className="text-lg font-bold">Flags — {patient.firstName}</h2>
        <div className="space-y-2">
          {(Object.keys(FLAG_LABELS) as PatientFlag[]).map((f) => (
            <label key={f} className="flex items-center gap-3 cursor-pointer">
              <Switch checked={active.includes(f)} onCheckedChange={() => toggle(f)} />
              <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${FLAG_COLORS[f]}`}>{FLAG_LABELS[f]}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={mutation.isPending}
            onClick={() => mutation.mutate({ id: patient.id, flags: serializeFlags(active) })}>
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const MAX_RECENT = 5;
const RECENT_KEY = "caredesk_recent_patients";

function loadRecent(): number[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch { return []; }
}

function saveRecent(id: number, prev: number[]): number[] {
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export default function Patients() {
  const { user } = useAuth();
  const canDelete = user?.role === "manager" || user?.role === "admin";

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [editPatient, setEditPatient] = useState<Patient | null>(null);
  const [profilePatient, setProfilePatient] = useState<Patient | null>(null);
  const [flagsPatient, setFlagsPatient] = useState<Patient | null>(null);
  const [recentIds, setRecentIds] = useState<number[]>(loadRecent);
  const utils = trpc.useUtils();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Tier status — used for patient limit pre-check and warning banner
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery();
  const patientLimit = tierStatus?.limits?.maxPatientsPerMonth ?? null;
  const patientsThisMonth = tierStatus?.usage?.patientsThisMonth ?? 0;
  const atLimit = patientLimit !== null && patientsThisMonth >= patientLimit;
  const nearLimit = patientLimit !== null && patientsThisMonth >= Math.floor(patientLimit * 0.8);

  // Days until patient counter resets
  const now = new Date();
  const daysUntilReset = Math.ceil(
    (new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Pre-check before opening the register form
  const handleOpenRegister = () => {
    if (atLimit) {
      toast.error(
        `You've reached the ${patientLimit}-patient monthly limit on the Free plan. The counter resets in ${daysUntilReset} day${daysUntilReset === 1 ? "" : "s"}, or upgrade to Clinic (UGX 90,000/mo) for unlimited patients.`,
        { duration: 8000 }
      );
      return;
    }
    setRegisterOpen(true);
  };

  const { data: patients, isLoading, refetch } = trpc.patient.list.useQuery();
  const [showInactive, setShowInactive] = useState(false);
  const { data: inactivePatients, isLoading: inactiveLoading, refetch: refetchInactive } =
    trpc.patient.listInactive.useQuery(undefined, { enabled: showInactive && canDelete });
  const restoreMutation = trpc.patient.restore.useMutation({
    onSuccess: () => { toast.success("Patient restored"); refetchInactive(); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const filteredPatients = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return patients ?? [];
    return (patients ?? []).filter(
      (p) =>
        p.firstName.toLowerCase().includes(q) ||
        (p.lastName ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").includes(q) ||
        p.patientId.toLowerCase().includes(q)
    );
  }, [patients, debouncedSearch]);

  const recentPatients = useMemo(() =>
    recentIds.map((id) => patients?.find((p) => p.id === id)).filter(Boolean) as Patient[],
    [recentIds, patients]
  );

  const openProfile = useCallback((p: Patient) => {
    setRecentIds((prev) => saveRecent(p.id, prev));
    setProfilePatient(p);
  }, []);

  const exportPatientsCsv = useCallback(() => {
    const rows = filteredPatients;
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    exportCsv(
      `caredesk-patients-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Patient ID",
        "First Name",
        "Last Name",
        "Phone",
        "Age",
        "Gender",
        "Village",
        "Next of Kin",
        "Next of Kin Phone",
        "Flags",
        "SMS Opt-Out",
        "Allergies",
        "Medical History",
      ],
      rows.map((p) => [
        p.patientId,
        p.firstName,
        p.lastName ?? "",
        p.phone ?? "",
        p.age ?? "",
        p.gender ?? "",
        p.village ?? "",
        p.nextOfKin ?? "",
        p.nextOfKinPhone ?? "",
        p.flags ?? "",
        p.smsOptOut ? "yes" : "no",
        p.allergies ?? "",
        p.medicalHistory ?? "",
      ])
    );
  }, [filteredPatients]);

  const createMutation = useOfflineMutation({
    procedure: "patient.create",
    label: (input) => `New patient: ${input.firstName as string} ${(input.lastName as string) ?? ""}`.trim(),
  });
  const updateMutation = trpc.patient.update.useMutation({
    onSuccess: () => { toast.success("Patient updated"); refetch(); setEditPatient(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.patient.delete.useMutation({
    onSuccess: () => { toast.success("Patient deleted"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = async (data: PatientFormData) => {
    try {
      const result = await createMutation.mutate(data);
      if (result.queued) {
        toast.success("Saved offline — will register once you're back online.");
      } else {
        toast.success("Patient registered");
      }
      setRegisterOpen(false);
      refetch();
      // Without this, the "X/30 patients this month" badge and the register-
      // button's disabled-at-limit state stay stale until a full page reload —
      // someone could register their 30th patient, see the badge still say
      // "29/30", and click Register again only to hit a confusing rejection.
      utils.clinic.getTierStatus.invalidate();
    } catch (err: any) {
      // Duplicate-patient detection needs a live lookup against the server,
      // so it only fires on the online path — a queued registration made
      // offline can't check this in advance and will surface here (as
      // "needs review" in the Sync Issues panel) if it turns out to be a
      // dupe once it actually syncs.
      if (err?.data?.code === "CONFLICT" && (err.message === "DUPLICATE_PATIENT" || err.message === "DUPLICATE_PATIENT_PHONE")) {
        const warningText = err.message === "DUPLICATE_PATIENT_PHONE"
          ? "A patient with this exact phone number already exists (name entered differently)."
          : "A patient with this name already exists.";
        const ok = window.confirm(`${warningText}\n\nAre you sure this is a different person? Click OK to register anyway.`);
        if (ok) {
          try {
            const result = await createMutation.mutate({ ...data, forceCreate: true });
            toast.success(result.queued ? "Saved offline — will register once you're back online." : "Patient registered");
            setRegisterOpen(false);
            refetch();
            utils.clinic.getTierStatus.invalidate();
          } catch { toast.error("Failed to register patient"); }
        }
      } else if (!parseTierError(err?.message ?? "")) {
        toast.error(err?.message ?? "Failed to register patient");
      }
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Patients</h1>
            <p className="text-muted-foreground mt-1">Manage patient records and medical history</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {nearLimit && patientLimit && (
              <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${atLimit ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                {patientsThisMonth}/{patientLimit} patients this month
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={exportPatientsCsv}
              disabled={!patients || patients.length === 0}
              title="Export the current (filtered) patient list as CSV"
            >
              <Download className="w-4 h-4 mr-1.5" />
              Export CSV
            </Button>
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button
                  className={`${atLimit ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}
                  onClick={(e) => { e.preventDefault(); handleOpenRegister(); }}
                  title={atLimit ? `Monthly limit reached — resets in ${daysUntilReset} days` : undefined}
                >
                <Plus className="w-4 h-4 mr-2" />Register Patient
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center justify-between pr-8">
                  <DialogTitle>Register New Patient</DialogTitle>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch checked={quickMode} onCheckedChange={setQuickMode} />
                    Quick
                  </label>
                </div>
              </DialogHeader>
              {quickMode && (
                <p className="text-xs text-muted-foreground -mt-2">Quick mode — name and phone only. Fill in the rest from the patient's profile later.</p>
              )}
              <PatientForm onSubmit={handleCreate} isPending={createMutation.isPending} quickMode={quickMode} />
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Recently viewed */}
        {recentPatients.length > 0 && !searchQuery && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Recently viewed</span>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {recentPatients.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openProfile(p)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm hover:bg-muted transition-colors"
                  >
                    <span>{p.firstName} {p.lastName || ""}</span>
                    <span className="text-muted-foreground text-xs">{p.patientId}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search */}
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search by name, phone, or patient ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {canDelete && (
              <Button variant="outline" size="sm" onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Hide" : "Show"} deactivated patients
              </Button>
            )}
          </div>
        </Card>

        {showInactive && canDelete && (
          <Card className="border-amber-200">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-muted-foreground mb-3">Deactivated patients — their records are kept, just hidden from the main list</p>
              {inactiveLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !inactivePatients || inactivePatients.length === 0 ? (
                <p className="text-sm text-gray-400">No deactivated patients</p>
              ) : (
                <div className="space-y-2">
                  {inactivePatients.map((p: any) => (
                    <div key={p.id} className="flex justify-between items-center bg-muted rounded p-2 text-sm">
                      <span>{p.firstName} {p.lastName || ""} — {p.patientId}</span>
                      <Button size="sm" variant="outline" disabled={restoreMutation.isPending}
                        onClick={() => restoreMutation.mutate({ id: p.id })}>
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Patient list */}
        <Card>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">Loading patients...</div>
          ) : filteredPatients.length === 0 ? (
            <EmptyState
              icon={Users}
              title={debouncedSearch ? "No patients match your search" : "No patients yet"}
              description={
                debouncedSearch
                  ? "Try a different name, phone number, or patient ID."
                  : "Register your first patient to start recording visits and bills. It only takes a minute."
              }
              actionLabel={debouncedSearch ? undefined : "Register Patient"}
              onAction={debouncedSearch ? undefined : handleOpenRegister}
            />
          ) : (
            <>
              {/* ── Mobile card list ─────────────────── */}
              <div className="sm:hidden divide-y divide-gray-100">
                {filteredPatients.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start justify-between p-4 hover:bg-muted cursor-pointer"
                    onClick={() => openProfile(p)}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-semibold text-foreground truncate">
                        {p.firstName} {p.lastName || ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.patientId} · {p.phone || "No phone"}{p.age ? ` · Age ${p.age}` : ""}
                      </p>
                      <PatientFlagBadges flags={p.flags} />
                    </div>
                    <div
                      className="flex items-center gap-3 ml-3 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => setFlagsPatient(p)} className="text-orange-500 hover:text-orange-700 p-1"><Flag className="w-4 h-4" /></button>
                      <button onClick={() => setEditPatient(p)} className="text-blue-600 hover:text-blue-800 p-1"><Edit2 className="w-4 h-4" /></button>
                      {canDelete && (
                        <button
                          onClick={() => {
                            if (!window.confirm(`Remove ${p.firstName} from the active patient list? Their records are kept — this can be reversed by a manager if needed.`)) return;
                            deleteMutation.mutate({ id: p.id });
                          }}
                          className="text-red-600 hover:text-red-800 p-1"
                        ><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* ── Desktop table ────────────────────── */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">ID</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Name</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Phone</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Age</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Flags</th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredPatients.map((p) => (
                      <tr key={p.id} className="hover:bg-muted cursor-pointer" onClick={() => openProfile(p)}>
                        <td className="px-6 py-4 text-sm font-medium text-foreground">{p.patientId}</td>
                        <td className="px-6 py-4 text-sm text-foreground font-medium">{p.firstName} {p.lastName || ""}</td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">{p.phone || "—"}</td>
                        <td className="px-6 py-4 text-sm text-muted-foreground">{p.age ?? "—"}</td>
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}><PatientFlagBadges flags={p.flags} /></td>
                        <td className="px-6 py-4 text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button title="View profile" onClick={() => openProfile(p)} className="text-purple-600 hover:text-purple-800"><History className="w-4 h-4" /></button>
                            <button title="Edit flags" onClick={() => setFlagsPatient(p)} className="text-orange-500 hover:text-orange-700"><Flag className="w-4 h-4" /></button>
                            <button title="Edit patient" onClick={() => setEditPatient(p)} className="text-blue-600 hover:text-blue-800"><Edit2 className="w-4 h-4" /></button>
                            {canDelete && (
                              <button
                                title="Delete patient"
                                onClick={() => { if (!window.confirm(`Remove ${p.firstName} from the active patient list? Their records are kept — this can be reversed by a manager if needed.`)) return; deleteMutation.mutate({ id: p.id }); }}
                                className="text-red-600 hover:text-red-800"
                              ><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Edit patient dialog */}
      {editPatient && (
        <Dialog open={!!editPatient} onOpenChange={(o) => { if (!o) setEditPatient(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Patient — {editPatient.patientId}</DialogTitle>
            </DialogHeader>
            <PatientForm
              defaultValues={editPatient}
              onSubmit={(data) => updateMutation.mutate({ id: editPatient.id, ...data })}
              isPending={updateMutation.isPending}
              submitLabel="Save Changes"
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Flags editor */}
      {flagsPatient && (
        <FlagsEditor patient={flagsPatient} onClose={() => setFlagsPatient(null)} />
      )}

      {/* Patient profile panel */}
      {profilePatient && (
        <PatientProfile
          patient={profilePatient}
          onClose={() => setProfilePatient(null)}
          onEdit={(p) => { setProfilePatient(null); setEditPatient(p); }}
        />
      )}
    </DashboardLayout>
  );
}
