/** Short name in the macOS menu bar and the Windows/Linux app menu. */
export const APP_MENU_NAME = 'Reader';

/** Official product name (About, updates, mail subjects, Dock/Launchpad). */
export const APP_OFFICIAL_NAME = 'Yomi Reader';

export const APP_SLUG = 'kiji';

export const DATABASE_FILE_NAME = `${APP_SLUG}.db`;

export const GUARD_LOG_PREFIX = `${APP_SLUG}-guard`;

export const SAVED_ARTICLES_EXPORT_FILE_PREFIX = `${APP_SLUG}-saved-articles`;
export const DIAGNOSTICS_EXPORT_FILE_PREFIX = `${APP_SLUG}-error-report`;
export const CONTACT_EMAIL_ADDRESS = 'hello@yomilab.app';
export const APP_WEBSITE_URL = 'https://reader.yomilab.app';
export const APP_DOWNLOADS_URL = `${APP_WEBSITE_URL}/download/`;
export const APP_UPDATES_FEED_URL = `${APP_WEBSITE_URL}/feed.xml`;
// Not /release.json: apps on 1.9 read that address, and it offers them the
// transition download.
export const APP_RELEASE_MANIFEST_URL = `${APP_WEBSITE_URL}/release-current.json`;
/** @deprecated Use APP_RELEASE_MANIFEST_URL */
export const PUBLIC_RELEASE_MANIFEST_URL = APP_RELEASE_MANIFEST_URL;
export const RECOMMENDED_OPML_DIRECTORY_URL = 'https://raw.githubusercontent.com/yomilab/kiji-resource/main/recommended.opml';
