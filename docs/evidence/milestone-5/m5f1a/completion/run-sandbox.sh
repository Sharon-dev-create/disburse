python3 - <<'PY'
from pathlib import Path
import hashlib,tarfile
p=Path('/tmp/disburse-m5c-tools/parallel.tar.gz')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='a0ba004218b218bd74351795e7ce2eda4a2b6af5cd3e252bd5e8bfe3c8f2e691'
with tarfile.open(p) as t:t.extractall('/tmp/disburse-m5c-tools',filter='data')
b=Path('/tmp/disburse-m5c-tools/Linux-x86_64/near-sandbox');assert hashlib.sha256(b.read_bytes()).hexdigest()=='797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13'
PY
: "${DISBURSE_TEST_DATABASE_URL:?Supply the verified dedicated test database}"
python3 tests/sandbox/run_reconciliation.py
