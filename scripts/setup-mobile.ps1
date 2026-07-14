# =============================================================================
# Prism Escalations - Mobile APK one-shot setup
# Automates everything that CAN be automated for the Android APK + push pipeline.
# You still log in to GitHub / Supabase / Firebase when prompted (your accounts).
#
# Usage (from prism-escalations/):
#   pwsh ./scripts/setup-mobile.ps1
#
# Prereqs you must have ready BEFORE running:
#   1. google-services.json  (Firebase Console -> Android app
#                             package: in.prismintelligence.escalations)
#   2. service-account.json  (Firebase Console -> Project settings ->
#                             Service accounts -> Generate new private key)
# Pass their paths with -GoogleServicesJson and -ServiceAccountJson,
# or the script will prompt you for them.
# =============================================================================

[CmdletBinding()]
param(
    [string]$Repo            = "TrainingTWC/Prism-escalations",
    [string]$SupabaseRef     = "sldvlxpxdcgzrlyqezsi",
    [string]$SupabaseUrl     = "https://sldvlxpxdcgzrlyqezsi.supabase.co",
    [string]$GoogleServicesJson,
    [string]$ServiceAccountJson,
    [string]$KeyAlias        = "prism",
    [switch]$SkipInstall,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }

# --- 0. Ensure we run from the project root --------------------------------
if (-not (Test-Path "./capacitor.config.ts")) {
    throw "Run this from the prism-escalations/ folder (capacitor.config.ts not found)."
}

# --- 1. Install CLIs (winget) ----------------------------------------------
function Ensure-Tool($cmd, $wingetId, $label) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { Ok "$label present"; return }
    if ($SkipInstall) { throw "$label missing and -SkipInstall set." }
    Step "Installing $label via winget"
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    # refresh PATH for current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "$label installed but '$cmd' not on PATH. Open a new terminal and re-run."
    }
    Ok "$label installed"
}

Ensure-Tool "gh"       "GitHub.cli"           "GitHub CLI"
Ensure-Tool "keytool"  "EclipseAdoptium.Temurin.21.JDK" "Temurin JDK 21 (keytool)"

# Supabase CLI: prefer npx (no global install needed)
$supabase = "npx --yes supabase@latest"
Ok "Supabase CLI via npx"

# --- 2. GitHub auth --------------------------------------------------------
Step "GitHub authentication"
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) { gh auth login -h github.com -w }
Ok "GitHub authenticated"

# --- 3. Read Supabase web keys from .env.local -----------------------------
Step "Reading Supabase web keys from .env.local"
$anonKey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
if (Test-Path "./.env.local") {
    Get-Content "./.env.local" | ForEach-Object {
        if ($_ -match '^\s*NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(.+)\s*$') { $anonKey = $Matches[1].Trim('"').Trim() }
        if ($_ -match '^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+)\s*$')      { $SupabaseUrl = $Matches[1].Trim('"').Trim() }
    }
}
if (-not $anonKey) { $anonKey = Read-Host "Enter NEXT_PUBLIC_SUPABASE_ANON_KEY" }
Ok "Supabase URL: $SupabaseUrl"

# --- 4. Locate the two Firebase files --------------------------------------
Step "Locating Firebase files"
if (-not $GoogleServicesJson) { $GoogleServicesJson = Read-Host "Path to google-services.json" }
if (-not $ServiceAccountJson) { $ServiceAccountJson = Read-Host "Path to Firebase service-account.json" }
if (-not (Test-Path $GoogleServicesJson)) { throw "google-services.json not found at $GoogleServicesJson" }
if (-not (Test-Path $ServiceAccountJson)) { throw "service-account.json not found at $ServiceAccountJson" }
Copy-Item $GoogleServicesJson "./android/app/google-services.json" -Force
Ok "google-services.json copied into android/app/"

