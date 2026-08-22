import { useEffect } from "react";
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
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";

const acceptSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type AcceptFormData = z.infer<typeof acceptSchema>;

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const inviteQuery = trpc.staff.getInviteInfo.useQuery({ token });

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
  });

  useEffect(() => {
    if (inviteQuery.data?.valid && inviteQuery.data.email) {
      setValue("email", inviteQuery.data.email);
    }
  }, [inviteQuery.data, setValue]);

  const acceptMutation = trpc.staff.acceptInvite.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate("/dashboard");
    },
    onError: (error) => toast.error(error.message),
  });

  const onSubmit = (data: AcceptFormData) => {
    acceptMutation.mutate({ token, ...data });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Activity className="w-8 h-8 text-green-600" />
          <span className="text-2xl font-bold text-gray-900">CareDesk</span>
        </div>

        <Card>
          {isAuthenticated && !loading ? (
            <>
              <CardHeader>
                <CardTitle>You're already signed in</CardTitle>
                <CardDescription>
                  Invite links are for setting up a new account. If this invite is meant
                  for a different account, sign out first and open the link again.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/dashboard" className="text-sm text-green-600 hover:text-green-700 font-medium">
                  Go to dashboard
                </Link>
              </CardContent>
            </>
          ) : inviteQuery.isLoading ? (
            <CardContent className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </CardContent>
          ) : inviteQuery.data?.valid ? (
            <>
              <CardHeader>
                <CardTitle>Join {inviteQuery.data.clinicName}</CardTitle>
                <CardDescription>
                  You've been invited as a <span className="capitalize font-medium">{inviteQuery.data.role}</span>. Set up your login to get started.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Your name</Label>
                    <Input id="name" {...register("name")} placeholder="e.g. Jane Mukasa" />
                    {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" {...register("email")} placeholder="you@example.com" />
                    {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" {...register("password")} placeholder="At least 8 characters" />
                    {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
                  </div>

                  <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={acceptMutation.isPending}>
                    {acceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Accept invite & sign in"}
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Invite link invalid</CardTitle>
                <CardDescription>
                  This invite link has expired, already been used, or doesn't exist. Ask your manager to send a new one.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/login" className="text-sm text-green-600 hover:text-green-700 font-medium">
                  Go to sign in
                </Link>
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center mt-6">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
