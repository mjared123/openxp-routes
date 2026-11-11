# Share strings

A share string packs one or more guides into a single line of text:

```
OXP1:<base64>
```

- `<base64>` is standard base64 (RFC 4648, with padding).
- Decoded, it is a zlib stream (RFC 1950).
- Inflated, it is UTF-8 guide text. Several guides are separated by one NUL byte (`\0`).

`src/guide/share.ts` writes and reads them.

## Why not the addon's existing import string?

OpenXP inherits RestedXP's importer (`GuideLoader.lua`, `ImportString` and `CheckDataIntegrity`). Its strings are
encrypted with a key derived from the player's own account, so a string only imports on the account it was made
for. A website can't make one string that works for everybody.

## What the addon needs

A small addition to OpenXP's importer: when the pasted text starts with `OXP1:`, decode it as above and hand each
guide to `RXPGuides.ImportGuide(text)`, skipping the account check. In game that is
`C_EncodingUtil.DecodeBase64` and `C_EncodingUtil.DecompressString` where they exist, with the bundled LibDeflate
(`DecodeForPrint` won't do; use a plain base64 decoder, then `LibDeflate:DecompressZlib`) as the fallback.

Until that is in the addon, a route can still be used by saving it as a guide file inside the addon folder.
