"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  ExerciseOverlayLayer,
  type ExerciseOverlayState,
  type ExerciseSelection,
} from "@/components/exercise-overlay-layer";
import styles from "@/components/pdf-viewer.module.css";
import type { Book } from "@/lib/catalog";
import type { PublicExercise } from "@/lib/exercise-manifest";

type PdfViewerProps = {
  book: Book;
  page: number;
  onPageChange: (page: number) => void;
  exercises?: readonly PublicExercise[];
  selected?: ExerciseSelection | null;
  overlayState?: ExerciseOverlayState;
  onExerciseSelect?: (selection: ExerciseSelection) => void;
  onViewerModeChange?: (mode: ViewerMode) => void;
};

export type { ExerciseSelection };
export type ViewerMode = "pdfjs" | "native-readonly";

type ViewerStatus =
  | "loading-document"
  | "rendering-page"
  | "ready"
  | "error";

type PdfJsModule = typeof import("pdfjs-dist");
type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PdfDocument = Awaited<PdfLoadingTask["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type PdfRenderTask = ReturnType<PdfPage["render"]>;
type PdfTextLayer = InstanceType<PdfJsModule["TextLayer"]>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;
const MAX_DEVICE_SCALE = 2;

let sharedPdfWorker: Worker | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (typeof window === "undefined" || !("Worker" in window)) {
    throw new Error("PDFJS_WORKER_UNAVAILABLE");
  }

  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    sharedPdfWorker ??= new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { name: "aimauta-pdfjs", type: "module" },
    );
    pdfjs.GlobalWorkerOptions.workerPort = sharedPdfWorker;
  }

  return pdfjs;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function isDefinitivePdfError(error: unknown): boolean {
  if (error instanceof Error && error.message === "PDFJS_WORKER_UNAVAILABLE") {
    return true;
  }

  return (
    error instanceof Error &&
    (error.name === "InvalidPDFException" ||
      error.name === "PasswordException")
  );
}

function viewerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "PasswordException") {
    return "Este material requiere una contraseña y no puede abrirse en el visor accesible.";
  }
  if (error instanceof Error && error.name === "InvalidPDFException") {
    return "El archivo no tiene un formato PDF válido.";
  }
  if (error instanceof Error && error.message === "PDFJS_WORKER_UNAVAILABLE") {
    return "Este navegador no permite ejecutar el visor accesible.";
  }

  return "No pudimos mostrar esta página con el visor accesible.";
}

function destroyLoadingTask(task: PdfLoadingTask | null): void {
  if (!task) return;
  void task.destroy().catch(() => undefined);
}

