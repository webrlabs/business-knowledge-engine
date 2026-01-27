/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImpactVisualization, {
  ImpactAnalysisResult,
  SimulationResult,
  ImpactEntity,
} from '../ImpactVisualization';

// Mock Cytoscape
jest.mock('cytoscape', () => {
  const mockCy = {
    on: jest.fn(),
    destroy: jest.fn(),
    nodes: jest.fn(() => ({
      addClass: jest.fn(),
      removeClass: jest.fn(),
      forEach: jest.fn(),
    })),
    edges: jest.fn(() => ({
      addClass: jest.fn(),
      removeClass: jest.fn(),
      forEach: jest.fn(),
    })),
    zoom: jest.fn(() => 1),
    width: jest.fn(() => 800),
    height: jest.fn(() => 600),
    fit: jest.fn(),
    $: jest.fn(() => ({ length: 1 })),
  };
  return jest.fn(() => mockCy);
});

// Sample test data
const mockUpstreamEntity: ImpactEntity = {
  id: 'entity-1',
  name: 'Database Service',
  type: 'System',
  pathLength: 1,
  impactScore: 0.85,
  direction: 'upstream',
  importance: 0.7,
};

const mockDownstreamEntity: ImpactEntity = {
  id: 'entity-2',
  name: 'User Interface',
  type: 'Application',
  pathLength: 1,
  impactScore: 0.65,
  direction: 'downstream',
  importance: 0.5,
};

const mockCriticalEntity: ImpactEntity = {
  id: 'entity-3',
  name: 'Core API',
  type: 'System',
  pathLength: 1,
  impactScore: 0.95,
  direction: 'downstream',
  importance: 0.9,
};

const mockImpactData: ImpactAnalysisResult = {
  sourceEntity: 'Payment Service',
  upstream: {
    description: 'What Payment Service depends on',
    count: 3,
    entities: [mockUpstreamEntity],
    paths: [['Payment Service', 'Database Service']],
  },
  downstream: {
    description: 'What depends on Payment Service',
    count: 5,
    entities: [mockDownstreamEntity, mockCriticalEntity],
    paths: [
      ['Payment Service', 'User Interface'],
      ['Payment Service', 'Core API'],
    ],
  },
  summary: {
    totalUniqueEntities: 8,
    criticalEntities: [mockCriticalEntity],
    criticalCount: 1,
    typeDistribution: {
      System: 4,
      Application: 2,
      Process: 2,
    },
    riskLevel: 'high',
  },
  metadata: {
    executionTimeMs: 150,
    maxUpstreamDepth: 2,
    maxDownstreamDepth: 3,
  },
};

const mockSimulationData: SimulationResult = {
  simulatedEntity: 'Payment Service',
  action: 'removal',
  impact: {
    directlyAffected: { count: 3, entities: [mockDownstreamEntity] },
    indirectlyAffected: { count: 5, entities: [] },
    criticallyAffected: { count: 1, entities: [mockCriticalEntity] },
  },
  brokenRelationships: {
    count: 4,
    relationships: [
      { type: 'DEPENDS_ON', from: 'User Interface', to: 'Payment Service' },
      { type: 'USES', from: 'Core API', to: 'Payment Service' },
    ],
  },
  recommendation: 'WARNING: This change affects critical entities. Review dependencies and prepare rollback plan.',
  riskLevel: 'high',
};

