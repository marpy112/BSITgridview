# Connect the Vercel frontend to Cloudflare

Frontend: https://bsitgridview.vercel.app

Cloudflare still runs the API and D1 database. A frontend deployment alone cannot process logins. Vercel has its own security headers in `vercel.json`; Cloudflare's `public/_headers` file does not configure Vercel.

1. Finish Cloudflare Workers onboarding in the dashboard and choose a `workers.dev` subdomain. Confirm Workers Paid is enabled for the bcrypt CPU budget; these scripts do not purchase a plan.
2. In PowerShell, open this project and authorize Cloudflare:

```powershell
npm.cmd run cf:login
```

3. Back up D1, apply the new indexes, and deploy the Worker:

```powershell
New-Item -ItemType Directory -Force backups
npx.cmd wrangler d1 export bsit-gradeview-db --remote --output backups/before-vercel.sql
npm.cmd run db:migrate:remote
npm.cmd run cf:deploy
```

Keep the existing database and administrator. Do not run database creation or reimport students for this deployment. If the backup file already exists, choose a new filename.

4. Copy the production Worker address Wrangler prints. Connect it using the helper, replacing the example with your real address:

```powershell
npm.cmd run vercel:backend -- https://bsit-gradeview.YOUR-SUBDOMAIN.workers.dev
git add vercel.json
git commit -m "Connect Vercel API to deployed Cloudflare Worker"
git push origin main
```

The helper writes an external `/api/:path*` rewrite. Until the Worker address is configured, API routes on Vercel are not connected. In Vercel, confirm the production branch is `main`, Framework is Vite, build command is `npm run build`, output directory is `dist`, and the new deployment succeeds. Do not use `cf:deploy` as Vercel's build command or put Cloudflare credentials into Vercel environment variables.

5. Verify after the Vercel deployment finishes:

```powershell
npm.cmd run production:smoke -- https://bsitgridview.vercel.app
```

Then open `https://bsitgridview.vercel.app/#/admin/login` and sign in. Verify student first-login password changes and a PDF download. Confirm the session cookie is HttpOnly and Secure in browser developer tools and refresh the page to verify the session survives the proxy. Initial student passwords remain their exact surnames.

The Worker permits writes from its own origin and the exact `APP_ORIGIN` value `https://bsitgridview.vercel.app`. Requests from other Vercel preview addresses are denied. Keep frontend requests on `/api`; the rewrite forwards them without cross-origin browser fetches. No wildcard origin or CORS relaxation is needed. If the production frontend domain changes, update `APP_ORIGIN` in `wrangler.jsonc` and redeploy the Worker.

References: [Vercel external rewrites](https://vercel.com/docs/routing/rewrites), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).
