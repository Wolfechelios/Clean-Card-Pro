export async function callCloudLLM(prompt: string) {
  return await supabase.functions.invoke("identify-card", {
    body: { prompt }
  });
}
