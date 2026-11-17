Third-Party Notices
==================

SahiPick is original work. This file records the third-party projects whose
*ideas* were studied and, where a small, clearly-identified piece of logic was
adapted, the attribution required by that project's licence.

Adapted code (with attribution)
--------------------------------

1. Aria — agentic shopping assistant
   Source:      https://github.com/caprion/agentic-shopping
   Licence:     Apache License 2.0
   Adapted in:  server/src/ai/guardrails.ts
   What:        The claim-verification rules for the answer guardrail —
                specifically the treatment of "limit echoes" ("under ₹70,000"),
                price bands ("₹1,200-1,500"), approximate prices ("around
                ₹40,000") and derived differences ("₹500 cheaper than the
                other") as text that is *not* a product-price claim, together
                with the relative-tolerance matching and the rating and
                discount-percentage checks. The stock guard's rule that a
                truthful "out of stock" statement must not be flagged also
                follows the same source.
   Changes:     Rewritten in TypeScript for this project. The SahiPick version
                uses integer paise rather than floating-point rupees, uses the
                Indian rupee sign, and reports violations rather than raising.
   Original
   file:        demo/app/guardrails.py (ClaimVerifier, CitationGate,
                StockGuard)

2. ValuSee — shopping decision assistant
   Source:      https://github.com/biheto/ValuSee
   Licence:     MIT License
   Adapted in:  server/src/intelligence/matching/identity.ts
   What:        The product-identity rules: a category-agnostic set of
                variant-discriminating fields; condition and connector/interface
                treated as hard separators that are checked *before* the
                manufacturer SKU; and the principle stated in the original
                module's docstring — "missing data is not agreement" — which
                lowers the confidence of an exact match when a field is only
                known on one side.
   Changes:     Rewritten in TypeScript with integer arithmetic, extended with
                a category-plugin concept, and adapted to SahiPick's
                verdict-first ranking.
   Original
   file:        app/shopping/identity.py (variant_conflict, same_item_relation)

Notes
-----

- No other source code from either project was copied. Both projects are
  Python; SahiPick is TypeScript. The adaptations above are rule sets
  re-expressed in SahiPick's own idiom and adapted to its data model.
- ValuSee's `app/core/url_security.py` was read for comparison only. SahiPick's
  SSRF protection in `server/src/net/safe-fetch.ts` was written independently
  and additionally handles NAT64 and IPv4-mapped IPv6 ranges.
- See `SOURCE_AND_LICENSE_AUDIT.md` for the full list of projects consulted,
  including those that were read but whose code was not reused because their
  licence was absent or unclear.

Licence texts
-------------

The MIT License and the Apache License 2.0 are reproduced at:

  https://github.com/biheto/ValuSee/blob/main/LICENSE
  https://github.com/caprion/agentic-shopping/blob/main/LICENSE

Apache 2.0 requires that modified files carry prominent notices stating that
they were changed. The files listed above carry a header comment stating the
origin project, its licence and the nature of the adaptation.
