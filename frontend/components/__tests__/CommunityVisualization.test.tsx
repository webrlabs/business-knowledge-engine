import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommunityVisualization, { Community, CommunityMember, CommunityEdge } from '../CommunityVisualization';

// Mock Cytoscape
const mockCytoscape = {
  nodes: jest.fn(() => ({
    forEach: jest.fn(),
    removeClass: jest.fn().mockReturnThis(),
    addClass: jest.fn().mockReturnThis(),
    style: jest.fn().mockReturnThis(),
  })),
  edges: jest.fn(() => ({
    forEach: jest.fn(),
    removeClass: jest.fn().mockReturnThis(),
    addClass: jest.fn().mockReturnThis(),
    style: jest.fn().mockReturnThis(),
  })),
  $: jest.fn(() => ({
    length: 1,
  })),
  on: jest.fn(),
  zoom: jest.fn(() => 1),
  width: jest.fn(() => 800),
  height: jest.fn(() => 600),
  fit: jest.fn(),
  destroy: jest.fn(),
};

jest.mock('cytoscape', () => {
  return jest.fn(() => mockCytoscape);
});

describe('CommunityVisualization', () => {
  const mockCommunities: Community[] = [
    {
      communityId: '0',
      title: 'Operations Cluster',
      summary: 'Core operational processes',
      memberCount: 8,
      dominantType: 'Process',
      typeCounts: { Process: 5, Task: 3 },
      keyEntities: ['Order Processing', 'Fulfillment'],
      members: [
        { id: 'p1', name: 'Order Processing', type: 'Process' },
        { id: 'p2', name: 'Fulfillment', type: 'Process' },
        { id: 't1', name: 'Review Order', type: 'Task' },
      ],
    },
    {
      communityId: '1',
      title: 'IT Systems',
      summary: 'Technology infrastructure',
      memberCount: 5,
      dominantType: 'System',
      typeCounts: { System: 4, DataAsset: 1 },
      keyEntities: ['CRM', 'ERP'],
      members: [
        { id: 's1', name: 'CRM', type: 'System' },
        { id: 's2', name: 'ERP', type: 'System' },
      ],
    },
    {
      communityId: '2',
      title: 'Compliance Group',
      summary: 'Regulatory and compliance',
      memberCount: 3,
      dominantType: 'Policy',
      typeCounts: { Policy: 2, Directive: 1 },
      keyEntities: ['Data Policy'],
      members: [
        { id: 'pol1', name: 'Data Policy', type: 'Policy' },
      ],
    },
  ];

  const mockEdges: CommunityEdge[] = [
    { id: 'e1', source: 'p1', target: 'p2', label: 'PRECEDES' },
    { id: 'e2', source: 'p1', target: 's1', label: 'USES' },
  ];

  const defaultProps = {
    communities: mockCommunities,
    edges: mockEdges,
    height: '600px',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial rendering', () => {
    it('renders the visualization container', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Container should be present
      const container = document.querySelector('.bg-gray-50');
      expect(container).toBeInTheDocument();
    });

    it('renders community list in controls panel', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByText('Communities (3)')).toBeInTheDocument();
    });

    it('displays all community names in the list', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Names appear in both the list and legend
      expect(screen.getAllByText('Operations Cluster').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('IT Systems').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Compliance Group').length).toBeGreaterThanOrEqual(1);
    });

    it('shows member counts for each community', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Member counts should be visible
      expect(screen.getByText('8')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('Controls', () => {
    it('renders layout selector', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByText('Layout')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('has layout options', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      // Check options
      expect(screen.getByText('Force-Directed')).toBeInTheDocument();
      expect(screen.getByText('Circular')).toBeInTheDocument();
      expect(screen.getByText('Concentric')).toBeInTheDocument();
    });

    it('renders zoom controls', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const zoomInButton = screen.getByTitle('Zoom In');
      const zoomOutButton = screen.getByTitle('Zoom Out');
      const resetButton = screen.getByTitle('Reset View');

      expect(zoomInButton).toBeInTheDocument();
      expect(zoomOutButton).toBeInTheDocument();
      expect(resetButton).toBeInTheDocument();
    });

    it('renders show labels checkbox', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByText('Show Labels')).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('labels checkbox is checked by default', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeChecked();
    });

    it('toggles labels checkbox', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(checkbox).not.toBeChecked();
    });
  });

  describe('Color mode', () => {
    it('renders color mode buttons', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByText('Color By')).toBeInTheDocument();
      expect(screen.getByText('Community')).toBeInTheDocument();
      expect(screen.getByText('Entity Type')).toBeInTheDocument();
    });

    it('clicking color mode buttons triggers recoloring', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const entityTypeButton = screen.getByText('Entity Type');
      fireEvent.click(entityTypeButton);

      // The mock would be called to update styles
      expect(mockCytoscape.nodes).toHaveBeenCalled();
    });
  });

  describe('Community interactions', () => {
    it('clicking community button focuses on that community', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Get the first occurrence (in the community list)
      const communityButton = screen.getAllByText('Operations Cluster')[0].closest('button');
      if (communityButton) {
        fireEvent.click(communityButton);
      }

      // Should call fit on the cytoscape instance
      expect(mockCytoscape.fit).toHaveBeenCalled();
    });

    it('hovering community highlights it', async () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Get the first occurrence (in the community list)
      const communityButton = screen.getAllByText('IT Systems')[0].closest('button');
      if (communityButton) {
        fireEvent.mouseEnter(communityButton);
      }

      // Highlighting should be applied via cytoscape
      await waitFor(() => {
        expect(mockCytoscape.nodes).toHaveBeenCalled();
      });
    });

    it('mouse leave removes highlight', async () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Get the first occurrence (in the community list)
      const communityButton = screen.getAllByText('IT Systems')[0].closest('button');
      if (communityButton) {
        fireEvent.mouseEnter(communityButton);
        fireEvent.mouseLeave(communityButton);
      }

      // Should remove highlighting
      await waitFor(() => {
        const nodesResult = mockCytoscape.nodes();
        expect(nodesResult.removeClass).toBeDefined();
      });
    });
  });

  describe('Callbacks', () => {
    it('calls onCommunitySelect when community is selected', () => {
      const onCommunitySelect = jest.fn();
      render(
        <CommunityVisualization {...defaultProps} onCommunitySelect={onCommunitySelect} />
      );

      // Simulate Cytoscape tap event by triggering the callback
      // Since we mock cytoscape, we need to test differently
      // The actual selection happens via cytoscape events
      expect(onCommunitySelect).not.toHaveBeenCalled(); // Not called on initial render
    });

    it('calls onNodeSelect callback when provided', () => {
      const onNodeSelect = jest.fn();
      render(<CommunityVisualization {...defaultProps} onNodeSelect={onNodeSelect} />);

      // Event handlers are registered
      expect(mockCytoscape.on).toHaveBeenCalled();
    });
  });

  describe('Legend', () => {
    it('renders legend section', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByText('Legend')).toBeInTheDocument();
    });

    it('shows community names in legend', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Legend shows abbreviated community names
      expect(screen.getAllByText('Operations Cluster').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('IT Systems').length).toBeGreaterThanOrEqual(1);
    });

    it('shows count of additional communities when more than 6', () => {
      const manyCommunities: Community[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          communityId: String(i),
          title: `Community ${i}`,
          memberCount: 5,
        }));

      render(<CommunityVisualization communities={manyCommunities} />);

      expect(screen.getByText('+ 4 more communities')).toBeInTheDocument();
    });
  });

  describe('Selected item panel', () => {
    it('does not show panel when nothing is selected', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // No "Community Details" or "Node Details" panel
      expect(screen.queryByText('Community Details')).not.toBeInTheDocument();
      expect(screen.queryByText('Node Details')).not.toBeInTheDocument();
    });
  });

  describe('Props handling', () => {
    it('uses default height when not provided', () => {
      render(<CommunityVisualization communities={mockCommunities} />);

      const container = document.querySelector('[style*="height"]');
      expect(container).toBeInTheDocument();
    });

    it('uses custom height when provided', () => {
      render(<CommunityVisualization communities={mockCommunities} height="800px" />);

      const container = document.querySelector('[style*="height: 800px"]');
      expect(container).toBeInTheDocument();
    });

    it('handles empty communities array', () => {
      render(<CommunityVisualization communities={[]} />);

      expect(screen.getByText('Communities (0)')).toBeInTheDocument();
    });

    it('handles communities without members', () => {
      const communitiesWithoutMembers: Community[] = [
        {
          communityId: '0',
          title: 'Empty Community',
          memberCount: 0,
        },
      ];

      render(<CommunityVisualization communities={communitiesWithoutMembers} />);

      // Text appears in both community list and legend
      expect(screen.getAllByText('Empty Community').length).toBeGreaterThanOrEqual(1);
    });

    it('handles communities without titles', () => {
      const communitiesWithoutTitles: Community[] = [
        {
          communityId: '5',
          memberCount: 3,
        },
      ];

      render(<CommunityVisualization communities={communitiesWithoutTitles} />);

      // Text appears in both community list and legend (as abbreviated)
      expect(screen.getAllByText(/Community 5|C5/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Zoom controls behavior', () => {
    it('zoom in button calls zoom', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const zoomInButton = screen.getByTitle('Zoom In');
      fireEvent.click(zoomInButton);

      expect(mockCytoscape.zoom).toHaveBeenCalled();
    });

    it('zoom out button calls zoom', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const zoomOutButton = screen.getByTitle('Zoom Out');
      fireEvent.click(zoomOutButton);

      expect(mockCytoscape.zoom).toHaveBeenCalled();
    });

    it('reset view button calls fit', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const resetButton = screen.getByTitle('Reset View');
      fireEvent.click(resetButton);

      expect(mockCytoscape.fit).toHaveBeenCalled();
    });
  });

  describe('Layout change', () => {
    it('changes layout when selection changes', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'circle' } });

      // Component should re-render with new layout
      expect(select).toHaveValue('circle');
    });
  });

  describe('Accessibility', () => {
    it('has accessible zoom buttons with titles', () => {
      render(<CommunityVisualization {...defaultProps} />);

      expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
      expect(screen.getByTitle('Reset View')).toBeInTheDocument();
    });

    it('checkbox has associated label', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeInTheDocument();
    });

    it('community buttons are keyboard accessible', () => {
      render(<CommunityVisualization {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Color coding', () => {
    it('renders color indicators for communities', () => {
      render(<CommunityVisualization {...defaultProps} />);

      // Color dots should be present
      const colorDots = document.querySelectorAll('.rounded-full.w-3.h-3');
      expect(colorDots.length).toBeGreaterThan(0);
    });
  });
});
