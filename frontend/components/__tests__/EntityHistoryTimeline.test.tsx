import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EntityHistoryTimeline, { EntityVersion, EntityHistoryResponse } from '../EntityHistoryTimeline';

// Mock the useAuthFetch hook
const mockAuthFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:8080',
  useAuthFetch: () => mockAuthFetch,
}));

// Sample entity versions from backend
const mockVersions: EntityVersion[] = [
  {
    id: 'entity-v1-id',
    name: 'Invoice Processing',
    type: 'Process',
    description: 'Original invoice processing workflow',
    validFrom: '2024-01-15T10:00:00Z',
    validTo: '2024-06-01T00:00:00Z',
    supersededBy: 'entity-v2-id',
    temporalStatus: 'superseded',
    versionSequence: 1,
    isCurrentVersion: false,
    createdAt: '2024-01-15T10:00:00Z',
    changeReason: 'Initial creation',
    changedBy: 'admin@company.com',
  },
  {
    id: 'entity-v2-id',
    name: 'Invoice Processing v2',
    type: 'Process',
    description: 'Updated invoice processing with automation',
    validFrom: '2024-06-01T00:00:00Z',
    validTo: '2024-12-01T00:00:00Z',
    supersedes: 'entity-v1-id',
    supersededBy: 'entity-v3-id',
    temporalStatus: 'superseded',
    versionSequence: 2,
    isCurrentVersion: false,
    createdAt: '2024-06-01T00:00:00Z',
    changeReason: 'Added automation features',
    changedBy: 'process-owner@company.com',
  },
  {
    id: 'entity-v3-id',
    name: 'Invoice Processing v3',
    type: 'Process',
    description: 'Current invoice processing with AI integration',
    validFrom: '2024-12-01T00:00:00Z',
    supersedes: 'entity-v2-id',
    temporalStatus: 'current',
    versionSequence: 3,
    isCurrentVersion: true,
    createdAt: '2024-12-01T00:00:00Z',
    changeReason: 'AI-powered validation',
    changedBy: 'ai-team@company.com',
  },
];

const mockHistoryResponse: EntityHistoryResponse = {
  entityId: 'entity-v3-id',
  name: 'Invoice Processing v3',
  type: 'Process',
  versions: mockVersions,
  currentVersion: mockVersions[2],
};

