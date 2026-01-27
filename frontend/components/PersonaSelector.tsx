'use client';

import { useState, useEffect } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

/**
 * Persona type definition matching backend response
 */
export interface Persona {
  id: string;
  name: string;
  description: string;
  icon: string;
  summaryStyle: string;
  exampleQueries: string[];
}

interface PersonaSelectorProps {
  selectedPersona: string;
  onPersonaChange: (personaId: string) => void;
  disabled?: boolean;
}

/**
 * Icons for each persona type - using Material-like icons as SVGs
 */
const PersonaIcons: Record<string, React.ReactNode> = {
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  code: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  trending_up: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  gavel: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
    </svg>
  ),
  person: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
};

/**
 * Background colors for each persona
 */
const PersonaColors: Record<string, string> = {
  ops: 'bg-green-100 text-green-800 border-green-300',
  it: 'bg-blue-100 text-blue-800 border-blue-300',
  leadership: 'bg-purple-100 text-purple-800 border-purple-300',
  compliance: 'bg-amber-100 text-amber-800 border-amber-300',
  default: 'bg-gray-100 text-gray-800 border-gray-300',
};

/**
 * PersonaSelector Component (F6.3.5)
 *
 * Dropdown to select the persona/role for GraphRAG queries.
 * Each persona gets tailored responses based on their focus area:
 * - Operations: Process-focused, actionable details
 * - IT: Technical details, system integrations
 * - Leadership: Executive summaries, KPIs
 * - Compliance: Regulatory focus, policies
 * - Default: Balanced for all audiences
 */
export default function PersonaSelector({
  selectedPersona,
  onPersonaChange,
  disabled = false,
}: PersonaSelectorProps) {
  const authFetch = useAuthFetch();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch personas from API
  useEffect(() => {
    const fetchPersonas = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await authFetch(`${API_BASE_URL}/api/personas`);

        if (!response.ok) {
          throw new Error('Failed to fetch personas');
        }

        const data = await response.json();
        setPersonas(data.personas || data);
      } catch (err) {
        console.error('Error fetching personas:', err);
        setError('Failed to load personas');
        // Provide fallback personas
        setPersonas([
          { id: 'default', name: 'General User', description: 'Balanced responses', icon: 'person', summaryStyle: 'balanced', exampleQueries: [] },
          { id: 'ops', name: 'Operations', description: 'Process-focused', icon: 'settings', summaryStyle: 'operational', exampleQueries: [] },
          { id: 'it', name: 'IT / Technology', description: 'Technical details', icon: 'code', summaryStyle: 'technical', exampleQueries: [] },
          { id: 'leadership', name: 'Leadership', description: 'Executive summary', icon: 'trending_up', summaryStyle: 'executive', exampleQueries: [] },
          { id: 'compliance', name: 'Compliance', description: 'Regulatory focus', icon: 'gavel', summaryStyle: 'compliance', exampleQueries: [] },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPersonas();
  }, [authFetch]);

  const selectedPersonaData = personas.find(p => p.id === selectedPersona) || personas.find(p => p.id === 'default');

  const getPersonaColor = (personaId: string) => {
    return PersonaColors[personaId] || PersonaColors.default;
  };

  const getPersonaIcon = (iconName: string) => {
    return PersonaIcons[iconName] || PersonaIcons.person;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg animate-pulse">
        <div className="w-5 h-5 bg-gray-200 rounded"></div>
        <div className="w-20 h-4 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg border transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-opacity-80'}
          ${selectedPersonaData ? getPersonaColor(selectedPersonaData.id) : 'bg-gray-100 text-gray-800 border-gray-300'}
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select persona"
      >
        {selectedPersonaData && getPersonaIcon(selectedPersonaData.icon)}
        <span className="text-sm font-medium">
          {selectedPersonaData?.name || 'Select Persona'}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown panel */}
          <div
            className="absolute left-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden"
            role="listbox"
            aria-label="Available personas"
          >
            {error && (
              <div className="px-3 py-2 text-xs text-amber-600 bg-amber-50 border-b border-amber-100">
                {error} - Using fallback personas
              </div>
            )}

            <div className="max-h-80 overflow-y-auto">
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  role="option"
                  aria-selected={selectedPersona === persona.id}
                  onClick={() => {
                    onPersonaChange(persona.id);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full px-4 py-3 text-left transition-colors
                    ${selectedPersona === persona.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-1.5 rounded ${getPersonaColor(persona.id)}`}>
                      {getPersonaIcon(persona.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{persona.name}</span>
                        {selectedPersona === persona.id && (
                          <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{persona.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Footer with hint */}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Persona tailors responses to your role and information needs
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
