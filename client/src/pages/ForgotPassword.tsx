import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

const schema = z.object({ email: z.string().email("Enter a valid email address") });

export default function ForgotPassword() {
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const mutation = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => toast.success("If that email exists, a reset link is on its way"),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <Activity className="w-8 h-8 text-green-600" />
          <span className="text-2xl font-bold text-gray-900">CareDesk</span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reset your password</CardTitle>
            <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register("email")} placeholder="you@clinic.com" />
                {errors.email && <p className="text-sm text-red-600">{errors.email.message as string}</p>}
              </div>
              <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
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
