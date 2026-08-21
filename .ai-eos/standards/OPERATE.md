# OPERATIONS

**How apps get deployed, run and fixed.** Written assuming you remember nothing.

**Index:** §1 two targets · §2 deploy (one procedure, both targets) · §3 the golden
rules · §4 backups · §5 the routine · §6 troubleshooting · §7 NAS specifics ·
§8 AWS specifics · §9 moving an app NAS → AWS

---

## §1 — TWO TARGETS, ONE COMPOSE FILE

| Target | Runs | Why |
|---|---|---|
| **NAS** (Synology DS923+, office) | internal tools · staging · our own apps · anything we would not apologise for losing for a day | Hardware already owned. Marginal cost per app ≈ zero. |
| **Cloud** (AWS Lightsail / EC2, or a VPS) | **anything a paying client touches** | An office on home fibre, behind CGNAT, with one power feed and one box, is not an uptime story you can sell. |

**The same `docker-compose.yml` runs on both.** The only differences are the `.env`
file and which ingress the app registers with. Nothing in application code knows
where it is running — if you find a code path that branches on environment, that is
a bug.

> **Decide the target before the first deploy, not after.** Moving a live app with
> client data is §9, and it is a real afternoon. Moving an app before it has data is
> ten minutes.

---

## §2 — DEPLOYING AN APP

One procedure. The old system had three (a checklist, a long-hand walkthrough, and a
quickstart) which drifted apart from each other; this replaces all three.

```bash
# 1. Scaffold — creates folder, compose, docs, verify.sh, git repo
fleet/scripts/new-app.sh tds "TDS Reconciliation" --target=nas

# 2. Secrets — writes .env, prints the two values to save in your password manager
cd tds && ./scripts/init-secrets.sh

# 3. Start
docker compose up -d && docker compose logs -f

# 4. Prove it works — this is the gate, not a formality
./verify.sh
```

`verify.sh` has two tiers. **One command answers: can this app be deployed?**

```bash
./verify.sh --fast     # seconds — static checks only. Every save, and pre-commit.
./verify.sh            # full — builds and runs things. Pre-deploy, and in CI.
```

| Tier | Checks |
|---|---|
| **fast** | secrets not in git *and never were* · `.env` complete against `.env.example` and free of placeholders · no float in the money path · nothing logging a credential · database publishes no port · ingress labels present · migrations forward-only · three docs present · `AGENTS.md` within budget · lint · type check · the five mandatory tests exist |
| **full** | everything above · docker builds · production frontend build · containers stable · `/api/health` reports `healthy` · health detail is auth-gated · four security headers present · full test suite · backup and restore round trip |

Two of these are worth calling out because they catch failures nothing else does:

- **`.env` completeness.** A key added to `.env.example` and forgotten in `.env`
  fails at runtime, usually on the one code path nobody exercised before deploying.
- **Secrets in git *history*.** Deleting a committed `.env` does not un-commit it.
  A secret that was ever pushed is compromised and must be rotated.

The scaffold installs `.githooks/pre-commit`, so `--fast` runs on every commit
without anyone deciding to. **That is the point.** The full run is the deploy gate and
runs in CI. If `--fast` ever stops being fast, move the slow check to the full tier —
the moment people start reaching for `--no-verify`, the gate is gone and you will not
be told.

Add app-specific checks under the `APP CHECKS` marker at the bottom of the file.
Everything above that marker belongs to the standard and is overwritten by
`fleet-patch.sh` on an upgrade — which is how a new check reaches a hundred apps.

**Restore and soft-delete are the two that used to get skipped and the two that cost
most.** That is precisely why they are in the script and not on a checklist.
An unrestorable backup is a file. A missed `is_deleted` filter shows correct-looking
numbers that are quietly wrong, and it surfaces during filing season.

There is **no manual port allocation, no manual reverse-proxy rule and no manual
SSL step.** The ingress reads Docker labels and issues certificates itself. Those
three steps, done by hand a hundred times, were about three hundred opportunities to
make a mistake.

---

## §3 — THE GOLDEN RULES

1. Never install software directly on a host. Containers only.
2. Every app gets its own folder, own database container, own network, own repo.
3. Databases never publish a host port.
4. Data lives in volumes, not inside containers. Delete the container, keep the data.
5. Snapshot (NAS) or take an EBS/instance snapshot (AWS) before any risky change.
6. Every change goes in that project's `docs/LOG.md`. Infrastructure changes that
   affect the fleet go in `fleet/REGISTRY.md` — which is regenerated, so record the
   *reason* in the app's log, not the fact in the register.

---

## §4 — BACKUPS: THREE LAYERS

Set all three up once. The part everyone skips and everyone regrets.

**Layer 1 — the app's own backup.** The platform backup sidecar runs nightly at
02:00 and exposes the admin one-click button. This is the layer you actually use:
it restores *one app* without touching the other ninety-nine.

**Layer 2 — host snapshots.** NAS: Snapshot Replication on the docker share, daily
01:00, keep 30 daily / 4 weekly. AWS: automated instance or EBS snapshots. Take one
manually before any risky change.

**Layer 3 — off-site, encrypted.** NAS: Hyper Backup to Backblaze B2 or an external
drive, weekly. AWS: cross-region S3 with lifecycle rules. **Save the encryption key
somewhere other than the password manager** — without it the backup is a pile of
bytes.

