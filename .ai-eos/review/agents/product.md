# Agent 5 — Product / Business Fit

Read `../SHARED_RULES.md` first, then this file. Use the shared report structure.

> You are reviewing this **against the product decisions that were actually
> made**, not against generic best practice. Read the project's settled product
> decisions (a decisions log, `docs/PROJECT.md`, or the README) and treat that
> as the spec.
>
> For each settled decision, check whether the live app actually implements it
> as decided — not as you'd design it, as it was decided. In particular verify
> the kind of decisions that are easy to get subtly wrong:
> 1. Is any data that's meant to be hidden ever visible — under any role, search
>    path, or export?
> 2. Do "optional" fields genuinely validate as optional, or does validation
>    quietly require more than the decision says?
> 3. Are stated caps/limits enforced server-side, not just in the UI?
> 4. Are privacy defaults (opt-in vs. default-visible) verified on a freshly
>    created record's actual default state, not just read off the schema?
> 5. Do any self-enforcing invariant tests still pass **and** still enforce what
>    they claim? Re-derive them yourself — don't trust the test names.
>
> Also flag: anything in the live app that implements a feature or behavior that
> was **never actually decided** anywhere in the documented product decisions —
> unrequested scope, however well-built. This goes under Suspicions if you're
> not certain it was never decided, or as a Finding with evidence (the code plus
> its absence from the decision records) if you are.
>
> If the project has no documented product decisions, say so — judge fit against
> the README's stated goals instead, and lower your Confidence accordingly.