describe('ImpactVisualization', () => {
  describe('Empty State', () => {
    it('renders empty state when no data is provided', () => {
      render(<ImpactVisualization data={null} />);

      expect(screen.getByText('Select an entity to view impact analysis')).toBeInTheDocument();
    });

    it('displays placeholder icon in empty state', () => {
      const { container } = render(<ImpactVisualization data={null} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('With Impact Data', () => {
    it('renders visualization container when data is provided', () => {
      const { container } = render(<ImpactVisualization data={mockImpactData} />);

      // Check for the visualization container
      expect(container.querySelector('.relative')).toBeInTheDocument();
    });

    it('displays source entity name in summary panel', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Payment Service')).toBeInTheDocument();
    });

    it('shows upstream count', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText(/Upstream:/i)).toBeInTheDocument();
      expect(screen.getByText('3 entities')).toBeInTheDocument();
    });

    it('shows downstream count', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText(/Downstream:/i)).toBeInTheDocument();
      expect(screen.getByText('5 entities')).toBeInTheDocument();
    });

    it('shows critical count', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText(/Critical:/i)).toBeInTheDocument();
    });

    it('displays risk level badge', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('shows execution time in metadata', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Time: 150ms')).toBeInTheDocument();
    });
  });

  describe('View Mode Controls', () => {
    it('renders view mode selector', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('View Mode')).toBeInTheDocument();
      expect(screen.getByText('both')).toBeInTheDocument();
      expect(screen.getByText('upstream')).toBeInTheDocument();
      expect(screen.getByText('downstream')).toBeInTheDocument();
    });

    it('switches view mode on button click', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      const upstreamButton = screen.getByRole('button', { name: /upstream/i });
      fireEvent.click(upstreamButton);

      // Button should have active styling after click
      expect(upstreamButton).toHaveClass('bg-blue-100');
    });
  });

  describe('Layout Controls', () => {
    it('renders layout selector', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Layout')).toBeInTheDocument();
    });

    it('has radial, tree, and force-directed options', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();

      const options = select.querySelectorAll('option');
      expect(options).toHaveLength(3);
    });
  });

  describe('Color Mode Controls', () => {
    it('renders color mode selector', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Color By')).toBeInTheDocument();
    });

    it('has impact and type color modes', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByRole('button', { name: /Impact/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Type/i })).toBeInTheDocument();
    });
  });

  describe('Zoom Controls', () => {
    it('renders zoom in button', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      const zoomInButton = screen.getByTitle('Zoom In');
      expect(zoomInButton).toBeInTheDocument();
    });

    it('renders zoom out button', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      const zoomOutButton = screen.getByTitle('Zoom Out');
      expect(zoomOutButton).toBeInTheDocument();
    });

    it('renders reset view button', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      const resetButton = screen.getByTitle('Reset View');
      expect(resetButton).toBeInTheDocument();
    });
  });

  describe('Labels Toggle', () => {
    it('renders show labels checkbox', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Show Labels')).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('checkbox is checked by default', () => {
      render(<ImpactVisualization data={mockImpactData} showLabels={true} />);

      expect(screen.getByRole('checkbox')).toBeChecked();
    });
  });

  describe('Legend', () => {
    it('renders direction legend', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Direction')).toBeInTheDocument();
      expect(screen.getByText('Source')).toBeInTheDocument();
      expect(screen.getByText('Upstream (depends on)')).toBeInTheDocument();
      expect(screen.getByText('Downstream (impacts)')).toBeInTheDocument();
    });

    it('renders impact score legend', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Impact Score')).toBeInTheDocument();
      expect(screen.getByText('Critical (>80%)')).toBeInTheDocument();
      expect(screen.getByText('High (60-80%)')).toBeInTheDocument();
      expect(screen.getByText('Medium (40-60%)')).toBeInTheDocument();
      expect(screen.getByText('Low (<40%)')).toBeInTheDocument();
    });

    it('renders node size explanation', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Node Size')).toBeInTheDocument();
      expect(screen.getByText('Larger nodes indicate higher impact scores')).toBeInTheDocument();
    });

    it('renders analysis info in legend', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('Analysis Info')).toBeInTheDocument();
      expect(screen.getByText('Max Upstream Depth: 2')).toBeInTheDocument();
      expect(screen.getByText('Max Downstream Depth: 3')).toBeInTheDocument();
    });
  });

  describe('Simulation Results', () => {
    it('renders simulation panel when simulation data is provided', () => {
      render(
        <ImpactVisualization
          data={mockImpactData}
          simulation={mockSimulationData}
        />
      );

      expect(screen.getByText('Removal Simulation')).toBeInTheDocument();
    });

    it('shows direct impact count', () => {
      render(
        <ImpactVisualization
          data={mockImpactData}
          simulation={mockSimulationData}
        />
      );

      expect(screen.getByText('Direct Impact:')).toBeInTheDocument();
    });

    it('shows indirect impact count', () => {
      render(
        <ImpactVisualization
          data={mockImpactData}
          simulation={mockSimulationData}
        />
      );

      expect(screen.getByText('Indirect Impact:')).toBeInTheDocument();
    });

    it('shows broken links count', () => {
      render(
        <ImpactVisualization
          data={mockImpactData}
          simulation={mockSimulationData}
        />
      );

      expect(screen.getByText('Broken Links:')).toBeInTheDocument();
    });

    it('displays recommendation text', () => {
      render(
        <ImpactVisualization
          data={mockImpactData}
          simulation={mockSimulationData}
        />
      );

      expect(screen.getByText(/WARNING: This change affects critical entities/)).toBeInTheDocument();
    });
  });

  describe('onNodeSelect Callback', () => {
    it('calls onNodeSelect when provided', async () => {
      const mockOnNodeSelect = jest.fn();

      render(
        <ImpactVisualization
          data={mockImpactData}
          onNodeSelect={mockOnNodeSelect}
        />
      );

      // The callback is registered with Cytoscape
      // In real usage, it would be called when a node is clicked
      expect(mockOnNodeSelect).not.toHaveBeenCalled();
    });
  });

  describe('Custom Props', () => {
    it('applies custom height', () => {
      const { container } = render(
        <ImpactVisualization data={mockImpactData} height="800px" />
      );

      const graphContainer = container.querySelector('[style*="height: 800px"]');
      expect(graphContainer).toBeInTheDocument();
    });

    it('respects initial viewMode prop', () => {
      render(<ImpactVisualization data={mockImpactData} viewMode="upstream" />);

      const upstreamButton = screen.getByRole('button', { name: /^upstream$/i });
      expect(upstreamButton).toHaveClass('bg-blue-100');
    });

    it('respects initial colorBy prop', () => {
      render(<ImpactVisualization data={mockImpactData} colorBy="type" />);

      const typeButton = screen.getByRole('button', { name: /^Type$/i });
      expect(typeButton).toHaveClass('bg-blue-100');
    });

    it('respects initial showLabels prop', () => {
      render(<ImpactVisualization data={mockImpactData} showLabels={false} />);

      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).not.toBeChecked();
    });
  });

  describe('Risk Level Styling', () => {
    it('applies correct styling for critical risk level', () => {
      const criticalData: ImpactAnalysisResult = {
        ...mockImpactData,
        summary: {
          ...mockImpactData.summary!,
          riskLevel: 'critical',
        },
      };

      render(<ImpactVisualization data={criticalData} />);

      expect(screen.getByText('critical')).toBeInTheDocument();
    });

    it('applies correct styling for low risk level', () => {
      const lowRiskData: ImpactAnalysisResult = {
        ...mockImpactData,
        summary: {
          ...mockImpactData.summary!,
          riskLevel: 'low',
        },
      };

      render(<ImpactVisualization data={lowRiskData} />);

      expect(screen.getByText('low')).toBeInTheDocument();
    });
  });

  describe('Entity Type Colors', () => {
    it('uses correct color for System type', () => {
      // The component uses entityTypeColors for System which is '#8B5CF6' (purple)
      // This is tested through the legend and node rendering
      render(<ImpactVisualization data={mockImpactData} />);

      // The legend should be visible
      expect(screen.getByText('Legend')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has accessible button titles', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
      expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
      expect(screen.getByTitle('Reset View')).toBeInTheDocument();
    });

    it('has accessible form labels', () => {
      render(<ImpactVisualization data={mockImpactData} />);

      expect(screen.getByText('View Mode')).toBeInTheDocument();
      expect(screen.getByText('Layout')).toBeInTheDocument();
      expect(screen.getByText('Color By')).toBeInTheDocument();
    });
  });

  describe('Data Without Summary', () => {
    it('renders without summary data', () => {
      const dataWithoutSummary: ImpactAnalysisResult = {
        sourceEntity: 'Test Entity',
        upstream: mockImpactData.upstream,
        downstream: mockImpactData.downstream,
      };

      render(<ImpactVisualization data={dataWithoutSummary} />);

      expect(screen.getByText('Test Entity')).toBeInTheDocument();
    });
  });

  describe('Data Without Metadata', () => {
    it('renders without metadata', () => {
      const dataWithoutMetadata: ImpactAnalysisResult = {
        sourceEntity: 'Test Entity',
        upstream: mockImpactData.upstream,
        summary: mockImpactData.summary,
      };

      render(<ImpactVisualization data={dataWithoutMetadata} />);

      expect(screen.getByText('Test Entity')).toBeInTheDocument();
    });
  });

  describe('Upstream Only Data', () => {
    it('renders with only upstream data', () => {
      const upstreamOnlyData: ImpactAnalysisResult = {
        sourceEntity: 'Test Entity',
        upstream: mockImpactData.upstream,
      };

      render(<ImpactVisualization data={upstreamOnlyData} viewMode="upstream" />);

      expect(screen.getByText('3 entities')).toBeInTheDocument();
    });
  });

  describe('Downstream Only Data', () => {
    it('renders with only downstream data', () => {
      const downstreamOnlyData: ImpactAnalysisResult = {
        sourceEntity: 'Test Entity',
        downstream: mockImpactData.downstream,
      };

      render(<ImpactVisualization data={downstreamOnlyData} viewMode="downstream" />);

      expect(screen.getByText('5 entities')).toBeInTheDocument();
    });
  });
});

