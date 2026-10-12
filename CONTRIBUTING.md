# Contributing

Thanks for helping. A few things first:

- **License.** FixFlow is under the [Functional Source License](LICENSE) (FSL-1.1-ALv2). By contributing you agree your change is released under it.
- **Sign off your commits** (`git commit -s`). That adds a `Signed-off-by:` line certifying the [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the change or have the right to submit it. The maintainer may relicense the project in future, and the sign-off is what makes that possible for your contribution.
- **Run the checks** before opening a pull request:

  ```bash
  npm run typecheck
  npm test
  ```

  If you changed the setup (`scripts/setup*.mjs`, `scripts/env-template.mjs`) or the desktop app (`desktop/`), also run:

  ```bash
  python3 test/setup-wizard.pty.py
  cd desktop && npm run dist:mac && npm run test:e2e
  ```

  The end-to-end tests run on macOS only. If your change touches Windows or Linux behaviour, build with `npm run dist:win` or `npm run dist:linux` and say in the pull request what you tried by hand.

- Keep a pull request to one change. Read `DESIGN.md` before touching the UI.

Found a security problem? Do not open a public issue; email the maintainer instead.
