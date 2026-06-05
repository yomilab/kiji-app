const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'www.youtu.be',
]);

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;

function sanitizeVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return YOUTUBE_VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function parseStartSeconds(rawValue: string | null): number | null {
  if (!rawValue) return null;
  const value = rawValue.trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const total = (hours * 3600) + (minutes * 60) + seconds;
  return total > 0 ? total : null;
}

export interface YouTubeEmbedTarget {
  videoId: string;
  startSeconds?: number;
}

export function extractYouTubeEmbedTarget(url: string): YouTubeEmbedTarget | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    let videoId: string | null = null;

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = sanitizeVideoId(pathParts[0]);
    } else if (pathParts[0] === 'watch') {
      videoId = sanitizeVideoId(parsed.searchParams.get('v'));
    } else if (pathParts[0] === 'embed' || pathParts[0] === 'shorts' || pathParts[0] === 'live' || pathParts[0] === 'v') {
      videoId = sanitizeVideoId(pathParts[1]);
    }

    if (!videoId) return null;

    const startSeconds = parseStartSeconds(parsed.searchParams.get('start'))
      ?? parseStartSeconds(parsed.searchParams.get('t'))
      ?? undefined;

    return { videoId, startSeconds };
  } catch {
    return null;
  }
}

export function buildYouTubeEmbedHtml(url: string, title?: string): string | null {
  const target = extractYouTubeEmbedTarget(url);
  if (!target) return null;

  const safeTitle = (title || 'YouTube video').replace(/"/g, '&quot;');
  const params = new URLSearchParams();
  if (target.startSeconds && target.startSeconds > 0) {
    params.set('start', String(target.startSeconds));
  }

  return `<lite-youtube videoid="${target.videoId}" playlabel="Play YouTube video" title="${safeTitle}" aria-label="${safeTitle}"${params.toString() ? ` params="${params.toString()}"` : ''}></lite-youtube>`;
}