> **Test a restore once a year. A backup you have never restored is not a backup.**
> One file is enough to prove the chain works.

---

## §5 — THE ROUTINE

At a hundred apps, "check the containers weekly" is not a routine, it is a full-time
job. Everything here is a script that reports exceptions only.

| Frequency | Task | How |
|---|---|---|
| Continuous | health checks on every app | uptime monitor hitting `/api/health`; alerts on failure only |
| Weekly | fleet status — versions, disk, cert expiry, last backup | `fleet/scripts/fleet-status.sh` |
| Monthly | dependency CVEs across the fleet | `fleet/scripts/fleet-audit.sh` |
| Quarterly | security checklist · access review · host updates | `standards/SECURITY.md` |
| Feb, post-Budget | re-verify tax rules | `standards/DOMAIN-INDIA.md` |
| 1 April | financial-year rollover | `standards/DOMAIN-INDIA.md` |
| Yearly | restore test · review `EMERGENCY.md` and reprint | |

**If a routine task cannot be scripted, it will not happen a hundred times.** That
is the test for adding one.

---

## §6 — TROUBLESHOOTING

```bash
docker ps -a                     # everything, including crashed
docker logs <name> --tail 100
docker compose restart
docker compose down && docker compose up -d   # volumes are untouched
df -h                            # disk space
```

| Symptom / log line | Cause | Fix |
|---|---|---|
| `password authentication failed` | `.env` password changed after first start | the password was baked into the data directory on first run. Restore the old password, or destroy the volume and start fresh (**you lose all data**) |
| App loads but API 502 | ingress or nginx name mismatch | `proxy_pass` must match the backend `container_name` exactly. Commonest deployment bug. |
| `connection refused` to db | backend started before the database was ready | health-check dependency in compose, or restart the backend |
| `permission denied` on a volume | folder ownership | `chown -R 1000:1000 <path>` |
| Certificate error | ingress could not complete the ACME challenge | port 80 must be reachable during issuance |
| Container restarting in a loop | read the logs; almost always a wrong secret or a missing file | |
| "It worked yesterday, I changed nothing" | host rebooted (check `restart: always`) · public IP changed · certificate expired · disk full | |

**Reality wins.** When a document and the running system disagree, the document is
what is wrong. Fix the document.

---

## §7 — NAS SPECIFICS

- DSM at `http://<nas-ip>:5000`. Find it via `https://finds.synology.com` on the
  office WiFi, or the router's DHCP client list.
- **Pin the NAS IP** — Control Panel → Network → LAN → manual configuration, *or* a
  DHCP reservation in the router. One or the other, never both; they fight.
- Everything lives under `/volume1/docker/<app>/`. Memorise that path.
- SSH off when not in use. 2FA on all admin accounts. Auto Block on. Default `admin`
  account renamed or disabled.
- Router forwards **only 80 and 443**. Never 5432, 5000, 5001 or 22.
- **CGNAT check:** if the router's WAN IP differs from `whatismyipaddress.com`, or
  starts `100.64.`–`100.127.`, port forwarding will never work. Use a Cloudflare
  Tunnel, which also removes the need for DSM's reverse proxy and Let's Encrypt.
- **Watch RAM.** One Postgres container per app is correct for isolation and is the
  constraint that bites first on a DS923+. `docker stats`. This is the hard ceiling
  on how many apps the NAS can hold — expect roughly 10–15, not 100.

---

## §8 — AWS SPECIFICS

Deliberately minimal. Two people cannot operate a bespoke cloud architecture per
client, so every client app gets the same boring shape:

| Concern | Choice | Why |
|---|---|---|
| Compute | one Lightsail/EC2 instance per client, Docker Compose on it | Identical to the NAS. Nothing new to learn, nothing new to debug. |
| Database | the app's own Postgres container on the same instance | Preserves per-app isolation. Move to RDS only when a specific client's load or compliance demands it. |
| Ingress | the same label-routed proxy, one per instance | Same config as the NAS. |
| Backups | platform backup sidecar → S3 bucket per client, versioned, lifecycle-expired | One mechanism, everywhere. |
| Secrets | `.env` on the instance, sourced from the password manager | Move to Secrets Manager when a client requires an audit trail on secret access, not before. |
| DNS / TLS | Route 53 or the client's registrar; ingress handles ACME | |

**Do not reach for Kubernetes, ECS, Terraform modules or a service mesh.** Each is a
correct answer to a problem two founders with a hundred single-tenant apps do not
have. The thing that scales here is *sameness*, not sophistication.

**One instance per client, not one big shared instance.** Blast radius, and a client
can be handed over, billed, or offboarded by deleting one thing.

---

## §9 — MOVING AN APP FROM NAS TO AWS

Same compose file, so this is a data move, not a rebuild.

1. Provision the instance from the standard image (`fleet/scripts/new-host.sh`).
2. Clone the app repo. Copy `.env`, adjust `APP_DOMAIN` and the ingress label.
3. **Backup on the NAS** via the admin button. Download the archive.
4. `docker compose up -d` on AWS, then restore the archive.
5. `./verify.sh` on the new host. It must be fully green before any traffic moves.
6. Run both in parallel, read-only on the old one, for at least a week.
7. Cut DNS over. Keep the NAS copy stopped-but-intact for a month.
8. `docs/LOG.md` entry. Regenerate `fleet/REGISTRY.md`.

> Step 6 is the one that gets skipped. Every migration that skipped a parallel run
> regretted it.
