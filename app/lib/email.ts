import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.EMAIL_FROM ?? "Orqestra <noreply@orqestra.app>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export interface InvitationEmailData {
    toEmail: string;
    toName: string | null;
    organizationName: string;
    invitationToken: string;
}

export interface ActivationConfirmationData {
    toEmail: string;
    toName: string | null;
    organizationName: string;
}

export type EmailResult =
    | { success: true; messageId: string }
    | { success: false; error: string };

export async function sendInvitationEmail(data: InvitationEmailData): Promise<EmailResult> {
    const activationUrl = `${APP_URL}/activate?token=${encodeURIComponent(data.invitationToken)}`;

    try {
        const result = await resend.emails.send({
            from: FROM_ADDRESS,
            to: data.toEmail,
            subject: `You're invited to join ${data.organizationName} on Orqestra`,
            html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 40px 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #18181b; padding: 32px 40px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">Orqestra</h1>
    </div>
    <div style="padding: 40px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">You're invited to join ${data.organizationName}</h2>
      <p style="margin: 0 0 24px; font-size: 15px; color: #52525b; line-height: 1.6;">
        ${data.toName ? `Hi ${data.toName},` : "Hi,"}<br/><br/>
        You have been invited to join <strong>${data.organizationName}</strong> on Orqestra — an AI-powered operations copilot.
      </p>
      <p style="margin: 0 0 32px; font-size: 15px; color: #52525b; line-height: 1.6;">
        Click the button below to set up your account. This invitation link expires in <strong>24 hours</strong>.
      </p>
      <a href="${activationUrl}" style="display: inline-block; background: #18181b; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">
        Accept invitation
      </a>
      <p style="margin: 32px 0 0; font-size: 13px; color: #a1a1aa;">
        If the button doesn't work, copy and paste this URL into your browser:<br/>
        <a href="${activationUrl}" style="color: #3b82f6; word-break: break-all;">${activationUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`,
        });

        if (result.error) {
            return { success: false, error: result.error.message };
        }

        return { success: true, messageId: result.data?.id ?? "unknown" };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown email error";
        return { success: false, error: message };
    }
}

export async function sendActivationConfirmationEmail(data: ActivationConfirmationData): Promise<EmailResult> {
    try {
        const result = await resend.emails.send({
            from: FROM_ADDRESS,
            to: data.toEmail,
            subject: `Welcome to ${data.organizationName} on Orqestra`,
            html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 40px 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="background: #18181b; padding: 32px 40px;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Orqestra</h1>
    </div>
    <div style="padding: 40px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">Your account is now active</h2>
      <p style="margin: 0 0 24px; font-size: 15px; color: #52525b; line-height: 1.6;">
        ${data.toName ? `Hi ${data.toName},` : "Hi,"}<br/><br/>
        Your account at <strong>${data.organizationName}</strong> on Orqestra has been activated. You can now log in.
      </p>
      <a href="${APP_URL}/login" style="display: inline-block; background: #18181b; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">
        Sign in to Orqestra
      </a>
    </div>
  </div>
</body>
</html>`,
        });

        if (result.error) {
            return { success: false, error: result.error.message };
        }

        return { success: true, messageId: result.data?.id ?? "unknown" };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown email error";
        return { success: false, error: message };
    }
}
