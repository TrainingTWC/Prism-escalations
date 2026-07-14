# Prism Escalations — Mobile App (APK) Setup

This app is wrapped as a native Android APK using **Capacitor**. The web UI is
bundled inside the APK (offline-capable shell), with **Firebase Cloud Messaging**
for background push notifications, native **haptics/vibration**, and zoom disabled
for a polished native feel.

The APK is built in the cloud via **GitHub Actions** — no local Android Studio
needed. Follow this checklist once, then every build is a single click.

---

## Fast path (automated)

Most of the steps below are automated by **`scripts/setup-mobile.ps1`**. You only
need to create the Firebase project and download two files first (steps 1.1–1.3
and 1.5 below), then run:

```powershell
cd prism-escalations
pwsh ./scripts/setup-mobile.ps1 -GoogleServicesJson "C:\path\google-services.json" -ServiceAccountJson "C:\path\service-account.json"
```

The script installs the GitHub CLI + JDK, generates the signing keystore,
encodes everything, sets all GitHub + Supabase secrets, deploys the `send-push`
function, and triggers the build. It prints the one SQL snippet you still run by
hand (migration + Vault secrets). Prefer the manual steps below if you'd rather
do each part yourself.

---


## 1. Firebase project (push notifications)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Add an **Android app**:
   - Package name: `in.prismintelligence.escalations` (must match exactly)
   - App nickname: `Prism Escalations`
3. Download **`google-services.json`**.
4. Base64-encode it for the GitHub secret:
   - macOS/Linux: `base64 -i google-services.json | tr -d '\n'`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json"))`
5. In Firebase → **Project settings → Service accounts → Generate new private key**.
   Save the JSON — this is `FCM_SERVICE_ACCOUNT` (used by the Supabase sender).

## 2. Release signing keystore

Generate once and keep it safe (losing it means you can't update the app):

```bash
keytool -genkeypair -v -keystore release.keystore -alias prism \
  -keyalg RSA -keysize 2048 -validity 10000
```

Base64-encode it (same commands as step 1.4) → `RELEASE_KEYSTORE_BASE64`.
Remember the store password, key alias (`prism`), and key password.

## 3. GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://sldvlxpxdcgzrlyqezsi.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
| `NEXT_PUBLIC_INTELLIGENCE_APP_URL` | (if used by the web app) |
| `GOOGLE_SERVICES_JSON` | base64 from step 1.4 |
| `RELEASE_KEYSTORE_BASE64` | base64 from step 2 |
| `RELEASE_STORE_PASSWORD` | keystore store password |
| `RELEASE_KEY_ALIAS` | `prism` |
| `RELEASE_KEY_PASSWORD` | key password |

> If you skip the keystore secrets, the workflow still produces an installable
> **debug** APK — handy for a first test before signing is set up.

## 4. Supabase (sender + database)

1. **Function secrets** (Dashboard → Edge Functions → Secrets, or CLI):

   ```bash
   supabase secrets set PUSH_FN_SECRET="<random-long-string>"
   supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
   ```

2. **Deploy the sender function:**

   ```bash
   supabase functions deploy send-push --no-verify-jwt
   ```

3. **Run the migration** `supabase/migration_push_notifications.sql` in the
   Supabase SQL editor (creates `device_tokens`, triggers, and the SLA sweep cron).

4. **Create Vault secrets** (so the DB can call the sender) — SQL editor:

   ```sql
   select vault.create_secret('https://sldvlxpxdcgzrlyqezsi.supabase.co', 'project_url');
   select vault.create_secret('<same PUSH_FN_SECRET value>', 'push_fn_secret');
   ```

## 5. Build the APK

1. GitHub → **Actions → Build Android APK → Run workflow**
   (choose `release`, or `debug` for an unsigned test build).
2. When it finishes, open the run and download the **`prism-escalations-apk`**
   artifact. Tagging a commit `v1.0.0` also attaches the APK to a GitHub Release.
3. Transfer the APK to phones and install (allow “Install unknown apps”).
   On first launch the app asks for **notification permission** — accept it.

---

## How it behaves on the phone

- **Installed app** (own icon, splash screen), not a browser tab.
- **No zoom / no text resize** — locked viewport for a native feel.
- **Vibration + haptics** on key actions and incoming alerts.
- **Background push**: new tickets and SLA breaches notify the right users even
  when the app is closed; tapping a notification deep-links to the ticket.
- **Android back button** navigates history / exits at the root.

## Updating the app later

Bump the `versionCode`/`versionName` in `android/app/build.gradle`, push, and
re-run the workflow. Install the new APK over the old one (same keystore required).
