---
name: insecure-defaults
description: "Audits a file, directory, or whole repository for insecure default configuration: fallback secrets, default credentials, fail-open switches, weak crypto, permissive access, debug leakage. Use when auditing configuration defaults, authentication setups, crypto algorithms, or security switches."
allowed-tools: Read Grep Glob
---

# Insecure Defaults Detection

Audits a codebase for insecure default configuration, tracing each candidate before reporting it.

## When to Use

- Auditing configuration schemas and default values
- Checking for fallback credentials or secrets in development and production configs
- Reviewing authentication/authorization switches that may fail-open
- Checking cryptographic hashing or encryption defaults
- Reviewing file system permissions or CORS access defaults
- Looking for debug endpoints or error disclosure leaks in production paths

## What It Audits

| Category | Description | References |
|---|---|---|
| Fallback secrets | Insecure fallback tokens or signing keys (e.g. `SECRET = env.get('KEY') or 'dev'`) | `references/fallback-secrets.md` |
| Default credentials | Hardcoded or seeded default passwords/usernames (`admin` / `admin123`) | `references/default-credentials.md` |
| Fail-open switches | Security checks that default to disabled if config is missing (`REQUIRE_AUTH = env.get('AUTH', 'false')`) | `references/fail-open-security.md` |
| Weak crypto | Insecure algorithms like MD5, SHA1 for passwords, ECB mode, static IVs | `references/weak-crypto.md` |
| Permissive access | Overly broad ACLs, CORS `*` with credentials, world-writable file modes | `references/permissive-access.md` |
| Debug leakage | Uncaught stack traces in production responses, verbose error modes | `references/debug-features.md` |

## Audit Methodology

1. **Reconnaissance**: Identify config files, environment variable loaders, auth middleware, and crypto utilities.
2. **Detection**: Search for pattern matches across each of the 6 categories using `Grep` and `Read`.
3. **Trace and Verification**:
   - Is the file reachable in production?
   - Is the fallback or default value actually insecure?
   - Does missing configuration cause the app to fail-open (insecure) or fail-closed (secure)?
   - Does the value reach a security-critical sink?
4. **Report Findings**: Record exact file, line number, category, evidence, and remediation advice.