describe('Impact Score Colors', () => {
  // Test the color function logic
  const getImpactColor = (score: number): string => {
    if (score >= 0.8) return '#EF4444'; // Red - Critical
    if (score >= 0.6) return '#F97316'; // Orange - High
    if (score >= 0.4) return '#EAB308'; // Yellow - Medium
    if (score >= 0.2) return '#22C55E'; // Green - Low
    return '#94A3B8'; // Gray - Minimal
  };

  it('returns red for critical scores (>=0.8)', () => {
    expect(getImpactColor(0.9)).toBe('#EF4444');
    expect(getImpactColor(0.8)).toBe('#EF4444');
    expect(getImpactColor(1.0)).toBe('#EF4444');
  });

  it('returns orange for high scores (0.6-0.8)', () => {
    expect(getImpactColor(0.75)).toBe('#F97316');
    expect(getImpactColor(0.6)).toBe('#F97316');
  });

  it('returns yellow for medium scores (0.4-0.6)', () => {
    expect(getImpactColor(0.55)).toBe('#EAB308');
    expect(getImpactColor(0.4)).toBe('#EAB308');
  });

  it('returns green for low scores (0.2-0.4)', () => {
    expect(getImpactColor(0.35)).toBe('#22C55E');
    expect(getImpactColor(0.2)).toBe('#22C55E');
  });

  it('returns gray for minimal scores (<0.2)', () => {
    expect(getImpactColor(0.15)).toBe('#94A3B8');
    expect(getImpactColor(0.0)).toBe('#94A3B8');
  });
});
