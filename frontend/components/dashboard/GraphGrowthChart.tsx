'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { GraphGrowthPoint } from '@/lib/gamification-types';

const DAY_OPTIONS = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
] as const;

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
}

function CustomChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 dark:text-white mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600 dark:text-gray-400">{entry.name}:</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="flex gap-1">
          <div className="h-7 w-10 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="h-7 w-10 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="h-7 w-10 bg-gray-200 dark:bg-gray-700 rounded-md" />
        </div>
      </div>
      <div className="h-64 bg-gray-100 dark:bg-gray-700/50 rounded-lg flex items-end gap-1 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-gray-200 dark:bg-gray-600 rounded-t"
            style={{ height: `${20 + Math.random() * 60}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function GraphGrowthChart() {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<GraphGrowthPoint[]>([]);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);

  const fetchGrowthData = useCallback(
    async (numDays: number) => {
      try {
        setLoading(true);
        const res = await authFetch(
          `${API_BASE_URL}/api/gamification/graph-growth?days=${numDays}`
        );
        if (!res.ok) throw new Error('Failed to fetch graph growth data');
        const points: GraphGrowthPoint[] = await res.json();
        setData(points);
      } catch (err) {
        console.error('Graph growth fetch error:', err);
      } finally {
        setLoading(false);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    fetchGrowthData(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {loading ? (
        <ChartSkeleton />
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Knowledge Graph Growth
              </h3>
            </div>

            {/* Day Toggle */}
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-900/50 rounded-lg p-0.5">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setDays(option.value)}
                  className={`text-xs font-medium py-1 px-2.5 rounded-md transition-all duration-200 ${
                    days === option.value
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  className="dark:opacity-20"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e7eb' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val: number) => val.toLocaleString()}
                  width={50}
                />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                />
                <Line
                  type="monotone"
                  dataKey="nodes"
                  name="Nodes"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Line
                  type="monotone"
                  dataKey="edges"
                  name="Edges"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Line
                  type="monotone"
                  dataKey="documents"
                  name="Documents"
                  stroke="#14b8a6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
