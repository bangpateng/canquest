#!/bin/bash
# Inspect DAR Splice API — cari module path + type names yang benar
# Jalankan di VPS 2 (DAR ada di packages/daml/dars/)
set -uo pipefail
DARS_DIR="${1:-/var/www/canquest/packages/daml/dars}"

echo "=== Cari interface/template/choice di DAR TransferInstruction + FeaturedApp ==="
for dar in "$DARS_DIR/splice-api-token-transfer-instruction-v1"*.dar "$DARS_DIR/splice-api-featured-app-v2"*.dar; do
  [ -f "$dar" ] || continue
  name=$(basename "$dar")
  echo ""
  echo "=== $name ==="
  python3 -c "
import zipfile, sys
with zipfile.ZipFile('$dar') as z:
    for n in z.namelist():
        if not n.endswith('.daml'): continue
        content = z.read(n).decode('utf-8', errors='ignore')
        print('--- module file:', n, '---')
        # Print semua definisi penting: interface, template, choice, record, data, type, instance
        for i, line in enumerate(content.splitlines(), 1):
            s = line.strip()
            if (s.startswith('interface ') or s.startswith('template ')
                or s.startswith('choice ') or s.startswith('nonconsuming choice ')
                or s.startswith('controller ') or s.startswith('instance ')):
                print('  L%d: %s' % (i, s[:90]))
" 2>&1 | head -80
done

echo ""
echo "=== Cari ContractId type / TransferFactory / FeaturedAppRight definition ==="
for dar in "$DARS_DIR"/splice-api-*.dar; do
  [ -f "$dar" ] || continue
  name=$(basename "$dar")
  python3 -c "
import zipfile
with zipfile.ZipFile('$dar') as z:
    for n in z.namelist():
        if not n.endswith('.daml'): continue
        content = z.read(n).decode('utf-8', errors='ignore')
        for i, line in enumerate(content.splitlines(), 1):
            s = line.strip()
            # Cari baris yg mengandung keyword penting
            if any(kw in s for kw in ['TransferFactory', 'FeaturedAppRight', 'TransferFactory_Transfer', 'CreateActivityMarker']):
                if any(s.startswith(p) for p in ['interface', 'template', 'choice', 'controller', 'instance', 'data', 'record', 'type', '--']):
                    print('  [%s] L%d: %s' % ('$name', i, s[:90]))
" 2>/dev/null
done

