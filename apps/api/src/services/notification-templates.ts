import dayjs from 'dayjs';
import 'dayjs/locale/el.js';

interface BookingContext {
  customerName: string;
  serviceName: string;
  staffName: string;
  businessName: string;
  startsAt: Date;
  ref: string;
  locale?: string;
}

function formatDateTime(date: Date, locale = 'en'): string {
  const d = dayjs(date).locale(locale === 'el' ? 'el' : 'en');
  return d.format('dddd D MMMM, HH:mm');
}

function emailLayout(businessName: string, body: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #1f2937;">${businessName}</h2>
      ${body}
    </div>
  `;
}

// ─── SMS templates (short, no formatting) ─────────────────────────────────────

export const smsTemplates = {
  confirmation(ctx: BookingContext): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Το ραντεβού σου για ${ctx.serviceName} επιβεβαιώθηκε για ${when} με ${ctx.staffName}. Κωδ: ${ctx.ref}`;
    }
    return `${ctx.businessName}: Your ${ctx.serviceName} appointment is confirmed for ${when} with ${ctx.staffName}. Ref: ${ctx.ref}`;
  },

  reminder(ctx: BookingContext): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `Υπενθύμιση: Ραντεβού ${ctx.serviceName} στις ${when} (${ctx.businessName}). Απάντησε CANCEL για ακύρωση.`;
    }
    return `Reminder: ${ctx.serviceName} appointment at ${when} (${ctx.businessName}). Reply CANCEL to cancel.`;
  },

  cancellation(ctx: BookingContext): string {
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Το ραντεβού σου (${ctx.ref}) ακυρώθηκε.`;
    }
    return `${ctx.businessName}: Your appointment (${ctx.ref}) has been cancelled.`;
  },

  rebookOffer(ctx: BookingContext & { newTime: Date; incentive?: string }): string {
    const newWhen = formatDateTime(ctx.newTime, ctx.locale);
    const incentiveText = ctx.incentive ? ` ${ctx.incentive}` : '';
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Άνοιξε θέση στις ${newWhen}. Θες να μετακινήσουμε το ραντεβού σου εκεί?${incentiveText} Απάντησε ΝΑΙ.`;
    }
    return `${ctx.businessName}: A slot opened at ${newWhen}. Want to move your appointment there?${incentiveText} Reply YES.`;
  },

  waitlistOffer(ctx: { businessName: string; serviceName: string; startsAt: Date; locale?: string }): string {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    if (ctx.locale === 'el') {
      return `${ctx.businessName}: Άνοιξε θέση για ${ctx.serviceName} στις ${when}. Απάντησε ΝΑΙ για να κλείσεις.`;
    }
    return `${ctx.businessName}: A slot just opened for ${ctx.serviceName} at ${when}. Reply YES to book it.`;
  },
};

// ─── Email templates (basic HTML via Brevo) ─────────────────────────────────

