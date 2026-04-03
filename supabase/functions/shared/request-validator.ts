/**
 * Request Validator
 * Spec 18.4: JSON body schema validation, payload size limits.
 */

const MAX_PAYLOAD_BYTES = 1_000_000; // 1MB
const MAX_MESSAGE_LENGTH = 5000;
const MAX_IMAGE_BASE64_LENGTH = 10_000_000; // ~7.5MB image

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateChatRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const b = body as Record<string, unknown>;

  // At least message or image required
  if (!b.message && !b.image_base64) {
    return { valid: false, error: 'message or image_base64 required.' };
  }

  // Message length check
  if (b.message && typeof b.message === 'string' && b.message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message too long. Max ${MAX_MESSAGE_LENGTH} characters.` };
  }

  // Image size check
  if (b.image_base64 && typeof b.image_base64 === 'string' && b.image_base64.length > MAX_IMAGE_BASE64_LENGTH) {
    return { valid: false, error: 'Image too large. Max ~7.5MB.' };
  }

  // Message type check
  if (b.message && typeof b.message !== 'string') {
    return { valid: false, error: 'message must be a string.' };
  }

  return { valid: true };
}

export function validatePlanRequest(body: unknown): ValidationResult {
  // Plan request needs no body or minimal body
  return { valid: true };
}

export function validateReportRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const b = body as Record<string, unknown>;

  if (b.type && !['daily', 'weekly'].includes(b.type as string)) {
    return { valid: false, error: 'type must be "daily" or "weekly".' };
  }

  return { valid: true };
}

/**
 * Check raw request payload size.
 */
export function checkPayloadSize(contentLength: string | null): ValidationResult {
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_BYTES) {
    return { valid: false, error: `Payload too large. Max ${MAX_PAYLOAD_BYTES / 1000}KB.` };
  }
  return { valid: true };
}