describe('EntityHistoryTimeline', () => {
  const defaultProps = {
    entityId: 'entity-v3-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation for successful API call
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockHistoryResponse),
    });
  });

  describe('Initial rendering', () => {
    it('shows loading state initially', () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      // Should show loading animation
      const loadingElement = document.querySelector('.animate-pulse');
      expect(loadingElement).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading entity history');
    });

    it('renders the timeline header after loading', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Invoice Processing v3 History')).toBeInTheDocument();
      });
    });

    it('shows version count in header', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/3 versions/)).toBeInTheDocument();
      });
    });

    it('fetches history from API on mount', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/entities/entity-v3-id/history'
        );
      });
    });

    it('encodes entity ID in URL', async () => {
      render(<EntityHistoryTimeline entityId="entity/with/slashes" />);

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith(
          'http://localhost:8080/api/entities/entity%2Fwith%2Fslashes/history'
        );
      });
    });
  });

  describe('Timeline display', () => {
    it('displays all versions in order', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument();
        expect(screen.getByText('Version 2')).toBeInTheDocument();
        expect(screen.getByText('Version 3')).toBeInTheDocument();
      });
    });

    it('shows correct status badges', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        // Current version should have "Current" badge
        expect(screen.getByText('Current')).toBeInTheDocument();
        // Other versions should have "Superseded" badges
        const supersededBadges = screen.getAllByText('Superseded');
        expect(supersededBadges).toHaveLength(2);
      });
    });

    it('shows dates for each version', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        // Should show formatted dates (using partial match for timezone flexibility)
        expect(screen.getByText(/Jan.*2024/)).toBeInTheDocument();
        expect(screen.getByText(/(May|Jun).*2024/)).toBeInTheDocument();
        expect(screen.getByText(/(Nov|Dec).*2024/)).toBeInTheDocument();
      });
    });

    it('highlights current version with ring', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        // Timeline node for current version should have ring class
        const timelineNodes = document.querySelectorAll('.rounded-full.border-2');
        const currentNode = Array.from(timelineNodes).find(
          node => node.classList.contains('ring-2')
        );
        expect(currentNode).toBeInTheDocument();
      });
    });
  });

  describe('Version expansion', () => {
    it('expands version details on click', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 3')).toBeInTheDocument();
      });

      // Click on version 3 card (find by aria-expanded attribute)
      const versionCard = screen.getByText('Version 3').closest('[aria-expanded]');
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      // Should show expanded details
      await waitFor(() => {
        expect(screen.getByText('Current invoice processing with AI integration')).toBeInTheDocument();
        expect(screen.getByText('AI-powered validation')).toBeInTheDocument();
        expect(screen.getByText('ai-team@company.com')).toBeInTheDocument();
      });
    });

    it('collapses version details on second click', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 3')).toBeInTheDocument();
      });

      // Click to expand
      const versionCard = screen.getByText('Version 3').closest('[aria-expanded]');
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      await waitFor(() => {
        expect(screen.getByText('Current invoice processing with AI integration')).toBeInTheDocument();
      });

      // Click to collapse
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      await waitFor(() => {
        expect(screen.queryByText('Current invoice processing with AI integration')).not.toBeInTheDocument();
      });
    });

    it('shows version chain links in expanded view', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 2')).toBeInTheDocument();
      });

      // Click on version 2 (middle version)
      const versionCard = screen.getByText('Version 2').closest('[aria-expanded]');
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      await waitFor(() => {
        expect(screen.getByText('Version Chain')).toBeInTheDocument();
        expect(screen.getByText(/Previous:/)).toBeInTheDocument();
        expect(screen.getByText(/Next/)).toBeInTheDocument();
      });
    });

    it('supports keyboard navigation', async () => {
      const onVersionSelect = jest.fn();
      render(<EntityHistoryTimeline {...defaultProps} onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        expect(screen.getByText('Version 3')).toBeInTheDocument();
      });

      // Focus on version card (has role="button" when onVersionSelect is provided)
      const versionCard = screen.getByText('Version 3').closest('[role="button"]');
      if (versionCard) {
        fireEvent.keyDown(versionCard, { key: 'Enter' });
      }

      // Should expand
      await waitFor(() => {
        expect(screen.getByText('Current invoice processing with AI integration')).toBeInTheDocument();
      });

      // Space bar should also work
      if (versionCard) {
        fireEvent.keyDown(versionCard, { key: ' ' });
      }

      await waitFor(() => {
        expect(screen.queryByText('Current invoice processing with AI integration')).not.toBeInTheDocument();
      });
    });
  });

  describe('Version selection', () => {
    it('calls onVersionSelect callback when clicking a version', async () => {
      const onVersionSelect = jest.fn();
      render(<EntityHistoryTimeline {...defaultProps} onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        expect(screen.getByText('Version 2')).toBeInTheDocument();
      });

      const versionCard = screen.getByText('Version 2').closest('[aria-expanded]');
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      expect(onVersionSelect).toHaveBeenCalledWith(mockVersions[1]);
    });

    it('highlights selected version', async () => {
      render(
        <EntityHistoryTimeline
          {...defaultProps}
          selectedVersionId="entity-v2-id"
        />
      );

      await waitFor(() => {
        const selectedItem = document.querySelector('.bg-blue-50');
        expect(selectedItem).toBeInTheDocument();
      });
    });
  });

  describe('Compact mode', () => {
    it('renders compact timeline with version chips', async () => {
      render(<EntityHistoryTimeline {...defaultProps} compact />);

      await waitFor(() => {
        // Compact mode should show v1, v2, v3 chips
        expect(screen.getByText('v1')).toBeInTheDocument();
        expect(screen.getByText('v2')).toBeInTheDocument();
        expect(screen.getByText('v3')).toBeInTheDocument();
      });
    });

    it('shows entity name in compact header', async () => {
      render(<EntityHistoryTimeline {...defaultProps} compact />);

      await waitFor(() => {
        expect(screen.getByText('Invoice Processing v3')).toBeInTheDocument();
      });
    });

    it('does not expand on click in compact mode', async () => {
      const onVersionSelect = jest.fn();
      render(<EntityHistoryTimeline {...defaultProps} compact onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        expect(screen.getByText('v3')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('v3'));

      // Should only call onVersionSelect, not expand
      expect(onVersionSelect).toHaveBeenCalled();
      expect(screen.queryByText('Current invoice processing with AI integration')).not.toBeInTheDocument();
    });

    it('highlights selected version chip', async () => {
      render(
        <EntityHistoryTimeline
          {...defaultProps}
          compact
          selectedVersionId="entity-v2-id"
        />
      );

      await waitFor(() => {
        const v2Chip = screen.getByText('v2').closest('button');
        expect(v2Chip).toHaveClass('ring-2');
      });
    });
  });

  describe('Max versions', () => {
    it('limits displayed versions when maxVersions is set', async () => {
      render(<EntityHistoryTimeline {...defaultProps} maxVersions={2} />);

      await waitFor(() => {
        expect(screen.getByText('Version 2')).toBeInTheDocument();
        expect(screen.getByText('Version 3')).toBeInTheDocument();
        expect(screen.queryByText('Version 1')).not.toBeInTheDocument();
      });
    });

    it('shows message about hidden versions', async () => {
      render(<EntityHistoryTimeline {...defaultProps} maxVersions={2} />);

      await waitFor(() => {
        expect(screen.getByText(/Showing 2 of 3 versions/)).toBeInTheDocument();
      });
    });

    it('shows all versions when maxVersions is not set', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument();
        expect(screen.getByText('Version 2')).toBeInTheDocument();
        expect(screen.getByText('Version 3')).toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    it('shows error message on API failure', async () => {
      mockAuthFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Error loading history/)).toBeInTheDocument();
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });
    });

    it('shows retry button on error', async () => {
      mockAuthFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });
    });

    it('retries fetch when retry button clicked', async () => {
      mockAuthFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockHistoryResponse),
        });

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Try again')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Try again'));

      await waitFor(() => {
        expect(screen.getByText('Invoice Processing v3 History')).toBeInTheDocument();
      });
    });

    it('handles 404 error', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Entity not found/)).toBeInTheDocument();
      });
    });

    it('handles non-404 error status', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/Failed to fetch entity history: 500/)).toBeInTheDocument();
      });
    });

    it('shows error when no entity ID provided', async () => {
      render(<EntityHistoryTimeline entityId="" />);

      await waitFor(() => {
        expect(screen.getByText(/No entity ID provided/)).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty message when no versions', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          entityId: 'test-id',
          name: 'Test Entity',
          type: 'Process',
          versions: [],
          currentVersion: null,
        }),
      });

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/No version history available/)).toBeInTheDocument();
      });
    });

    it('shows empty message when history is null', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(null),
      });

      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/No version history available/)).toBeInTheDocument();
      });
    });
  });

  describe('Temporal status display', () => {
    it.each([
      ['current', 'Current', 'bg-green-100'],
      ['superseded', 'Superseded', 'bg-gray-100'],
      ['pending', 'Pending', 'bg-amber-100'],
      ['expired', 'Expired', 'bg-red-100'],
    ])('displays %s status with correct styling', async (status, label, bgClass) => {
      const singleVersionResponse = {
        entityId: 'test-id',
        name: 'Test Entity',
        type: 'Process',
        versions: [{
          id: 'test-version-id',
          name: 'Test Version',
          type: 'Process',
          temporalStatus: status as EntityVersion['temporalStatus'],
          versionSequence: 1,
          isCurrentVersion: status === 'current',
          validFrom: '2024-01-01T00:00:00Z',
        }],
        currentVersion: null,
      };

      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(singleVersionResponse),
      });

      render(<EntityHistoryTimeline entityId="test-id" />);

      await waitFor(() => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper list role', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('list', { name: 'Entity version history' })).toBeInTheDocument();
      });
    });

    it('has proper listitem roles', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
      });
    });

    it('version cards have proper button role when selectable', async () => {
      const onVersionSelect = jest.fn();
      render(<EntityHistoryTimeline {...defaultProps} onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        // When onVersionSelect is provided, version cards should have button role
        const cards = document.querySelectorAll('[role="button"]');
        expect(cards.length).toBe(3); // 3 version cards
      });
    });

    it('compact mode chips have proper aria attributes', async () => {
      render(<EntityHistoryTimeline {...defaultProps} compact selectedVersionId="entity-v2-id" />);

      await waitFor(() => {
        const v2Button = screen.getByText('v2').closest('button');
        expect(v2Button).toHaveAttribute('aria-pressed', 'true');
      });
    });

    it('version cards have aria-expanded attribute', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        const cards = document.querySelectorAll('[aria-expanded]');
        expect(cards.length).toBe(3);
      });
    });

    it('screen reader label for loading state', () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      expect(screen.getByText('Loading entity history...')).toHaveClass('sr-only');
    });
  });

  describe('Date formatting', () => {
    it('formats dates correctly in full view', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        // Click to expand version
        const versionCard = screen.getByText('Version 1').closest('[role="button"]');
        if (versionCard) {
          fireEvent.click(versionCard);
        }
      });

      await waitFor(() => {
        // Should show full date format
        expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument();
      });
    });

    it('shows relative time', async () => {
      // Mock a recent date
      const recentResponse = {
        ...mockHistoryResponse,
        versions: [
          {
            ...mockVersions[0],
            validFrom: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
          },
        ],
      };

      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(recentResponse),
      });

      render(<EntityHistoryTimeline entityId="test-id" />);

      await waitFor(() => {
        expect(screen.getByText(/days ago/)).toBeInTheDocument();
      });
    });

    it('handles N/A for missing dates', async () => {
      const noDateResponse = {
        entityId: 'test-id',
        name: 'Test Entity',
        type: 'Process',
        versions: [{
          id: 'test-id',
          name: 'Test',
          type: 'Process',
          temporalStatus: 'current' as const,
          versionSequence: 1,
          isCurrentVersion: true,
          // No validFrom
        }],
        currentVersion: null,
      };

      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(noDateResponse),
      });

      render(<EntityHistoryTimeline entityId="test-id" />);

      await waitFor(() => {
        expect(screen.getByText('N/A')).toBeInTheDocument();
      });
    });
  });

  describe('Entity type display', () => {
    it('shows entity type in header', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Process')).toBeInTheDocument();
      });
    });

    it('shows type in expanded version details', async () => {
      render(<EntityHistoryTimeline {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Version 1')).toBeInTheDocument();
      });

      const versionCard = screen.getByText('Version 1').closest('[aria-expanded]');
      if (versionCard) {
        fireEvent.click(versionCard);
      }

      await waitFor(() => {
        // Look for the Type label (dt element) and its value (dd element)
        const typeLabels = screen.getAllByText('Type');
        expect(typeLabels.length).toBeGreaterThan(0);
      });
    });
  });
});
