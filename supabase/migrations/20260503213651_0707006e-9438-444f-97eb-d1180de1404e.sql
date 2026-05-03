-- Add a RESTRICTIVE policy so only admins can INSERT/UPDATE/DELETE on user_roles.
-- The existing permissive "Admins can manage all roles" policy still grants admin access;
-- this RESTRICTIVE policy adds a hard floor that no permissive policy can bypass.

CREATE POLICY "Only admins can write roles (restrictive)"
ON public.user_roles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));