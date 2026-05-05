import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearCleanCardAuthCache, supabase, supabaseRuntimeStatus } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Scan, Wrench } from "lucide-react";

function cleanAuthError(error: any) {
  const message = String(error?.message || error || "Unknown auth error");
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Invalid email or password. If this account was recreated after a repo/deploy mix-up, use Sign Up or reset the password in Supabase.";
  }
  if (lower.includes("email not confirmed")) {
    return "Email is not confirmed. Confirm the account in Supabase Auth or turn off email confirmation for testing.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Clean Card Pro cannot reach Supabase. Check the deployed repo/env vars and your internet connection.";
  }
  if (lower.includes("supabaseurl") || lower.includes("api key") || lower.includes("invalid key")) {
    return "Supabase configuration is wrong or missing. The app needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.";
  }
  if (lower.includes("refresh") || lower.includes("session_not_found")) {
    return "Your saved login session is stale. Use the Repair Sign-In button below, then sign in again.";
  }
  return message;
}

const Auth = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);

  const diagnosticText = useMemo(() => {
    const status = supabaseRuntimeStatus;
    return [
      `Project: ${status.projectRef}`,
      `VITE URL: ${status.hasViteUrl ? "present" : "missing — fallback active"}`,
      `VITE Key: ${status.hasVitePublishableKey ? "present" : "missing — fallback active"}`,
    ].join(" • ");
  }, []);

  const handleRepairSignIn = async () => {
    setIsRepairing(true);
    try {
      await clearCleanCardAuthCache();
      toast.success("Clean Card Pro sign-in cache repaired. Sign in again.");
      setLastError(null);
      window.location.replace("/auth?repair=1");
    } catch (error: any) {
      const friendly = cleanAuthError(error);
      setLastError(friendly);
      toast.error(friendly);
    } finally {
      setIsRepairing(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLastError(null);

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      toast.success("Account created. You can now sign in.");
    } catch (error: any) {
      const friendly = cleanAuthError(error);
      setLastError(friendly);
      toast.error(friendly);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLastError(null);

    try {
      await clearCleanCardAuthCache();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;
      if (!data.session) throw new Error("Supabase accepted the request but returned no session. Check Auth URL settings.");

      toast.success("Signed in successfully.");
      navigate("/dashboard", { replace: true });
    } catch (error: any) {
      const friendly = cleanAuthError(error);
      setLastError(friendly);
      toast.error(friendly);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md shadow-elevated">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80">
            <Scan className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-3xl font-bold">Clean Card Pro</CardTitle>
          <CardDescription>
            Scan, identify, and price your trading cards instantly
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pb-0">
          <Alert className="text-left">
            {supabaseRuntimeStatus.isConfigured ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertTitle>Connection check</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              {diagnosticText}
            </AlertDescription>
          </Alert>

          {lastError && (
            <Alert variant="destructive" className="text-left">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Sign-in problem detected</AlertTitle>
              <AlertDescription>{lastError}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn}>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                <Button type="submit" className="w-full" disabled={isLoading || isRepairing}>
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleRepairSignIn}
                  disabled={isLoading || isRepairing}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  {isRepairing ? "Repairing..." : "Repair Sign-In / Clear Bad Deploy Cache"}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp}>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={6}
                  />
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={isLoading || isRepairing}>
                  {isLoading ? "Creating account..." : "Create Account"}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>
        </Tabs>

        <CardFooter className="flex-col space-y-2 pt-2 border-t">
          <p className="text-xs text-muted-foreground text-center">
            If the wrong repo was deployed yesterday, this screen now shows whether the live app has the expected Supabase connection.
          </p>
          <p className="text-xs text-muted-foreground text-center">
            On mobile, after signing in visit{" "}
            <a href="/mobile-scan" className="text-primary underline font-medium">
              /mobile-scan
            </a>{" "}
            to use your camera.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default Auth;
