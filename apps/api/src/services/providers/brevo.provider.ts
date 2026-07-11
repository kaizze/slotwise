// Brevo (formerly Sendinblue) transactional email via their REST API.
// Free tier covers 300 emails/day — sufficient for early-stage volume.

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export async function sendEmail(input: {
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
}): Promise<{ providerId: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.FROM_EMAIL ?? 'noreply@slotwise.app';
  const fromName = process.env.FROM_NAME ?? 'SlotWise';

  if (!apiKey) throw new Error('BREVO_API_KEY not configured');

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: input.to, name: input.toName }],
      subject: input.subject,
      htmlContent: input.htmlContent,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { messageId: string };
  return { providerId: data.messageId };
}
