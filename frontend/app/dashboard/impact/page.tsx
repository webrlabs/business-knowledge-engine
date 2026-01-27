'use client';

import { useState, useCallback, useEffect } from 'react';
import ImpactVisualization, {
  ImpactAnalysisResult,
  SimulationResult,
  ImpactEntity,
} from '@/components/ImpactVisualization';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface EntitySuggestion {
  id: string;
  name: string;
  type: string;
}

export default function ImpactAnalysisPage() {
  const [entityName, setEntityName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<EntitySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [impactData, setImpactData] = useState<ImpactAnalysisResult | null>(null);
  const [simulationData, setSimulationData] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState(5);
  const [direction, setDirection] = useState<'both' | 'upstream' | 'downstream'>('both');
  const [selectedEntity, setSelectedEntity] = useState<ImpactEntity | null>(null);

  // Debounced entity search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/graphrag/entities/search?q=${encodeURIComponent(searchQuery)}&limit=10`
        );
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.entities || []);
        }
      } catch (err) {
        // Silently fail - suggestions are optional
        setSuggestions([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchImpactAnalysis = useCallback(async () => {
    if (!entityName.trim()) {
      setError('Please enter an entity name');
      return;
    }

    setLoading(true);
    setError(null);
    setSimulationData(null);

    try {
      const response = await fetch(`${API_BASE}/api/graphrag/impact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityName: entityName.trim(),
          direction,
          maxDepth,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch impact analysis');
      }

      const data = await response.json();
      setImpactData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setImpactData(null);
    } finally {
      setLoading(false);
    }
  }, [entityName, direction, maxDepth]);

  const fetchSimulation = useCallback(async () => {
    if (!entityName.trim()) {
      setError('Please enter an entity name');
      return;
    }

    setSimulateLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/graphrag/impact/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityName: entityName.trim(),
          maxDepth: maxDepth + 2, // Deeper traversal for simulation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run simulation');
      }

      const data = await response.json();
      setSimulationData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSimulateLoading(false);
    }
  }, [entityName, maxDepth]);

  const handleEntitySelect = (suggestion: EntitySuggestion) => {
    setEntityName(suggestion.name);
    setSearchQuery(suggestion.name);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleNodeSelect = (entity: ImpactEntity | null) => {
    setSelectedEntity(entity);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchImpactAnalysis();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Impact Analysis
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Visualize dependencies and downstream impact for any entity in the knowledge graph
          </p>
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Entity Search */}
            <div className="md:col-span-2 relative">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Entity Name
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setEntityName(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="Search for an entity..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {/* Suggestions Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-auto">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => handleEntitySelect(suggestion)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                    >
                      <span className="text-gray-900 dark:text-white">{suggestion.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">
                        {suggestion.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Direction Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Direction
              </label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'both' | 'upstream' | 'downstream')}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="both">Both</option>
                <option value="upstream">Upstream Only</option>
                <option value="downstream">Downstream Only</option>
              </select>
            </div>

            {/* Max Depth */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Depth
              </label>
              <input
                type="number"
                value={maxDepth}
                onChange={(e) => setMaxDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                min={1}
                max={10}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading || !entityName.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Analyze Impact
                </>
              )}
            </button>

            <button
              type="button"
              onClick={fetchSimulation}
              disabled={simulateLoading || !entityName.trim()}
              className="px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {simulateLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Simulating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Simulate Removal
                </>
              )}
            </button>

            {impactData && (
              <button
                type="button"
                onClick={() => {
                  setImpactData(null);
                  setSimulationData(null);
                  setSelectedEntity(null);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-600 dark:text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-700 dark:text-red-300">{error}</span>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Cards */}
      {impactData && impactData.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Upstream Dependencies</p>
                <p className="text-2xl font-bold text-blue-600">{impactData.upstream?.count || 0}</p>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Downstream Impact</p>
                <p className="text-2xl font-bold text-red-600">{impactData.downstream?.count || 0}</p>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Critical Entities</p>
                <p className="text-2xl font-bold text-orange-600">{impactData.summary.criticalCount}</p>
              </div>
              <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Risk Level</p>
                <p className={`text-2xl font-bold capitalize ${
                  impactData.summary.riskLevel === 'critical' ? 'text-red-600' :
                  impactData.summary.riskLevel === 'high' ? 'text-orange-600' :
                  impactData.summary.riskLevel === 'medium' ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {impactData.summary.riskLevel}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${
                impactData.summary.riskLevel === 'critical' ? 'bg-red-50 dark:bg-red-900/20' :
                impactData.summary.riskLevel === 'high' ? 'bg-orange-50 dark:bg-orange-900/20' :
                impactData.summary.riskLevel === 'medium' ? 'bg-yellow-50 dark:bg-yellow-900/20' :
                'bg-green-50 dark:bg-green-900/20'
              }`}>
                <svg className={`w-6 h-6 ${
                  impactData.summary.riskLevel === 'critical' ? 'text-red-600' :
                  impactData.summary.riskLevel === 'high' ? 'text-orange-600' :
                  impactData.summary.riskLevel === 'medium' ? 'text-yellow-600' :
                  'text-green-600'
                }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Visualization */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <ImpactVisualization
          data={impactData}
          simulation={simulationData}
          height="600px"
          onNodeSelect={handleNodeSelect}
        />
      </div>

      {/* Type Distribution */}
      {impactData?.summary?.typeDistribution && Object.keys(impactData.summary.typeDistribution).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Entity Type Distribution
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Object.entries(impactData.summary.typeDistribution)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                >
                  <div
                    className="w-4 h-4 rounded-full mr-3 flex-shrink-0"
                    style={{
                      backgroundColor: (
                        {
                          Process: '#3B82F6',
                          Task: '#10B981',
                          Role: '#F59E0B',
                          System: '#8B5CF6',
                          DataAsset: '#EC4899',
                          Form: '#06B6D4',
                          Policy: '#EF4444',
                          Procedure: '#14B8A6',
                          Application: '#8B5CF6',
                          Database: '#EC4899',
                        } as Record<string, string>
                      )[type] || '#64748B',
                    }}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{type}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{count} entities</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Critical Entities List */}
      {impactData?.summary?.criticalEntities && impactData.summary.criticalEntities.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Critical Entities
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Direction
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Distance
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Impact Score
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {impactData.summary.criticalEntities.map((entity, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {entity.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {entity.type || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        entity.direction === 'upstream'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {entity.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {entity.pathLength} hop{entity.pathLength !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex items-center">
                        <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-2 mr-2">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${entity.impactScore * 100}%`,
                              backgroundColor:
                                entity.impactScore >= 0.8 ? '#EF4444' :
                                entity.impactScore >= 0.6 ? '#F97316' :
                                entity.impactScore >= 0.4 ? '#EAB308' : '#22C55E',
                            }}
                          />
                        </div>
                        <span className="text-gray-700 dark:text-gray-300">
                          {(entity.impactScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
