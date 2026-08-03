# Pertanyaan ke Canton AI — DAML v22 Signatures & Patterns

> **Tujuan:** Konfirmasi 3 hal teknis DAML agar penulisan v22 tidak salah
> (syntax/idiom match dengan token standard Splice).
>
> **Cara pakai:** Copy seluruh blok "PROMPT" di bawah → paste ke AI Canton docs.

---

## PROMPT (copy dari sini ke bawah)

I'm writing a NEW DAML package (canquest-v22, SDK 3.4.11, Canton validator-app
mode, custodial operator pattern). I need EXACT DAML signatures and patterns
for composing with the Splice token standard from inside my own DAML choice.

CONTEXT (already confirmed by earlier Canton AI answers):
- Custodial: operator party submits all commands, user/rewardParty are co-actAs.
- My DAML choice `QuestClaimReceipt_Settle` will do NESTED sub-exercises of
  `TransferFactory_Transfer` (CIP-56) for fee + reward, in ONE transaction tree.
- actAs at command submission = [operator, user, rewardParty] —
  service-account token has CanActAsAnyParty.
- FAR is OFF now but switching on later: I want `Optional (ContractId FeaturedAppRight)`
  as a Settle argument so marker creation is conditional.
- My existing dependencies (daml.yaml): daml-prim, daml-stdlib, daml-script.
- DARs already on participant: splice-amulet, splice-wallet, splice-util-featuredapp,
  splice-api-token-transfer-instruction-v1, splice-api-token-holding-v1,
  splice-api-featured-app-v1 (all Splice standard).

I need EXACT answers to 3 things. Please ground every answer in actual DAML
syntax / type definitions from the Splice DARs (cite the module path).

───────────────────────────────────────────────────────────────
QUESTION 1 — Exact signature of TransferFactory_Transfer for nested exercise
───────────────────────────────────────────────────────────────

Inside my Settle choice body I want to write:

```haskell
feeOutcomeCid  <- exercise factoryCid TransferFactory_Transfer with { ... }
rewardOutcomeCid <- exercise factoryCid2 TransferFactory_Transfer with { ... }
```

Please give me the EXACT DAML record type of the choice argument, field by
field, so I can fill the `with { ... }` block correctly. Specifically:

  (a) The full `choice TransferFactory_Transfer : <return type>` declaration —
      what is the return type? What module/template/interface defines it?

  (b) The argument record — show me every field:
      - `expectedAdmin` : Party? (or Text?)
      - `transfer` : <Transfer record> — list its fields (sender, receiver,
        amount, instrumentId, lock, requestedAt, executeBefore, inputHoldingCids,
        meta, ...). Is `amount` a `Numeric`, `Decimal`, or `Text`? Is
        `instrumentId` a nested record `{admin : Party, id : Text}` or flat?
        Is `lock` `Optional <Lock>`? What are `requestedAt`/`executeBefore` types
        (Text ISO-8601? Int microseconds? Timestamp?)?
      - `inputHoldingCids` : is it `[ContractId <Holding>]` inside `transfer`
        or a top-level field of the choice arg? Which `Holding` type —
        `Splice.Api.Token.HoldingV1:Holding`?
      - `extraArgs` : <ExtraArgs record> — fields `context` and `meta`.
        What is the type of `context`? Is it a generic `Value`/`Struct`/
        `TextMap Value`? Same for `meta`?

  (c) Show a CONCRETE example `with { ... }` block filling all fields for a
      CC (Amulet) transfer of 3.0 from user→treasury. I want to see the literal
      DAML syntax I would type, including how `amount`, `instrumentId`, and
      `extraArgs.context` look.

