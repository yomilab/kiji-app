# Favicon quality fixtures

Binary samples and a **documented meta catalog** for favicon placeholder detection (`faviconQuality.ts`).

Tests: `test/services/favicons/faviconQuality.fixtures.test.ts`  
Catalog: `quality-cases.ts`

## After each similar fix

1. **Save the asset** (when possible) under this directory, e.g. `origin-favicon.ico` or `feed-icon-w192.png`.
2. **Append a case** to `FAVICON_QUALITY_CASES` in `quality-cases.ts` with:
   - `id` — stable slug
   - `label` — human description
   - `fixRef` — short note tying the case to the bug/fix (changelog line or PR title)
   - `sourceUrl` — original URL when applicable
   - `expectedPlaceholder` — what `isPlaceholderFaviconDataUrl` should return
   - `meta` — documented image info for future accuracy audits:
     - **ICO:** `byteLength`, `ico.{ width, height, colorCount, bitCount, imageCount }` from `extractIcoMetadata`
     - **PNG/JPEG:** `byteLength`, `raster.{ width, height }` from file header or decode
     - **Pixels:** `pixels.{ width, height, opaquePixelCount, opaquePixelRatio, nearWhiteOpaqueRatio, uniqueOpaqueColors }` from browser canvas sample (`analyzeFaviconPixels` uses 32×32)
     - **SVG:** `svgCharLength` (full data URL length gate is `< 120` chars)
     - `capturedWith` — how/when metrics were measured
3. Set `useMetaPixelsForRasterCheck: true` when jsdom cannot decode the raster fixture but pixel metrics are documented.
4. Run `npm test -- test/services/favicons/faviconQuality.fixtures.test.ts`.

### Case template

```ts
{
  id: 'example-origin-blank-ico',
  label: 'Example site blank favicon.ico',
  fixRef: 'YYYY-MM-DD — reject blank origin ICO',
  sourceUrl: 'https://example.com/favicon.ico',
  fixtureFile: 'example-origin-favicon.ico',
  expectedPlaceholder: true,
  meta: {
    byteLength: 198,
    mimeHint: 'image/x-icon',
    ico: {
      width: 16,
      height: 16,
      colorCount: 2,
      bitCount: 1,
      byteLength: 198,
      imageCount: 1,
    },
  },
},
```

### Capturing pixel meta (browser)

In devtools or a one-off script in the app context:

```js
import { analyzeFaviconPixels } from '@/services/favicons/faviconQuality';
const metrics = await analyzeFaviconPixels(dataUrl);
console.log(metrics);
```

Copy the result into `meta.pixels` and note the date in `capturedWith`.
