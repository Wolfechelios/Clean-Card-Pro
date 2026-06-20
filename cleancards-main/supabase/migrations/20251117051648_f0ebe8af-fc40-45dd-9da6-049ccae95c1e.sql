-- Enable real-time updates for the cards table
ALTER TABLE public.cards REPLICA IDENTITY FULL;

-- Add cards table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.cards;