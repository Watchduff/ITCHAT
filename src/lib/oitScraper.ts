import axios from 'axios';
import * as cheerio from 'cheerio';
import { delay, fetchPage, type ScrapedArticle } from './scraper';

// The public OIT website (a Brightspot CMS site), crawled alongside the TeamDynamix KB.
const BASE_URL = 'https://oit.byuh.edu';
const HOSTNAME = 'oit.byuh.edu';
const USER_AGENT = 'Mozilla/5.0 (compatible; IT-KB-Ingest-Bot/1.0)';
// robots.txt asks for `Crawl-delay: 10`; this is the fallback if it can't be read.
const DEFAULT_CRAWL_DELAY_MS = 10_000;
const MAX_PAGES = Number(process.env.OIT_SCRAPER_MAX_PAGES ?? 300);
// Pages with less text than this are navigation hubs or empty shells, not useful context.
const MIN_CONTENT_LENGTH = 150;
const SKIPPED_EXTENSIONS = /\.(rss|xml|pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|svg|webp|mp4|mp3|ics)$/i;
const SKIPPED_PATHS = /^\/(search|tags?|login|logout|_)(\/|$)/i;

function normalizeUrl(href: string): string | null {
  try {
    const url = new URL(href, BASE_URL);
    if (url.hostname !== HOSTNAME || !/^https?:$/.test(url.protocol)) return null;
    if (SKIPPED_EXTENSIONS.test(url.pathname) || SKIPPED_PATHS.test(url.pathname)) return null;
    url.protocol = 'https:';
    url.search = '';
    url.hash = '';
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000,
      responseType: 'text',
    });
    return res.data as string;
  } catch {
    return null;
  }
}

async function readCrawlDelayMs(): Promise<number> {
  const robots = await fetchText(`${BASE_URL}/robots.txt`);
  const match = robots?.match(/^\s*crawl-delay:\s*(\d+(?:\.\d+)?)/im);
  return match ? Number(match[1]) * 1000 : DEFAULT_CRAWL_DELAY_MS;
}

// The sitemap is an index of monthly sitemaps; collect every page URL across all of them.
async function readSitemapUrls(crawlDelayMs: number): Promise<string[]> {
  const index = await fetchText(`${BASE_URL}/sitemap.xml`);
  await delay(crawlDelayMs);
  if (!index) return [];

  const locs = (xml: string) => {
    const $ = cheerio.load(xml, { xml: true });
    return $('loc')
      .map((_, el) => $(el).text().trim())
      .get();
  };
  const childSitemaps = locs(index).filter((loc) => loc.endsWith('.xml'));
  const pageUrls = new Set<string>();

  for (const sitemapUrl of childSitemaps) {
    console.log(`Reading sitemap: ${sitemapUrl}`);
    const xml = await fetchText(sitemapUrl);
    await delay(crawlDelayMs);
    if (!xml) continue;
    for (const loc of locs(xml)) {
      const normalized = normalizeUrl(loc);
      if (normalized) pageUrls.add(normalized);
    }
  }

  return [...pageUrls];
}

function extractPage(html: string, url: string): ScrapedArticle | null {
  const $ = cheerio.load(html);

  // Brightspot uses several templates (Page, ArticlePage, …) with the template name as a class
  // prefix, e.g. `h1.Page-pageHeading` or `h1.ArticlePage-headline`, so match on the suffix.
  const title =
    $('h1[class$="-pageHeading"], h1[class$="-headline"]').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('head > title').first().text().trim();

  // The page lead holds the hero banner; main holds the body (rich text, accordions, cards).
  const bodyEls = $('[class$="-pageLead"], main');
  if (!title || bodyEls.length === 0) return null;

  bodyEls.find('script, style, noscript, iframe, svg, button, .sr-only, .debug').remove();
  // Keep adjacent blocks from running together ("Toggle ItemHow do I…") once tags are stripped.
  bodyEls.find('p, li, h1, h2, h3, h4, h5, h6, div, td, th, dt, dd, br').append(' ');
  const content = bodyEls.text().replace(/\s+/g, ' ').trim();
  if (content.length < MIN_CONTENT_LENGTH) return null;

  return { source: 'oit', url, title, category: 'OIT website', content };
}

function extractLinks(html: string): string[] {
  const $ = cheerio.load(html);
  return $('a[href]')
    .map((_, el) => normalizeUrl($(el).attr('href') ?? ''))
    .get()
    .filter((url): url is string => Boolean(url));
}

export async function scrapeOitWebsite(): Promise<ScrapedArticle[]> {
  const crawlDelayMs = await readCrawlDelayMs();
  console.log(`OIT website: honoring a ${crawlDelayMs / 1000}s crawl delay`);

  // Seed from the sitemap, then also follow on-site links in case the sitemap misses pages.
  const sitemapUrls = await readSitemapUrls(crawlDelayMs);
  console.log(`OIT website: ${sitemapUrls.length} pages listed in the sitemap`);

  const queue: string[] = [`${BASE_URL}/`, ...sitemapUrls];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const articles: ScrapedArticle[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`Scraping: ${url}`);
    const html = await fetchPage(url);
    await delay(crawlDelayMs);
    if (!html) continue;

    const article = extractPage(html, url);
    if (article) {
      console.log(`  -> ${article.title} (${article.content.length} chars)`);
      articles.push(article);
    }

    for (const link of extractLinks(html)) {
      if (!queued.has(link)) {
        queued.add(link);
        queue.push(link);
      }
    }
  }

  console.log(`OIT website crawl complete: ${articles.length} pages scraped (${visited.size} pages visited)`);
  return articles;
}
