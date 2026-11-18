import type { MediaType, ProviderDomain, ProviderUrls, SharePayload } from "@/types";

export const SHARE_FORMAT_VERSION = "1";
export const MAX_ENCODED_PAYLOAD_SIZE = 65536;
export const MAX_DECODED_PAYLOAD_SIZE = 65536;

export class ShareLinkCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkCompatibilityError";
  }
}

/** Artwork hosts a share link may point at, matched exactly or as a subdomain. */
export const ARTWORK_HOST_SUFFIXES = [
  "mzstatic.com",
  "scdn.co",
  "tidal.com",
  "qobuz.com",
  "dzcdn.net",
  "bcbits.com",
  "googleusercontent.com",
  "ytimg.com",
  "coverartarchive.org",
  "archive.org",
  "theaudiodb.com",
  "fanart.tv",
  "last.fm",
  "lastfm.freetls.fastly.net",
  "ssl-images-amazon.com",
] as const;

// Share URL hosts the server attributes to each provider (music_assistant/helpers/uri.py)
const PROVIDER_HOSTS: Record<ProviderDomain, readonly string[]> = {
  spotify: ["open.spotify.com"],
  tidal: ["tidal.com", "listen.tidal.com"],
  qobuz: ["open.qobuz.com", "play.qobuz.com", "qobuz.com", "www.qobuz.com"],
  ytmusic: ["music.youtube.com"],
  deezer: ["deezer.com", "www.deezer.com"],
  apple_music: ["music.apple.com", "itunes.apple.com", "geo.itunes.apple.com"],
};

const MEDIA_TYPES: readonly MediaType[] = ["track", "album", "artist"];
const STRING_FIELDS = [
  "artist",
  "version",
  "album",
  "isrc",
  "mbid",
  "mb_track",
  "barcode",
] as const;

/**
 * Decode the fragment of a share link (without the leading "#").
 *
 * Throws when the link is malformed, oversized or of an unsupported version or media type.
 * Artwork and provider URLs that fail validation are dropped instead.
 */
export async function decodeSharePayload(encoded: string): Promise<SharePayload> {
  if (!encoded.startsWith(SHARE_FORMAT_VERSION)) {
    throw new ShareLinkCompatibilityError(
      "Unsupported share format version. Please create a new share link."
    );
  }
  if (encoded.length > MAX_ENCODED_PAYLOAD_SIZE) {
    throw new Error("Share payload is too large");
  }
  const body = encoded.slice(SHARE_FORMAT_VERSION.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) {
    throw new Error("Invalid share payload");
  }
  return parsePayload(JSON.parse(await inflate(base64UrlToBytes(body))));
}

/** Parse the recipient's Music Assistant URL, allowing only plain http(s) URLs. */
export function parseInstanceUrl(value: string): URL {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported instance URL");
  }
  return url;
}

/** Build the URL that opens the share in the recipient's Music Assistant frontend. */
export function createMusicAssistantUrl(instanceUrl: string, encodedPayload: string): string {
  const url = parseInstanceUrl(instanceUrl);
  url.hash = `/share?payload=${encodeURIComponent(encodedPayload)}`;
  return url.toString();
}

function parsePayload(data: unknown): SharePayload {
  if (isRecord(data) && data.type === "playlist") {
    throw new ShareLinkCompatibilityError(
      "Unsupported share payload: playlist share links are no longer supported."
    );
  }
  if (!isRecord(data) || !MEDIA_TYPES.includes(data.type as MediaType)) {
    throw new Error("Unsupported share payload");
  }
  if (typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("Share payload title is missing");
  }
  const strings: Partial<Record<(typeof STRING_FIELDS)[number], string>> = {};
  for (const field of STRING_FIELDS) {
    const value = data[field];
    if (value == null) continue;
    if (typeof value !== "string") throw new Error(`Invalid share payload field: ${field}`);
    strings[field] = value;
  }
  const artists = data.artists ?? undefined;
  if (
    artists !== undefined &&
    (!Array.isArray(artists) || artists.some((a) => typeof a !== "string" || !a.trim()))
  ) {
    throw new Error("Invalid share artist credits");
  }
  const duration = data.duration ?? undefined;
  if (duration !== undefined && (!Number.isInteger(duration) || (duration as number) < 0)) {
    throw new Error("Invalid share track duration");
  }
  const artUrl = data.art_url;
  return {
    type: data.type as MediaType,
    title: data.title,
    ...strings,
    artists: (artists as string[] | undefined)?.map((a) => a.trim()),
    art_url: typeof artUrl === "string" && isValidArtworkUrl(artUrl) ? artUrl : undefined,
    provider_urls: validatedProviderUrls(data.provider_urls),
    duration: duration as number | undefined,
  };
}

/** Keep the provider URLs that pass validation; reject a map of the wrong shape. */
function validatedProviderUrls(value: unknown): ProviderUrls | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new Error("Invalid share provider URLs");
  const urls: ProviderUrls = {};
  for (const [domain, url] of Object.entries(value)) {
    if (typeof url !== "string") throw new Error("Invalid share provider URLs");
    if (isValidProviderUrl(domain, url)) urls[domain as ProviderDomain] = url;
  }
  return Object.keys(urls).length ? urls : undefined;
}

function isValidProviderUrl(domain: string, value: string): boolean {
  const url = parseUrl(value);
  return (
    !!url &&
    Object.hasOwn(PROVIDER_HOSTS, domain) &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    // host, not hostname: the server rejects a URL with an explicit port
    PROVIDER_HOSTS[domain as ProviderDomain].includes(url.host)
  );
}

function isValidArtworkUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    return false;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return ARTWORK_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

/** Raw-inflate the bytes as UTF-8 text, aborting once the output exceeds the size cap. */
async function inflate(compressed: Uint8Array<ArrayBuffer>): Promise<string> {
  let decompressor: DecompressionStream;
  try {
    if (typeof DecompressionStream === "undefined") {
      throw new TypeError("DecompressionStream is unavailable");
    }
    decompressor = new DecompressionStream("deflate-raw");
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw new ShareLinkCompatibilityError(
      "This browser does not support raw DEFLATE share links. Please use an up-to-date browser."
    );
  }
  const reader = new Blob([compressed]).stream().pipeThrough(decompressor).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_DECODED_PAYLOAD_SIZE) {
      await reader.cancel();
      throw new Error("Share payload is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