# --- 5. Generate the release keystore --------------------------------------
Step "Release signing keystore"
$ksPath = "./android/app/release.keystore"
if (Test-Path $ksPath) {
    Warn "release.keystore already exists - reusing it."
    $storePass = Read-Host "Enter the existing keystore STORE password" -AsSecureString
    $keyPass   = Read-Host "Enter the existing KEY password (Enter = same as store)" -AsSecureString
} else {
    Write-Host "    Choose a strong password (you'll need it for every future update)." -ForegroundColor Gray
    $storePass = Read-Host "Create keystore STORE password" -AsSecureString
    $keyPass   = $storePass
    $sp = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))
    keytool -genkeypair -v -keystore $ksPath -alias $KeyAlias -keyalg RSA -keysize 2048 `
        -validity 10000 -storepass $sp -keypass $sp `
        -dname "CN=Prism Intelligence, OU=Escalations, O=Prism Intelligence, L=NA, S=NA, C=IN"
    Ok "Keystore generated at $ksPath"
}
$storePassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))
$keyPassPlain   = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPass))
if (-not $keyPassPlain) { $keyPassPlain = $storePassPlain }

# --- 6. Base64 encode artifacts --------------------------------------------
Step "Encoding artifacts for GitHub secrets"
$ksB64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $ksPath)))
$gsB64  = [IO.File]::ReadAllText((Resolve-Path "./android/app/google-services.json"))
$saJson = [IO.File]::ReadAllText((Resolve-Path $ServiceAccountJson))
Ok "Encoded keystore + google-services.json"

# --- 7. Generate a shared push secret --------------------------------------
$pushSecret = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})

# --- 8. Push GitHub repo secrets -------------------------------------------
Step "Setting GitHub repository secrets on $Repo"
function Set-GhSecret($name, $value) {
    $value | gh secret set $name --repo $Repo --body -  | Out-Null
    Ok "secret $name set"
}
Set-GhSecret "NEXT_PUBLIC_SUPABASE_URL"      $SupabaseUrl
Set-GhSecret "NEXT_PUBLIC_SUPABASE_ANON_KEY" $anonKey
Set-GhSecret "GOOGLE_SERVICES_JSON"          $gsB64
Set-GhSecret "RELEASE_KEYSTORE_BASE64"       $ksB64
Set-GhSecret "RELEASE_STORE_PASSWORD"        $storePassPlain
Set-GhSecret "RELEASE_KEY_ALIAS"             $KeyAlias
Set-GhSecret "RELEASE_KEY_PASSWORD"          $keyPassPlain

# --- 9. Supabase: secrets, function deploy, migration ----------------------
Step "Supabase login"
Invoke-Expression "$supabase login"
Invoke-Expression "$supabase link --project-ref $SupabaseRef"

Step "Setting Supabase function secrets"
Invoke-Expression "$supabase secrets set PUSH_FN_SECRET=`"$pushSecret`""
$saTmp = New-TemporaryFile
Set-Content -Path $saTmp -Value $saJson -NoNewline
Invoke-Expression "$supabase secrets set FCM_SERVICE_ACCOUNT=`"$(Get-Content $saTmp -Raw)`""
Remove-Item $saTmp -Force
Ok "PUSH_FN_SECRET + FCM_SERVICE_ACCOUNT set"

Step "Deploying send-push edge function"
Invoke-Expression "$supabase functions deploy send-push --no-verify-jwt"
Ok "send-push deployed"

# --- 10. Print the manual SQL (migration + Vault) --------------------------
Step "Final manual step: run this in the Supabase SQL editor"
Write-Host @"
-- 1) Run the migration file:
--    supabase/migration_push_notifications.sql
-- 2) Create the Vault secrets the DB trigger needs:
select vault.create_secret('$SupabaseUrl', 'project_url');
select vault.create_secret('$pushSecret', 'push_fn_secret');
"@ -ForegroundColor Yellow

# --- 11. Trigger the cloud build -------------------------------------------
if (-not $SkipBuild) {
    Step "Triggering the Android build workflow"
    gh workflow run android.yml --repo $Repo -f build_type=release
    Ok "Build started. Watch it with:  gh run watch --repo $Repo"
    Write-Host "    Download the APK when done:  gh run download --repo $Repo --name prism-escalations-apk" -ForegroundColor Gray
}

Step "Done"
Write-Host "Keystore stored at android/app/release.keystore - BACK IT UP. Losing it means you cannot update the app." -ForegroundColor Magenta
