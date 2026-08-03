#!/bin/bash
# Inspect DAR Splice API — cari module path + type names yang benar
# Jalankan di VPS 2 (DAR ada di packages/daml/dars/)
set -uo pipefail
DARS_DIR="${1:-/var/www/canquest/packages/daml/dars}"

echo "=== Module paths di DAR Splice API ==="
for dar in "$DARS_DIR"/splice-api-*.dar; do
  [ -f "$dar" ] || continue
  name=$(basename "$dar")
  echo ""
  echo "--- $name ---"
  # DAR = ZIP. List nama .daml (module path)
  python3 -c "
import zipfile, sys
try:
    with zipfile.ZipFile('$dar') as z:
        daml_files = [n for n in z.namelist() if n.endswith('.daml')]
        for n in daml_files:
            # Strip folder prefix + .daml → module path
            parts = n.split('/')
            # Skip folder name (hash suffix)
            mod_parts = [p for p in parts[1:] if not (len(p) > 64 and all(c in '0123456789abcdef' for c in p[:64]))]
            mod_path = '/'.join(mod_parts).replace('.daml','')
            print('  module:', mod_path)
            # Cari type/record/template definitions
            content = z.read(n).decode('utf-8', errors='ignore')
            for line in content.splitlines():
                stripped = line.strip()
                if stripped.startswith('record ') or stripped.startswith('template ') or stripped.startswith('variant ') or stripped.startswith('data '):
                    print('    ', stripped[:80])
except Exception as e:
    print('  ERROR:', e, file=sys.stderr)
" 2>&1 | head -50
done
echo ""
echo "=== Cari 'ExtraArgs' di semua DAR ==="
for dar in "$DARS_DIR"/splice-api-*.dar; do
  [ -f "$dar" ] || continue
  name=$(basename "$dar")
  MATCH=$(python3 -c "
import zipfile
with zipfile.ZipFile('$dar') as z:
    for n in z.namelist():
        if n.endswith('.daml'):
            content = z.read(n).decode('utf-8', errors='ignore')
            if 'ExtraArgs' in content:
                print(n)
                break
" 2>/dev/null)
  [ -n "$MATCH" ] && echo "  $name → ExtraArgs ada di: $MATCH"
done
