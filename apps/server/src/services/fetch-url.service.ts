import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { BadRequestError, UpstreamError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Fetch a web page server-side with SSRF hardening.
 *
 * Threat model: the URL comes from user input; a naive fetch would let an
 * attacker probe internal services (cloud metadata endpoints, admin panels).
 * Defences, in order:
 *   1. scheme allowlist (http/https only)
 *   2. DNS resolution of every hostname → all resulting IPs checked against
 *      private/loopback/link-local ranges (IPv4 + IPv6) BEFORE connecting
 *   3. redirects followed manually, re-validating each hop
 *   4. 10s timeout, 2 MiB body cap, 3 MiB HTML cap before parse
 *   5. main-article extraction via Readability (never executed as HTML)
 */

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map((n) => Number.parseInt(n ?? '0', 10));
    if (a === 10 || a === 127 || a === 0) return true; // 10/8, 127/8, 0/8
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice(7);
      return net.isIPv4(v4) ? isPrivateIp(v4) : false;
    }
  }
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BadRequestError('This URL is not allowed');
  }
  if (host === 'metadata.google.internal' || host === '169.254.169.254') {
    throw new BadRequestError('This URL is not allowed');
  }
  // If the hostname is already an IP literal, validate directly.
  if (net.isIPv4(host) || net.isIPv6(host)) {
    if (isPrivateIp(host)) throw new BadRequestError('This URL is not allowed');
    return;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UpstreamError('Could not resolve the job posting URL');
  }
  if (addresses.length === 0) throw new UpstreamError('Could not resolve the job posting URL');
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new BadRequestError('This URL is not allowed');
  }
}

function extractMainText(html: string, finalUrl: string): { title: string; text: string } {
  const dom = new JSDOM(html, { url: finalUrl });
  const article = new Readability(dom.window.document).parse();
  const title = article?.title?.trim() ?? '';
  const text = (article?.textContent ?? dom.window.document.body?.textContent ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { title, text };
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
}

export async function fetchPageText(rawUrl: string): Promise<FetchedPage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestError('Only http(s) URLs are allowed');
  }

  let current = parsed;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname);

    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'CareerIntelligenceBot/1.0 (+https://github.com/career-intelligence)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location === null) throw new UpstreamError('Redirect without location');
      if (hop === MAX_REDIRECTS) throw new UpstreamError('Too many redirects');
      const next = new URL(location, current);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new BadRequestError('Only http(s) URLs are allowed');
      }
      current = next;
      continue;
    }

    if (!res.ok) throw new UpstreamError(`Fetch failed with status ${res.status}`);

    const declaredLength = Number.parseInt(res.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      throw new UpstreamError('Page too large');
    }

    // Size-capped streaming read (do not trust content-length alone).
    const reader = res.body?.getReader();
    if (reader === undefined) throw new UpstreamError('Empty response body');
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        void reader.cancel();
        throw new UpstreamError('Page too large');
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    const page = extractMainText(html, current.toString());
    if (page.text.length < 30) throw new UpstreamError('Could not extract job description text');
    logger.debug({ url: current.toString(), chars: page.text.length }, 'url_fetched');
    return { url: current.toString(), title: page.title, text: page.text };
  }
  throw new UpstreamError('Too many redirects');
}
