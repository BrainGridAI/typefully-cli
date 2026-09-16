# typefully-cli

A comprehensive command-line interface for the [Typefully API v2](https://typefully.com/docs/api):
create and schedule drafts and threads across X, LinkedIn, Threads, Bluesky and Mastodon, upload
media, manage the queue and tags, pull post and follower analytics, and push whole content
calendars from a JSON file with one command.

```
typefully drafts create -f thread.md --schedule next-free-slot --media-file card.png
typefully batch push gtm/twitter/schedule-60.json --day 62 --record gtm/twitter/draft-ids.json
typefully analytics posts --days 14 --group-by-draft --map gtm/twitter/draft-ids.json
```

## Install

```bash
# from source (this repo)
pnpm install
pnpm build
pnpm link --global      # puts `typefully` on your PATH

# or run without installing
node dist/index.js --help
```

Requires Node.js 18+.

## Authenticate

Create an API key at <https://typefully.com/?settings=api>, then either:

```bash
typefully auth login                    # prompts for the key (hidden input), verifies it against /me
typefully auth login --token tf_…       # non-interactive
echo "$KEY" | typefully auth login      # from a pipe / secret manager

export TYPEFULLY_API_KEY=tf_…           # or use the environment (CI, scripts)
```

`TYPEFULLY_TOKEN` is accepted as an alias. The CLI also reads `./.env` and `./.env.local` from the
working directory (real environment variables always win; set `TYPEFULLY_NO_DOTENV=1` to skip).

```bash
typefully auth status     # resolved profile, key source, default social set
typefully auth whoami     # the Typefully user behind the key
typefully auth token      # print the key (for scripts)
typefully auth logout
```

## Pick an account (social set)

A Typefully **social set** is one identity with its connected platforms. Every content command
needs one. Resolution order: `--social-set` flag, `TYPEFULLY_SOCIAL_SET`, the profile's
`social_set`, then the global config value.

```bash
typefully social-sets list --platforms
#   id      username      name          team       platforms
#   54758   @acossta      Nico Acosta              x,linkedin,bluesky
#   315492  @radialbuild  Radial        BrainGrid  x

typefully config set social_set 54758         # global default
typefully config set social_set 315492 --profile-scope
typefully social-sets get                     # connected platforms + publishing quota
```

## Drafts

```bash
# unscheduled draft on the default platforms (X + Bluesky when connected)
typefully drafts create "Planning is the new bottleneck."

# thread: repeat --text, or split a file / stdin on lines that are exactly ---
typefully drafts create -t "first" -t "second" -t "third"
typefully drafts create -f thread.md
printf 'first\n---\nsecond' | typefully drafts create

# platforms, media, scheduling, metadata
typefully drafts create "Hi" -p x,linkedin --media-file card.png --title "Wed post" --tags ship
typefully drafts create "Hi" --schedule next-free-slot
typefully drafts create "Hi" --schedule 2026-09-24T15:00:00Z
typefully drafts create "Hi" --schedule now                       # publish immediately

# X-only forms
typefully drafts create "Great thread" --reply-to https://x.com/u/status/1
typefully drafts create "My take"      --quote    https://x.com/u/status/1
typefully drafts create "Update"       --community 1493446837214187523

# inspect / change
typefully drafts list --scheduled                 # upcoming, every page
typefully drafts list --published --since 2026-09-01
typefully drafts get 10797988
typefully drafts update 10797988 --title "renamed" --schedule 2026-09-25T15:00:00Z
typefully drafts update 10797988 --append-media --media-file extra.png
typefully drafts schedule 10797988 --at next-free-slot
typefully drafts publish 10797988 --yes
typefully drafts delete 10797988 10797989
```

Every X post is checked against X's weighted 280-character limit before the request is sent (links
count 23, emoji and CJK count 2). Add `--no-length-check` to override. `--dry-run` prints the exact
request body without calling the API.

## Media, tags, queue

