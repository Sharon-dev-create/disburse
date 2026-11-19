# M5-F.1E artifact recovery

PASS. Inventory found535 length-valid reusable subranges of543. Their individual SHA256 fingerprints are retained in range-inventory.json; no independent per-range trusted checksums exist. Eight missing ranges were recovered by the existing utility, validating HTTP206, exact Content-Range and exact length. Reassembly occurred only after all ranges were present. Full archive hash authenticates reused bytes as a whole. No version/hash substitutions or integrity bypass occurred.

Recovered inclusive offsets:33095680–33161215;33161216–33226751;33226752–33292287;33292288–33357823;33357824–33423359;33423360–33488895;33488896–33554431;33554432–33619967.

Archive SHA256:a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691. Executable SHA256:797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13. Both match pins. Recovery took5.27seconds. Binary reports release2.14.0 commit bc4e9e8cfb03d9e82f027883055624e18576993e, protocol88. ELF x86-64 and required shared libraries resolved. Fresh private sandbox initialization/start/shutdown succeeded through the full harness. Historical WASM fetched with read-only view_code and exact historical hash; token/fault/old-B fixtures built in isolated temporary copies. Earlier evidence preserved.
