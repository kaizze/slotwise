import { sendSms as sendTwilioSms, sendWhatsApp as sendTwilioWhatsApp } from './providers/twilio.provider.js';
import { sendApifonSms } from './providers/apifon.provider.js';

export type SmsProviderName = 'twilio' | 'apifon';

export function normalizeSmsProvider(value: unknown): SmsProviderName {
  return value === 'apifon' ? 'apifon' : 'twilio';
}

/**
 * Outbound SMS for booking notifications. Provider is chosen per business in Settings.
 * WhatsApp stays on Twilio for now (inbound agent webhooks are Twilio-shaped).
 */
export async function sendOutboundSms(input: {
  to: string;
  body: string;
  provider: SmsProviderName;
  senderId?: string;
  referenceId?: string;
}): Promise<{ providerId: string; provider: SmsProviderName }> {
  if (input.provider === 'apifon') {
    const result = await sendApifonSms({
      to: input.to,
      body: input.body,
      senderId: input.senderId,
      referenceId: input.referenceId,
    });
    return { ...result, provider: 'apifon' };
  }

  const result = await sendTwilioSms(input.to, input.body);
  return { ...result, provider: 'twilio' };
}

export async function sendOutboundWhatsApp(input: {
  to: string;
  body: string;
}): Promise<{ providerId: string; provider: 'twilio' }> {
  const result = await sendTwilioWhatsApp(input.to, input.body);
  return { ...result, provider: 'twilio' };
}
