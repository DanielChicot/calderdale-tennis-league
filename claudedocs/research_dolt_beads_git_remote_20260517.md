# Can a plain Git repo serve as the Dolt/beads remote?

## TL;DR

Yes — as of Dolt v1.81.10 (released February 2026), Dolt natively supports plain Git repositories
as remotes using standard SSH (`git+ssh://git@github.com/org/repo.git`) or HTTPS
(`git+https://github.com/org/repo.git`) URLs. Beads has already integrated this: you run
`bd dolt remote add origin git+ssh://git@github.com/DanielChicot/calderdale-tennis-league.git`
once, then `bd dolt push` / `bd dolt pull` to sync your issue database across machines using
the same GitHub repo you already have. No DoltHub account required.

---

## Question 1: Does Dolt support a plain Git remote?

**Yes, as of Dolt v1.81.10 (February 2026).**

DoltHub announced this feature on 13 February 2026:
> "Dolt now supports using Git repositories as Dolt remotes, letting you use a Git repository on
> disk or a hosted Git server (over HTTPS or SSH) as the backing store for a Dolt remote."

The exact example from the announcement:

```bash
dolt remote add origin https://github.com/coffeegoddd/example.git
dolt push origin main
```

Technical mechanism: Dolt stores its data on a custom Git ref (`refs/dolt/data`) so it does not
collide with normal branches or tags. The data is pushed to/fetched from that ref using the Git
binary directly. From the user's perspective the remote is just a normal GitHub repo.

**Hard requirement:** The `git` binary must be installed and on `PATH`. Dolt shells out to it for
all operations on Git remotes.

**Known bug (as of announcement date):** Dolt cannot handle Git remotes that require username/password
via STDIN. SSH key auth or HTTPS with a credential helper (e.g. `gh auth` or a `.netrc` file) works
fine. GitHub SSH (`git+ssh://`) is the recommended approach.

