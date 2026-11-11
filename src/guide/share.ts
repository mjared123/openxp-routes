/**
 * Share strings: one or more guides packed into a single line of text that
 * can be pasted into a chat box, a URL or the addon.
 *
 *     OXP1:<base64 of zlib(guide text, guides separated by a NUL byte)>
 *
 * This is not the string RestedXP's importer reads (that one is encrypted
 * with a key made from the player's account), so the addon needs to know
 * the OXP1 prefix before these can be pasted in game. See docs/share-string.md.
 */
import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";

export const SHARE_PREFIX = "OXP1:";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeShareString(guides: string[]): string {
  if (guides.some((g) => g.includes("\0"))) throw new Error("A guide can't contain a NUL character.");
  return SHARE_PREFIX + toBase64(zlibSync(strToU8(guides.join("\0")), { level: 9 }));
}

export function decodeShareString(share: string): string[] {
  const text = share.trim();
  if (!text.startsWith(SHARE_PREFIX)) throw new Error("This isn't an OpenXP Routes share string.");
  try {
    return strFromU8(unzlibSync(fromBase64(text.slice(SHARE_PREFIX.length).replace(/\s+/g, "")))).split("\0");
  } catch {
    throw new Error("The share string is damaged or incomplete.");
  }
}
