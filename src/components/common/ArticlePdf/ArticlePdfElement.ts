import { loadPdfBytes } from '@/services/articles/pdfInlineService';

const PDF_RENDER_SCALE = 1.35;

type PdfJsModule = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      return pdfjs;
    })();
  }
  return pdfJsModulePromise;
}

function releaseCanvasMemory(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * ArticlePdfElement — owns PDF fetch/render lifecycle and releases pdf.js,
 * canvas, and byte buffers on cancel or disconnect.
 */
class ArticlePdfElement extends HTMLElement {
  private root: ShadowRoot;
  private loadToken = 0;
  private activeUrl: string | null = null;
  private loadingTask: PdfLoadingTask | null = null;
  private pdfDocument: PdfDocument | null = null;
  private renderedPages: PdfPage[] = [];
  private pagesContainer: HTMLDivElement;
  private promptContainer: HTMLDivElement;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        margin: 16px 0;
        color: var(--theme-text-secondary, #7a7a7a);
        font: inherit;
      }

      .article-pdf-pages {
        display: flex;
        flex-direction: column;
        gap: 16px;
        align-items: center;
        width: 100%;
      }

      .article-pdf-page {
        display: block;
        width: 100%;
        max-width: 100%;
        height: auto;
        border-radius: 4px;
        background: #ffffff;
        box-shadow: 0 1px 6px var(--theme-shadow, rgba(0, 0, 0, 0.1));
      }

      .article-pdf-loading {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .article-pdf-loading-line {
        height: 0.75em;
        border-radius: 4px;
        background: color-mix(in srgb, var(--theme-text-muted, #b5b5b5) 24%, transparent);
      }

      .article-pdf-loading-line:nth-child(1) { width: 92%; }
      .article-pdf-loading-line:nth-child(2) { width: 88%; }
      .article-pdf-loading-line:nth-child(3) { width: 76%; }
      .article-pdf-loading-line:nth-child(4) { width: 84%; }

      .article-pdf-prompt p {
        margin: 0 0 12px;
      }

      .article-pdf-open-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 14px;
        border: none;
        border-radius: var(--widget-button-border-radius, 6px);
        background-color: var(--system-accent-color, var(--theme-primary-color, #4a4a49));
        color: #ffffff;
        font: inherit;
        font-size: 14px;
        line-height: 1.2;
        cursor: pointer;
      }
    `;

    this.pagesContainer = document.createElement('div');
    this.pagesContainer.className = 'article-pdf-pages';

    this.promptContainer = document.createElement('div');
    this.promptContainer.className = 'article-pdf-prompt';
    this.promptContainer.hidden = true;

    this.root.append(style, this.pagesContainer, this.promptContainer);
    this.showLoadingState();
  }

  setSource(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) {
      this.cancelPendingWork();
      return;
    }

    if (trimmed === this.activeUrl && this.pdfDocument) {
      return;
    }

    const token = this.loadToken + 1;
    this.loadToken = token;
    void this.beginLoad(trimmed, token);
  }

  cancelPendingWork(): void {
    this.loadToken += 1;
    void this.releaseResources();
    this.showLoadingState();
  }

  disconnectedCallback(): void {
    this.loadToken += 1;
    void this.releaseResources();
  }

  private async beginLoad(url: string, token: number): Promise<void> {
    await this.releaseResources();
    if (token !== this.loadToken) {
      return;
    }

    this.showLoadingState();

    const result = await loadPdfBytes(url);
    if (token !== this.loadToken) {
      return;
    }

    if ('error' in result) {
      this.activeUrl = url;
      this.showErrorState(result.error);
      return;
    }

    this.activeUrl = url;
    await this.renderPdf(result.bytes, token);
  }

  private async renderPdf(bytes: Uint8Array, token: number): Promise<void> {
    this.clearPrompt();
    this.pagesContainer.replaceChildren();

    try {
      const pdfjs = await loadPdfJsModule();
      if (token !== this.loadToken) {
        return;
      }

      const loadingTask = pdfjs.getDocument({ data: bytes });
      this.loadingTask = loadingTask;
      const pdf = await loadingTask.promise;
      this.loadingTask = null;

      if (token !== this.loadToken) {
        await pdf.destroy();
        return;
      }

      this.pdfDocument = pdf;
      const fragment = document.createDocumentFragment();

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        if (token !== this.loadToken) {
          break;
        }

        const page = await pdf.getPage(pageNum);
        if (token !== this.loadToken) {
          page.cleanup();
          break;
        }

        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
        const canvas = document.createElement('canvas');
        canvas.className = 'article-pdf-page';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const context = canvas.getContext('2d');
        if (!context) {
          page.cleanup();
          continue;
        }

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        if (token !== this.loadToken) {
          releaseCanvasMemory(canvas);
          page.cleanup();
          break;
        }

        this.renderedPages.push(page);
        fragment.appendChild(canvas);
      }

      if (token !== this.loadToken) {
        for (const canvas of fragment.querySelectorAll('canvas')) {
          releaseCanvasMemory(canvas);
        }
        return;
      }

      this.pagesContainer.appendChild(fragment);
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      console.error('Failed to render PDF:', error);
      this.showErrorState('Could not render PDF.');
    }
  }

  private async releaseResources(): Promise<void> {
    const loadingTask = this.loadingTask;
    this.loadingTask = null;
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        // Ignore races when a load is cancelled mid-flight.
      }
    }

    for (const page of this.renderedPages) {
      try {
        page.cleanup();
      } catch {
        // Ignore cleanup races.
      }
    }
    this.renderedPages = [];

    for (const canvas of this.pagesContainer.querySelectorAll('canvas')) {
      releaseCanvasMemory(canvas);
    }
    this.pagesContainer.replaceChildren();

    const document = this.pdfDocument;
    this.pdfDocument = null;
    if (document) {
      try {
        await document.destroy();
      } catch {
        // Ignore destroy races.
      }
    }

    this.activeUrl = null;
    this.clearPrompt();
  }

  private showLoadingState(): void {
    this.clearPrompt();
    this.pagesContainer.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'article-pdf-loading';
    for (let index = 0; index < 4; index += 1) {
      const line = document.createElement('div');
      line.className = 'article-pdf-loading-line';
      loading.appendChild(line);
    }
    this.pagesContainer.appendChild(loading);
  }

  private showErrorState(message: string): void {
    for (const canvas of this.pagesContainer.querySelectorAll('canvas')) {
      releaseCanvasMemory(canvas);
    }
    this.pagesContainer.replaceChildren();
    this.promptContainer.replaceChildren();

    const paragraph = document.createElement('p');
    paragraph.textContent = message;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'article-pdf-open-button';
    button.textContent = 'Open in browser';
    button.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('article-pdf-open-external', {
        bubbles: true,
        composed: true,
      }));
    });

    this.promptContainer.append(paragraph, button);
    this.promptContainer.hidden = false;
  }

  private clearPrompt(): void {
    this.promptContainer.replaceChildren();
    this.promptContainer.hidden = true;
  }
}

if (!customElements.get('article-pdf')) {
  customElements.define('article-pdf', ArticlePdfElement);
}

export default ArticlePdfElement;

export interface ArticlePdfElementInstance extends HTMLElement {
  setSource?: (url: string) => void;
  cancelPendingWork?: () => void;
}