**Sources:** [Announcing Git remote support in Dolt](https://www.dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/) |
[Supporting Git remotes as Dolt remotes (technical deep-dive)](https://www.dolthub.com/blog/2026-02-19-supporting-git-remotes-as-dolt-remotes/)

---

## Question 2: What Dolt remote types exist?

| Type | URL scheme / format | Notes |
|------|---------------------|-------|
| DoltHub / DoltLab | `https://doltremoteapi.dolthub.com/<org>/<repo>` or just `<org>/<repo>` | Default host from config |
| Git repo (SSH) | `git+ssh://git@github.com/org/repo.git` | Requires git binary on PATH |
| Git repo (HTTPS) | `git+https://github.com/org/repo.git` or `https://github.com/org/repo.git` | Same requirement |
| Git repo (local bare) | `file:///absolute/path/to/repo.git` | Filesystem bare git repo |
| Dolt filesystem | `file:///absolute/path/to/dolt-remote-dir/` | Dedicated directory, NOT an existing Dolt working dir |
| AWS | `aws://[dynamo-table:s3-bucket]/database` | Requires DynamoDB + S3, plus AWS creds |
| Google Cloud Storage | `gs://gcs-bucket/database` | Requires `gcloud` credentials |
| OCI / Azure | `oci://...` / Azure variants | Also supported per docs |

The key constraint on filesystem remotes: "you still can't use an existing Dolt working directory
as a `file://` remote. Use either a dedicated filesystem-remote directory, or a Git repo ending
in `.git`."

**Sources:** [Dolt remotes blog (2021)](https://www.dolthub.com/blog/2021-07-19-remotes/) |
[Dolt remotes concepts docs](https://docs.dolthub.com/concepts/dolt/git/remotes) |
[Dolt CLI reference](https://docs.dolthub.com/cli-reference/cli)

---

## Question 3: Filesystem-via-git workaround viability

This was the workaround question before the Feb 2026 announcement made it moot, but it is still
worth understanding for context.

### Approach A: `file://` Dolt remote inside the git working tree

The idea would be:
1. `dolt remote add backup file:///path/to/project/.beads/dolt-remote/`
2. `dolt push backup main`
3. `git add .beads/dolt-remote/ && git commit`

**Analysis:**

- Dolt's filesystem remote creates a directory of binary blob files (tablefiles) and a manifest.
  These are Dolt-internal opaque objects, not human-readable.
- Git *can* track them — they are just files. However, each `dolt push` rewrites/adds blobs.
  Git would create a new commit for each push, and the binary files would not delta-compress well,
  causing **repo size to grow substantially** with every push.
- There is no file locking between Dolt and Git; you would need to manually `git add` and
  `git commit` the dolt-remote directory after every `dolt push`. This is a two-step manual process
  prone to forgetting.
- The Dolt docs explicitly warn that a Dolt working directory cannot be used as a `file://` remote,
  but a *separate dedicated* directory can. So `.beads/embeddeddolt/` (the live DB) cannot be the
  remote; you'd need `.beads/dolt-remote/` as a second directory.
- **Conclusion:** Technically possible but fragile, bulky, and now entirely superseded by native
  Git remote support.

### Approach B: Bare git repo as `file://` remote

The updated docs state you can use `file:///path/to/repo.git` (a bare git repo) as a Dolt remote,
and this is essentially the same mechanism as the GitHub remote — just local. You could maintain a
bare git repo on a shared filesystem (NAS, Dropbox, etc.) and `dolt push` to it. This is cleaner
than approach A.

**For this user's scenario (no shared filesystem, only GitHub):** irrelevant. The native
`git+ssh://github.com` remote is the right answer.

---

## Question 4: `bd backup` accepted remotes

Beads wraps Dolt's remote concept in two ways:

### `bd dolt remote` (version-control sync — recommended for cross-machine)

```bash
# Add GitHub SSH remote
bd dolt remote add origin git+ssh://git@github.com/DanielChicot/calderdale-tennis-league.git

# Or HTTPS
bd dolt remote add origin git+https://github.com/DanielChicot/calderdale-tennis-league.git

# Or filesystem path
bd dolt remote add origin file:///path/to/remote

# Then push/pull
bd dolt push
bd dolt pull
```

If the project's git `origin` is already set (i.e. `git remote -v` shows `origin`), `bd init`
**automatically configures the same URL as the Dolt remote**. This means for this user, running
`bd init` in the cloned repo on machine 2 may configure the Dolt remote automatically.

### `bd backup` (disaster-recovery backup — separate mechanism)

```bash
bd backup init /path/to/backup      # filesystem path
bd backup init <git-url>            # git URL (via backup.git-repo config)
bd backup sync                      # push snapshot
bd backup restore /path/to/backup   # restore
```

`bd backup` uses Dolt's `CALL DOLT_BACKUP(...)` SQL procedure — it is a point-in-time snapshot
mechanism, distinct from version-controlled push/pull. The backup system supports:
- Filesystem paths (default fallback: `.beads/backup/`)
- Git URLs via a `backup.git-repo` config setting

**Important distinction:** `bd backup` is for disaster recovery. `bd dolt push` / `bd dolt pull`
is for cross-machine workflow sync. They are separate concerns.

---

## Question 5: Beads-official cross-machine recommendation

From `docs/SYNC_SETUP.md` (gastownhall/beads repo):

The official recommended workflow for two-machine sync via GitHub:

**Machine A (initial setup):**
```bash
bd init
bd create "New task" -p 1
bd dolt push
```

**Machine B (after cloning):**
```bash
git clone git@github.com:org/repo.git
cd repo
bd bootstrap
bd dolt pull
```

**Machine A (receiving updates from B):**
```bash
bd dolt pull
bd list
```

The docs explicitly warn against using JSONL for sync:
> "Do not use JSONL as sync — it is not the source of truth and cannot safely reconcile deletes
> or pruning."

The `bd export` / `bd import` JSONL workflow is documented as existing **for issue portability
and interchange**, not day-to-day synchronisation. The source of truth is always the Dolt
database, synced via `bd dolt push` / `bd dolt pull`.

The docs also note that because Dolt stores data under `refs/dolt/data` (separate from normal Git
refs), **you can use the same GitHub remote as your source code**.

---

## Question 6: Tradeoff matrix

| Aspect | DoltHub remote | GitHub repo (git+ssh://) | `bd export` JSONL + git commit |
|--------|---------------|--------------------------|-------------------------------|
| Setup complexity | Create DoltHub account + repo | One `bd dolt remote add` command | Manual: export, git add, commit, push on every change |
| Extra service dependency | Yes (DoltHub account) | No | No |
| Merge / conflict resolution | Dolt-native cell-level merge | Dolt-native cell-level merge (same engine) | Manual diff/merge of JSONL files — fragile |
| Commit history & audit trail | Full Dolt history on DoltHub UI | Full Dolt history; viewable with `dolt log` locally | Git commit history of JSONL snapshots only |
| Branching semantics | Full Dolt branching + DoltHub PR UI | Full Dolt branching; no web UI | Git branches only (flat JSONL, no query) |
| Authentication | DoltHub token | Existing GitHub SSH key | Existing GitHub SSH key |
| Repo size growth | Dolt-managed, efficient | Same Dolt tablefiles under `refs/dolt/data`; git does not re-download on `git pull` | Binary JSONL diffs, grows linearly but small |
| Works if GitHub is down | No | No | No (git push needs GitHub) |
| `bd backup` disaster recovery | DoltHub acts as backup | GitHub acts as backup | Git history acts as backup (less granular) |
| Data visibility on remote | DoltHub web UI | GitHub shows only raw Dolt blob refs | GitHub shows human-readable JSONL |

**Summary:**
- **DoltHub vs GitHub:** Functionally equivalent for this use case. GitHub saves you a separate
  account. DoltHub gives you a web UI for browsing issues as SQL tables.
- **JSONL-via-git:** Loses merge semantics, is explicitly warned against in the beads docs, and
  is strictly inferior to Dolt push/pull for routine sync. Reserve it for one-off exports or
  interoperability with non-beads tooling.

---

## Recommendation

**Use `bd dolt remote` pointing at your existing GitHub repo. It is the officially documented
path and requires zero extra services.**

Exact command sequence for this user's project:

**Machine A (where beads is already set up):**
```bash
cd /path/to/calderdale-tennis-league

# Add the GitHub repo as the Dolt remote (check if bd init already did this)
bd dolt remote -v          # if origin already appears, skip the next line
bd dolt remote add origin git+ssh://git@github.com/DanielChicot/calderdale-tennis-league.git

# Push the beads issue database to GitHub
bd dolt push
```

**Machine B (new machine, after cloning the repo):**
```bash
git clone git@github.com:DanielChicot/calderdale-tennis-league.git
cd calderdale-tennis-league

# Bootstrap beads (this initialises the embedded Dolt DB)
bd bootstrap      # or: bd init --existing, check bd help for exact flag

# Pull the issue database from GitHub
bd dolt pull

# Verify
bd list
```

**Day-to-day workflow (either machine):**
```bash
# Before switching to the other machine:
bd dolt push

# After switching / resuming:
bd dolt pull
```

**Prerequisites:**
- Dolt v1.81.10 or later must be installed and the `dolt` binary on PATH (beads embeds a Dolt
  server but the git-remote feature requires the CLI binary for the git shell-outs).
- SSH key for GitHub must be configured on both machines (`ssh -T git@github.com` should succeed).
- If your SSH auth prompts for a passphrase interactively (and the STDIN bug is present), use
  `ssh-agent` to avoid the interactive prompt.

**Do not** use `bd export` + `git commit` for routine sync. Use it only if you need to inspect
or migrate issues as plain text.

---

## Sources

- [Announcing Git remote support in Dolt (Feb 13 2026)](https://www.dolthub.com/blog/2026-02-13-announcing-git-remote-support-in-dolt/)
- [Supporting Git remotes as Dolt remotes — technical deep-dive (Feb 19 2026)](https://www.dolthub.com/blog/2026-02-19-supporting-git-remotes-as-dolt-remotes/)
- [Dolt without DoltHub: Other Dolt Remotes (2021 blog, remote types overview)](https://www.dolthub.com/blog/2021-07-19-remotes/)
- [Dolt remotes concepts documentation](https://docs.dolthub.com/concepts/dolt/git/remotes)
- [Dolt CLI reference](https://docs.dolthub.com/cli-reference/cli)
- [beads README.md (steveyegge/beads)](https://github.com/steveyegge/beads/blob/main/README.md)
- [beads FAQ.md](https://github.com/steveyegge/beads/blob/main/docs/FAQ.md)
- [beads SYNC_SETUP.md (gastownhall/beads)](https://github.com/gastownhall/beads/blob/main/docs/SYNC_SETUP.md)
- [Dolt Remote Federation — Beads DeepWiki](https://deepwiki.com/steveyegge/beads/9.3-dolt-remote-federation)
- [Beads Data Synchronization — Beads DeepWiki section 6](https://deepwiki.com/steveyegge/beads)
