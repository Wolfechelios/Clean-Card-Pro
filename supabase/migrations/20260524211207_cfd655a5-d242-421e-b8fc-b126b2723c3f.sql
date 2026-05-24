REVOKE EXECUTE ON FUNCTION public.is_card_owner_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_card_owner_path(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.path_card_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.path_card_id(text) TO authenticated;