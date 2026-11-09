# Azure App Service deployment

SickleCare runs as a Next.js Node server. Use **Azure App Service for Linux** with Node.js 24 LTS. This project uses the standard Next.js `build` and `start` scripts; source deployments must build with the project’s environment values available. See Microsoft's [Node.js App Service configuration guide](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs), [Node.js App Service quickstart](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs), and [GitHub Actions deployment guide](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions).

## Connect GitHub to an existing App Service

After the source is pushed to GitHub and an App Service exists, sign in to both CLIs and run:

```powershell
az login
az account set --subscription <subscription-id>
az webapp config set --resource-group <resource-group> --name <app-name> --linux-fx-version "NODE|24-lts"
az webapp deployment github-actions add --repo <github-owner>/<repository> --branch main --resource-group <resource-group> --name <app-name> --runtime "NODE|24-lts" --login-with-github
```

The final command uses Azure CLI's supported GitHub integration to add a workflow under `.github/workflows/` and connect pushes on `main` to the App Service deployment. It authenticates interactively with GitHub; it does not need a GitHub token pasted into the terminal. See the [Azure CLI command reference](https://learn.microsoft.com/en-us/cli/azure/webapp/deployment/github-actions?view=azure-cli-latest).

The workflow must build with these GitHub Actions variables available, because `NEXT_PUBLIC_*` values are embedded into the client bundle:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL=https://<app-name>.azurewebsites.net`

Set the same values in App Service Configuration for server runtime. Inspect the generated workflow after Azure creates it and pass the three variables to its build step if Azure's generated template does not already do so. Keep the service-role key out of GitHub variables, this workflow, the PWA, and firmware.

In Supabase Authentication URL configuration, set the Site URL to the Azure HTTPS URL and add `https://<app-name>.azurewebsites.net/auth/callback` and `http://localhost:3000/auth/callback` to allowed redirect URLs.

## Manual ZIP fallback

If GitHub Actions is unavailable, create a source ZIP that excludes local environment files, dependencies, build output, Supabase CLI metadata, and the raw ESP32 token:

```powershell
.\scripts\package-azure.ps1
az webapp config appsettings set --resource-group <resource-group> --name <app-name> --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true
az webapp deploy --resource-group <resource-group> --name <app-name> --src-path "$env:TEMP\sicklecare-azure.zip" --type zip
```

Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL` in App Service before deployment so the build can embed them. The ZIP script excludes local `.env*` files except the safe `.env.example` template, plus `node_modules`, `.next`, `.git`, `supabase/.temp`, and `firmware/sicklecare_device/secrets.h`.

## Verify deployment

Check `https://<app-name>.azurewebsites.net/api/health` returns `{"status":"ok","service":"sicklecare-web"}`, then sign in and check the dashboard. App Service supports Node 24 LTS and source build automation as described in Microsoft's [Node.js runtime guide](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs) and [Node.js quickstart](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs).

## Before the client presentation

- Sign in using a real patient account, not preview mode.
- Use the simulated data mode only when no real readings have been provisioned; it is visibly labelled.
- Keep the Azure Supabase URL and anon key in App Service settings. Do not add a service-role key to the web app.
- Keep Wi-Fi credentials and the raw per-device token only in the local ignored firmware `secrets.h`; never include that file in the deployment ZIP.
- Confirm the Supabase redirect allow-list contains the final Azure hostname after the app name is chosen.
