'use client';

import { useState, useEffect } from 'react';
import { StagedEntity, StagedRelationship, RelationshipType } from '@/lib/staging-store';

interface RelationshipModalProps {
  isOpen: boolean;
  onClose: () => void;
  entities: StagedEntity[];
  sourceEntityId?: string;
  targetEntityId?: string;
  onSave: (relationship: Omit<StagedRelationship, 'id' | 'stagedId' | 'status'>) => void;
}

const relationshipTypes: RelationshipType[] = [
  'PRECEDES',
  'RESPONSIBLE_FOR',
  'TRANSFORMS_INTO',
  'REGULATED_BY',
];

export default function RelationshipModal({
  isOpen,
  onClose,
  entities,
  sourceEntityId,
  targetEntityId,
  onSave,
}: RelationshipModalProps) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RelationshipType>('PRECEDES');

  useEffect(() => {
    if (sourceEntityId) setSource(sourceEntityId);
    if (targetEntityId) setTarget(targetEntityId);
  }, [sourceEntityId, targetEntityId]);

  if (!isOpen) return null;

  const availableEntities = entities.filter((e) => e.status !== 'deleted');

  const handleSave = () => {
    if (!source || !target || source === target) return;

    onSave({
      source,
      target,
      type,
      confidence: 1.0,
    });
    onClose();
    // Reset form
    setSource('');
    setTarget('');
    setType('PRECEDES');
  };

  const sourceEntity = availableEntities.find((e) => e.id === source);
  const targetEntity = availableEntities.find((e) => e.id === target);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Create Relationship</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Source Entity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                From Entity <span className="text-red-500">*</span>
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select source entity...</option>
                {availableEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Relationship Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Relationship Type <span className="text-red-500">*</span>
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as RelationshipType)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {relationshipTypes.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Entity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                To Entity <span className="text-red-500">*</span>
              </label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">Select target entity...</option>
                {availableEntities.map((entity) => (
                  <option key={entity.id} value={entity.id} disabled={entity.id === source}>
                    {entity.name} ({entity.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Preview */}
            {source && target && source !== target && (
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Preview:</p>
                <div className="flex items-center text-sm text-gray-900 dark:text-white">
                  <span className="font-medium">{sourceEntity?.name}</span>
                  <span className="mx-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-xs font-mono rounded">
                    {type}
                  </span>
                  <span className="font-medium">{targetEntity?.name}</span>
                </div>
              </div>
            )}

            {/* Validation error */}
            {source && target && source === target && (
              <p className="text-sm text-red-500">Source and target cannot be the same entity.</p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!source || !target || source === target}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Relationship
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
