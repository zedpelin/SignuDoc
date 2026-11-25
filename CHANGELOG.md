# Changelog

All notable changes to SignuDoc are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Until 1.0, a minor release may
change settings or the database in ways that need a migration step; each
release says when it does.

## [Unreleased]

### Added

- Files can be kept in an S3-compatible bucket (AWS S3, Nine Object Storage,
  Cloudflare R2, MinIO) by setting `S3_BUCKET` and its credentials, for hosts
  whose disk does not survive a restart. See "S3-compatible storage" in
  docs/self-hosting.md.

## [0.9.0] - 2026-11-22

People can now work as a team, seeing the envelopes their teammates send,
and a sender can put approvers in the signing order, who approve or reject
the document instead of signing it. This release changes the database: see
the end of this entry.

### Teams

- Teams. An administrator makes teams in Settings and puts people on them.
  People on a team see the envelopes their teammates have sent, read-only,
  in a "My team" view on the dashboard, and can download their audit trail
  and, once finished, the signed PDF and certificate. Drafts stay private,
  and only the sender changes an envelope. Team changes and teammates'
  views and downloads are recorded in the site audit trail. See
  [docs/teams.md](docs/teams.md) (PR #158 by @MattJackson).

### Approvers

- Anyone in the signing order can be an approver instead of a signer: on
  the signers page, pick "Approves or rejects it (no fields)". An approver
  reviews the document and approves or rejects it. They have no fields and
  nothing of theirs is stamped on the signed PDF. Approvers take their turn
  in the steps like signers, and a rejection ends the envelope, as a decline
  does (PR #159 by @MattJackson).
- Invitations and reminders ask an approver to approve, not to sign. The
  audit trail, the envelope page and the certificate show "Approved" and
  "Rejected", and the certificate lists approvals on their own, so an
  approval is never read as a signature. Certificates of envelopes without
  approvers are unchanged.
- Templates keep who approves, so do copies of an envelope and Send to
  many. The API shows each person's `role` (`signer` or `approver`);
  webhooks report an approval as `signer.signed` and a rejection as
  `envelope.declined`. See [docs/signing-order.md](docs/signing-order.md).
- Approvers are not offered in Part 11 mode, where an approval is an
  electronic signature: make the approver a signer with the meaning
  Approval instead. They cannot be combined with advanced or qualified
  signatures through a signing provider either.
- The send confirmation counts signers and approvers apart, and the public
  verify page says how many approvers there were (PR #249).

### Fixes

- In Settings, a team added while the list of teams was still loading
  could be hidden until the page was reloaded (PR #249).
- A declined envelope's certificate now lists the checks the signer had
  passed before declining, as it does for a signature.

### Upgrading

This release changes the database, in two migrations:

- `20261121100000_teams.sql` adds the `teams` and `team_members` tables.
- `20261121110000_approvers.sql` lets a signer row have the role
  `approver`, adds the `approved` and `rejected` audit events, and stops a
  field from being given to an approver. A copy of the app from before this
  release still runs on the database, but leaves approvers out of the
  signing order: roll back past it only with no approvers on envelopes out
  for signature.

On Vercel the production build applies the migrations. On other hosts, run
`npm run db:migrate` as on every deploy.

Thank you to @MattJackson, who built both headline features of this
release. Teams draw a careful line: teammates can read and download but
never change, drafts stay private, and every look is on the record.
Approvers fit into the signing order without a second set of rules, are
kept apart from signatures everywhere it counts, and stay out of Part 11
and provider signatures where an approval would not hold up. They answered
every review note quickly, too.

## [0.8.0] - 2026-11-21

An administrator can now write the words signers agree to before signing,
and this release closes a set of security gaps found in a review of the
code. Upgrading matters most for installs that use Part 11 mode, single
sign-on or backups. This release changes the database: see the end of this
entry.

### Settings

- An administrator can write the disclosure signers read and agree to before
  signing, under Settings, Organization, "What signers agree to before
  signing", or start from the standard text and edit it. Empty keeps the
  standard text. A line starting with `## ` is a heading, and `{sender}` and
  `{contact}` fill in who is asking and who to write to. Saving words of
  their own first shows a notice that the standard text covers what the U.S.
  E-SIGN Act requires, that changing it may make signatures invalid, and that
  nothing in SignuDoc is legal advice; the administrator presses "I agree",
  and that is recorded in the site audit trail. The version stored with each
  signer's agreement follows the text, and their audit trail keeps the words
  they read. The hosted service keeps the standard text (PR #193 by
  @carefulcomputer).

### Security

- Single sign-on counts an email address as verified only when the identity
  provider says so (`email_verified` set to true, or Microsoft Entra's
  `xms_edov`). Before, a provider that left the claim out was trusted.
- In Part 11 mode, an administrator's identity confirmation now holds the
  name and email address that were confirmed, and it counts only while the
  account still has both. Changing either one needs a new confirmation
  before the person can sign. Sending refuses a signer name that does not
  match the confirmed name, signatures are made in the confirmed name, and
  each signature checks again.
- Restoring a backup ends the sessions, sign-in codes, emailed signing codes,
  signing links and open signing-provider sessions it brought back, so a
  restore cannot bring an ended session or link back to life. Download links
  keep working. Restoring an older backup also fills in the rows that later
  migrations backfill.
- A certificate seals the audit trail as it stands while the envelope is
  held, so an event recorded at the same moment cannot be left out.
- Wrong access codes are counted per signer and code over a week, across
  every link and address: after 10, the signer has to wait or ask the sender
  for a new code. Tries sent at the same moment cannot slip past the count.
- Public signing and download links are limited to 1,000 requests per
  address every 10 minutes, and the text-fit check is limited per link.
- Off Vercel, the visitor's address is read from the end of
  `X-Forwarded-For`, where the last trusted proxy put it, so a visitor
  cannot choose the address that rate limits count against.
- A PDF with more than 1,000 pages is refused at upload.
- Sending refuses a dropdown whose box is too small to show its choices
  readably, so the signer is never handed one they cannot read.
- Failed sign-ins to addresses that have no account are recorded in the
  site audit trail, up to 20 an hour per address.

### Upgrading

If you use Part 11 mode, people whose confirmation came before this release
keep it: the migration records their current name and address as the
confirmed ones. From then on, a change to either needs an administrator to
confirm the person again.

This release changes the database, in three migrations:

- `20261119130000_consent_disclosure.sql` adds the
  `app_settings.consent_disclosure` column. Until it has run, the setting
  reads as empty and signers see the standard text.
- `20261120100000_identity_verified_snapshot.sql` adds
  `identity_verified_name` and `identity_verified_email` to the `user` table
  and fills them for people already confirmed.
- `20261120110000_repair_edited_migrations.sql` adds columns that a database
  which ran an early copy of three 0.5 and 0.7 migrations lacks (a preview
  deployment sharing the production database, for one). On a database that
  ran the final copies it changes nothing.

On Vercel the production build applies the migrations. On other hosts, run
`npm run db:migrate` as on every deploy.

Thank you to @carefulcomputer, who built the editable consent disclosure in
#193: the setting, the version that follows the text, and the care to keep
the hosted service on the standard words. It gave this release its headline
feature, and the E-SIGN notice was added on top of their work.

## [0.7.0] - 2026-11-20

A sender can now send one template to many people at once from a CSV. Two
signing fixes from outside contributors are in too. This release changes the
database: see the end of this entry.

### Templates

- **Send to many** on a template: upload or paste a CSV of names and email
  addresses and send one envelope per row, with a preview that flags missing
  or invalid addresses, duplicate rows and batches over 200 before anything
  is created. Each row is sent on its own, so one failure does not take the
  others with it. Confirming is safe to retry: the same batch returns its
  stored results instead of sending again. After sending, the results can be
  downloaded as a CSV. In Part 11 mode, a row is skipped when the signer
  does not have a verified, identity-checked account (PR #37 by
  @mvanhorn).

### Signing

- A required dropdown whose choices are all too long for their box no longer
  stops the signer from finishing. The signer cannot shorten the sender's
  text, so the choice is taken and drawn whole in the box, however small.
  Typed Text and Number answers are still checked as before (PR #196 by
  @RayFernando1337).
- A page with no fields for the signer stays readable. The notice that
  covered the whole page is gone, and the toolbar says "No fields on this
  page" instead (#182, PR #194 by @HimanshuMahto).

Thank you to everyone who helped with this release. @mvanhorn built Send to
many and worked through every review round until a lost connection, a slow
retry or an edited draft could no longer send anyone a second envelope.
@RayFernando1337 found the stuck dropdown and explained exactly why a signer
could not get past it, @chrisremboldt reported the notice that covered pages
without fields in #182, and @HimanshuMahto moved it out of the way and added
a test that checks nothing covers the document.

This release changes the database, in three migrations:
`20261118090000_bulk_send_batches.sql`,
`20261118120000_bulk_send_row_reason_cleared_with_envelope.sql` and
`20261120090000_bulk_send_skipped_rows.sql`. They add the
`bulk_send_batches` and `bulk_send_batch_rows` tables, so a confirmed batch
keeps its results and a retry does not send the same envelopes again, and a
trigger that clears a stored failure reason when its envelope is deleted. On
Vercel the production build applies the migrations. On other hosts, run
`npm run db:migrate` as on every deploy.

## [0.6.0] - 2026-11-20

Other apps can now work with SignuDoc: an API with keys, signed webhooks, and
signing inside another site's page. Signers can also sign at the same time,
and the sender can open the document while it is out for signature. This
release changes the database: see the end of this entry.

### API

- API keys: an administrator can make keys under Settings, Organization, API
  keys, for another app to use the SignuDoc API. A key is shown once, only
  its hash is stored, and it acts as the administrator who made it. Keys can
  be read-only, can expire, and stop working when revoked or when their
  administrator stops being one. `GET /api/v1/me` checks a key works. See
  [docs/api.md](docs/api.md) (#43, PR #44).
- API endpoints under `/api/v1`: create an envelope from a PDF with its
  signers, copy recipients and fields, and send it, in one call (all or
  nothing, safe to retry with an `Idempotency-Key`); send, void, remind and
  delete; list and read envelopes and their audit trail; download the signed
  PDF and the certificate; start an envelope from a template; upload PDFs
  over 4 MB straight to Blob. `GET /api/v1/openapi.json` describes it all
  (PR #45).
- Webhooks: an administrator can add endpoints under Settings,
  Organization, Webhooks, to be told when an envelope is sent, viewed,
  signed, completed, declined, voided or expires. Deliveries are signed the
  Standard Webhooks way, written in the same transaction as the change they
  report, and retried for about two and a half days. Settings shows a
  delivery log with "Send again", a test button and secret rotation;
  `GET /api/v1/webhook-deliveries` lets an app catch up. A new daily cron
  job, `/api/internal/webhooks`, sends retries that are due (PR #46).
- Embedded signing: an app can send an envelope with
  `"delivery": "embedded"` and show the signing page in a frame on its own
  site, from a link it asks for at
  `POST /api/v1/envelopes/{id}/signers/{signerId}/embed-link`. No invitations
  are emailed. Only sites an administrator lists under Settings,
  Organization, Embedded signing can frame the page, and the frame tells
  the app with `postMessage` when the signer signs or declines. The
  certificate of completion says the signer was identified by the app
  (PR #48).
- For installs where people sign in only through single sign-on, the API
  guide explains that removing someone at the identity provider leaves the
  keys they made working, and how to stop them when that person leaves
  (from @seanGSISG in #43).

### Signing

- Signers can sign at the same time. On Add signers, "Sign at the same time
  as Signer N" puts signers in one step: everyone in a step is invited when
  it starts and can sign in any order, and the next step starts once they
  have all signed. Steps and one-after-another signers can be mixed.
  Reminders, deadline changes, the expiry notice and voiding cover everyone
  whose turn it is, and the certificate numbers signers by step. Part 11
  mode and advanced or qualified signatures keep one signer after another.
  See [Signing order](docs/signing-order.md) (#85, PR #157 by @MattJackson,
  carried in PR #190).
- An envelope can have up to 25 signers instead of 10, and
  `MAX_SIGNERS_PER_ENVELOPE` sets any limit from 1 to 100 (PR #157).
- A browser test now checks that a long typed signature keeps the signature
  dialog and its buttons on a phone screen. PR #168 fixed this in 0.5.2
  (#112, PR #187).

### Sending

- While an envelope is out for signature, and after it is declined, voided
  or expired, its page has a View document button, and its first-page
  picture opens the document as it was sent, in a new tab. An administrator
  opening another member's document is recorded in the site audit trail
  (#87, PR #188).
- A field save from an older Place fields page, such as the save sent on
  the way out that arrives late, or one from a second tab, is refused with a
  request to reload, instead of overwriting newer fields (PR #186, a
  follow-up to #165).

### Settings and docs

- With Part 11 mode on, "Who can create an account" says that Part 11
  signers need an account whose identity an administrator has confirmed, so
  the sign-up rule must let them make one (#107, PR #187).
- The Part 11 change-control guide describes the numbered releases, with
  their tag, source archive, SBOM and checksums (#101, PR #187).
- The development guide explains how to run a production build on your own
  computer with email capture (#114, PR #183 by @Chirag0401, carried in
  PR #187).
- The README covers sign-in security, backups, the administrator features
  and the API, with new screenshots (PRs #189 and #195).

Thank you to everyone who helped with this release. @azshaw asked for the
API, webhooks and embedded signing in #43, and set out in four clear parts
what an app needs, down to letting chosen sites frame the signing page, which
is how embedded signing works. @steven-khimba, @mattwpickles and @seanGSISG
told us what they would build with it, and @seanGSISG's note on single
sign-on is now in the API guide. @MattJackson built signing at the same time,
which @melsom123 asked for. @infoivy asked for View document, @Chirag0401
wrote the guide to local production builds, and @coygeek reported four more
careful issues.

This release changes the database, in eight migrations:
`20261118090000_api_keys.sql`, `20261118100000_api_envelopes.sql`,
`20261118100500_api_idempotency_resource.sql`,
`20261118110000_webhooks.sql`, `20261118120000_embedded_signing.sql`,
`20261118120500_embed_link_api_key.sql`, `20261119090000_signing_steps.sql`
and `20261119120000_fields_revision.sql`. They add the `api_keys`,
`api_idempotency`, `webhook_endpoints`, `webhook_deliveries` and
`embed_allowed_origins` tables and nine columns on envelopes and signers.
Every signer already in an envelope gets the step of their place in the
order, so envelopes out for signature carry on as before. On Vercel the
production build applies the migrations. On other hosts, run
`npm run db:migrate` as on every deploy, and if you use webhooks, have your
scheduler call `/api/internal/webhooks` once a day too.

## [0.5.2] - 2026-11-19

Twenty-four bug fixes. Seventeen fix reported issues (sixteen from @coygeek,
one from @seanGSISG), and ten came as pull requests from five outside
contributors. This release adds one database column: see the end of this
entry.

### Signing

- Opening an old invitation after the envelope was signed, completed,
  declined or voided says what happened to it, instead of asking the signer
  to request a new link the sender cannot send (#110, PR #178).
- Reloading the signing page before Finish asks first, instead of throwing
  away the signature and answers without warning (#99, PR #169).
- A long Text answer no longer widens the signing page past the window
  (#103, PR #177).
- Closing the signature dialog, including with Escape, returns focus to the
  field instead of the top of the page (#105, PR #181).
- "Resend code" says when the code was not sent, instead of confirming an
  email during the wait between codes (#113, PR #172).
- A signer name that is a lone emoji, or uses scripts with combining marks,
  gives whole-character avatar initials instead of a broken one that could
  stop the page from loading (#115, PR #173).

### Sending

- Going Back from Add signers returns to the same draft, instead of a blank
  upload where a second upload made a second draft (#94, PR #166).
- A field placed just before pressing Back on Place fields is saved
  (#102, PR #165).
- On a phone, the Field tools sheet stays on screen with Done visible, and
  Escape closes it (#111, PR #180).
- A long unbroken title in the review and send dialogs wraps, so "Send now"
  stays on screen (#104, PR #168).
- On wide screens the envelope page's action buttons wrap instead of covering
  a long title (#131, PR #132 by @seanGSISG, carried in PR #170).
- A new sender on an install without email is told so at sign-up, instead of
  being told to check their inbox (#95, PR #167).
- Uploading a cut-off or damaged logo is refused, instead of replacing the
  working logo with a broken one (#91, PR #124 by @HimanshuMahto, carried in
  PR #171).

### Audit trail and certificates

- Password resets, role changes and account closure requests record the IP
  address and user agent in the site audit trail (#98, PR #164).
- The daily job's scheduled account deletion is logged as the system's, not as
  a user action (#109, PR #176).
- The certificate says a locally captured email was captured, not accepted by
  a mail provider (#106, PR #175).

### Administrators and settings

- The last administrator cannot close their own account (PR #153 by
  @MattJackson).
- Saving settings can no longer be undone by an older cached copy
  (PR #152 by @MattJackson).
- A cancelled deletion's email always arrives before the notice of a deletion
  scheduled again (PR #160 by @RayFernando1337).
- A scheduled deletion whose files could not be removed is reported as a
  failure (PR #162 by @RayFernando1337).
- Switching between Mine and Everyone's on the dashboard clears the old search
  (PR #161 by @RayFernando1337).

### Hosting

- The functions that draw PDFs ship only the files they need instead of a
  copy of the whole project, and CI checks this after each build (#108,
  PR #119 by @UsamaKhan, carried in PR #174).
- An empty `STORAGE_LOCAL_DIR` uses the default `.data/storage` folder instead
  of the working directory (PR #151 by @MattJackson).
- A backup or restore whose copy fails lets go of its download
  (PR #150 by @MattJackson).

The seven outside PRs #150-#153 and #160-#162 were merged through PR #179.

Thank you to everyone who helped with this release. @coygeek filed sixteen of
these reports, each with the cause and a clear way to reproduce it, which is a
huge gift to the project. @MattJackson sent four careful fixes for the edges of
backups, storage, settings and account closure. @RayFernando1337 sent three
fixes for scheduled deletion and the dashboard. @UsamaKhan made the PDF
functions much smaller, @HimanshuMahto made logo uploads safe against damaged
files, and @seanGSISG both reported the covered title and sent the fix.

This release changes the database (`20261119090000_spent_signing_links.sql`,
one new column on signers that lets an old link say what happened). On Vercel
the production build applies it. On other hosts, run `npm run db:migrate` as on
every deploy.

## [0.5.1] - 2026-11-19

Six bug fixes, all reported by @coygeek. There are no database changes and no
new settings.

### Fixes

- A completed envelope whose title has an emoji near the 120th character can
  be downloaded again. Its signed PDF and certificate returned a server error,
  because the file name was cut in the middle of the emoji (#89, PR #142).
  The email sender's name and the seal certificate's names are now cut at
  whole characters too, so an emoji in an organization name cannot break the
  seal or the From line (PR #148).
- A long answer in a Text, Number or Dropdown field wraps onto as many lines
  as it needs inside its box on the signed PDF, at the largest size that fits,
  instead of running past the box and off the page. While typing, the signer
  sees a "box is full" warning with how many characters fit, and Finish stays
  off until the answer is shortened. Answers accepted before this release are
  still drawn whole (#90, PR #146).
- With local disk storage, PDFs between 10 and 20 MB upload instead of failing
  with a misleading title error. An upload over the limit gets the usual size
  message (#92, PR #147).
- The certificate lists audit events in the order they were recorded, so
  events from the same second no longer swap places, for example "completed"
  above the last "signed". Existing certificates still verify (#97, PR #143).
- The last signer can finish, and a signer can decline, when the install's
  email setup has been removed. The envelope used to stay incomplete with a
  server error (#96, PR #145).
- Voiding an envelope emails the signers who already signed, telling them the
  document will not be completed. Signers still waiting for their turn were
  never invited and still get nothing. The void dialog says who will be told
  (#93, PR #144).

Thanks to @coygeek for six clear, careful reports, each with the cause and a
way to reproduce it, which made every one of these fixes straightforward.

## [0.5.0] - 2026-11-18

Administrators can now see every member's envelopes and delete finished ones
after a 14-day notice, plus six outside bug fixes and a security update. This
release changes the database: see the end of this entry.

### Administrators

- An "Everyone's" view on the dashboard lists every member's sent and
  finished envelopes, with the sender on each card. Administrators can open
  them and download their files, and a download of another member's file is
  recorded in the site audit trail. Drafts stay private to their sender.
- The dashboard is split into pages of 48, and its search box searches the
  whole list on the server, including the sender's name and email in
  "Everyone's".
- "Delete envelope" on a completed, declined or voided envelope schedules it
  for deletion 14 days later. The sender gets an email naming who asked, and
  any administrator can cancel within the 14 days, in which case the sender
  is told it will not be deleted. Nothing is deleted before the sender has
  been emailed. In Part 11 mode a reason is required. The request, a
  cancellation and the deletion itself are all in the site audit trail, with
  the record's hashes kept after the files are gone.
- A deleted envelope's files are queued and retried by the daily job until
  they are gone, so a storage hiccup cannot leave orphaned files behind.
- The retention sweep does not delete an envelope with a deletion scheduled,
  so the retention period cannot cut the 14-day notice short.

### Fixes

- Fields placed on rotated pages (typical of landscape scans), and on pages
  whose crop box differs from the page size, are stamped where they were
  placed in the signed PDF instead of shifted or sideways. This includes
  envelopes uploaded before this release (#69, PR #116).
- A void or decline that races another void, decline or the last signature
  no longer deletes the winner's certificate (#68).
- After switching signature tabs, the Draw tab shows the drawing that will
  be applied, instead of an empty canvas (#70).
- A client that sends an empty User-Agent header can sign, verify, consent
  and decline, instead of getting an error (#71).
- Exporting the audit trail of an envelope whose title has a dash, curly
  quote or non-Latin characters works, instead of failing with a server
  error (#72).
- An envelope's timeline lists events in the order they were recorded, so
  "completed" no longer shows before "signed" (#73).

### Security

- node-forge updated to 1.4.3, which fixes four moderate advisories (#80).

Thanks to @njarrar for the six fixes, and to @jasonhaggart for the node-forge
update.

This release changes the database (`20261118100000_pending_file_deletions.sql`,
`20261118110000_scheduled_envelope_deletions.sql`). On Vercel the production
build applies them. On other hosts, run `npm run db:migrate` as on every
deploy.

## [0.4.0] - 2026-11-17

A name field, and fixes for nine reported bugs. This release changes the
database: see the end of this entry.

### Envelopes

- A name field. Place it where the signer's printed name belongs, and it is
  filled in with the name the sender gave that signer when they sign, the
  way a date field is filled in with the day. It is always required, and the
  signer does not type it. Contributed by @sumnerboy12 (#49, PR #50).

### Fixes

- The certificate's "sent" and reminder rows name the sender, not the first
  signer next to the sender's email address (#52).
- Sending or reminding when email is not set up says so, instead of failing
  with a generic server error. A manual reminder no longer retires the
  signer's link before finding there is no email to send it with (#53).
- A password-locked PDF is named as locked on upload, instead of being
  reported as a file that could not be rendered (#54).
- After a signer declines, the page says the decline was recorded, instead
  of "This link has expired" (#55).
- Setup refuses a password over 128 characters instead of silently cutting
  it short, which made the next sign-in fail (#56).
- Sign-in and sign-up say a password is too long, instead of "too short" or
  "something went wrong" (#57).
- Typed signatures in the script font keep every letter when the text is
  copied or searched, and no longer show gaps inside names where the font
  joins letters (#58, #59).

### Documentation

- The agent deploy guide checks Vercel's rule that the free Hobby plan is
  for non-commercial use before choosing free plans for a company (#47).

Thanks to @coygeek for the detailed bug reports, and to @sumnerboy12 for the
name field.

This release changes the database (`20261118090000_name_field.sql`). On
Vercel the production build applies it. On other hosts, run
`npm run db:migrate` as on every deploy.

## [0.3.0] - 2026-11-16

Sign-in security and audit features for organizations that need them, and
two new ways to fix a sent envelope. This release changes the database: see
the end of this entry.

### Envelopes

- A sender can correct a signer's email address after sending. The old
  signing link stops working, the new address gets a fresh invitation, and
  the audit trail records the correction.
- A finished envelope can be copied into a new draft with the same document,
  recipients and fields, and nothing that was filled in.

### Sign-in security

- Two-step sign-in: anyone with an account can add an authenticator app
  under Settings, with ten single-use backup codes. Signing in then asks for
  a code after the password.
- Administrators can require two-step sign-in of everyone (Settings,
  Organization, Sign-in security), and reset it for someone who lost their
  phone (People).
- Session limits: administrators can sign people out after a time without
  use (15 minutes to 8 hours) and at the latest a set time after sign-in
  (8 hours to 3 days). Anyone can sign out on every device at once.
- A session that was ended (signed out everywhere, or reset by an
  administrator) stops working at once, not when the short-lived session
  cookie runs out.
- Ten wrong passwords for one email address within 15 minutes stop sign-in
  for that address for 15 minutes.
- The site audit trail now records sign-ins, failed sign-ins, lockouts,
  sign-outs, password changes and resets, two-step sign-in changes, logo
  changes and the email domain being added. It moved from the Part 11 panel
  to the new Sign-in security panel, and is there whether or not Part 11
  mode is on.
- Single sign-on over OpenID Connect (Okta, Microsoft Entra ID, Google
  Workspace and others), set up with `SSO_ISSUER`, `SSO_CLIENT_ID` and
  `SSO_CLIENT_SECRET`. New people get an account under the install's
  sign-up rule. `PASSWORD_SIGN_IN=off` then turns password sign-in off,
  except for the addresses in `PASSWORD_SIGN_IN_ALLOWED_EMAILS`.
- Audit rows (site and document trails) and security events are written to
  the function logs as JSON lines once saved, so a Vercel log drain can
  deliver them to a SIEM. `AUDIT_LOG=off` stops the audit lines.
- A daily backup of the database and files to a second, private Blob store,
  turned on with `BACKUP_BLOB_READ_WRITE_TOKEN`, and `npm run restore-backup`
  to restore it into a new database and store. See
  `docs/backup-and-restore.md`. `vercel.json` has a second daily cron job,
  which does nothing until the token is set.

- Account closure requests and account deletions are recorded in the site
  audit trail.
- `docs/soc2`: a SOC 2 pack for organizations that put an install in their
  audit: a control map to the Trust Services Criteria, vendor duties,
  questionnaire answers and sample policies.

### Project security

- CodeQL, dependency review, a weekly `npm audit` and OpenSSF Scorecard run
  on the SignuDoc repository (skipped in a copy made by the Deploy button).
- Each release gets a CycloneDX SBOM, a source archive and signed build
  provenance attached. `SECURITY.md` says how to verify them.

This release changes the database (`20261115100000_copied_audit_event.sql`,
`20261116100000_signer_corrected.sql`, `20261117090000_sign_in_security.sql`,
`20261117100000_session_controls.sql`). On Vercel the production build
applies them, so nothing is needed by hand. On other hosts, run
`npm run db:migrate` as on every deploy.

## [0.2.1] - 2026-11-16

A smoother first deploy. No database change: this release needs no
migration step.

### Deploying

- The Deploy button adds Resend first, then Neon and Blob, so Resend's
  sending domain has longer to be ready before the first deployment starts.
- The README and the self-hosting guide say what to do when Vercel stops the
  first deployment with "One or more integration resources failed to
  provision": wait, refresh and redeploy.
- New [guide for AI agents](docs/deploy-with-an-agent.md) that deploy
  SignuDoc for someone through their browser.
- The README's button now reads "Deploy to Vercel", with "or copy this to
  your LLM" under it, linking to that guide.

## [0.2.0] - 2026-11-15

Installs can now find and take new releases without using git. No database
change: this release needs no migration step.

### Keeping an install up to date

- **Check for updates** in Settings, SignuDoc (administrators only): shows
  the version the site runs, asks GitHub for the latest release, and shows
  what is new in it.
- **Update SignuDoc workflow** (`.github/workflows/update-signudoc.yml`) in
  each copy: runs every Monday or by hand, merges the new release with the
  copy on a `signudoc-update/<version>` branch and opens a pull request, so
  Vercel builds a preview first. Changes you made to the code are kept; where
  you and SignuDoc changed the same lines it stops and lists the files. It
  never force-pushes.
- Optional settings for the workflow: a `SIGNUDOC_UPDATE_TOKEN` secret so it
  can update workflow files too, `SIGNUDOC_AUTO_MERGE=1` to merge clean
  updates straight into production, and `SIGNUDOC_PRODUCTION_BRANCH` when
  Vercel deploys from a branch other than the default one.
- `docs/self-hosting.md` explains the workflow and a by-hand update for a
  Deploy-button copy, which shares no history with this project.

### Upgrading from 0.1.0

A copy made from 0.1.0 does not have the update workflow yet. Add
`.github/workflows/update-signudoc.yml` to it once (Settings in SignuDoc
links to the right page, and `docs/self-hosting.md` has the steps), then run
it. If it asks which version you deployed, use `v0.1.0`.

### Other changes

- The Code of Conduct file is removed.

### Not yet verified

- The update workflow is tested in CI against stand-in repositories. A real
  run in a Deploy-button copy has not been done yet.
- Everything listed under 0.1.0 as not yet verified still is.

## [0.1.0] - 2026-11-14

The first open-source release. SignuDoc is an e-signature platform that an
organization deploys to its own Vercel account and runs on free plans.

### Deploy and run it yourself

- One-click **Deploy to Vercel** button that provisions Neon Postgres, Vercel
  Blob and Resend from the Vercel Marketplace, all on their free plans.
  Vercel keeps its free Hobby plan for personal, non-commercial use, so a
  company belongs on Vercel Pro ($20 a month, whatever its size).
- Setup wizard on first visit: creates the first administrator, asks for the
  install's own support email, and fills in the email sending domain (with a
  `sign.` subdomain by default).
- Daily Vercel cron for reminders, deadlines and retention, rate limits kept
  in Postgres, and optional Vercel BotID (`BOTID=1`).
- Runs locally with no outside services for development and tests.
- Copyright Nyllon Software, released under the license in `LICENSE`.

### Sending and signing

- Soft Studio interface for the dashboard, field placement, envelopes and the
  signing page, with first-page thumbnails and a phone layout.
- Signers sign without an account. A signer's extra check is one choice: an
  emailed code or an access code.
- Text, date, number, checkbox, dropdown and radio fields; signing order;
  CC recipients; deadlines with expiry; optional reminders.
- Templates for documents sent often ("Save as template", "Use template").
- Branding with your own name, logo and color, and an administrators panel.

### Records you can rely on

- Electronic-records consent disclosure and a permitted-use list, both
  versioned, to meet US ESIGN/UETA and EU eIDAS expectations for simple
  electronic signatures.
- Hash-chained audit trail and a completion certificate on every envelope.
- Finished documents sealed with a PAdES signature (an install's own key, or
  your certificate through `SEAL_P12_BASE64`), with an RFC 3161 timestamp when
  `SEAL_TIMESTAMP_URL` is set.
- PAdES B-LT and B-LTA: revocation data and a document timestamp are added
  after the seal so it stays checkable for years.
- Retention settings with a warning before anything is deleted, and signer
  erasure requests.

### Regulated use

- **Part 11 mode** for FDA 21 CFR Part 11 records: signers sign from a
  verified account and enter their password at signing, each signature
  carries its meaning, and settings changes go to their own audit chain with
  CSV export. A validation pack in `docs/part11/` gives an install a start on
  its own validation.
- **Signer advanced and qualified signatures (AdES/QES)**: a signer can sign in
  their own name through eID Easy or any Cloud Signature Consortium (CSC v2)
  provider, with the result embedded in the PDF.

### Not yet verified

These parts are built and tested against stand-ins in CI, but have not been
checked against the real services:

- A full Deploy-button pass on a clean Vercel account, step by step against the
  README. A first run surfaced Vercel's "Needs Attention" badge on Neon
  variables, which `docs/self-hosting.md` now explains.
- Live eID Easy and CSC providers for signer AdES/QES.
- A real timestamp authority and certificate authority for the seal and for
  B-LT/B-LTA.
- Part 11 mode and the validation pack are a starting point: each
  organization still has to validate its own install.

SignuDoc is software, not legal advice. See the README's legal disclaimer.

[0.9.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.9.0
[0.8.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.8.0
[0.7.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.7.0
[0.6.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.6.0
[0.5.2]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.5.2
[0.5.1]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.5.1
[0.5.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.5.0
[0.4.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.4.0
[0.3.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.3.0
[0.2.1]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.2.1
[0.2.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.2.0
[0.1.0]: https://github.com/NYLLON-SOFTWARE/SignuDoc/releases/tag/v0.1.0
