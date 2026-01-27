import { render, screen, fireEvent } from '@testing-library/react';
import CommunityPanel from '../CommunityPanel';
import { Community, CommunityMember } from '../CommunityVisualization';

describe('CommunityPanel', () => {
  const mockCommunity: Community = {
    communityId: '1',
    title: 'Business Process Core',
    summary: 'This community contains the core business processes and their related tasks.',
    memberCount: 15,
    dominantType: 'Process',
    typeCounts: {
      Process: 8,
      Task: 5,
      Role: 2,
    },
    relationshipCount: 22,
    keyEntities: ['Order Processing', 'Invoice Generation', 'Customer Onboarding'],
    members: [
      { id: 'entity1', name: 'Order Processing', type: 'Process' },
      { id: 'entity2', name: 'Invoice Generation', type: 'Process' },
      { id: 'entity3', name: 'Review Order', type: 'Task' },
      { id: 'entity4', name: 'Process Manager', type: 'Role' },
    ],
    generatedAt: '2026-01-25T10:00:00Z',
  };

  describe('Empty state', () => {
    it('renders empty state when no community is selected', () => {
      render(<CommunityPanel community={null} />);

      expect(screen.getByText('Select a community to view details')).toBeInTheDocument();
    });

    it('shows placeholder icon in empty state', () => {
      render(<CommunityPanel community={null} />);

      const svg = document.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('Community display', () => {
    it('renders community title', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('Business Process Core')).toBeInTheDocument();
    });

    it('renders fallback title when title is not provided', () => {
      const communityWithoutTitle: Community = {
        ...mockCommunity,
        title: undefined,
      };
      render(<CommunityPanel community={communityWithoutTitle} />);

      expect(screen.getByText('Community 1')).toBeInTheDocument();
    });

    it('renders community summary', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(
        screen.getByText('This community contains the core business processes and their related tasks.')
      ).toBeInTheDocument();
    });

    it('renders member count', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('Members')).toBeInTheDocument();
    });

    it('renders relationship count', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('22')).toBeInTheDocument();
      expect(screen.getByText('Relationships')).toBeInTheDocument();
    });

    it('renders dominant type with color indicator', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('Dominant Entity Type')).toBeInTheDocument();
      // Process appears multiple times (dominant type, type distribution, members)
      expect(screen.getAllByText('Process').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Type distribution', () => {
    it('renders type distribution section', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('Type Distribution')).toBeInTheDocument();
    });

    it('shows all entity types with counts', () => {
      render(<CommunityPanel community={mockCommunity} />);

      // Type counts are displayed
      const processCount = screen.getByText('8');
      const taskCount = screen.getByText('5');
      const roleCount = screen.getByText('2');

      expect(processCount).toBeInTheDocument();
      expect(taskCount).toBeInTheDocument();
      expect(roleCount).toBeInTheDocument();
    });

    it('does not render type distribution when typeCounts is empty', () => {
      const communityWithoutTypes: Community = {
        ...mockCommunity,
        typeCounts: {},
      };
      render(<CommunityPanel community={communityWithoutTypes} />);

      expect(screen.queryByText('Type Distribution')).not.toBeInTheDocument();
    });
  });

  describe('Key entities', () => {
    it('renders key entities section', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText('Key Entities')).toBeInTheDocument();
    });

    it('shows all key entities as tags', () => {
      render(<CommunityPanel community={mockCommunity} />);

      // Key entities also appear in members list, so use getAllByText
      expect(screen.getAllByText('Order Processing').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Invoice Generation').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Customer Onboarding')).toBeInTheDocument(); // Only in key entities
    });

    it('does not render key entities when none provided', () => {
      const communityWithoutKeyEntities: Community = {
        ...mockCommunity,
        keyEntities: [],
      };
      render(<CommunityPanel community={communityWithoutKeyEntities} />);

      expect(screen.queryByText('Key Entities')).not.toBeInTheDocument();
    });
  });

  describe('Members list', () => {
    it('renders members section with count', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText(/Members \(4\)/)).toBeInTheDocument();
    });

    it('renders all members as clickable buttons', () => {
      const onMemberClick = jest.fn();
      render(<CommunityPanel community={mockCommunity} onMemberClick={onMemberClick} />);

      // Each member should be a button
      const memberButtons = screen.getAllByRole('button');
      // Filter for member buttons (exclude close button if present)
      const memberItems = memberButtons.filter(
        (btn) =>
          btn.textContent?.includes('Order Processing') ||
          btn.textContent?.includes('Invoice Generation') ||
          btn.textContent?.includes('Review Order') ||
          btn.textContent?.includes('Process Manager')
      );

      expect(memberItems.length).toBe(4);
    });

    it('calls onMemberClick when member is clicked', () => {
      const onMemberClick = jest.fn();
      render(<CommunityPanel community={mockCommunity} onMemberClick={onMemberClick} />);

      // Find and click a member button
      const memberButtons = screen.getAllByRole('button');
      const orderProcessingBtn = memberButtons.find((btn) =>
        btn.textContent?.includes('Review Order')
      );

      if (orderProcessingBtn) {
        fireEvent.click(orderProcessingBtn);
      }

      expect(onMemberClick).toHaveBeenCalledWith({
        id: 'entity3',
        name: 'Review Order',
        type: 'Task',
      });
    });

    it('does not render members section when no members', () => {
      const communityWithoutMembers: Community = {
        ...mockCommunity,
        members: [],
      };
      render(<CommunityPanel community={communityWithoutMembers} />);

      expect(screen.queryByText(/Members \(/)).not.toBeInTheDocument();
    });
  });

  describe('Generated at timestamp', () => {
    it('renders timestamp when provided', () => {
      render(<CommunityPanel community={mockCommunity} />);

      expect(screen.getByText(/Summary generated:/)).toBeInTheDocument();
    });

    it('does not render timestamp when not provided', () => {
      const communityWithoutTimestamp: Community = {
        ...mockCommunity,
        generatedAt: undefined,
      };
      render(<CommunityPanel community={communityWithoutTimestamp} />);

      expect(screen.queryByText(/Summary generated:/)).not.toBeInTheDocument();
    });
  });

  describe('Close button', () => {
    it('renders close button when onClose is provided', () => {
      const onClose = jest.fn();
      render(<CommunityPanel community={mockCommunity} onClose={onClose} />);

      const closeButton = screen.getAllByRole('button')[0]; // First button should be close
      expect(closeButton).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = jest.fn();
      render(<CommunityPanel community={mockCommunity} onClose={onClose} />);

      // Find the close button (has X icon)
      const buttons = screen.getAllByRole('button');
      const closeButton = buttons.find((btn) => {
        const svg = btn.querySelector('svg');
        return svg && btn.classList.contains('text-gray-400');
      });

      if (closeButton) {
        fireEvent.click(closeButton);
      }

      expect(onClose).toHaveBeenCalled();
    });

    it('does not render close button when onClose is not provided', () => {
      render(<CommunityPanel community={mockCommunity} />);

      // Should not have a close button in header (only member buttons)
      const header = document.querySelector('.px-6.py-4.border-b');
      const closeButtonInHeader = header?.querySelector('button');

      expect(closeButtonInHeader).not.toBeInTheDocument();
    });
  });

  describe('Styling and layout', () => {
    it('renders with proper container styling', () => {
      render(<CommunityPanel community={mockCommunity} />);

      const container = document.querySelector('.rounded-lg.shadow-md');
      expect(container).toBeInTheDocument();
    });

    it('displays progress bars for type distribution', () => {
      render(<CommunityPanel community={mockCommunity} />);

      // Progress bars are divs with rounded-full class
      const progressBars = document.querySelectorAll('.bg-gray-200.dark\\:bg-gray-700.rounded-full');
      expect(progressBars.length).toBeGreaterThan(0);
    });

    it('shows color indicators for entity types', () => {
      render(<CommunityPanel community={mockCommunity} />);

      // Color indicators are small rounded divs
      const colorDots = document.querySelectorAll('.rounded-full');
      expect(colorDots.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('handles community with minimal data', () => {
      const minimalCommunity: Community = {
        communityId: '99',
        memberCount: 0,
      };
      render(<CommunityPanel community={minimalCommunity} />);

      expect(screen.getByText('Community 99')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles numeric communityId', () => {
      const numericIdCommunity: Community = {
        communityId: 42,
        title: 'Numeric ID Community',
        memberCount: 5,
      };
      render(<CommunityPanel community={numericIdCommunity} />);

      expect(screen.getByText('Numeric ID Community')).toBeInTheDocument();
    });

    it('handles long summary text', () => {
      const longSummaryCommunity: Community = {
        ...mockCommunity,
        summary: 'A'.repeat(500),
      };
      render(<CommunityPanel community={longSummaryCommunity} />);

      expect(screen.getByText('A'.repeat(500))).toBeInTheDocument();
    });

    it('handles many key entities', () => {
      const manyEntitiesCommunity: Community = {
        ...mockCommunity,
        keyEntities: Array(20)
          .fill(null)
          .map((_, i) => `Entity ${i + 1}`),
      };
      render(<CommunityPanel community={manyEntitiesCommunity} />);

      expect(screen.getByText('Entity 1')).toBeInTheDocument();
      expect(screen.getByText('Entity 20')).toBeInTheDocument();
    });
  });
});
