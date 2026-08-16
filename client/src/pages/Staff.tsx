import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { mutationErrorToast } from "@/lib/utils";
import { UserPlus, Loader2, Copy, X, RefreshCw } from "lucide-react";

type StaffRole = "receptionist" | "doctor" | "manager";

const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  receptionist: "Can register patients, manage appointments, and open visits for walk-ins. Best for front-desk staff.",
  doctor: "Everything a receptionist can do, plus recording diagnoses, prescriptions, and vitals during visits.",
  manager: "Full access including billing, revenue reports, staff management, and clinic settings.",
};

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "Never";
  return new Date(date).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" });
}

function InviteDialog({ atLimit = false, tier = "free" }: { atLimit?: boolean; tier?: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("receptionist");
  const [result, setResult] = useState<{ inviteLink: string; smsStatus?: string; emailStatus?: string } | null>(null);

  const inviteMutation = trpc.staff.invite.useMutation({
    onSuccess: (data) => {
      setResult(data);
      utils.staff.listPendingInvites.invalidate();
    },
    onError: (e) => mutationErrorToast(e),
  });

  const reset = () => {
    setEmail("");
    setPhone("");
    setRole("receptionist");
    setResult(null);
  };

  const copyLink = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.inviteLink);
    toast.success("Invite link copied");
  };

  const handleTriggerClick = () => {
    if (atLimit) {
      toast.error(
        tier === "free"
          ? "You've reached the 1-staff limit on the Free plan. Upgrade to Clinic (UGX 90,000/mo) for up to 5 staff members."
          : "You've reached your plan's staff limit. Upgrade to Pro for unlimited staff.",
        { duration: 8000 }
      );
      return;
    }
    setOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button
          className={atLimit ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}
          onClick={(e) => { e.preventDefault(); handleTriggerClick(); }}
          title={atLimit ? "Staff limit reached — upgrade to invite more" : undefined}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Invite Staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite a staff member</DialogTitle>
              <DialogDescription>
                Send an invite by phone (SMS) or email. They'll set up their own login when they accept.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-phone">Phone number</Label>
                <Input id="invite-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email (optional)</Label>
                <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receptionist">Receptionist</SelectItem>
                    <SelectItem value="doctor">Doctor</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                className="bg-green-600 hover:bg-green-700"
                disabled={inviteMutation.isPending || (!email && !phone)}
                onClick={() => inviteMutation.mutate({
                  email: email || undefined,
                  phone: phone || undefined,
                  role,
                })}
              >
                {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Invite"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite sent</DialogTitle>
              <DialogDescription>
                {result.smsStatus === "sent" && "An SMS with the invite link was sent."}
                {result.emailStatus === "sent" && " An email with the invite link was sent."}
                {result.smsStatus !== "sent" && result.emailStatus !== "sent" &&
                  "We couldn't deliver the SMS or email automatically - share this link with them directly."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.inviteLink} className="text-xs" />
              <Button size="icon" variant="outline" onClick={copyLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} className="bg-green-600 hover:bg-green-700">Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Staff() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const canManage = user?.role === "manager" || user?.role === "admin";

  const { data: staffList, isLoading } = trpc.staff.list.useQuery(undefined, { enabled: canManage });
  const { data: pendingInvites } = trpc.staff.listPendingInvites.useQuery(undefined, { enabled: canManage });

  // Tier status for staff limit enforcement
  const { data: tierStatus } = trpc.clinic.getTierStatus.useQuery(undefined, { enabled: canManage });
  const staffLimit = tierStatus?.limits?.maxStaff ?? null;
  const activeStaff = tierStatus?.usage?.activeStaff ?? 0;
  const atStaffLimit = staffLimit !== null && activeStaff >= staffLimit;
  const tier = tierStatus?.tier ?? "free";

  const updateRoleMutation = trpc.staff.updateRole.useMutation({
    onSuccess: () => { toast.success("Role updated"); utils.staff.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const setActiveMutation = trpc.staff.setActive.useMutation({
    onSuccess: () => {
      toast.success("Status updated");
      utils.staff.list.invalidate();
      // Deactivating/reactivating changes countActiveStaff, which feeds
      // getTierStatus.usage.activeStaff — the exact number this page uses
      // (line ~174) to decide whether the Invite button is enabled. Without
      // this, freeing up a slot on the 1-staff Free tier by deactivating
      // someone wouldn't unlock inviting a replacement until a full reload.
      utils.clinic.getTierStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelInviteMutation = trpc.staff.cancelInvite.useMutation({
    onSuccess: () => { toast.success("Invite cancelled"); utils.staff.listPendingInvites.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const resendInviteMutation = trpc.staff.resendInvite.useMutation({
    onSuccess: (data) => {
      if (data.smsStatus === "sent" || data.emailStatus === "sent") toast.success("Invite resent");
      else toast.success("Invite link refreshed - copy it below to share manually");
      utils.staff.listPendingInvites.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!canManage) {
    return (
      <DashboardLayout>
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500">Only managers can view and manage staff.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Staff</h1>
            <p className="text-gray-600 mt-1">Manage who has access to your clinic</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {staffLimit !== null && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${atStaffLimit ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {activeStaff}/{staffLimit} staff used
                {atStaffLimit && tier === "free" && " — upgrade to add more"}
              </span>
            )}
            <InviteDialog atLimit={atStaffLimit} tier={tier} />
          </div>
        </div>

        {pendingInvites && pendingInvites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Invites</CardTitle>
              <CardDescription>Invites that haven't been accepted yet</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-6 px-6">
              <Table className="min-w-[500px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.phone || invite.email}</TableCell>
                      <TableCell className="capitalize">{invite.role}</TableCell>
                      <TableCell>{formatDate(invite.expiresAt)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm" variant="outline"
                          disabled={resendInviteMutation.isPending}
                          onClick={() => resendInviteMutation.mutate({ inviteId: invite.id })}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          Resend
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          disabled={cancelInviteMutation.isPending}
                          onClick={() => cancelInviteMutation.mutate({ inviteId: invite.id })}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>Everyone with access to this clinic</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
              <Table className="min-w-[540px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffList?.map((member) => {
                    const isSelf = member.id === user?.id;
                    return (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}</TableCell>
                        <TableCell>{member.email || member.phone || "—"}</TableCell>
                        <TableCell>
                          {isSelf || member.role === "admin" ? (
                            <Badge variant="secondary" className="capitalize">{member.role}</Badge>
                          ) : (
                            <Select
                              value={member.role}
                              onValueChange={(role) => updateRoleMutation.mutate({ userId: member.id, role: role as StaffRole })}
                            >
                              <SelectTrigger className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="receptionist">Receptionist</SelectItem>
                                <SelectItem value="doctor">Doctor</SelectItem>
                                <SelectItem value="manager">Manager</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>{formatDate(member.lastSignedIn)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={member.isActive}
                              disabled={isSelf}
                              onCheckedChange={(checked) => setActiveMutation.mutate({ userId: member.id, isActive: checked })}
                            />
                            <Badge variant={member.isActive ? "default" : "destructive"}>
                              {member.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
