# Contributing

Read the [reference entry point](doc/reference-playbook.md) before changing behavior. Port reusable reference code directly; record its pinned commit, original file, license and necessary Pi adaptations in the relevant topic. Keep copyright headers and [third-party notices](THIRD_PARTY_NOTICES.md). Preserve the [product contract](doc/product-contract.md).

Follow the [verification policy](doc/verification.md). Documentation and selected records need links and diff checks only. Code needs typecheck, lint and affected behavior tests; shared session/protocol/access changes need the full unit suite once. Packaging and installation changes need an audit, real Pi plugin loading and a launch of the final artifact. Do not gate on document keywords, historical report presence or test counts.

Daily probe output belongs in ignored evidence/runs/. Commit selected records only for support changes, releases or important faults. Preserve original reports and run identities. Old hashes cannot prove changed source. Keep support conclusions only in the [support matrix](doc/support-matrix.md).

Deliver independently reviewable commits. Remove obsolete paths; use Git history for superseded material. Check actual dependency licenses, credentials and package contents; failures block releases. See [security reporting](SECURITY.md).