```bash
typefully media upload card.png video.mp4        # waits for processing, prints media ids
typefully media status <media_id>

typefully tags list
typefully tags create launch

typefully queue show --days 7                     # slots and the drafts filling them
typefully queue show --empty
typefully queue schedule                          # slot rules + timezone
typefully queue set-schedule --slot 08:00 --slot 17:00@mon,wed,fri
typefully queue set-schedule --rules '[{"h":9,"m":30,"days":["mon","wed","fri"]}]'
```

## Analytics (X)

```bash
typefully analytics posts --days 14                          # per post, every page
typefully analytics posts --from 2026-08-01 --to 2026-08-31 --include-replies -o csv
typefully analytics posts --group-by-draft                   # one row per thread
typefully analytics posts --group-by-draft --map gtm/twitter/draft-ids.json   # labelled by campaign
typefully analytics followers --days 30
```

`--group-by-draft` takes the thread's top tweet for impressions and engagement and sums link clicks
across every tweet in the thread (reply-arm links live on the reply). `--map` accepts either
`{ "61-am": 9930823 }` or `{ "61-am": { "id": 9930823, "campaign": "h-agent-honesty" } }`.

## Batch publishing

`batch push` turns a JSON content calendar into scheduled drafts, uploading media on the way and
recording the resulting draft ids so analytics can be matched back to campaigns.

```jsonc
// gtm/twitter/schedule-60.json
{
  "social_set": 315492,
  "posts": [
    {
      "day": 62, "slot": "am", "campaign": "h-agent-honesty",
      "publish_at": "2026-09-20T15:57:00Z",
      "tweets": ["main tweet", "reply with the link"],
      "media_files": ["gtm/videos/out/clip.mp4"],
      "platforms": ["x"]
    }
  ]
}
```

```bash
typefully batch list gtm/twitter/schedule-60.json --day 62 --record gtm/twitter/draft-ids.json
typefully batch push gtm/twitter/schedule-60.json --day 62 --record gtm/twitter/draft-ids.json --skip-recorded
typefully batch push gtm/twitter/schedule-60.json --key 62-am --dry-run
typefully batch push gtm/twitter/schedule-60.json --all --skip-existing     # dedupe by draft title
```

Each post becomes one draft titled `AM D62 h-agent-honesty` (slot, day, campaign), scheduled at its
own `publish_at` unless `--at` overrides it or `--unscheduled` is given. `--skip-recorded` skips keys
already in the record file; `--skip-existing` walks every draft in Typefully and skips titles that
already exist, so re-running a day never creates duplicates.

## Text utilities

```bash
typefully text length "post text"        # weighted length per post; exit 3 if any post is over 280
typefully text length -f thread.md
typefully text split -f thread.md         # show the thread split
```

## Global options

Place these **after** the command:

| Option | Description |
| --- | --- |
| `--token <key>` | API key (overrides env and profile) |
| `--profile <name>` | configuration profile |
| `-s, --social-set <id>` | account to operate on |
| `-o, --output <fmt>` | `table` (default on a TTY), `json` (default when piped), `csv` |
| `--fields a,b` | columns to show in table/csv output |
| `--no-color`, `--debug`, `--timeout <ms>`, `--max-retries <n>`, `--no-retry` | |

Environment: `TYPEFULLY_API_KEY` (alias `TYPEFULLY_TOKEN`), `TYPEFULLY_SOCIAL_SET`,
`TYPEFULLY_DEFAULT_PLATFORMS`, `TYPEFULLY_BASE_URL`, `TYPEFULLY_PROFILE`, `TYPEFULLY_CONFIG_DIR`,
`TYPEFULLY_NO_DOTENV`, `NO_COLOR`.

Config lives at `~/.config/typefully/config.json` (`typefully config path`), with profiles for
multiple keys and per-profile default social sets.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | API or network error |
| 2 | usage / configuration error (missing key, no social set, bad flag) |
| 3 | content validation failed (post over X's limit) |

## Development

```bash
pnpm dev -- drafts list --scheduled    # run from source
pnpm typecheck
pnpm test
pnpm build
```

Retries with backoff on 429/5xx and network errors are built into the client (`--no-retry` to
disable). `--debug` logs every request and response to stderr.
