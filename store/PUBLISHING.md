# Publishing checklist

## First submission

1. Register the permanent publisher Google account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Enable two-step verification and complete the one-time developer registration payment.
3. Ensure the directional split-navigation changes and release preparation are committed and pushed.
4. Make `PRIVACY.md` publicly accessible at the URL used in `LISTING.md`.
5. Capture the outstanding graphics in `ASSETS.md`.
6. Run:

   ```sh
   npm run package
   ```

7. Inspect `dist/helium-command-bar-<version>.zip`. Its root must contain `manifest.json`.
8. In the Developer Dashboard, choose **Add new item** and upload that ZIP.
9. Copy the product copy, single-purpose statement, privacy disclosures, and permission justifications from `LISTING.md` into the corresponding dashboard fields.
10. Add the public privacy-policy URL:

    ```text
    https://github.com/0xrusowsky/helium-command-bar/blob/main/PRIVACY.md
    ```

11. Add the reviewer guidance from `TEST_INSTRUCTIONS.md`.
12. Configure distribution and submit for review. Deferred publishing is recommended for the first release so the approved listing can be checked before going live.

## Release updates

Every uploaded package must have a version greater than the currently published version.

1. Update `version` in both `manifest.json` and `package.json`.
2. Update user-facing documentation and the privacy policy when behavior or data handling changes.
3. Run `npm test`.
4. Run `npm run package`.
5. Upload the new ZIP to the existing store item and submit it for review.
6. Tag the same commit in Git so the store package can be reproduced later.

## Package policy

The release archive is built from an explicit runtime-file allowlist in `scripts/package.sh`. Tests, Git metadata, store documents, screenshots, repository integrations, and development files are intentionally excluded.

All executable JavaScript and CSS must remain inside the uploaded package. Do not introduce remotely hosted scripts, WebAssembly, `eval`, or downloaded executable logic.

## Existing unpacked users

The store installation will probably receive a different extension ID from existing unpacked installations. Existing users should install the store version, reconfigure synchronized preferences if they do not transfer, assign extension shortcuts, enable the Karabiner rules, and then remove the unpacked copy.

The Chrome Web Store updates the extension package automatically, but it cannot update a user's external Karabiner configuration or manually assigned fifth extension shortcut.
