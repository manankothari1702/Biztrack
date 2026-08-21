# Shared rules — every review agent follows these

Read this, then your assigned agent file, then start.

Each agent reads the project's `AGENTS.md` and `docs/PROJECT.md` first. **Do not let
a clean bill of health elsewhere lower your guard on your own domain.**

## Evidence, not speculation

Every finding cites what makes it true — a file and line, a command you ran and its
output, a reproduction step you followed, a description of what you saw rendered.
"This could become an issue" without evidence is a hunch. Hunches go under
Suspicions, not findings.

## False-positive rule

Better to miss a minor issue than to invent one. If you cannot verify a concern,
label it a *suspicion*. **Never pad the report.** "No issues found in this area" is a
complete and acceptable result.

## Fleet context

This app is one of many built to the same standard. Two consequences:

- **A finding that is true of the standard, not just this app, is worth ten times
  more.** Say so explicitly — it becomes a platform fix or an ADR, not a ticket.
- **A finding that is an app deviating from the standard is a defect**, even if the
  deviation is an improvement. Consistency across a hundred apps is the asset. If the
  deviation is genuinely better, the recommendation is to change the standard.

## The ratchet — the most valuable output of any review

**A review agent should never report something `verify.sh` could have caught.** If
one does, the finding is not really about this app — it is about a gap in the gate.

So every finding gets a second question: **could a script have found this?**

- **Yes** → the recommendation is *two* things: fix the app, **and** add the check to
  `verify.sh` in `templates/new-project/`, so it reaches a hundred apps via
  `fleet-patch.sh`. Mark it `Scope: standard`.
- **No** → this is genuine human judgment, which is what these agents are for.

This is the mechanism that makes the expensive layer shrink over time instead of
growing. Every review permanently retires a class of finding. Without it, you run six
agents forever against the same recurring mistakes, and the cost per release never
comes down.

A review that produces one new `verify.sh` check is worth more than a review that
produces ten one-off fixes.

## Report structure

```
Review Metadata
Date · Files/areas reviewed · Commands executed

Role: <persona>
Confidence: <how much you verified hands-on vs. read-only — be honest>
Overall Score: <1-10, this domain only>
Verdict: PASS / PASS WITH CONDITIONS / FAIL — one line, so Synthesis need not infer it

Critical Issues
- Finding:
  Evidence: (file/line, command + output, or repro steps)
  Impact:
  Scope: this app only / the standard / the platform
  Recommendation: (for Critical/Important, include what else needs retesting if fixed)
  Confidence: High / Medium / Low

Important Issues      (same shape)
Minor Issues          (same shape, no regression note needed)

Suspicions (unverified — not findings)
Things Done Well      (specific, not vague)
One Thing I'd Fix First
Unknowns (could not verify, and why)
```

`Scope` is the field that matters most at fleet scale. It routes the finding to the
right place: one repo, `verify.sh`, `standards/`, or `platform/`.
