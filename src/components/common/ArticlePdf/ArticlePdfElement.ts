import { loadPdfBytes } from '@/services/articles/pdfInlineService';

const PDF_RENDER_SCALE = 1.35;

type PdfJsModule = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;
type PdfRenderTask = ReturnType<PdfPage['render']>;

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
 * Renders each pdf.js page to canvas and appends it immediately (not batched).
 */
class ArticlePdfElement extends HTMLElement {
  private root: ShadowRoot;
  private loadToken = 0;
  private activeUrl: string | null = null;
  private loadingTask: PdfLoadingTask | null = null;
  private activeRenderTask: PdfRenderTask | null = null;
  private pdfDocument: PdfDocument | null = null;
  private renderedPages: PdfPage[] = [];
  private releasePromise: Promise<void> = Promise.resolve();
  private loadingElement: HTMLDivElement | null = null;
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

      .article-pdf-progress {
        width: 100%;
        max-width: 420px;
        padding: 10px 0 4px;
        font-size: 13px;
        line-height: 1.4;
        text-align: center;
        color: var(--theme-text-tertiary, #9a9a9a);
      }

      .article-pdf-loading-overlay-host {
        width: 100%;
      }

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

  cancelPendingWork(options?: { silent?: boolean }): void {
    this.loadToken += 1;
    void this.releaseResources();
    if (!options?.silent && this.isConnected) {
      this.showLoadingState();
    }
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
    this.dispatchPdfEvent('article-pdf-load-start');

    const [result, pdfjs] = await Promise.all([
      loadPdfBytes(url),
      loadPdfJsModule(),
    ]);

    if (token !== this.loadToken) {
      return;
    }

    if ('error' in result) {
      this.activeUrl = url;
      this.clearLoadingState();
      this.showErrorState(result.error);
      this.dispatchPdfEvent('article-pdf-load-error');
      return;
    }

    this.activeUrl = url;
    await this.renderPdf(result.bytes, token, pdfjs);
  }

  private async renderPdf(bytes: Uint8Array, token: number, pdfjs: PdfJsModule): Promise<void> {
    this.clearPrompt();

    try {
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
      const totalPages = pdf.numPages;
      const containerWidth = this.resolveRenderContainerWidth();
      const progressFooter = totalPages > 1 ? this.createProgressFooter(totalPages) : null;
      if (progressFooter) {
        this.pagesContainer.appendChild(progressFooter);
      }

      for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
        if (token !== this.loadToken) {
          break;
        }

        const page = await pdf.getPage(pageNum);
        if (token !== this.loadToken) {
          page.cleanup();
          break;
        }

        const viewport = this.resolvePageViewport(page, containerWidth);
        const canvas = document.createElement('canvas');
        canvas.className = 'article-pdf-page';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const context = canvas.getContext('2d');
        if (!context) {
          page.cleanup();
          continue;
        }

        const renderTask = page.render({
          canvasContext: context,
          viewport,
        });
        this.activeRenderTask = renderTask;

        try {
          await renderTask.promise;
        } catch {
          page.cleanup();
          if (token !== this.loadToken) {
            releaseCanvasMemory(canvas);
            break;
          }
          continue;
        } finally {
          if (this.activeRenderTask === renderTask) {
            this.activeRenderTask = null;
          }
        }

        if (token !== this.loadToken) {
          releaseCanvasMemory(canvas);
          page.cleanup();
          break;
        }

        this.renderedPages.push(page);
        if (pageNum === 1) {
          this.clearLoadingState();
          this.dispatchPdfEvent('article-pdf-first-page-rendered');
        }

        if (progressFooter) {
          this.pagesContainer.insertBefore(canvas, progressFooter);
          progressFooter.textContent = `Rendering page ${pageNum} of ${totalPages}…`;
        } else {
          this.pagesContainer.appendChild(canvas);
        }

        if (pageNum < totalPages) {
          await this.yieldToUiThread();
        }
      }

      if (token !== this.loadToken) {
        return;
      }

      if (progressFooter) {
        progressFooter.remove();
      }

      this.dispatchPdfEvent('article-pdf-render-complete');
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      console.error('Failed to render PDF:', error);
      this.clearLoadingState();
      this.showErrorState('Could not render PDF.');
      this.dispatchPdfEvent('article-pdf-load-error');
    }
  }

  private resolveRenderContainerWidth(): number {
    const hostWidth = this.getBoundingClientRect().width;
    if (hostWidth > 0) {
      return hostWidth;
    }
    const parentWidth = this.parentElement?.getBoundingClientRect().width ?? 0;
    if (parentWidth > 0) {
      return parentWidth;
    }
    return 720;
  }

  private resolvePageViewport(page: PdfPage, containerWidth: number) {
    const unscaled = page.getViewport({ scale: 1 });
    const maxWidth = Math.max(containerWidth, 320);
    const scale = Math.min(PDF_RENDER_SCALE, maxWidth / unscaled.width);
    return page.getViewport({ scale });
  }

  private dispatchPdfEvent(type: string): void {
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      composed: true,
    }));
  }

  private createProgressFooter(totalPages: number): HTMLDivElement {
    const progress = document.createElement('div');
    progress.className = 'article-pdf-progress';
    progress.textContent = `Rendering page 1 of ${totalPages}…`;
    return progress;
  }

  private yieldToUiThread(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  private async releaseResources(): Promise<void> {
    this.releasePromise = this.releasePromise
      .then(() => this.releaseResourcesInternal())
      .catch(() => {});
    return this.releasePromise;
  }

  private async releaseResourcesInternal(): Promise<void> {
    const activeRenderTask = this.activeRenderTask;
    this.activeRenderTask = null;
    if (activeRenderTask) {
      try {
        activeRenderTask.cancel();
      } catch {
        // Ignore races when render is already finished.
      }
    }

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
    this.clearLoadingState();

    const loading = document.createElement('div');
    loading.className = 'article-pdf-loading-overlay-host';
    loading.setAttribute('aria-busy', 'true');
    loading.setAttribute('aria-label', 'Loading PDF');
    for (let index = 0; index < 6; index += 1) {
      const block = document.createElement('div');
      block.className = 'article-pdf-page article-pdf-loading-page';
      block.style.minHeight = '420px';
      block.style.background = 'color-mix(in srgb, var(--theme-text-muted, #b5b5b5) 14%, transparent)';
      loading.appendChild(block);
    }
    this.loadingElement = loading;
    this.pagesContainer.appendChild(loading);
  }

  private clearLoadingState(): void {
    if (this.loadingElement) {
      this.loadingElement.remove();
      this.loadingElement = null;
    }
  }

  private showErrorState(message: string): void {
    this.clearLoadingState();
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
  cancelPendingWork?: (options?: { silent?: boolean }) => void;
}
