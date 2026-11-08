# Implementation record

Built from the kickoff prompt in [`KICKOFF.md`](../KICKOFF.md) (unchanged), starting at commit `a196dd944b8605bda3c48486f0d505aa410b7c45`.

## Run

Requires Node.js 22.13 or newer. There are no runtime dependencies.

```sh
npm start        # runs the repeatable setup, then serves http://127.0.0.1:3000
```

## Milestones

1. Runnable foundation: durable storage, repeatable setup, opening rules, menu browsing.
2. Customer ordering: cart, exactly-once acceptance, uncertain-outcome recovery, confirmation. The "View progress" link has no page until milestone 3.
