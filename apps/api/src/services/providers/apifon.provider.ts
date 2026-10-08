import { createHmac } from 'crypto';

const APIFON_HOST = 'https://ars.apifon.com';
const APIFON_SMS_PATH = '/services/api/v1/sms/send';

/**
 * Apifon (apifon.com) transactional SMS via HMAC-signed REST API.
 * Docs: https://docs.apifon.com/authentication.html + SMS Gateway reference.
 *
 * Env:
 *   APIFON_TOKEN          — API token from Mookee
 *   APIFON_SECRET         — matching secret key
 *   APIFON_DEFAULT_SENDER_ID — alphanumeric sender (max 11), e.g. SalonEleni
 */

function signRequest(secret: string, method: string, path: string, body: string, date: string): string {
  const stringToSign = `${method}\n${path}\n${body}\n${date}`;
  return createHmac('sha256', secret).update(stringToSign, 'utf8').digest('base64');
}

/** Apifon wants international MSISDN digits only (no +, no leading 0). */
export function toApifonMsisdn(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Common Greek local mobiles: 69xxxxxxxx → 3069xxxxxxxx
  if (digits.length === 10 && digits.startsWith('69')) {
    digits = `30${digits}`;
  }
  if (digits.length < 7 || digits.length > 15) {
    throw new Error(`Invalid phone for Apifon SMS: ${phone}`);
  }
  return digits;
}

function normalizeSenderId(senderId: string): string {
  const cleaned = senderId.replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
  if (!cleaned) throw new Error('Apifon sender ID is empty after normalization');
  return cleaned;
}

export async function sendApifonSms(input: {
  to: string;
  body: string;
  senderId?: string;
  referenceId?: string;
}): Promise<{ providerId: string }> {
  const token = process.env.APIFON_TOKEN;
  const secret = process.env.APIFON_SECRET;
  const defaultSender = process.env.APIFON_DEFAULT_SENDER_ID ?? 'SlotWise';

  if (!token || !secret) {
    throw new Error('Apifon credentials not configured (APIFON_TOKEN / APIFON_SECRET)');
  }

  const senderId = normalizeSenderId(input.senderId?.trim() || defaultSender);
  const number = toApifonMsisdn(input.to);

  const payload: Record<string, unknown> = {
    message: {
      text: input.body,
      sender_id: senderId,
    },
    subscribers: [{ number }],
  };
  if (input.referenceId) {
    payload.reference_id = input.referenceId.slice(0, 255);
  }

  const body = JSON.stringify(payload);
  const date = new Date().toUTCString(); // RFC 1123, e.g. "Thu, 08 Oct 2026 20:00:00 GMT"
  const signature = signRequest(secret, 'POST', APIFON_SMS_PATH, body, date);

  const response = await fetch(`${APIFON_HOST}${APIFON_SMS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-ApifonWS-Date': date,
      Authorization: `ApifonWS ${token}:${signature}`,
    },
    body,
  });

  const raw = await response.text();
  let data: {
    request_id?: string;
    results?: Record<string, Array<{ message_id?: string }>>;
    result_info?: { status_code?: number | string; description?: string };
  };

  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`Apifon API error (${response.status}): ${raw}`);
  }

  const statusCode = Number(data.result_info?.status_code ?? response.status);
  if (!response.ok || (statusCode && statusCode >= 400)) {
    throw new Error(
      `Apifon API error (${statusCode}): ${data.result_info?.description ?? raw}`,
    );
  }

  const messageId = data.results?.[number]?.[0]?.message_id
    ?? data.request_id
    ?? 'apifon-unknown';

  return { providerId: messageId };
}
