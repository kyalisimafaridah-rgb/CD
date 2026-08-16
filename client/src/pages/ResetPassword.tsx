import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const ROLE_REDIRECT: Record<string, string> = {
  admin: "/owner",
  manager: "/dashboard",
  doctor: "/visits",
  receptionist: "/patients",
};

const schema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const mutation = trpc.auth.resetPassword.useMutation({
    onSuccess: async (data) => {
      await utils.auth.me.invalidate();
      toast.success("Password reset successfully");
      navigate(ROLE_REDIRECT[data.role] ?? "/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Activity className="w-8 h-8 text-green-600" />
          <span className="text-2xl font-bold text-foreground">CareDesk</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>Choose a strong password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => mutation.mutate({ token, password: d.password }))} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" {...register("password")} placeholder="At least 8 characters" />
                {errors.password && <p className="text-sm text-red-600">{errors.password.message as string}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input id="confirmPassword" type="password" {...register("confirmPassword")} placeholder="Same as above" />
                {errors.confirmPassword && <p className="text-sm text-red-600">{errors.confirmPassword.message as string}</p>}
              </div>
              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Set password & sign in"}
              </Button>
            </form>
            <p className="text-sm text-center mt-6">
              <Link href="/login" className="text-green-600 hover:text-green-700 font-medium">Back to sign in</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