export const emailTemplates = {
  confirmation(ctx: BookingContext): { subject: string; html: string } {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    const isEl = ctx.locale === 'el';
    const subject = isEl
      ? `Επιβεβαίωση ραντεβού — ${ctx.businessName}`
      : `Appointment confirmed — ${ctx.businessName}`;

    const body = isEl
      ? `
        <p>Γεια σου ${ctx.customerName},</p>
        <p>Το ραντεβού σου επιβεβαιώθηκε:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280;">Υπηρεσία</td><td style="padding: 8px 0;"><strong>${ctx.serviceName}</strong></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Με</td><td style="padding: 8px 0;">${ctx.staffName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Πότε</td><td style="padding: 8px 0;">${when}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Κωδικός</td><td style="padding: 8px 0;">${ctx.ref}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 13px;">Για ακύρωση ή αλλαγή, απάντησε σε αυτό το email ή επικοινώνησε μαζί μας.</p>
      `
      : `
        <p>Hi ${ctx.customerName},</p>
        <p>Your appointment is confirmed:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0;"><strong>${ctx.serviceName}</strong></td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">With</td><td style="padding: 8px 0;">${ctx.staffName}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">When</td><td style="padding: 8px 0;">${when}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Reference</td><td style="padding: 8px 0;">${ctx.ref}</td></tr>
        </table>
        <p style="color: #6b7280; font-size: 13px;">If you need to cancel or reschedule, reply to this email or contact us directly.</p>
      `;

    return { subject, html: emailLayout(ctx.businessName, body) };
  },

  reminder(ctx: BookingContext): { subject: string; html: string } {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    const isEl = ctx.locale === 'el';
    const subject = isEl
      ? `Υπενθύμιση ραντεβού — ${ctx.businessName}`
      : `Appointment reminder — ${ctx.businessName}`;

    const body = isEl
      ? `
        <p>Γεια σου ${ctx.customerName},</p>
        <p>Σε υπενθυμίζουμε το ραντεβού σου για <strong>${ctx.serviceName}</strong> στις <strong>${when}</strong> με ${ctx.staffName}.</p>
        <p style="color: #6b7280; font-size: 13px;">Κωδικός: ${ctx.ref}. Για ακύρωση, επικοινώνησε μαζί μας.</p>
      `
      : `
        <p>Hi ${ctx.customerName},</p>
        <p>This is a reminder for your <strong>${ctx.serviceName}</strong> appointment at <strong>${when}</strong> with ${ctx.staffName}.</p>
        <p style="color: #6b7280; font-size: 13px;">Reference: ${ctx.ref}. Contact us if you need to cancel.</p>
      `;

    return { subject, html: emailLayout(ctx.businessName, body) };
  },

  cancellation(ctx: BookingContext): { subject: string; html: string } {
    const isEl = ctx.locale === 'el';
    const subject = isEl
      ? `Ακύρωση ραντεβού — ${ctx.businessName}`
      : `Appointment cancelled — ${ctx.businessName}`;

    const body = isEl
      ? `
        <p>Γεια σου ${ctx.customerName},</p>
        <p>Το ραντεβού σου (${ctx.ref}) για ${ctx.serviceName} ακυρώθηκε.</p>
        <p style="color: #6b7280; font-size: 13px;">Αν θέλεις να κλείσεις νέο ραντεβού, επικοινώνησε μαζί μας.</p>
      `
      : `
        <p>Hi ${ctx.customerName},</p>
        <p>Your appointment (${ctx.ref}) for ${ctx.serviceName} has been cancelled.</p>
        <p style="color: #6b7280; font-size: 13px;">Contact us if you'd like to book again.</p>
      `;

    return { subject, html: emailLayout(ctx.businessName, body) };
  },

  rebookOffer(ctx: BookingContext & { newTime: Date; incentive?: string }): { subject: string; html: string } {
    const newWhen = formatDateTime(ctx.newTime, ctx.locale);
    const isEl = ctx.locale === 'el';
    const subject = isEl
      ? `Νέα διαθέσιμη ώρα — ${ctx.businessName}`
      : `Earlier slot available — ${ctx.businessName}`;

    const incentiveLine = ctx.incentive
      ? (isEl ? `<p>${ctx.incentive}</p>` : `<p>${ctx.incentive}</p>`)
      : '';

    const body = isEl
      ? `
        <p>Γεια σου ${ctx.customerName},</p>
        <p>Άνοιξε θέση στις <strong>${newWhen}</strong> για ${ctx.serviceName}.</p>
        ${incentiveLine}
        <p>Θέλεις να μετακινήσουμε το ραντεβού σου εκεί; Απάντησε σε αυτό το email.</p>
      `
      : `
        <p>Hi ${ctx.customerName},</p>
        <p>A slot opened at <strong>${newWhen}</strong> for ${ctx.serviceName}.</p>
        ${incentiveLine}
        <p>Would you like to move your appointment? Reply to this email and we'll take care of it.</p>
      `;

    return { subject, html: emailLayout(ctx.businessName, body) };
  },

  waitlistOffer(ctx: { businessName: string; serviceName: string; startsAt: Date; locale?: string; customerName?: string }): { subject: string; html: string } {
    const when = formatDateTime(ctx.startsAt, ctx.locale);
    const isEl = ctx.locale === 'el';
    const subject = isEl
      ? `Θέση διαθέσιμη — ${ctx.businessName}`
      : `Slot available — ${ctx.businessName}`;

    const greeting = ctx.customerName
      ? (isEl ? `Γεια σου ${ctx.customerName},` : `Hi ${ctx.customerName},`)
      : (isEl ? 'Γεια σου,' : 'Hi,');

    const body = isEl
      ? `
        <p>${greeting}</p>
        <p>Άνοιξε θέση για <strong>${ctx.serviceName}</strong> στις <strong>${when}</strong>.</p>
        <p>Απάντησε σε αυτό το email για να κλείσεις.</p>
      `
      : `
        <p>${greeting}</p>
        <p>A slot just opened for <strong>${ctx.serviceName}</strong> at <strong>${when}</strong>.</p>
        <p>Reply to this email to book it.</p>
      `;

    return { subject, html: emailLayout(ctx.businessName, body) };
  },
};
