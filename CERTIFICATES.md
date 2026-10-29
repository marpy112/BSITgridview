# E-certificates

Open **E-certificates** in the administrator sidebar.

1. In **Certificate designs**, upload a JPEG (`.jpg` or `.jpeg`) of up to 1 MB. Include the citation, signature artwork and other fixed content. Leave the recipient name, certificate ID and QR code blank. Images can be up to 6000 pixels per side and 20 megapixels; standard portrait or landscape proportions work best. The image orientation is applied automatically.
2. Give the design a certificate title. This title is shown on the verification page.
3. Under **Customize placement**, select **QR code**, **Certificate ID** or **Recipient name**. Drag its box on the preview, click an empty location to place the selected element, or use the position fields and sliders. Arrow keys move a focused element by 0.5%; Shift + arrow moves it by 2%. Adjust the QR size, or the ID/name text size, color, font and text area width. Names shrink automatically to fit the text area.
4. Save the design. In **Issue certificate**, choose a design and select the recipient's **Student account**. Their profile name is used automatically and the certificate appears in their portal. Student account selection is required by default. Choose **Outside recipient (no student account)** only for someone without an account; a warning explains that the certificate will not appear in a student portal. If the entered name matches a student, the form offers that account for explicit selection.
5. Issue the certificate, then download its PDF. Issuance saves a unique `IBACMI-IT-YYYY-…` ID, a random verification token and the server's issue timestamp. The verification page labels that timestamp as the date and time obtained, in Philippine Standard Time (UTC+8).

Choose **Customize placement** beside a saved design, or **Customize QR & ID placement** in the issuing form, to reposition its elements without uploading the JPEG again. Save the updated placement as a new design for future certificates. Earlier certificates keep their original layout and verification records.

**Issued certificates** lists saved records with PDF download, verification and revocation actions. Revocation keeps the record and changes its public status to revoked.

## Bulk issuance

Open **Bulk issuance**, choose a design, and select students using the checkboxes. Search by name or student ID, filter by year, and use **Select all shown** to select a group. Optionally add other recipients with one name per line. Each batch supports up to 200 recipients; student IDs distinguish students with the same name.

Click **Issue certificates** to save the whole batch. Each certificate receives its own randomly generated ID and verification token. The database enforces unique IDs and tokens across individual issuance and every batch. A batch is saved in one transaction, so a failed write does not leave a partially issued group. Retrying the same request returns its existing records without issuing duplicates.

Use **Download all (PDF)** for a combined PDF with one certificate per page, or download individual PDFs from the result list. Every page has that recipient's own QR code and ID. Records also appear in **Issued certificates**.

Migration `migrations/0013_certificate_batches.sql` adds batch tracking and must be applied along with migration 0012 before using bulk issuance.

## Student certificates and badges

Students have a **Certificates** tab for viewing their own certificates, opening verification links and downloading PDFs. A count appears beside the tab. Students with valid certificates also receive a **Certificate holder** badge on their profile and account card. The count includes valid certificates only; revoked records remain listed with their status and cannot be downloaded.

Certificates issued by selecting a student account, including students selected during bulk issuance, are linked by student ID. Recipients entered only as names are not automatically linked to accounts, even when their names match a student's name.

For an older or unlinked certificate, open **Issued certificates** as an administrator and choose **Link student**. Confirm the correct student ID. **Change student** can correct an assignment; the previous account immediately loses access to future views and downloads. Linking preserves the printed recipient name, certificate ID and verification QR code.

Migration `migrations/0014_student_certificates.sql` adds the student ownership field and index. Apply it before deploying the student tab. Ownership is checked against the authenticated student session for both the list and each individual view/download. Public verification does not disclose student account IDs or template artwork.

## Verification

QR codes open `/#/verify/<random-token>`. Production Vercel requests always use the canonical public `APP_ORIGIN` (default `https://bsitgridview.vercel.app`), including issuance and PDF downloads through the administrator branch alias. Local development uses the local app's origin. The page requires no login and shows only the recipient name, certificate title, ID, issuer, issue time and validity status. Uploaded designs, signatures, account identifiers and student records are not publicly returned. A missing or revoked certificate is never shown as verified.

Verification confirms the saved issuance record. The viewer should match the name and ID on the presented document against that record.

## Database and hosting

Migration `migrations/0012_certificates.sql` adds `certificate_templates` and `certificates`. JPEG designs are embedded in a PDF for storage in the existing database; no additional storage service or migration is required for JPEG uploads. Previously saved designs and issued PDF downloads stay compatible. The authenticated Cloudflare database gateway accepts bounded payloads large enough for these design writes.

- Local Cloudflare database: `npm run db:migrate:local`.
- Production Cloudflare database: apply migrations through the existing deployment procedure (`npm run db:migrate:remote`) before releasing the feature.
- Production Turso database: run `npm run turso:migrate -- --plan`, take a fresh private backup, then `npm run turso:migrate -- --apply` before releasing the feature. This upgrades an existing installation and commits pending schema changes and migration history atomically. The existing database transfer script also preserves the new tables when present.
- Deploy both the Vercel app and the Cloudflare database gateway when using that hosting arrangement. The gateway's updated request limit is required for design uploads.

The security headers in `public/_headers` and `vercel.json` allow the bundled, same-origin PDF preview worker. QR generation and PDF processing do not send designs or recipient names to an external conversion service.

Local QR links point to the local app and work on that computer. Issue real certificates from the deployed public HTTPS app so people scanning them on other devices can reach the verification page. Keep the public hostname stable to preserve existing QR links.

Follow [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) for the release order and final verification.
