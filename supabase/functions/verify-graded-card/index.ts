import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerificationResult {
  verified: boolean;
  verificationUrl: string;
  cardName?: string;
  cardSet?: string;
  grade?: string;
  error?: string;
}

async function verifyPSA(certNumber: string): Promise<VerificationResult> {
  const verificationUrl = `https://www.psacard.com/cert/${certNumber}`;
  
  try {
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const html = await response.text();
    
    // Check for explicit "not found" messages
    const notFound = html.toLowerCase().includes("cert not found") || 
                     html.toLowerCase().includes("no results found") ||
                     html.toLowerCase().includes("invalid cert");
    
    // Check for PSA certification page indicators
    const hasPositiveIndicators = html.includes("PSA") && 
                                  (html.includes("Certification") || 
                                   html.includes("Grade") ||
                                   html.includes("cert"));

    const isValid = !notFound && hasPositiveIndicators && response.ok;

    // Try to extract card details from the page
    let cardName = "";
    let cardSet = "";
    let grade = "";

    const gradeMatch = html.match(/Grade:\s*<[^>]*>([^<]+)/i) || 
                       html.match(/<span[^>]*class="[^"]*grade[^"]*"[^>]*>([^<]+)/i);
    if (gradeMatch) grade = gradeMatch[1].trim();

    const nameMatch = html.match(/Card:\s*<[^>]*>([^<]+)/i);
    if (nameMatch) cardName = nameMatch[1].trim();

    console.log(`PSA verification: status=${response.status}, notFound=${notFound}, hasPositive=${hasPositiveIndicators}`);

    return {
      verified: isValid,
      verificationUrl,
      cardName,
      cardSet,
      grade,
    };
  } catch (error) {
    console.error("PSA verification error:", error);
    return { verified: false, verificationUrl, error: "Could not auto-verify - please check manually" };
  }
}

async function verifyCGC(certNumber: string): Promise<VerificationResult> {
  const verificationUrl = `https://www.cgccards.com/certlookup/${certNumber}`;
  
  try {
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    });

    // CGC redirects to the cert page if valid, returns 200 for lookup page
    // A successful lookup typically shows the certification details
    const html = await response.text();
    
    // Check for explicit "not found" messages
    const notFound = html.toLowerCase().includes("not found") || 
                     html.toLowerCase().includes("no certification") ||
                     html.toLowerCase().includes("invalid cert") ||
                     html.toLowerCase().includes("no results");
    
    // Check for positive indicators - CGC pages typically have these
    const hasPositiveIndicators = html.includes("CGC") || 
                                  html.includes("certlookup") ||
                                  html.includes("Certification") ||
                                  html.includes("Grade:") ||
                                  response.status === 200;

    // If we got a valid response without "not found", consider it potentially valid
    // User can click through to verify manually
    const isValid = !notFound && hasPositiveIndicators && response.ok;

    console.log(`CGC verification: status=${response.status}, notFound=${notFound}, hasPositive=${hasPositiveIndicators}`);

    return {
      verified: isValid,
      verificationUrl,
    };
  } catch (error) {
    console.error("CGC verification error:", error);
    // Return verification URL even on error so user can check manually
    return { verified: false, verificationUrl, error: "Could not auto-verify - please check manually" };
  }
}

async function verifyBeckett(certNumber: string): Promise<VerificationResult> {
  const verificationUrl = `https://www.beckett.com/grading/card-lookup/${certNumber}`;
  
  try {
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const html = await response.text();
    
    // Check for explicit "not found" messages
    const notFound = html.toLowerCase().includes("not found") || 
                     html.toLowerCase().includes("no results") ||
                     html.toLowerCase().includes("invalid");
    
    // Check for Beckett/BGS indicators
    const hasPositiveIndicators = html.includes("Beckett") || 
                                  html.includes("BGS") || 
                                  html.includes("BVG") ||
                                  html.includes("Grade");

    const isValid = !notFound && hasPositiveIndicators && response.ok;

    console.log(`Beckett verification: status=${response.status}, notFound=${notFound}, hasPositive=${hasPositiveIndicators}`);

    return {
      verified: isValid,
      verificationUrl,
    };
  } catch (error) {
    console.error("Beckett verification error:", error);
    return { verified: false, verificationUrl, error: "Could not auto-verify - please check manually" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { certNumber, gradingCompany } = await req.json();

    if (!certNumber || !gradingCompany) {
      return new Response(
        JSON.stringify({ error: "Cert number and grading company required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Clean the cert number (remove spaces, dashes)
    const cleanCertNumber = certNumber.replace(/[\s-]/g, "");

    let result: VerificationResult;

    switch (gradingCompany.toUpperCase()) {
      case "PSA":
        result = await verifyPSA(cleanCertNumber);
        break;
      case "CGC":
        result = await verifyCGC(cleanCertNumber);
        break;
      case "BECKETT":
      case "BGS":
      case "BVG":
        result = await verifyBeckett(cleanCertNumber);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown grading company: ${gradingCompany}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    console.log(`Verification result for ${gradingCompany} #${cleanCertNumber}:`, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Verification error:", error);
    return new Response(
      JSON.stringify({ 
        verified: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});