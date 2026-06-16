
CREATE OR REPLACE FUNCTION public.is_card_owner_path(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.id = public.path_card_id(_path)
      AND c.user_id = auth.uid()
  )
$function$;
