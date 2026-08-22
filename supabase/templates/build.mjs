/**
 * Generates the Supabase auth email templates.
 *
 * Written as a generator rather than five hand-maintained HTML files because
 * they differ only in a heading, a paragraph and a button label. Hand-copied,
 * the shell drifts: one gets a padding fix, another keeps the old footer, and
 * the set stops looking like one product.
 *
 * Run:  node supabase/templates/build.mjs
 * Then: paste each .html into Supabase Dashboard > Authentication > Emails.
 *
 * Constraints that shape the markup, all of them email-client rather than web:
 * - Tables for layout. Outlook's rendering engine is Word, which does not do
 *   flex or grid.
 * - Inline styles only. Gmail strips <style> blocks in some contexts.
 * - No web fonts, no background images, no external assets. The wordmark is
 *   live text, so it renders with images off, which is the default in Outlook
 *   and many corporate clients.
 * - Hex colours, not oklch. Email clients are years behind on colour syntax.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const INK = "#0b1220";
const MUTED = "#5b6472";
const BORDER = "#e6e9ef";
const BRAND = "#0071e3";

/**
 * @param {{ preheader: string, heading: string, body: string, cta: string,
 *           action: string, footnote: string }} content
 */
function layout({ preheader, heading, body, cta, action, footnote }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${heading}</title>
</head>
<body style="margin:0; padding:0; background:#f5f6f8; -webkit-font-smoothing:antialiased;">

<!-- Inbox preview text. Hidden in the body, but it is the second line every
     client shows next to the subject, so it is worth writing deliberately. -->
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f6f8;">
  <tr>
    <td align="center" style="padding:40px 16px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; margin:0 auto;">

        <tr>
          <td align="center" style="padding-bottom:24px;">
            <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:${INK}; letter-spacing:-0.01em;">FXU Apps</span>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff; border:1px solid ${BORDER}; border-radius:16px; padding:36px 32px;">

            <h1 style="margin:0 0 14px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:23px; line-height:1.25; font-weight:700; color:${INK}; letter-spacing:-0.02em;">${heading}</h1>

            <p style="margin:0 0 26px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:${MUTED};">${body}</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:10px; background:${BRAND};">
                  <a href="${action}" style="display:inline-block; padding:13px 26px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;">${cta}</a>
                </td>
              </tr>
            </table>

            <p style="margin:26px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.6; color:${MUTED};">${footnote}</p>

            <!-- Some clients strip or rewrite buttons, and some people simply
                 do not trust them. The raw URL is the fallback. -->
            <p style="margin:18px 0 0; padding-top:18px; border-top:1px solid ${BORDER}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:${MUTED}; word-break:break-all;">
              Button not working? Paste this into your browser:<br>
              <span style="color:${BRAND};">${action}</span>
            </p>

          </td>
        </tr>

        <tr>
          <td align="center" style="padding-top:22px;">
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:${MUTED};">
              FXU Apps &middot; Trade Journal and Affiliate CRM, one account.<br>
              You received this because someone used this address at fx-apps.com.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

// {{ .ConfirmationURL }} and friends are Supabase's own placeholders and must
// survive into the output verbatim.
const TEMPLATES = {
  "confirm-signup": {
    preheader: "Confirm your address and your Trade Journal is ready.",
    heading: "Confirm your email",
    body: "You are one click from your FXU account. Confirm this address and the Trade Journal is ready to use straight away.",
    cta: "Confirm my email",
    action: "{{ .ConfirmationURL }}",
    footnote: "This link expires in 24 hours. If you did not create an FXU account, ignore this email and nothing will happen.",
  },
  "reset-password": {
    preheader: "Choose a new FXU password.",
    heading: "Reset your password",
    body: "Use the button below to choose a new password for your FXU account. Your current password stays active until you do.",
    cta: "Choose a new password",
    action: "{{ .ConfirmationURL }}",
    footnote: "This link works once and expires in one hour. If you did not ask to reset your password, you can ignore this email safely.",
  },
  "magic-link": {
    preheader: "Your FXU sign-in link.",
    heading: "Sign in to FXU",
    body: "Here is your sign-in link. No password needed.",
    cta: "Sign in",
    action: "{{ .ConfirmationURL }}",
    footnote: "This link works once and expires in one hour. If you did not request it, ignore this email.",
  },
  invite: {
    preheader: "You have been invited to FXU Apps.",
    heading: "You have been invited to FXU",
    body: "An FXU admin invited you to join. Accept below to set a password and open your Trade Journal.",
    cta: "Accept the invitation",
    action: "{{ .ConfirmationURL }}",
    footnote: "If you were not expecting this invitation, you can ignore it.",
  },
  "change-email": {
    preheader: "Confirm your new FXU email address.",
    heading: "Confirm your new address",
    body: "Confirm that {{ .NewEmail }} is yours and it becomes the address you sign in with.",
    cta: "Confirm the change",
    action: "{{ .ConfirmationURL }}",
    footnote: "If you did not ask to change your email, ignore this and your address stays as it is. We recommend changing your password too.",
  },
};

for (const [name, content] of Object.entries(TEMPLATES)) {
  const file = join(OUT_DIR, `${name}.html`);
  writeFileSync(file, layout(content), "utf8");
  console.log(`  wrote ${name}.html`);
}
