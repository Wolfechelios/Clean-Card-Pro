import { supabase } from "@/integrations/supabase/client";

import { disabledSupabaseFunctionInvoke } from "@/lib/supabaseFunctionsDisabled";
export async function callCloudLLM(prompt: string): Promise<string> {
  const { data, error } = await disabledSupabaseFunctionInvoke("identify-card", {
    body: { prompt }
  });
  
  if (error) throw new Error(error.message);
  return data?.response || data?.cardData || JSON.stringify(data);
}
