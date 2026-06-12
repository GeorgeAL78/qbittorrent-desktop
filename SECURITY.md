# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/GeorgeAL78/qbittorrent-desktop/security/advisories/new) to report it confidentially. You'll receive a response within a few days.

## Scope

This app is a desktop wrapper around the qBittorrent Web UI. Security concerns may include:

- Credentials (username/password) stored or transmitted insecurely
- Local path exposure via the path mapping feature
- Electron security misconfigurations (remote code execution, etc.)

## Out of scope

- Vulnerabilities in qBittorrent itself — report those to the [qBittorrent project](https://github.com/qbittorrent/qBittorrent)
- Vulnerabilities in Electron — report those to the [Electron project](https://github.com/electron/electron)
