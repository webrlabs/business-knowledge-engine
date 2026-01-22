'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { StagedEntity } from '@/lib/staging-store';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  entities: StagedEntity[];
  selectedEntityId: string | null;
  onEntityClick: (entityId: string) => void;
  onScrollToEntity?: (entityId: string) => void;
  scrollToEntityId?: string | null;
}

const entityColors: Record<string, string> = {
  Process: 'rgba(59, 130, 246, 0.3)',
  Task: 'rgba(16, 185, 129, 0.3)',
  Role: 'rgba(245, 158, 11, 0.3)',
  System: 'rgba(139, 92, 246, 0.3)',
  DataAsset: 'rgba(236, 72, 153, 0.3)',
  Form: 'rgba(6, 182, 212, 0.3)',
  Policy: 'rgba(239, 68, 68, 0.3)',
  Procedure: 'rgba(20, 184, 166, 0.3)',
  Directive: 'rgba(249, 115, 22, 0.3)',
  Guide: 'rgba(99, 102, 241, 0.3)',
};

export default function PDFViewer({
  url,
  entities,
  selectedEntityId,
  onEntityClick,
  scrollToEntityId,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setIsLoading(false);
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setError('Failed to load PDF document');
    setIsLoading(false);
  }, []);

  // Scroll to entity when selected from graph
  useEffect(() => {
    if (!scrollToEntityId) return;

    const entity = entities.find((e) => e.id === scrollToEntityId || e.stagedId === scrollToEntityId);
    if (entity?.pdfLocation?.page) {
      const pageNum = entity.pdfLocation.page;
      setCurrentPage(pageNum);

      // Scroll to the page
      setTimeout(() => {
        const pageElement = pageRefs.current.get(pageNum);
        if (pageElement && containerRef.current) {
          pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [scrollToEntityId, entities]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3.0));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const handleFitWidth = () => setScale(1.0);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, numPages));

  const handlePageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const page = parseInt(e.target.value, 10);
    if (page >= 1 && page <= numPages) {
      setCurrentPage(page);
    }
  };

  // Get entities for a specific page
  const getEntitiesForPage = (pageNum: number) => {
    return entities.filter(
      (e) => e.pdfLocation?.page === pageNum && e.status !== 'deleted'
    );
  };

  // Render entity highlight overlays
  const renderEntityHighlights = (pageNum: number) => {
    const pageEntities = getEntitiesForPage(pageNum);

    return pageEntities.map((entity) => {
      const loc = entity.pdfLocation;
      if (!loc) return null;

      const isSelected = entity.id === selectedEntityId || entity.stagedId === selectedEntityId;
      const bgColor = entityColors[entity.type] || 'rgba(100, 100, 100, 0.3)';

      return (
        <div
          key={entity.id}
          className={`absolute cursor-pointer transition-all ${
            isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : 'hover:ring-2 hover:ring-yellow-400'
          }`}
          style={{
            left: `${loc.x}%`,
            top: `${loc.y}%`,
            width: `${loc.width}%`,
            height: `${loc.height}%`,
            backgroundColor: bgColor,
            borderRadius: '2px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onEntityClick(entity.id);
          }}
          title={`${entity.name} (${entity.type})`}
        />
      );
    });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-50 dark:bg-gray-800 rounded-lg p-8">
        <svg
          className="w-16 h-16 text-red-400 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-gray-600 dark:text-gray-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Page Navigation */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Previous page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center space-x-1 text-sm">
            <input
              type="number"
              min={1}
              max={numPages}
              value={currentPage}
              onChange={handlePageChange}
              className="w-12 px-2 py-1 text-center border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
            <span className="text-gray-600 dark:text-gray-400">/ {numPages}</span>
          </div>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Next page"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Zoom out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 w-16 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Zoom in"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={handleFitWidth}
            className="px-2 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Fit to width"
          >
            Fit
          </button>
        </div>
      </div>

      {/* PDF Document */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900"
      >
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
          className="flex flex-col items-center py-4"
        >
          {Array.from({ length: numPages }, (_, index) => {
            const pageNum = index + 1;
            // Only render current page and adjacent pages for performance
            if (Math.abs(pageNum - currentPage) > 1) return null;

            return (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) pageRefs.current.set(pageNum, el);
                }}
                className="relative mb-4 shadow-lg"
                style={{ display: pageNum === currentPage ? 'block' : 'none' }}
              >
                <Page
                  pageNumber={pageNum}
                  scale={scale}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="bg-white"
                />
                {/* Entity highlight overlays */}
                <div className="absolute inset-0 pointer-events-auto">
                  {renderEntityHighlights(pageNum)}
                </div>
              </div>
            );
          })}
        </Document>
      </div>

      {/* Entity Legend */}
      <div className="px-4 py-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(entityColors).slice(0, 5).map(([type, color]) => (
            <div key={type} className="flex items-center space-x-1">
              <div
                className="w-3 h-3 rounded"
                style={{ backgroundColor: color.replace('0.3', '0.6') }}
              />
              <span className="text-gray-600 dark:text-gray-400">{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
