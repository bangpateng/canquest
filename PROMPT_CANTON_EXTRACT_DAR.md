# Pertanyaan ke Canton AI — Cara extract DAR API dependencies

> Script extract gagal: endpoint /v2/packages/{id} tidak balas binary DAR
> atau nama package tidak match. Butuh klarifikasi cara yang benar.

---

## PROMPT (copy dari sini)

I'm trying to build my custom DAML package (canquest-v22, SDK 3.4.11) that
composes with Splice token standard via data-dependencies. My daml.yaml has:

```yaml
data-dependencies:
  - dars/splice-api-token-transfer-instruction-v1.dar
  - dars/splice-api-token-holding-v1.dar
  - dars/splice-api-token-metadata-v1.dar
  - dars/splice-api-featured-app-v2.dar
```

I need to GET these 4 DAR files. Question: WHERE do they come from?

OPTION A I tried: extract from my running participant node via JSON Ledger API.
- GET /v2/packages returns {"packageIds": [...]} (just IDs, no metadata)
- GET /v2/packages/{id} — unclear response format. Is it binary DAR
  (application/octet-stream) or JSON metadata? In my testing it returned
  something that didn't look like a valid DAR zip.

OPTION B: download from Splice release bundle on GitHub
  (canton-network/splice releases, splice-amulet-* artifact). The earlier
  Canton AI answer said "extract the latest version of the .dar file from
  the release bundle" — but it didn't specify which release / which artifact
  contains these 4 API DARs.

QUESTIONS:

1. CONCRETE SOURCE: For SDK 3.4.11 (Splice 0.5.0), where exactly do I get
   these 4 DAR files?
   - GitHub release URL?
   - Maven coordinates?
   - npm package?
   - Canton SDK install directory (e.g. ~/.daml/...)?
   - Participant node API endpoint (which one, what format)?

2. EXACT FILE NAMES: What are the exact filenames? My daml.yaml references
   "splice-api-token-transfer-instruction-v1.dar" but the actual file in
   Splice releases might be named differently (e.g. with version suffix
   like "splice-api-token-transfer-instruction-v1-0.4.0.dar"). Do I need
   to match the filename exactly to what's in daml.yaml, or just the path?

3. The 4 DARs I see referenced in Splice docs:
   - splice-api-token-transfer-instruction-v1
   - splice-api-token-holding-v1
   - splice-api-token-metadata-v1
   - splice-api-featured-app-v2
   Are these all SEPARATE DAR files, or are some bundled inside
   splice-amulet DAR? I noticed my participant has "splice-amulet-0.1.18"
   deployed — does that single DAR already contain all 4 API modules
   (TransferInstructionV1, HoldingV1, MetadataV1, FeaturedAppRightV2),
   so I only need to data-depend on splice-amulet-current.dar?

4. INSPECTION: How do I verify a DAR contains the module I need?
   Is there `daml damlc inspect-dar <file>.dar` that lists exported modules?
   Or `daml damlc inspect <file>.dar --template`?

5. JSON LEDGER API: Does GET /v2/packages/{id} return the raw DAR binary
   (so I can save it to file), or only metadata? If binary, what
   Content-Type header? Is there a different endpoint like
   /v2/packages/{id}/bytes or /v2/dars/{id}?

Please give the EXACT procedure (commands or URLs) to obtain these 4 DAR
files for SDK 3.4.11. I've been stuck on this for hours.

##sampai sini
