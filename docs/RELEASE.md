# Release Process

## Versioning

MCP-Hub follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes, incompatible API changes
- **MINOR** (0.x.0): New features, backward compatible
- **PATCH** (0.0.x): Bug fixes, backward compatible

## Release Checklist

Before cutting a release:

- [ ] All tests pass: `npm run test:run`
- [ ] Lint passes: `npm run lint`
- [ ] CHANGELOG.md updated with new version section
- [ ] Version bumped in `package.json` (and `mcp-server/package.json` if separate)
- [ ] Documentation reviewed for accuracy
- [ ] No secrets or credentials in committed files
- [ ] Breaking changes documented in CHANGELOG and migration notes if needed

## Release Steps

1. **Update CHANGELOG.md**
   - Move items from `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`
   - Add new `[Unreleased]` section

2. **Bump version**
   ```bash
   npm version patch   # or minor, major
   ```

3. **Tag and push**
   ```bash
   git push origin main --tags
   ```

4. **Create GitHub Release** (if using GitHub Releases)
   - Copy CHANGELOG section for the version
   - Attach build artifacts if applicable

## Pre-release (Beta/RC)

For pre-release versions:

```bash
npm version 1.2.0-beta.1
```

Use the `-beta.N` or `-rc.N` suffix. Document in CHANGELOG under a pre-release section.
