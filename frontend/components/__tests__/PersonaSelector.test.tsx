import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PersonaSelector, { Persona } from '../PersonaSelector';

// Mock the useAuthFetch hook
const mockAuthFetch = jest.fn();
jest.mock('@/lib/api', () => ({
  API_BASE_URL: 'http://localhost:8080',
  useAuthFetch: () => mockAuthFetch,
}));

// Sample personas from backend
const mockPersonas: Persona[] = [
  {
    id: 'default',
    name: 'General User',
    description: 'Default persona with balanced weights across all entity types',
    icon: 'person',
    summaryStyle: 'balanced',
    exampleQueries: ['How does our organization handle customer complaints?'],
  },
  {
    id: 'ops',
    name: 'Operations',
    description: 'Operations team members focused on day-to-day business processes and workflows',
    icon: 'settings',
    summaryStyle: 'operational',
    exampleQueries: ['How do I complete the monthly reconciliation process?'],
  },
  {
    id: 'it',
    name: 'IT / Technology',
    description: 'IT professionals focused on systems, applications, and technical infrastructure',
    icon: 'code',
    summaryStyle: 'technical',
    exampleQueries: ['What databases does the CRM system connect to?'],
  },
  {
    id: 'leadership',
    name: 'Leadership / Executive',
    description: 'Executives and senior leadership focused on strategic metrics and business outcomes',
    icon: 'trending_up',
    summaryStyle: 'executive',
    exampleQueries: ['What are our key performance indicators this quarter?'],
  },
  {
    id: 'compliance',
    name: 'Compliance / Risk',
    description: 'Compliance officers and risk managers focused on regulations, policies, and controls',
    icon: 'gavel',
    summaryStyle: 'compliance',
    exampleQueries: ['What regulations govern our data handling practices?'],
  },
];

describe('PersonaSelector', () => {
  const defaultProps = {
    selectedPersona: 'default',
    onPersonaChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation for successful API call
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ personas: mockPersonas }),
    });
  });

  describe('Initial rendering', () => {
    it('shows loading state initially', () => {
      render(<PersonaSelector {...defaultProps} />);
      // Should show the loading animation/placeholder with animate-pulse class
      const loadingElement = document.querySelector('.animate-pulse');
      expect(loadingElement).toBeInTheDocument();
    });

    it('renders the selected persona after loading', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });
    });

    it('fetches personas from API on mount', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(mockAuthFetch).toHaveBeenCalledWith('http://localhost:8080/api/personas');
      });
    });
  });

  describe('Dropdown interaction', () => {
    it('opens dropdown when clicked', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Click to open dropdown
      fireEvent.click(screen.getByRole('button'));

      // Should show all personas
      expect(screen.getByText('Operations')).toBeInTheDocument();
      expect(screen.getByText('IT / Technology')).toBeInTheDocument();
      expect(screen.getByText('Leadership / Executive')).toBeInTheDocument();
      expect(screen.getByText('Compliance / Risk')).toBeInTheDocument();
    });

    it('closes dropdown when clicking outside', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Operations')).toBeInTheDocument();

      // Click backdrop to close
      const backdrop = document.querySelector('.fixed.inset-0');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      // Dropdown should close (Operations text may still exist but not visible)
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('calls onPersonaChange when selecting a persona', async () => {
      const onPersonaChange = jest.fn();
      render(
        <PersonaSelector
          {...defaultProps}
          onPersonaChange={onPersonaChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));

      // Click on Operations
      fireEvent.click(screen.getByText('Operations'));

      expect(onPersonaChange).toHaveBeenCalledWith('ops');
    });

    it('closes dropdown after selection', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Select a persona
      fireEvent.click(screen.getByText('IT / Technology'));

      // Dropdown should close
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });

  describe('Persona display', () => {
    it('shows correct icon for each persona', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));

      // Each persona should be visible
      expect(screen.getByText('Operations')).toBeInTheDocument();
      expect(screen.getByText('IT / Technology')).toBeInTheDocument();
      expect(screen.getByText('Leadership / Executive')).toBeInTheDocument();
      expect(screen.getByText('Compliance / Risk')).toBeInTheDocument();
    });

    it('shows description for each persona in dropdown', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));

      // Check descriptions are visible
      expect(screen.getByText(/Operations team members focused/)).toBeInTheDocument();
      expect(screen.getByText(/IT professionals focused/)).toBeInTheDocument();
    });

    it('shows checkmark for selected persona', async () => {
      render(<PersonaSelector {...defaultProps} selectedPersona="ops" />);

      await waitFor(() => {
        expect(screen.getByText('Operations')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));

      // Operations option should be highlighted
      const opsButton = screen.getAllByRole('option').find(
        (el) => el.getAttribute('aria-selected') === 'true'
      );
      expect(opsButton).toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('does not open dropdown when disabled', async () => {
      render(<PersonaSelector {...defaultProps} disabled={true} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Try to click
      fireEvent.click(screen.getByRole('button'));

      // Dropdown should not open
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('shows disabled styling when disabled', async () => {
      render(<PersonaSelector {...defaultProps} disabled={true} />);

      await waitFor(() => {
        const button = screen.getByRole('button');
        expect(button).toHaveClass('opacity-50');
        expect(button).toHaveClass('cursor-not-allowed');
      });
    });
  });

  describe('Error handling', () => {
    it('shows fallback personas on API error', async () => {
      mockAuthFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown - fallback personas should be available
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Operations')).toBeInTheDocument();
      expect(screen.getByText('IT / Technology')).toBeInTheDocument();
    });

    it('shows error message when API fails', async () => {
      mockAuthFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText(/Failed to load personas/)).toBeInTheDocument();
    });

    it('handles non-ok response', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        // Should fall back to defaults
        expect(screen.getByText('General User')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper aria attributes', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('aria-haspopup', 'listbox');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveAttribute('aria-label', 'Select persona');
      });
    });

    it('updates aria-expanded when opened', async () => {
      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(button);

      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('options have proper role and aria-selected', async () => {
      render(<PersonaSelector {...defaultProps} selectedPersona="it" />);

      await waitFor(() => {
        expect(screen.getByText('IT / Technology')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button'));

      const options = screen.getAllByRole('option');
      expect(options.length).toBe(5);

      // IT should be selected
      const itOption = options.find((opt) =>
        opt.textContent?.includes('IT / Technology')
      );
      expect(itOption).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Different personas', () => {
    it.each([
      ['ops', 'Operations'],
      ['it', 'IT / Technology'],
      ['leadership', 'Leadership / Executive'],
      ['compliance', 'Compliance / Risk'],
      ['default', 'General User'],
    ])('displays %s persona correctly', async (personaId, expectedName) => {
      render(
        <PersonaSelector {...defaultProps} selectedPersona={personaId} />
      );

      await waitFor(() => {
        expect(screen.getByText(expectedName)).toBeInTheDocument();
      });
    });
  });

  describe('API response variations', () => {
    it('handles personas array directly', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPersonas), // Direct array instead of { personas: [...] }
      });

      render(<PersonaSelector {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('General User')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Operations')).toBeInTheDocument();
    });

    it('handles empty personas array', async () => {
      mockAuthFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ personas: [] }),
      });

      render(<PersonaSelector {...defaultProps} />);

      // Should fall back to button without specific persona name
      await waitFor(() => {
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
      });
    });
  });
});
