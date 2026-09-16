# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-16

Initial release.

### Added

- Typed client for the Typefully API v2 with retries, backoff, timeouts, and offset pagination.
- `auth` (login, status, whoami, token, logout) with profiles stored in `~/.config/typefully`.
- `social-sets` list/get, `config` for default social set and base URL.
- `drafts` create/update/get/list/schedule/publish/delete, with threads from repeated `--text`,
  files split on `---`, or stdin; media upload and attach in one step; X reply, quote, and
  community posts; a weighted 280-character check for X.
- `media` upload/status, `tags` list/create, `queue` show/schedule/set-schedule.
- `analytics` posts (per post or grouped per thread, labelled from a draft-id map) and followers.
- `batch` list/push for JSON content calendars with draft-id recording and duplicate protection.
- `text` length/split utilities.
- `.env` / `.env.local` loading from the working directory.

[0.1.0]: https://github.com/BrainGridAI/typefully-cli/releases/tag/v0.1.0
