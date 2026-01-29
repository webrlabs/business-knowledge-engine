'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGraphStore, GraphNode, PathResult } from '@/lib/graph-store';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { NODE_COLORS, getNodeColor } from '@/lib/graph-constants';

interface PathFinderPanelProps {
  nodes: GraphNode[];
  onHighlightPath: (nodeIds: string[]) => void;
  onClearHighlight: () => void;
}


interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (node: GraphNode) => void;
  nodes: GraphNode[];
  placeholder: string;
  label: string;
}

function AutocompleteInput({
  value,
  onChange,
  onSelect,
  nodes,
  placeholder,
  label,
}: AutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filteredNodes = value.trim()
    ? nodes.filter(
        (node) =>
          node.label.toLowerCase().includes(value.toLowerCase()) ||
          node.type.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 20)
    : [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filteredNodes.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) =>
          prev < filteredNodes.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filteredNodes.length) {
          onSelect(filteredNodes[highlightIndex]);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
        {label}
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
      />
      {isOpen && filteredNodes.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto"
        >
          {filteredNodes.map((node, index) => (
            <li
              key={node.id}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
                index === highlightIndex
                  ? 'bg-blue-50 dark:bg-blue-900/50'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={() => {
                onSelect(node);
                setIsOpen(false);
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: NODE_COLORS[node.type] || '#64748B' }}
              />
              <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
                {node.label}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{node.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PathResultItem({
  result,
  index,
  isSelected,
  onSelect,
}: {
  result: PathResult;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full p-3 rounded-lg border transition-colors text-left ${
        isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Path {index + 1}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {result.pathDetails.length} steps
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {result.pathDetails.map((node, nodeIndex) => (
          <div key={node.id} className="flex items-center gap-1">
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
              style={{
                backgroundColor: `${NODE_COLORS[node.type] || '#64748B'}20`,
                color: NODE_COLORS[node.type] || '#64748B',
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: NODE_COLORS[node.type] || '#64748B' }}
              />
              <span className="truncate max-w-[100px]" title={node.name}>
                {node.name}
              </span>
            </div>
            {nodeIndex < result.pathDetails.length - 1 && (
              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </button>
  );
}

export default function PathFinderPanel({
  nodes,
  onHighlightPath,
  onClearHighlight,
}: PathFinderPanelProps) {
  const authFetch = useAuthFetch();
  const {
    pathFromNode,
    pathToNode,
    pathResults,
    pathFindingLoading,
    highlightedPath,
    setPathFromNode,
    setPathToNode,
    findPath,
    setHighlightedPath,
    clearPathResults,
    setShowPathFinder,
  } = useGraphStore();

  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [maxSteps, setMaxSteps] = useState(4);
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);

  // Sync inputs with store
  useEffect(() => {
    if (pathFromNode) setFromInput(pathFromNode);
  }, [pathFromNode]);

  useEffect(() => {
    if (pathToNode) setToInput(pathToNode);
  }, [pathToNode]);

  const handleFromSelect = (node: GraphNode) => {
    setFromInput(node.label);
    setPathFromNode(node.label);
  };

  const handleToSelect = (node: GraphNode) => {
    setToInput(node.label);
    setPathToNode(node.label);
  };

  const handleFindPath = useCallback(async () => {
    if (!fromInput.trim() || !toInput.trim()) return;
    setSelectedPathIndex(0);
    await findPath(fromInput, toInput, maxSteps, authFetch);
  }, [fromInput, toInput, maxSteps, authFetch, findPath]);

  const handleSelectPath = (index: number) => {
    setSelectedPathIndex(index);
    if (pathResults[index]) {
      const nodeIds = pathResults[index].pathDetails.map((n) => n.id);
      setHighlightedPath(nodeIds);
      onHighlightPath(nodeIds);
    }
  };

  const handleClear = () => {
    setFromInput('');
    setToInput('');
    clearPathResults();
    onClearHighlight();
  };

  const handleClose = () => {
    setShowPathFinder(false);
    onClearHighlight();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-sm w-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <h4 className="font-semibold text-gray-900 dark:text-white">Find Path</h4>
        </div>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* From Node */}
        <AutocompleteInput
          value={fromInput}
          onChange={setFromInput}
          onSelect={handleFromSelect}
          nodes={nodes}
          placeholder="Start typing to search..."
          label="From Node"
        />

        {/* To Node */}
        <AutocompleteInput
          value={toInput}
          onChange={setToInput}
          onSelect={handleToSelect}
          nodes={nodes}
          placeholder="Start typing to search..."
          label="To Node"
        />

        {/* Max Steps */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
            Max Steps: {maxSteps}
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={maxSteps}
            onChange={(e) => setMaxSteps(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleFindPath}
            disabled={!fromInput.trim() || !toInput.trim() || pathFindingLoading}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {pathFindingLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                Finding...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Find Path
              </>
            )}
          </button>
          {(pathResults.length > 0 || fromInput || toInput) && (
            <button
              onClick={handleClear}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Results */}
        {pathResults.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
              {pathResults.length} Path{pathResults.length > 1 ? 's' : ''} Found
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pathResults.map((result, index) => (
                <PathResultItem
                  key={index}
                  result={result}
                  index={index}
                  isSelected={index === selectedPathIndex}
                  onSelect={() => handleSelectPath(index)}
                />
              ))}
            </div>
          </div>
        )}

        {/* No Results */}
        {pathResults.length === 0 && !pathFindingLoading && fromInput && toInput && highlightedPath.length === 0 && (
          <div className="text-center py-4">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Click "Find Path" to search for connections
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
