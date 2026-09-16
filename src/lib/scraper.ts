import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://byuh.teamdynamix.com';
const KB_PATH_PREFIX = '/TDClient/1902/ithelp/KB/';
const HOSTNAME = 'byuh.teamdynamix.com';
const REQUEST_DELAY_MS = 500;
const MAX_PAGES = Number(process.env.SCRAPER_MAX_PAGES ?? 500);

export interface ScrapedArticle {
  url: string;
  title: string;
  category: string;
  content: string;
}

function normalizeUrl(href: string): string | null {
  try {
    const url = new URL(href, BASE_URL);
    if (url.hostname !== HOSTNAME) return null;
    if (!url.pathname.startsWith(KB_PATH_PREFIX)) return null;
    url.search = '';
    url.hash = '';
    let pathname = url.pathname;
    if (pathname.endsWith('/') && pathname.length > KB_PATH_PREFIX.length) {
      pathname = pathname.slice(0, -1);
    }
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function isArticleUrl(url: string): boolean {
  return /\/KB\/Article\/\d+/.test(url);
}

function isCrawlableUrl(url: string): boolean {
  // Only follow article and category pages — Search/Login/Feedback/etc. are noise.
  return isArticleUrl(url) || /\/KB\/Category\/\d+/.test(url) || url === `${BASE_URL}${KB_PATH_PREFIX}`.replace(/\/$/, '');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IT-KB-Ingest-Bot/1.0)' },
      timeout: 15000,
    });
    const contentType = String(res.headers['content-type'] ?? '');
    if (!contentType.includes('text/html')) return null;
    return res.data as string;
  } catch {
    return null;
  }
}

function extractArticle(html: string, url: string): ScrapedArticle | null {
  const $ = cheerio.load(html);

  const title = $('h1.gutter-top').first().text().trim();
  const bodyEl = $('div[id$="_divBody"]').first();
  const category = $('ol.breadcrumb a[href*="/KB/Category/"]').last().text().trim();
  if (!title || bodyEl.length === 0) return null;

  // Strip non-content chrome before extracting body text.
  bodyEl.find('script, style, iframe, noscript').remove();
  const content = bodyEl.text().replace(/\s+/g, ' ').trim();
  if (!content) return null;

  return { url, title, category, content };
}

function extractLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const normalized = normalizeUrl(href);
    if (normalized && isCrawlableUrl(normalized)) {
      links.push(normalized);
    }
  });
  return links;
}

export async function scrapeKnowledgeBase(): Promise<ScrapedArticle[]> {
  const startUrl = `${BASE_URL}${KB_PATH_PREFIX}`.replace(/\/$/, '');
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const articles: ScrapedArticle[] = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`Scraping: ${url}`);
    const html = await fetchPage(url);
    await delay(REQUEST_DELAY_MS);
    if (!html) continue;

    if (isArticleUrl(url)) {
      const article = extractArticle(html, url);
      if (article) {
        console.log(`  -> ${article.title} (${article.content.length} chars)`);
        articles.push(article);
      }
    }

    for (const link of extractLinks(html)) {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }
  }

  console.log(`Crawl complete: ${articles.length} articles scraped (${visited.size} pages visited)`);
  return articles;
}
