# EMERGENCY RECOVERY

### 🚨 PRINT THIS. One copy in the office safe, one at home, one with each founder.

**If you are reading this, something has gone badly wrong. Start at §1.**

> ## ⚠ THIS FILE IS NOT FINISHED UNTIL THE 🔴 ROWS ARE FILLED
>
> The **procedures** are complete. The **facts** they depend on — where the safe is,
> who the contractor is, what the recovery codes are — only the founders can supply.
> **An unfilled emergency plan is not a plan.** This is the one document whose value
> is zero until someone sits down for an hour.

---

## §0 — WHO YOU MIGHT BE

| You are | Start at |
|---|---|
| A founder, and something is broken | §2 |
| Family or executor, and a founder is unavailable | §1, then §5 |
| A client, and your app is down | §1, then call the numbers in §1 |
| An IT contractor called in | §1, then `standards/OPERATE.md` |

**Backups and disaster recovery are different things.** Backups answer *"restore this
file."* This file answers *"the thing holding the backups is gone,"* or *"the only
person who knew the passwords is gone."* Having good backups is not a recovery plan.

---

## §1 — THE FIRST FIVE MINUTES

**Do not touch anything yet.**

1. **Nothing here justifies a hasty action that destroys data.** The company can lose
   a day. It cannot lose the client records.
2. **Do not reinstall, reformat, factory-reset or "repair" anything.** A NAS that
   will not boot usually still has intact drives. A reformatted one does not.
3. **Do not delete anything.** Not a container, not a volume, not a "corrupted" file.
4. **Write down what you did and when.** You will need it, possibly legally.
5. **Call before acting.**

### 🔴 EMERGENCY CONTACTS — FILL THIS IN

| Role | Name | Phone |
|---|---|---|
| Founder 1 | 🔴 | 🔴 |
| Founder 2 | 🔴 | 🔴 |
| Family / executor contact — knows where the safe is | 🔴 | 🔴 |
| **IT contractor** | 🔴 | 🔴 |
| Cloud provider account owner + account ID | 🔴 | 🔴 |
| Domain registrar account email | 🔴 | 🔴 |
| Internet provider (office) + account no. | 🔴 | 🔴 |
| Lawyer — for client-notification questions | 🔴 | 🔴 |

> **The IT contractor row being empty is the single biggest hole in this system.**
> Finding a competent one takes days. Finding one while a hundred client apps are
> down takes the same days, with everything stopped. That is a phone call this week,
> not an emergency task.

---

## §2 — SYMPTOM → WHAT TO DO

| Symptom | Go to |
|---|---|
| One client's app is down | `standards/OPERATE.md` §6 |
| Every app on one host is down | §3 |
| Everything, everywhere, is down | §3, then §4 |
| Locked out of the password manager | §4 |
| A founder is unavailable and cannot be reached | §5 |
| Ransomware / files encrypted | §6 |
| Client data may be exposed | `standards/SECURITY.md` §7 — **that clock starts now** |

---

## §3 — A HOST IS GONE

**NAS.** If it will not boot: do not reformat. The drives are probably fine. Power
cycle once (hold power 5 s, wait for the beep, wait 3 minutes, power on, wait 5).
Still nothing → the drives can be read in another Synology, or by a recovery service.
The NAS holds internal tools and staging (ADR-026), so **no client is down because of
this.** That is the whole reason for that decision.

**A cloud instance.** One client is affected. Rebuild from the standard image
(`fleet/scripts/new-host.sh`), clone the repo, restore the latest backup from that
client's bucket, run `./verify.sh`. Target: under two hours. **If you have never done
this once, on purpose, in calm conditions, it will not take two hours.** Do it once
this quarter.

**Everything.** Work client by client, most critical first. `fleet/REGISTRY.md` is
the list — if the machine that generates it is also gone, that is why this file is
printed.

---

## §4 — THE PASSWORD MANAGER IS LOST

Do this **today**, while you still have access:

### 🔴 MUST EXIST OUTSIDE THE PASSWORD MANAGER

Printed, in the safe, and in a second location:

- [ ] 🔴 Password manager master password + recovery kit
- [ ] 🔴 Cloud provider root account credentials and MFA recovery codes
- [ ] 🔴 Domain registrar login
- [ ] 🔴 **Off-site backup encryption key** — without this every off-site backup is a
      pile of bytes, and there is no recovery path. This is the most irreplaceable
      item in the company.
- [ ] 🔴 NAS admin credentials
- [ ] 🔴 Email account recovery codes (it is the reset path for everything else)

If it is already lost: work outward from whatever account you can still reach.
Provider account recovery usually needs identity documents and takes days. Start
immediately; it does not go faster later.

---

## §5 — A FOUNDER IS UNAVAILABLE

### What exists

Every app is documented in its own repository: `docs/PROJECT.md` says what it is and
how it works, `docs/LOG.md` says what happened. `fleet/REGISTRY.md` lists everything
running. `standards/OPERATE.md` is written for a competent stranger.

### First 48 hours

1. Do not change anything. Apps keep running unattended; that is what
   `restart: always` and the nightly backups are for.
2. Confirm backups are still running — `fleet/scripts/fleet-status.sh`.
3. Contact clients only when you can say something true. "We are aware and working on
   it" is true. A guess about timing is not.
4. Bring in the IT contractor from §1 and give them `standards/OPERATE.md`.

### 🔴 SUCCESSION — DECIDE AND WRITE DOWN

- [ ] 🔴 Who takes over operationally, and do they know?
- [ ] 🔴 Where is the sealed envelope with the §4 items?
- [ ] 🔴 What are clients told, by whom, and within what time?
- [ ] 🔴 Is there a written agreement between the two founders covering this?

**Two founders means every app has, at most, two people who can operate it. This
section is the only thing standing between that and zero.**

---

## §6 — RANSOMWARE

**Immediately, in this order:**

1. Disconnect the affected host from the network. Physically, if that is fastest.
2. **Do not pay, do not delete, do not reboot.**
3. Check whether backups are also encrypted — this is why off-site backups are
   immutable or versioned. If the backup is reachable and writable from the infected
   host, assume it is gone.
4. Preserve everything for investigation.
5. Rebuild from the last known-clean backup on new or fully wiped storage.
6. Assume data was exfiltrated as well as encrypted. `standards/SECURITY.md` §7 —
   notification obligations apply.

---

## §7 — MAKE THIS FILE REAL

- [ ] Fill in every 🔴 above
- [ ] Print it. Safe, home, and one copy per founder.
- [ ] Rehearse §3 once — rebuild one app from backup on a fresh instance, timed
- [ ] Re-read and reprint annually, or whenever the contractor, succession
      arrangement or backup location changes

Reviewed: 🔴 not yet · Owner: both founders
