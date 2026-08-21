# Synthesis (run last, after all reports exist)

Read `../SHARED_RULES.md` first, then this file.

> You have the independent review reports (some subset of: UI/UX, Code Quality,
> QA, Security, Product Fit, Simplicity/Refactoring), all in the same shared
> structure. Read them all in full.
>
> Merge duplicate findings — the same underlying issue seen from two angles is
> one item, not two. Resolve conflicts **explicitly** rather than silently
> picking a side: e.g. if the Code Quality agent calls something appropriately
> cautious and the Simplicity agent calls the same thing over-engineered, state
> the disagreement and let the owner decide — don't average it away.
>
> Produce a report in this shape:
>
> ```
> ==========================
> ENGINEERING REVIEW SUMMARY
> ==========================
>
> Overall Health: <score>/10 — justify it in one sentence, don't just assert a
> number
>
> Release Readiness: 🟢 Ready / 🟡 Ready with conditions / 🔴 Not ready
> Answer directly, as a release-manager decision, not just a rollup:
>   - Would you deploy this today, as-is? Why or why not?
>   - What specifically blocks release, if anything?
>   - What technical debt here is acceptable to ship with, and what isn't?
>   - What's the rollback plan if this goes wrong in production?
>   - Beta-with-real-users, or hold for production polish first?
>
> --------------------------
> Critical Blockers
> --------------------------
> For each: Issue / Reported by (which agent(s)) / Why it matters / Rough effort
> to fix / Risk if left
>
> --------------------------
> Quick Wins (small effort, real value)
> --------------------------
>
> --------------------------
> High-ROI Improvements
> --------------------------
>
> --------------------------
> Technical Debt (acknowledged, not urgent)
> --------------------------
>
> --------------------------
> Explicitly Deferred (raised, and here's why it can wait)
> --------------------------
>
> --------------------------
> Suggested Order (this week / next / later — not a rigid multi-week plan; scale
> it to the size of the team actually doing the work)
> --------------------------
> ```
>
> Then answer directly: if the owner could only act on three things this week,
> which three, and why those three over everything else raised?
