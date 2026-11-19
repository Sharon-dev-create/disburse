# M5-F.1D receipt regression results

Receipt-backed RPC: BLOCKED (eight required, zero fresh passes). Sandbox receipts: BLOCKED (twenty groups required, zero fresh passes).

The supported harness tests/sandbox/run_reconciliation.py requires the pinned near-sandbox2.14.0 binary. The prior /tmp artifact cache is absent after the environment interruption. A fresh bounded official S3 range-recovery attempt completed 452 of 543 subranges in 184.70 seconds, with TimeoutError and ConnectionResetError. It used eight parallel requests, ten-second request timeout, two attempts per range and a180-second scheduling budget with in-flight draining. Full archive integrity could not be established, so no binary was extracted or executed. This is infrastructure incompleteness, not an application vulnerability.

Required archive SHA256: a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691; binary SHA256:797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13. Official URL:https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.0/near-sandbox.tar.gz. No architecture failure was demonstrated; binary execution compatibility remains untested. See artifact-recovery.log and the checksum-enforcing C recovery script. No pin, application logic or test was weakened.

Remaining procedure: recover the complete official artifact, verify both hashes, prepare fresh isolated harness artifacts as documented in tests/sandbox/README.md and RECONCILIATION.md, verify a dedicated test database, then run run_reconciliation.py from an isolated copy so earlier evidence is preserved. Require new logs proving all eight native-live tests and twenty receipt groups, then stop temporary infrastructure. Earlier results are not fresh evidence.