export function PdfViewer({
  book,
  page,
  onPageChange,
  exercises = [],
  selected = null,
  overlayState = "ready",
  onExerciseSelect,
  onViewerModeChange,
}: PdfViewerProps) {
  const generatedId = useId();
  const pageInputId = `pdf-page-${generatedId}`;
  const pageTotalId = `pdf-page-total-${generatedId}`;
  const pageErrorId = `pdf-page-error-${generatedId}`;
  const pdfUrl = `/api/materials/${encodeURIComponent(book.id)}/pdf`;
  const nativePdfUrl = `${pdfUrl}#page=${page}&view=FitH`;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const failureCountRef = useRef(0);
  const [pdfjs, setPdfjs] = useState<PdfJsModule | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [viewerStatus, setViewerStatus] =
    useState<ViewerStatus>("loading-document");
  const [viewerError, setViewerError] = useState("");
  const [nativeFallback, setNativeFallback] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const [pageInput, setPageInput] = useState<{
    page: number;
    value: string;
  } | null>(null);
  const [pageInputError, setPageInputError] = useState<{
    page: number;
    message: string;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [hasPositionedText, setHasPositionedText] = useState(false);
  const [accessiblePageText, setAccessiblePageText] = useState("");

  const registerFailure = useCallback(
    (error: unknown, forceFallback = false) => {
      const failures = failureCountRef.current + 1;
      failureCountRef.current = failures;
      setViewerError(viewerErrorMessage(error));
      setViewerStatus("error");
      setPdfDocument(null);
      setHasPositionedText(false);
      setRenderedPage(null);

      if (forceFallback || isDefinitivePdfError(error) || failures >= 2) {
        setNativeFallback(true);
      }
    },
    [],
  );

  const retryPdfJs = useCallback(() => {
    setNativeFallback(false);
    setViewerError("");
    setViewerStatus("loading-document");
    setRetrySequence((current) => current + 1);
  }, []);

  useEffect(() => {
    onViewerModeChange?.(
      nativeFallback ? "native-readonly" : "pdfjs",
    );
  }, [nativeFallback, onViewerModeChange]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || nativeFallback) return;

    let animationFrame = 0;
    const updateWidth = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setViewportWidth(Math.max(0, Math.round(viewport.clientWidth)));
      });
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [nativeFallback]);

  useEffect(() => {
    if (nativeFallback) return;

    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;

    void (async () => {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setPdfjs(null);
        setPdfDocument(null);
        setViewerStatus("loading-document");
        setViewerError("");
        setHasPositionedText(false);
        setAccessiblePageText("");
        setRenderedPage(null);

        const pdfjsLibrary = await loadPdfJs();
        if (cancelled) return;

        loadingTask = pdfjsLibrary.getDocument({
          url: pdfUrl,
          enableXfa: false,
          withCredentials: false,
        });
        const documentProxy = await loadingTask.promise;
        if (cancelled) {
          destroyLoadingTask(loadingTask);
          loadingTask = null;
          return;
        }
        setPdfjs(pdfjsLibrary);
        setPdfDocument(documentProxy);
      } catch (error) {
        if (cancelled) return;
        destroyLoadingTask(loadingTask);
        loadingTask = null;
        registerFailure(error);
      }
    })();

    return () => {
      cancelled = true;
      destroyLoadingTask(loadingTask);
    };
  }, [nativeFallback, pdfUrl, registerFailure, retrySequence]);

  useEffect(() => {
    if (!pdfjs || !pdfDocument || nativeFallback) return;

    let cancelled = false;
    let pdfPage: PdfPage | null = null;
    let renderTask: PdfRenderTask | null = null;
    let textLayer: PdfTextLayer | null = null;
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    if (!canvas || !textContainer) return;

    void (async () => {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setViewerStatus("rendering-page");
        setViewerError("");
        setHasPositionedText(false);
        setAccessiblePageText("");
        setRenderedPage(null);
        textContainer.replaceChildren();

        if (page < 1 || page > pdfDocument.numPages) {
          throw new Error("PDF_PAGE_OUT_OF_RANGE");
        }
        pdfPage = await pdfDocument.getPage(page);
        if (cancelled) return;

        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(
          280,
          (viewportWidth || 760) - 32,
        );
        const widthScale = availableWidth / baseViewport.width;
        const requestedScale = widthScale * (fitWidth ? 1 : zoomMultiplier);
        const scale = Math.min(3, Math.max(0.35, requestedScale));
        const viewport = pdfPage.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          MAX_DEVICE_SCALE,
        );

        setRenderScale(scale);
        setPageSize({ width: viewport.width, height: viewport.height });
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const textContentPromise = pdfPage.getTextContent({
          includeMarkedContent: true,
        });
        void textContentPromise.catch(() => undefined);
        renderTask = pdfPage.render({
          canvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;

        try {
          const textContent = await textContentPromise;
          if (cancelled) return;

          const extractedText = textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          textLayer = new pdfjs.TextLayer({
            container: textContainer,
            textContentSource: textContent,
            viewport,
          });
          await textLayer.render();
          if (cancelled) return;
          setHasPositionedText(extractedText.length > 0);
        } catch {
          if (cancelled) return;
          textLayer?.cancel();
          textContainer.replaceChildren();

          try {
            const fallbackContent = await pdfPage.getTextContent();
            const fallbackText = fallbackContent.items
              .map((item) => ("str" in item ? item.str : ""))
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            setAccessiblePageText(fallbackText);
          } catch {
            setAccessiblePageText("");
          }
        }

        failureCountRef.current = 0;
        setRenderedPage(page);
        setViewerStatus("ready");
      } catch (error) {
        if (cancelled) return;
        registerFailure(error);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      pdfPage?.cleanup();
      textContainer.replaceChildren();
    };
  }, [
    fitWidth,
    nativeFallback,
    page,
    pdfDocument,
    pdfjs,
    registerFailure,
    viewportWidth,
    zoomMultiplier,
  ]);

  function movePage(nextPage: number) {
    setPageInput(null);
    setPageInputError(null);
    onPageChange(Math.min(Math.max(nextPage, 1), book.pages));
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = (
      pageInput?.page === page ? pageInput.value : ""
    ).trim();
    const parsedPage = /^\d+$/.test(value) ? Number(value) : Number.NaN;

    if (
      Number.isInteger(parsedPage) &&
      parsedPage >= 1 &&
      parsedPage <= book.pages
    ) {
      movePage(parsedPage);
      return;
    }

    setPageInputError({
      page,
      message: `Escribe una página entre 1 y ${book.pages}.`,
    });
  }

  function changeZoom(direction: -1 | 1) {
    setFitWidth(false);
    setZoomMultiplier((current) =>
      clampZoom(current + direction * ZOOM_STEP),
    );
  }

  function fitPageWidth() {
    setZoomMultiplier(1);
    setFitWidth(true);
  }

  function handleViewerKeys(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLAnchorElement
    ) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      movePage(page - 1);
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      movePage(page + 1);
    }
  }

  const pageStyle = {
    width: pageSize.width ? `${pageSize.width}px` : undefined,
    height: pageSize.height ? `${pageSize.height}px` : undefined,
    "--scale-factor": String(renderScale),
    "--total-scale-factor": String(renderScale),
    "--user-unit": "1",
  } as CSSProperties;
  const hasAccessibleText = hasPositionedText || accessiblePageText.length > 0;
  const activePageInput =
    pageInput?.page === page ? pageInput.value : null;
  const activePageInputError =
    pageInputError?.page === page ? pageInputError.message : "";
  const statusMessage =
    viewerStatus === "loading-document"
      ? "Cargando el material…"
      : "Preparando la página…";

  return (
    <section
      className={`document-panel ${styles.panel}`}
      aria-label={`Visor de ${book.title}`}
    >
      <header className={`document-toolbar ${styles.toolbar}`}>
        <div className={`document-title ${styles.documentTitle}`}>
          <span className="document-icon" aria-hidden="true">
            <DocumentIcon />
          </span>
          <div>
            <strong>{book.title}</strong>
            <small>{book.subject}</small>
          </div>
        </div>

        <div className={styles.toolbarActions}>
          <div
            className={`page-controls ${styles.pageControls}`}
            aria-label="Navegación de páginas"
          >
            <button
              type="button"
              className={`icon-button ${styles.iconButton}`}
              onClick={() => movePage(page - 1)}
              disabled={page <= 1}
              aria-label="Página anterior"
              aria-keyshortcuts="ArrowLeft PageUp"
            >
              <ChevronIcon direction="left" />
            </button>
            <form className={styles.pageForm} onSubmit={submitPage}>
              <label htmlFor={pageInputId}>Página</label>
              <input
                id={pageInputId}
                type="number"
                inputMode="numeric"
                min={1}
                max={book.pages}
                onChange={(event) => {
                  setPageInput({ page, value: event.target.value });
                  setPageInputError(null);
                }}
                value={activePageInput ?? String(page)}
                aria-describedby={
                  activePageInputError
                    ? `${pageTotalId} ${pageErrorId}`
                    : pageTotalId
                }
                aria-invalid={Boolean(activePageInputError)}
              />
              <span id={pageTotalId}>de {book.pages}</span>
              {activePageInputError ? (
                <span
                  className={styles.pageInputError}
                  id={pageErrorId}
                  role="alert"
                >
                  {activePageInputError}
                </span>
              ) : null}
            </form>
            <button
              type="button"
              className={`icon-button ${styles.iconButton}`}
              onClick={() => movePage(page + 1)}
              disabled={page >= book.pages}
              aria-label="Página siguiente"
              aria-keyshortcuts="ArrowRight PageDown"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>

          <div className={styles.zoomControls} aria-label="Escala del documento">
            <button
              type="button"
              className={styles.compactButton}
              onClick={() => changeZoom(-1)}
              disabled={!pdfDocument || zoomMultiplier <= MIN_ZOOM}
              aria-label="Alejar página"
            >
              <ZoomOutIcon />
            </button>
            <span aria-live="polite">
              {fitWidth ? "Ancho" : `${Math.round(zoomMultiplier * 100)} %`}
            </span>
            <button
              type="button"
              className={styles.compactButton}
              onClick={() => changeZoom(1)}
              disabled={!pdfDocument || zoomMultiplier >= MAX_ZOOM}
              aria-label="Acercar página"
            >
              <ZoomInIcon />
            </button>
            <button
              type="button"
              className={styles.fitButton}
              onClick={fitPageWidth}
              disabled={!pdfDocument}
              aria-pressed={fitWidth}
            >
              Ajustar ancho
            </button>
          </div>

          <a
            className={`source-link ${styles.openPdfLink}`}
            href={nativePdfUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Abrir ${book.title} como PDF en una pestaña nueva`}
          >
            Abrir PDF
            <ExternalIcon />
          </a>
        </div>
      </header>

      {nativeFallback ? (
        <div className={styles.nativeFallback}>
          <div className={styles.fallbackNotice} role="status">
            <div>
              <strong>Usando el visor del navegador</strong>
              <span>
                El visor interactivo no pudo continuar. Puedes seguir leyendo
                aquí o volver a intentarlo.
              </span>
            </div>
            <button type="button" onClick={retryPdfJs}>
              Reintentar visor interactivo
            </button>
          </div>
          <iframe
            key={page}
            className={styles.nativeFrame}
            src={nativePdfUrl}
            title={`${book.title}, página ${page}, visor de respaldo`}
          />
        </div>
      ) : (
        <div
          className={styles.viewerViewport}
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={handleViewerKeys}
          aria-label={`Página ${page} de ${book.pages}. Usa las flechas izquierda y derecha para navegar.`}
        >
          <div
            className={styles.pageSurface}
            style={pageStyle}
            role="region"
            aria-label={`Contenido de la página ${page}`}
          >
            <canvas
              className={styles.canvas}
              ref={canvasRef}
              aria-hidden={hasAccessibleText}
              role={hasAccessibleText ? undefined : "img"}
              aria-label={
                hasAccessibleText
                  ? undefined
                  : `Representación visual de la página ${page}`
              }
            />
            <div
              className={styles.textLayer}
              ref={textLayerRef}
              role="group"
              aria-label={`Texto seleccionable de la página ${page}`}
              aria-hidden={!hasPositionedText}
            />
            {viewerStatus === "ready" && renderedPage === page ? (
              <ExerciseOverlayLayer
                exercises={exercises}
                page={page}
                selected={selected}
                overlayState={overlayState}
                onExerciseSelect={onExerciseSelect}
              />
            ) : null}
            {accessiblePageText ? (
              <p className={styles.screenReaderText}>
                {accessiblePageText}
              </p>
            ) : null}
          </div>

          {viewerStatus === "loading-document" ||
          viewerStatus === "rendering-page" ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              {statusMessage}
            </div>
          ) : null}

          {viewerStatus === "error" ? (
            <div className={styles.errorState} role="alert">
              <strong>No se pudo mostrar la página</strong>
              <p>{viewerError}</p>
              <div>
                <button type="button" onClick={retryPdfJs}>
                  Volver a intentar
                </button>
                <a href={nativePdfUrl} target="_blank" rel="noreferrer">
                  Abrir PDF
                </a>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <p className={`pdf-attribution ${styles.attribution}`}>
        {book.attribution}. {book.edition}.{" "}
        <a href={book.sourcePageUrl} target="_blank" rel="noreferrer">
          Fuente oficial
        </a>
        {" · "}
        <a href={book.licenseUrl} target="_blank" rel="noreferrer">
          {book.licenseName}
        </a>
        .
      </p>
    </section>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M7 3.5h7l4 4v13H7v-17Z" />
      <path d="M14 3.5v4h4M10 12h5M10 15.5h5" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      className={direction === "right" ? "flip-x" : undefined}
      viewBox="0 0 20 20"
    >
      <path d="m12 5-5 5 5 5" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2 17 17M6 8.5h5" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2 17 17M6 8.5h5M8.5 6v5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M8 5H5v10h10v-3M11 5h4v4M9 11l6-6" />
    </svg>
  );
}