───────────────────────────────────────────────────────────────
QUESTION 2 — daml.yaml dependencies + module imports for nested exercise
───────────────────────────────────────────────────────────────

  (a) What EXACT lines do I add to daml.yaml `dependencies:` to compose with
      CIP-56 + holding + featured-app from MY package? I assume:

      ```yaml
      dependencies:
        - daml-prim
        - daml-stdlib
        - daml-script
        - splice-api-token-transfer-instruction-v1
        - splice-api-token-holding-v1
        - splice-api-featured-app-v1
      ```

      Is this complete? Wrong order? Missing one (e.g. do I also need
      `splice-api-token-metadata-v1` for the `meta` field, or
      `splice-amulet` for AmuletRules disclosure)?

  (b) What is the EXACT `import` statement at the top of my Main.daml? Give me
      the full module path for: TransferFactory, TransferFactory_Transfer,
      Transfer, Holding, ExtraArgs, FeaturedAppRight, and any types those
      reference. For example:

      ```haskell
      import Splice.Api.Token.TransferInstructionV1 (TransferFactory, TransferFactory_Transfer, Transfer, ExtraArgs)
      import Splice.Api.Token.HoldingV1 (Holding)
      import Splice.Api.FeaturedApp.FeaturedAppRightV1 (FeaturedAppRight)
      ```

      Are these module paths correct for SDK 3.4.11 / Splice 0.4.x? If not,
      give the correct paths.

  (c) DAR version compatibility: my SDK is 3.4.11. Are the
      `splice-api-token-transfer-instruction-v1` etc. DARs I extracted from
      the participant (already running) guaranteed ABI-compatible with a
      3.4.11-compiled canquest-v22 DAR? Or do I need a specific DAR version
      in daml.yaml (e.g. `version: 0.4.0`)?

───────────────────────────────────────────────────────────────
QUESTION 3 — Optional FeaturedAppRight + conditional exercise pattern
───────────────────────────────────────────────────────────────

  (a) Show me the DAML idiom for a Settle choice that takes an
      `Optional (ContractId FeaturedAppRight)` and exercises
      `FeaturedAppRight_CreateActivityMarker` ONLY when the value is `Some`.

      My draft:
      ```haskell
      choice QuestClaimReceipt_Settle : ContractId QuestClaimReceipt
        with
          feeFactoryCid    : ContractId TransferFactory
          feeTransferArg   : <Transfer arg type>
          feeExtraArgs     : ExtraArgs
          rewardFactoryCid : ContractId TransferFactory
          rewardTransferArg: <Transfer arg type>
          rewardExtraArgs  : ExtraArgs
          featuredAppRightCid : Optional (ContractId FeaturedAppRight)
          rewardSentAt     : Text
        controller operator
        do
          feeTxId    <- toText <$> exercise feeFactoryCid TransferFactory_Transfer with
            { expectedAdmin = ...; transfer = feeTransferArg; extraArgs = feeExtraArgs }
          rewardTxId <- toText <$> exercise rewardFactoryCid TransferFactory_Transfer with
            { expectedAdmin = ...; transfer = rewardTransferArg; extraArgs = rewardExtraArgs }
          -- Marker only if FAR provided
          case featuredAppRightCid of
            Some farCid -> exercise farCid FeaturedAppRight_CreateActivityMarker with { ... }
            None -> pure ()
          create this with
            feePaid = True
            feeTxId = feeTxId
            rewardSent = True
            rewardTxId = rewardTxId
      ```

      Is this idiom correct? Specifically:
      - Is `case ... of Some -> exercise; None -> pure ()` the right pattern,
        or should I use `forA_` / `mapA_`? Show the exact idiom.
      - Is the return type of `exercise ... TransferFactory_Transfer` something
        I can `toText` to store as `feeTxId : Text`? What does it actually
        return (a ContractId? The update_id? A record)?
      - What is the exact choice name and argument signature for
        `FeaturedAppRight_CreateActivityMarker` (module, fields like
        `activityType`, `description`, `user`)?

  (b) Is there a subtlety with exercising a choice on `FeaturedAppRight`
      (whose signatory is the Canton Foundation / app-provider) from MY
      choice whose controller is `operator`? Do I need a delegation contract,
      or does `actAs: [operator, appProvider]` at command submission cover it?

───────────────────────────────────────────────────────────────
DELIVERABLE I NEED
───────────────────────────────────────────────────────────────

Please return, in order:
  1. Corrected daml.yaml dependencies block.
  2. Corrected import lines for Main.daml.
  3. A FULL example `QuestClaimReceipt` template with a working `Settle` choice
     that does nested TransferFactory_Transfer (fee + reward) + optional FAR
     marker, using real type names and field names from the Splice DARs. I want
     to be able to adapt this to my exact fields without guessing types.
  4. Any caveats about SDK 3.4.11 compatibility.

If any type name is uncertain, tell me which DAR file to open to find the exact
definition (e.g. "look in splice-api-token-transfer-instruction-v1.dar under
Splice.Api.Token.TransferInstructionV1").

##sampai sini
