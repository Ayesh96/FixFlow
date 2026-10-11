# Contributing

Thanks for helping. A few things first:

- **License.** FixFlow is under the [Functional Source License](LICENSE) (FSL-1.1-ALv2). By contributing you agree your change is released under it.
- **Sign off your commits** (`git commit -s`). That adds a `Signed-off-by:` line certifying the [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the change or have the right to submit it. The maintainer may relicense the project in future, and the sign-off is what makes that possible for your contribution.
- **Run the checks** before opening a pull request:

  ```bash
  npm run typecheck
  npm test
  ```

- Keep a pull request to one change. Read `DESIGN.md` before touching the UI.

Found a security problem? Do not open a public issue; email the maintainer instead.
