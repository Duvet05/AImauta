/**
 * Public origin for links that leave the app: QR codes printed on paper,
 * WhatsApp messages, social previews. These outlive the request that created
 * them, so they cannot be built from request headers — a link generated behind
 * a proxy or on localhost would be dead the moment it is shared.
 */
const DEFAULT_SITE_URL = "https://aimauta.pe";

export function siteUrl(): string {
  const configured = process.env.AIMAUTA_SITE_URL?.trim();
  if (!configured) {
    return DEFAULT_SITE_URL;
  }
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return DEFAULT_SITE_URL;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function assignmentUrl(token: string): string {
  return `${siteUrl()}/t/${encodeURIComponent(token)}`;
}

export function achievementUrl(shareToken: string): string {
  return `${siteUrl()}/logro/${encodeURIComponent(shareToken)}`;
}
