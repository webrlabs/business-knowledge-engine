'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

interface LeaderboardEntry {
    userId: string;
    userEmail: string;
    userName: string;
    totalPoints: number;
    lastActive: string;
    rank: number;
}

export default function LeaderboardPage() {
    const { user } = useAuth();
    const authFetch = useAuthFetch();
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                const response = await authFetch(`${API_BASE_URL}/api/leaderboard?limit=20`);
                if (!response.ok) {
                    throw new Error('Failed to fetch leaderboard');
                }
                const data = await response.json();
                setLeaderboard(data);
            } catch (err) {
                console.error('Error fetching leaderboard:', err);
                setError('Failed to load leaderboard. Please try again later.');
            } finally {
                setLoading(false);
            }
        };

        fetchLeaderboard();
    }, [authFetch]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600">Loading top contributors...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center max-w-2xl mx-auto mt-8">
                <h2 className="text-lg font-bold text-red-900 mb-2">Error</h2>
                <p className="text-red-800">{error}</p>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
                <p className="text-gray-600 mt-1">Top contributors driving knowledge discovery.</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Rank
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    User
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Total Points
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Last Active
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {leaderboard.map((entry, index) => {
                                const isCurrentUser = user?.email === entry.userEmail;
                                let rankIcon = null;
                                if (index === 0) rankIcon = '🥇';
                                else if (index === 1) rankIcon = '🥈';
                                else if (index === 2) rankIcon = '🥉';

                                return (
                                    <tr
                                        key={entry.userId}
                                        className={`${isCurrentUser ? 'bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <span className="text-lg font-bold text-gray-700 w-8 text-center">
                                                    {rankIcon || index + 1}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                                                    {entry.userName?.charAt(0).toUpperCase() || 'U'}
                                                </div>
                                                <div className="ml-4">
                                                    <div className={`text-sm font-medium ${isCurrentUser ? 'text-blue-900' : 'text-gray-900'}`}>
                                                        {entry.userName} {isCurrentUser && '(You)'}
                                                    </div>
                                                    <div className="text-sm text-gray-500">{entry.userEmail}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-bold text-gray-900 bg-gray-100 px-3 py-1 rounded-full inline-block">
                                                {entry.totalPoints.toLocaleString()} pts
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(entry.lastActive).toLocaleDateString()}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {leaderboard.length === 0 && (
                    <div className="p-12 text-center text-gray-500">
                        No activity recorded yet. Be the first to contribute!
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
                    <h3 className="text-lg font-bold mb-2">How to earn points?</h3>
                    <ul className="space-y-2 text-purple-100 text-sm">
                        <li>• Upload a document: <span className="font-bold text-white">+10 pts</span></li>
                        <li>• Document approved: <span className="font-bold text-white">+50 pts</span></li>
                        <li>• Verify an entity: <span className="font-bold text-white">+5 pts</span></li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
