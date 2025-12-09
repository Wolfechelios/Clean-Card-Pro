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
    // PSA verification page - we check if the cert exists by fetching the page
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return { verified: false, verificationUrl };
    }

    const html = await response.text();
    
    // Check if the cert was found (PSA shows specific content for valid certs)
    const isValid = !html.includes("Cert Not Found") && 
                    !html.includes("No results found") &&
                    html.includes("PSA Certification Verification");

    // Try to extract card details from the page
    let cardName = "";
    let cardSet = "";
    let grade = "";

    const gradeMatch = html.match(/Grade:\s*<[^>]*>([^<]+)/i) || 
                       html.match(/<span[^>]*class="[^"]*grade[^"]*"[^>]*>([^<]+)/i);
    if (gradeMatch) grade = gradeMatch[1].trim();

    const nameMatch = html.match(/Card:\s*<[^>]*>([^<]+)/i);
    if (nameMatch) cardName = nameMatch[1].trim();

    return {
      verified: isValid,
      verificationUrl,
      cardName,
      cardSet,
      grade,
    };
  } catch (error) {
    console.error("PSA verification error:", error);
    return { verified: false, verificationUrl, error: "Failed to verify" };
  }
}

async function verifyCGC(certNumber: string): Promise<VerificationResult> {
  const verificationUrl = `https://www.cgccards.com/certlookup/${certNumber}`;
  
  try {
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return { verified: false, verificationUrl };
    }

    const html = await response.text();
    
    // CGC shows certification details for valid certs
    const isValid = !html.includes("not found") && 
                    !html.includes("No certification") &&
                    (html.includes("CGC") || html.includes("certification"));

    return {
      verified: isValid,
      verificationUrl,
    };
  } catch (error) {
    console.error("CGC verification error:", error);
    return { verified: false, verificationUrl, error: "Failed to verify" };
  }
}

async function verifyBeckett(certNumber: string): Promise<VerificationResult> {
  const verificationUrl = `https://www.beckett.com/grading/card-lookup/${certNumber}`;
  
  try {
    const response = await fetch(verificationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return { verified: false, verificationUrl };
    }

    const html = await response.text();
    
    // Beckett shows card details for valid serial numbers
    const isValid = !html.includes("not found") && 
                    !html.includes("No results") &&
                    (html.includes("Beckett") || html.includes("BGS") || html.includes("BVG"));

    return {
      verified: isValid,
      verificationUrl,
    };
  } catch (error) {
    console.error("Beckett verification error:", error);
    return { verified: false, verificationUrl, error: "Failed to verify" };
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