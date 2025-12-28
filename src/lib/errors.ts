import { toast } from "sonner";
import { z } from "zod";

// ============= Error Types =============

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ErrorCode =
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "VALIDATION_ERROR"
  | "API_ERROR"
  | "RATE_LIMIT"
  | "PAYMENT_REQUIRED"
  | "NOT_FOUND"
  | "UNKNOWN";

// ============= Error Handling =============

export function handleApiError(error: unknown): AppError {
  // Supabase function errors
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: string }).message;
    
    if (message.includes("Rate limit")) {
      return new AppError("Rate limit exceeded. Please try again later.", "RATE_LIMIT", error);
    }
    if (message.includes("Payment required") || message.includes("credits")) {
      return new AppError("AI credits exhausted. Please add credits.", "PAYMENT_REQUIRED", error);
    }
    if (message.includes("unauthorized") || message.includes("Unauthorized")) {
      return new AppError("You must be logged in to perform this action.", "AUTH_ERROR", error);
    }
    if (message.includes("not found") || message.includes("Not found")) {
      return new AppError("The requested resource was not found.", "NOT_FOUND", error);
    }
    
    return new AppError(message, "API_ERROR", error);
  }

  // Standard Error
  if (error instanceof Error) {
    return new AppError(error.message, "UNKNOWN", error);
  }

  // Fetch errors
  if (typeof error === "string") {
    return new AppError(error, "UNKNOWN");
  }

  return new AppError("An unexpected error occurred", "UNKNOWN", error);
}

export function showErrorToast(error: unknown): void {
  const appError = error instanceof AppError ? error : handleApiError(error);
  
  const toastConfig: Record<ErrorCode, { title: string; description?: string }> = {
    NETWORK_ERROR: { title: "Network Error", description: "Check your connection and try again." },
    AUTH_ERROR: { title: "Authentication Required", description: appError.message },
    VALIDATION_ERROR: { title: "Validation Error", description: appError.message },
    API_ERROR: { title: "API Error", description: appError.message },
    RATE_LIMIT: { title: "Rate Limited", description: "Please wait a moment and try again." },
    PAYMENT_REQUIRED: { title: "Credits Exhausted", description: "Please add credits to continue." },
    NOT_FOUND: { title: "Not Found", description: appError.message },
    UNKNOWN: { title: "Error", description: appError.message },
  };

  const config = toastConfig[appError.code];
  toast.error(config.title, { description: config.description });
}

// ============= Zod Validation Helpers =============

export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: AppError } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errorMessage = result.error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join(", ");
  
  console.error("Validation failed:", errorMessage, data);
  
  return {
    success: false,
    error: new AppError(`Invalid response: ${errorMessage}`, "VALIDATION_ERROR", result.error),
  };
}

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = safeValidate(schema, data);
  if (result.success === false) {
    throw result.error;
  }
  return result.data;
}

// ============= Async Error Wrapper =============

export async function tryCatch<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<{ data: T; error: null } | { data: null; error: AppError }> {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    const appError = handleApiError(err);
    console.error(`Error${context ? ` in ${context}` : ""}:`, appError);
    return { data: null, error: appError };
  }
}
