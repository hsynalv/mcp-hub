# Open-Source Readiness Checklist

Use this checklist to verify MCP-Hub is ready for open-source release.

## Documentation

- [x] README with quick start and feature overview
- [x] Documentation index (docs/README.md)
- [x] Architecture documentation
- [x] Plugin SDK and development guide
- [x] Environment variables documented (no real secrets)
- [x] Example configurations (minimal, RAG, code intelligence)
- [x] Security model and workspace security docs

## Community

- [x] CONTRIBUTING.md with setup, style, PR process
- [x] Pull request template
- [x] Issue templates (bug, feature)
- [x] SECURITY.md for vulnerability reporting

## Release Discipline

- [x] CHANGELOG.md following Keep a Changelog
- [x] Semantic versioning (SemVer)
- [x] Release checklist (docs/RELEASE.md)
- [ ] GitHub Releases workflow (if applicable)
- [ ] Automated version bump (optional)

## Security

- [x] No secrets in documentation
- [x] Placeholder values in examples (sk-xxx, ghp_xxx, etc.)
- [x] .env.example with safe defaults
- [x] .gitignore excludes .env and sensitive files
- [x] Security policy (SECURITY.md)

## Code Quality

- [ ] All tests passing
- [ ] Lint passing
- [ ] No known critical vulnerabilities
- [ ] Dependencies up to date (npm audit)

## Legal

- [ ] LICENSE file present and correct
- [ ] Third-party licenses acknowledged if required
- [ ] No proprietary code without permission

## Optional Enhancements

- [ ] GitHub Discussions for Q&A
- [ ] Code of conduct (CODE_OF_CONDUCT.md)
- [ ] Badges in README (build status, coverage, license)
- [ ] Docker image or deployment guide
- [ ] API reference (OpenAPI/Swagger)
