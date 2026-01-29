'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGraphStore } from '@/lib/graph-store';

interface ContextMenuProps {
  position: { x: number; y: number };
  nodeName: string;
  nodeId: string;
  nodeType: string;
  onClose: () => void;
  onViewDetails: () => void;
  onFocus: () => void;
  onFindPathsFrom: () => void;
  onShowUpstreamImpact?: () => void;
  onShowDownstreamImpact?: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
  destructive?: boolean;
}

function MenuItem({ icon, label, onClick, shortcut, destructive }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
        destructive ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'
      }`}
    >
      <span className="w-4 h-4 flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && (
        <span className="text-xs text-gray-400 dark:text-gray-500">{shortcut}</span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="border-t border-gray-200 dark:border-gray-700 my-1" />;
}

export default function ContextMenu({
  position,
  nodeName,
  nodeId,
  nodeType,
  onClose,
  onViewDetails,
  onFocus,
  onFindPathsFrom,
  onShowUpstreamImpact,
  onShowDownstreamImpact,
}: ContextMenuProps) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const { setPathFromNode, setShowPathFinder } = useGraphStore();

  // Close menu on outside click or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      if (position.x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }
      if (position.y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [position]);

  const handleAskAI = () => {
    const query = `Tell me about the ${nodeType} "${nodeName}". What are its dependencies and relationships?`;
    router.push(`/dashboard/query?q=${encodeURIComponent(query)}&context=graph&entityId=${nodeId}`);
    onClose();
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(nodeName);
    onClose();
  };

  const handleFindPathsFrom = () => {
    setPathFromNode(nodeName);
    setShowPathFinder(true);
    onFindPathsFrom();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[200px]"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={nodeName}>
          {nodeName}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{nodeType}</p>
      </div>

      {/* Menu Items */}
      <div className="py-1">
        <MenuItem
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          }
          label="View Details"
          onClick={() => {
            onViewDetails();
            onClose();
          }}
        />

        <MenuItem
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
              />
            </svg>
          }
          label="Focus on Node"
          onClick={() => {
            onFocus();
            onClose();
          }}
          shortcut="F"
        />

        <MenuDivider />

        <MenuItem
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          }
          label="Find Paths From Here..."
          onClick={handleFindPathsFrom}
          shortcut="P"
        />

        {onShowUpstreamImpact && (
          <MenuItem
            icon={
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 11l5-5m0 0l5 5m-5-5v12"
                />
              </svg>
            }
            label="Show Upstream Impact"
            onClick={() => {
              onShowUpstreamImpact();
              onClose();
            }}
          />
        )}

        {onShowDownstreamImpact && (
          <MenuItem
            icon={
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 13l-5 5m0 0l-5-5m5 5V6"
                />
              </svg>
            }
            label="Show Downstream Impact"
            onClick={() => {
              onShowDownstreamImpact();
              onClose();
            }}
          />
        )}

        <MenuDivider />

        <MenuItem
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          }
          label="Ask AI About This"
          onClick={handleAskAI}
        />

        <MenuDivider />

        <MenuItem
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          }
          label="Copy Node Name"
          onClick={handleCopyName}
        />
      </div>
    </div>
  );
}
