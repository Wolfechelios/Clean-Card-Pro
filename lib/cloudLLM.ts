import { supabase } from "@/integrations/supabase/client";

export async function callCloudLLM(prompt: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("identify-card", {
    body: { prompt }
  });
  
  if (error) throw new Error(error.message);
  return data?.response || data?.cardData || JSON.stringify(data);
}
