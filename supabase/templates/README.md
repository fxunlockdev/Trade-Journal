# Auth email setup

Everything here is dashboard configuration. Supabase sends auth email itself, so
none of it can be committed into the app.

Until step 1 and 2 are done, confirmation and reset email goes out through
Supabase's shared sender, which is rate limited to a handful of messages per
hour and lands in spam often enough that you should assume it does. That is the
single reason email signup feels broken today, and it is not a code problem.

## 1. Verify the sending domain in Resend

Resend will only send from a domain you have proved you own. Until then the
only usable sender is `onboarding@resend.dev`, which delivers to the Resend
account owner and nobody else, so it is useless for real signups.

1. Resend dashboard, **Domains**, **Add Domain**, enter `fx-apps.com`.
2. Resend shows a set of DKIM/SPF records. Add each one in GoDaddy under
   **Domains > fx-apps.com > DNS**, exactly as shown.
3. Wait for the status to go **Verified**. Usually minutes.

Do not delete the Vercel records while you are in there. The apex `A` record
must stay `216.150.1.1` and `www` must stay pointed at Vercel.

Note: the API key currently in use is send-only, so it cannot add the domain
over the API. This step has to happen in the dashboard.

## 2. Point Supabase at Resend

Supabase Dashboard, **Project Settings > Authentication > SMTP Settings**.
Turn on **Enable Custom SMTP** and enter:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `no-reply@fx-apps.com` |
| Sender name | `FXU Apps` |

The API key is the SMTP password. That is Resend's design, not a workaround.

Raise **Rate limit for sending emails** at the same time. It stays at the
shared-sender default until you change it, which silently caps your own SMTP.

## 3. Paste the templates

Supabase Dashboard, **Authentication > Emails**. For each template, switch the
editor to the source/HTML view and paste the matching file:

| Supabase template | File |
| --- | --- |
| Confirm signup | `confirm-signup.html` |
| Reset password | `reset-password.html` |
| Magic link | `magic-link.html` |
| Invite user | `invite.html` |
| Change email address | `change-email.html` |

Suggested subjects:

- Confirm signup: `Confirm your FXU account`
- Reset password: `Reset your FXU password`
- Magic link: `Your FXU sign-in link`
- Invite user: `You have been invited to FXU`
- Change email address: `Confirm your new FXU email`

Do not hand-edit the `.html` files. They are generated:

```bash
node supabase/templates/build.mjs
```

Edit `build.mjs` and regenerate, otherwise the five drift apart.

## 4. Check the redirect allow list

Supabase Dashboard, **Authentication > URL Configuration**. `Redirect URLs`
must include:

```
https://www.fx-apps.com/callback
https://fx-apps.com/callback
http://localhost:3000/callback
```

The password reset link goes to `/callback?next=/reset-password`. If `/callback`
is not on this list Supabase refuses the redirect and every reset link dies with
an opaque error.

## 5. Rotate the key

The Resend API key used for this setup was pasted into a chat transcript, so
treat it as public. Once mail is confirmed working, create a fresh key in Resend,
update the SMTP password in Supabase, and delete the old one.

## Still to do outside this file

Google sign-in returns `403 org_internal` for everyone outside the Workspace
until the OAuth consent screen is switched from **Internal** to **External** and
published, in Google Cloud Console. That is unrelated to email, and it is
currently the larger of the two barriers to signup.
