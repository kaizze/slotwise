import { sendEmail as sendViaBrevo } from './providers/brevo.provider.js';

// Single gateway for all outbound email — always routed through Brevo.

export const EmailService = {
  async send(input: {
    to: string;
    toName?: string;
    subject: string;
    htmlContent: string;
  }): Promise<{ providerId: string }> {
    return sendViaBrevo(input);
  },
};
