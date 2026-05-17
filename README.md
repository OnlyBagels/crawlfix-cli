# crawlfix

External SEO and AI-search auditor. Scan sites, get prioritized fix prompts
for your coding agent. Zero dependencies, Node 18+.

```bash
# One-off, no install:
npx crawlfix scan example.com

# Or install globally:
npm install -g crawlfix
crawlfix scan example.com
```

## Quick start

```bash
crawlfix login                 # device-flow login, opens your browser
crawlfix scan example.com      # run an audit, prints summary on completion
crawlfix issues <auditId>      # list issues for that audit
crawlfix fix <issueId>         # get an AI fix prompt to paste into your agent
```

## Commands

| Command                                  | What it does                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `crawlfix login [--email <email>]`       | Authenticate this machine via device-authorization-grant flow.       |
| `crawlfix logout`                        | Clear locally stored credentials.                                    |
| `crawlfix whoami`                        | Show the currently logged-in account and server URL.                 |
| `crawlfix scan <url>`                    | Run an audit; waits for completion and prints a summary.             |
| `crawlfix issues <auditId>`              | List all issues for an audit, with severity / category filters.      |
| `crawlfix fix <issueId>`                 | Get an AI-generated fix prompt for one issue. (paid)                 |
| `crawlfix history`                       | List your recent audits.                                             |
| `crawlfix verify <issueId>`              | Re-crawl to confirm a fix worked.                                    |
| `crawlfix export <auditId> --format pdf` | Download an audit report as JSON, HTML, or PDF. (paid)               |
| `crawlfix compare <auditId> <url>`       | Side-by-side audit against a competitor URL. (paid)                  |
| `crawlfix monitor <subcommand>`          | Schedule recurring scans and alerts. (paid)                          |
| `crawlfix help [command]`                | Show this list, or detailed help for one command.                    |
| `crawlfix --version`                     | Print the installed CLI version.                                     |

### `crawlfix scan <url>`

```bash
crawlfix scan example.com
crawlfix scan https://example.com --json       # pipe-friendly raw JSON
crawlfix scan example.com --no-wait            # submit and return immediately
crawlfix scan example.com --timeout 300        # max seconds to wait (default 180)
```

### `crawlfix issues <auditId>`

```bash
crawlfix issues aud_abc123
crawlfix issues aud_abc123 --severity high
crawlfix issues aud_abc123 --category SEO
crawlfix issues aud_abc123 --json
```

### `crawlfix fix <issueId>`

```bash
crawlfix fix iss_xyz789                       # prints prompt in a box
crawlfix fix iss_xyz789 --copy                # also copies to clipboard
crawlfix fix iss_xyz789 --save                # write .md in cwd, auto-named
crawlfix fix iss_xyz789 --save ./fixes/       # auto-named inside ./fixes/
crawlfix fix iss_xyz789 --out ./fix.md        # exact file path
```

`--save` writes a labeled markdown file with YAML front-matter (issue id,
severity, category, page URL, scan id, timestamp), an H1 title, and the fix
prompt. Hand the file straight to your coding agent instead of copy-pasting
out of the terminal. Auto-named files look like
`crawlfix-fix-<issueId>-<host>-<YYYYMMDD>.md`. Set `CRAWLFIX_OUT_DIR` to
change the default directory for bare `--save`.

Paid feature. If you are on the free tier, the CLI opens a checkout page in
your browser and waits for payment to confirm before retrying the call.

### `crawlfix monitor`

```bash
crawlfix monitor add example.com
crawlfix monitor list
crawlfix monitor pause example.com
crawlfix monitor resume example.com
crawlfix monitor remove example.com
```

## Environment variables

| Variable           | Purpose                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `CRAWLFIX_SERVER`  | Override the backend URL. Default: `https://crawlfix.ai`.                     |
| `CRAWLFIX_TOKEN`   | Bearer token (for CI / scripting). Takes priority over `~/.crawlfix/creds`.   |
| `CRAWLFIX_OUT_DIR` | Default directory for `crawlfix fix --save` when no path is given.            |
| `CRAWLFIX_DEBUG`   | Set to `1` to print stack traces on errors.                                   |
| `NO_COLOR`         | Disable ANSI colors.                                                          |
| `FORCE_COLOR`      | Force ANSI colors on (`1` or `true`).                                         |

Credentials are stored at `~/.crawlfix/credentials.json` with mode `0600`
(POSIX). On Windows the file is created in `%USERPROFILE%\.crawlfix\`.

## Local development

```bash
cd cli
npm link                       # symlinks `crawlfix` globally
crawlfix --version
crawlfix login --server http://localhost:7238
crawlfix scan example.com
```

Or run the entry directly without linking:

```bash
node cli/bin/crawlfix.js scan example.com
```

There is a tiny smoke test:

```bash
node cli/scripts/smoke-test.mjs
```

## Publishing to npm

```bash
cd cli
npm login                      # one-time, prompts for an npm account
npm publish                    # publishes 'crawlfix' to the public registry

# After publish, anywhere on the internet:
npx crawlfix scan example.com
```

## Support

Issues, bug reports, or licensing questions: Michael@faction.chat

## License

MIT. See `LICENSE`.
