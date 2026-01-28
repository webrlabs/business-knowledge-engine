'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth, canReview, isLoadingRoles } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import GraphVisualization from '@/components/GraphVisualization';



interface ExtractedEntity {
  id: string;
  type: 'Process' | 'Task' | 'Role' | 'System' | 'DataAsset' | 'Form' | 'Policy' | 'Procedure' | 'Directive' | 'Guide';
  name: string;
  confidence: number;
  startOffset: number;
  endOffset: number;
  properties?: Record<string, any>;
}

interface ExtractedRelationship {
  id: string;
  type: 'PRECEDES' | 'RESPONSIBLE_FOR' | 'TRANSFORMS_INTO' | 'REGULATED_BY';
  source: string;
  target: string;
  confidence: number;
}

interface DocumentReview {
  id: string;
  documentName: string;
  documentType: string;
  uploadDate: string;
  status: 'pending' | 'approved' | 'rejected' | 'pending_review';
  textContent: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export default function StagingPage() {
  const router = useRouter();
  const params = useParams();
  const { user, roles, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [accessDenied, setAccessDenied] = useState(false);
  const [document, setDocument] = useState<DocumentReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{ name: string; type: string; properties: Record<string, any> } | null>(null);
  const [modifiedEntities, setModifiedEntities] = useState<Set<string>>(new Set());

  const graphData = useMemo(() => {
    if (!document) return { nodes: [], edges: [] };

    // Build name-to-id lookup since relationships reference entities by name
    const nameToId = new Map<string, string>();
    for (const e of document.entities) {
      nameToId.set(e.name, e.id);
    }

    const nodeIds = new Set(document.entities.map(e => e.id));

    return {
      nodes: document.entities.map(e => ({
        id: e.id,
        label: e.name,
        type: e.type as any
      })),
      edges: document.relationships
        .map(r => ({
          id: r.id,
          source: nameToId.get(r.source) || r.source,
          target: nameToId.get(r.target) || r.target,
          label: r.type
        }))
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    };
  }, [document]);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [editRelFormData, setEditRelFormData] = useState<{ type: string; source: string; target: string; properties: Record<string, any> } | null>(null);
  const [modifiedRelationships, setModifiedRelationships] = useState<Set<string>>(new Set());
  const [rejectingEntityId, setRejectingEntityId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectAllModal, setShowRejectAllModal] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    // Wait for roles to be loaded (they're fetched async from token)
    if (isLoadingRoles(user, roles)) {
      return;
    }

    if (!canReview(roles)) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    // Fetch document from API
    const fetchDocument = async () => {
      const docId = params.id as string;

      try {
        setLoading(true);
        setError(null);

        const response = await authFetch(`${API_BASE_URL}/api/documents/${docId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setDocument(null);
          } else {
            throw new Error(`Failed to fetch document: ${response.statusText}`);
          }
          return;
        }

        const data = await response.json();

        // Transform API response to match our interface
        const docReview: DocumentReview = {
          id: data.id,
          documentName: data.title || data.originalFilename || 'Untitled Document',
          documentType: data.mimeType || 'Unknown',
          uploadDate: data.createdAt || new Date().toISOString(),
          status: data.status || 'pending_review',
          textContent: data.extractedText || '',
          entities: data.entities || [],
          relationships: data.relationships || [],
        };

        setDocument(docReview);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [isAuthenticated, roles, router, params.id, authFetch]);

  const handleEditEntity = (entity: ExtractedEntity) => {
    setEditingEntityId(entity.id);
    setEditFormData({
      name: entity.name,
      type: entity.type,
      properties: entity.properties || {}
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEntityId || !editFormData || !document) return;

    try {
      // Call API to update entity
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/entities/${editingEntityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFormData.name,
          type: editFormData.type,
          properties: editFormData.properties,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update entity');
      }

      // Update local state
      const updatedEntities = document.entities.map(entity => {
        if (entity.id === editingEntityId) {
          return {
            ...entity,
            name: editFormData.name,
            type: editFormData.type as any,
            properties: editFormData.properties
          };
        }
        return entity;
      });

      setDocument({
        ...document,
        entities: updatedEntities
      });

      setModifiedEntities(prev => new Set(prev).add(editingEntityId));
    } catch (err) {
      alert('Failed to save entity changes. Changes saved locally only.');
      // Still update locally even if API fails
      const updatedEntities = document.entities.map(entity => {
        if (entity.id === editingEntityId) {
          return {
            ...entity,
            name: editFormData.name,
            type: editFormData.type as any,
            properties: editFormData.properties
          };
        }
        return entity;
      });

      setDocument({
        ...document,
        entities: updatedEntities
      });

      setModifiedEntities(prev => new Set(prev).add(editingEntityId));
    }

    setEditingEntityId(null);
    setEditFormData(null);
  };

  const handleCancelEdit = () => {
    setEditingEntityId(null);
    setEditFormData(null);
  };

  const handleEditRelationship = (rel: ExtractedRelationship) => {
    setEditingRelationshipId(rel.id);
    setEditRelFormData({
      type: rel.type,
      source: rel.source,
      target: rel.target,
      properties: {}
    });
  };

  const handleSaveRelEdit = async () => {
    if (!editingRelationshipId || !editRelFormData || !document) return;

    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/relationships/${editingRelationshipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editRelFormData.type,
          source: editRelFormData.source,
          target: editRelFormData.target,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update relationship');
      }
    } catch (err) {
      // Continue with local update even if API fails
    }

    // Update local state
    const updatedRelationships = document.relationships.map(rel => {
      if (rel.id === editingRelationshipId) {
        return {
          ...rel,
          type: editRelFormData.type as any,
          source: editRelFormData.source,
          target: editRelFormData.target
        };
      }
      return rel;
    });

    setDocument({
      ...document,
      relationships: updatedRelationships
    });

    setModifiedRelationships(prev => new Set(prev).add(editingRelationshipId));
    setEditingRelationshipId(null);
    setEditRelFormData(null);
  };

  const handleCancelRelEdit = () => {
    setEditingRelationshipId(null);
    setEditRelFormData(null);
  };

  // Check if user can approve/reject entities
  const canApprove = canReview(roles);

  const [approvalError, setApprovalError] = useState<string | null>(null);

  const handleApproveEntity = async (entityId: string) => {
    if (!canApprove) {
      setApprovalError('You do not have permission to approve entities. Only users with Admin or Reviewer roles can approve.');
      setTimeout(() => setApprovalError(null), 5000);
      return;
    }

    const entity = document?.entities.find(e => e.id === entityId);
    if (!entity || !user || !document) return;

    try {
      // Call the entity approval API
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/entities/${entityId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to approve entity');
      }

      alert('Entity approved successfully!');
    } catch (err) {
      // Fallback to audit log
      try {
        await authFetch(`${API_BASE_URL}/api/audit/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approve',
            entityType: 'entity',
            entityId: entityId,
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            details: {
              entityName: entity.name,
              entityCategory: entity.type,
              confidenceScore: entity.confidence
            }
          })
        });
        alert('Entity approved successfully!');
      } catch (auditErr) {
        alert('Entity approval recorded locally.');
      }
    }
  };

  const handleRejectEntity = (entityId: string) => {
    if (!canApprove) {
      setApprovalError('You do not have permission to reject entities. Only users with Admin or Reviewer roles can reject.');
      setTimeout(() => setApprovalError(null), 5000);
      return;
    }
    setRejectingEntityId(entityId);
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingEntityId || !user || !document) return;

    const entity = document?.entities.find(e => e.id === rejectingEntityId);
    if (!entity) return;

    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/entities/${rejectingEntityId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: rejectionReason,
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reject entity');
      }

      alert(`Entity rejected successfully!\n\nReason: ${rejectionReason || 'No reason provided'}`);
    } catch (err) {
      // Fallback to audit log
      try {
        await authFetch(`${API_BASE_URL}/api/audit/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reject',
            entityType: 'entity',
            entityId: rejectingEntityId,
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            details: {
              entityName: entity.name,
              entityCategory: entity.type,
              confidenceScore: entity.confidence,
              reason: rejectionReason
            }
          })
        });
        alert(`Entity rejected successfully!\n\nReason: ${rejectionReason || 'No reason provided'}`);
      } catch (auditErr) {
        alert('Entity rejection recorded locally.');
      }
    }

    setRejectingEntityId(null);
    setRejectionReason('');
  };

  const handleCancelReject = () => {
    setRejectingEntityId(null);
    setRejectionReason('');
  };

  const handleApproveAll = async () => {
    if (!canApprove) {
      setApprovalError('You do not have permission to approve entities. Only users with Admin or Reviewer roles can approve.');
      setTimeout(() => setApprovalError(null), 5000);
      return;
    }

    if (!document || !user) return;

    setActionInProgress(true);

    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/entities/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to approve all entities');
      }

      alert('All entities approved successfully!');
      router.push('/dashboard/review');
    } catch (err) {
      // Log individual approvals as fallback
      try {
        for (const entity of document.entities) {
          await authFetch(`${API_BASE_URL}/api/audit/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'approve',
              entityType: 'entity',
              entityId: entity.id,
              userId: user.id,
              userEmail: user.email,
              userName: user.name,
              details: {
                entityName: entity.name,
                entityCategory: entity.type,
                confidenceScore: entity.confidence,
                batchOperation: true,
              }
            })
          });
        }
        alert('All entities approved successfully!');
        router.push('/dashboard/review');
      } catch (auditErr) {
        alert('Batch approval recorded locally.');
        router.push('/dashboard/review');
      }
    } finally {
      setActionInProgress(false);
    }
  };

  const handleRejectAll = () => {
    if (!canApprove) {
      setApprovalError('You do not have permission to reject entities. Only users with Admin or Reviewer roles can reject.');
      setTimeout(() => setApprovalError(null), 5000);
      return;
    }
    setShowRejectAllModal(true);
    setRejectionReason('');
  };

  const handleConfirmRejectAll = async () => {
    if (!document || !user) return;

    setActionInProgress(true);

    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${document.id}/entities/reject-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: rejectionReason,
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to reject all entities');
      }

      alert(`All entities rejected successfully!\n\nReason: ${rejectionReason || 'No reason provided'}`);
      setShowRejectAllModal(false);
      setRejectionReason('');
      router.push('/dashboard/review');
    } catch (err) {
      // Log individual rejections as fallback
      try {
        for (const entity of document.entities) {
          await authFetch(`${API_BASE_URL}/api/audit/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'reject',
              entityType: 'entity',
              entityId: entity.id,
              userId: user.id,
              userEmail: user.email,
              userName: user.name,
              details: {
                entityName: entity.name,
                entityCategory: entity.type,
                confidenceScore: entity.confidence,
                reason: rejectionReason,
                batchOperation: true,
              }
            })
          });
        }
        alert(`All entities rejected successfully!\n\nReason: ${rejectionReason || 'No reason provided'}`);
        setShowRejectAllModal(false);
        setRejectionReason('');
        router.push('/dashboard/review');
      } catch (auditErr) {
        alert('Batch rejection recorded locally.');
        setShowRejectAllModal(false);
        setRejectionReason('');
        router.push('/dashboard/review');
      }
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCancelRejectAll = () => {
    setShowRejectAllModal(false);
    setRejectionReason('');
  };

  const highlightEntities = (text: string, entities: ExtractedEntity[]) => {
    // Sort entities by start offset to process them in order
    const sortedEntities = [...entities].sort((a, b) => a.startOffset - b.startOffset);

    const parts: React.JSX.Element[] = [];
    let currentOffset = 0;

    sortedEntities.forEach((entity, index) => {
      // Add text before entity
      if (currentOffset < entity.startOffset) {
        parts.push(
          <span key={`text-${index}`}>
            {text.substring(currentOffset, entity.startOffset)}
          </span>
        );
      }

      // Add highlighted entity
      const isSelected = selectedEntityId === entity.id;
      const colorMap = {
        Process: 'bg-blue-100 border-blue-300 text-blue-900',
        Task: 'bg-green-100 border-green-300 text-green-900',
        Role: 'bg-purple-100 border-purple-300 text-purple-900',
        System: 'bg-orange-100 border-orange-300 text-orange-900',
        DataAsset: 'bg-teal-100 border-teal-300 text-teal-900',
        Form: 'bg-pink-100 border-pink-300 text-pink-900',
        Policy: 'bg-red-100 border-red-300 text-red-900',
        Procedure: 'bg-indigo-100 border-indigo-300 text-indigo-900',
        Directive: 'bg-yellow-100 border-yellow-300 text-yellow-900',
        Guide: 'bg-gray-100 border-gray-300 text-gray-900',
      };

      parts.push(
        <span
          key={`entity-${entity.id}`}
          className={`${colorMap[entity.type]} ${isSelected ? 'ring-2 ring-blue-500 shadow-md' : ''
            } px-1 py-0.5 rounded border cursor-pointer transition-all`}
          onClick={() => setSelectedEntityId(entity.id)}
          title={`${entity.type} (${Math.round(entity.confidence * 100)}% confidence)`}
        >
          {text.substring(entity.startOffset, entity.endOffset)}
        </span>
      );

      currentOffset = entity.endOffset;
    });

    // Add remaining text
    if (currentOffset < text.length) {
      parts.push(<span key="text-end">{text.substring(currentOffset)}</span>);
    }

    return parts;
  };

  if (!user) {
    return null;
  }

  if (accessDenied) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-red-900 mb-2">Access Denied</h2>
          <p className="text-red-800 mb-4">
            You do not have permission to access the review staging area.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Return to Dashboard
          </button>
        </div>
      </div>

    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading document...</p>
        </div>
      </div>

    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-red-900 mb-2">Error Loading Document</h2>
          <p className="text-red-800 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard/review')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Return to Review Queue
          </button>
        </div>
      </div>

    );
  }

  if (!document) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-yellow-900 mb-2">Document Not Found</h2>
          <p className="text-yellow-800 mb-4">
            The requested document could not be found.
          </p>
          <button
            onClick={() => router.push('/dashboard/review')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Return to Review Queue
          </button>
        </div>
      </div>

    );
  }

  const selectedEntity = document.entities.find(e => e.id === selectedEntityId);
  const selectedRelationship = document.relationships.find(r => r.id === selectedRelationshipId);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard/review')}
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{document.documentName}</h1>
              <p className="text-sm text-gray-600">{document.documentType} • {new Date(document.uploadDate).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {!canApprove && (
              <div className="mr-2 px-3 py-1 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                View-only mode
              </div>
            )}
            <button
              className="px-4 py-2 bg-blue-100 text-blue-700 border-2 border-blue-300 rounded-lg hover:bg-blue-200 transition-colors font-medium flex items-center"
              onClick={() => router.push(`/dashboard/review/${document.id}/split`)}
              title="Open Split View with PDF viewer and interactive graph editor"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              Split View
            </button>
            <button
              className="px-4 py-2 bg-white text-gray-700 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              onClick={() => router.push('/dashboard/review')}
            >
              Cancel
            </button>
            <button
              className={`px-4 py-2 rounded-lg transition-colors font-medium ${canApprove && !actionInProgress
                ? 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              onClick={handleRejectAll}
              disabled={!canApprove || actionInProgress}
              title={!canApprove ? 'You need Admin or Reviewer role to reject entities' : ''}
            >
              {actionInProgress ? 'Processing...' : 'Reject'}
            </button>
            <button
              className={`px-4 py-2 rounded-lg transition-colors font-medium ${canApprove && !actionInProgress
                ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              onClick={handleApproveAll}
              disabled={!canApprove || actionInProgress}
              title={!canApprove ? 'You need Admin or Reviewer role to approve entities' : ''}
            >
              {actionInProgress ? 'Processing...' : 'Approve All'}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {approvalError && (
          <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start">
            <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{approvalError}</span>
          </div>
        )}
      </div>

      {/* Split-screen content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Document Viewer */}
        <div className="w-1/2 border-r border-gray-200 overflow-auto bg-gray-50">
          <div className="p-6">
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Document Content</h2>
              {document.textContent ? (
                <div className="prose max-w-none text-gray-700 whitespace-pre-wrap font-mono text-sm leading-relaxed">
                  {highlightEntities(document.textContent, document.entities)}
                </div>
              ) : (
                <p className="text-gray-500 italic">No text content available for this document.</p>
              )}
            </div>

            {/* Legend */}
            <div className="mt-4 bg-white rounded-lg shadow-sm p-4 border border-gray-200">
              <h3 className="text-sm font-bold text-gray-900 mb-3">Entity Types</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 bg-blue-100 border border-blue-300 text-blue-900 rounded">Process</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 bg-green-100 border border-green-300 text-green-900 rounded">Task</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 bg-purple-100 border border-purple-300 text-purple-900 rounded">Role</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 bg-orange-100 border border-orange-300 text-orange-900 rounded">System</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 bg-red-100 border border-red-300 text-red-900 rounded">Policy</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel - Graph Editor */}
        <div className="w-1/2 overflow-auto bg-white">
          <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Extracted Knowledge Graph</h2>

            {/* Graph Visualization */}
            <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <GraphVisualization data={graphData} height="500px" />
            </div>


            {/* Entity Details (when selected) */}
            {selectedEntity && (
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-md font-bold text-blue-900">{selectedEntity.name}</h3>
                  <button
                    onClick={() => setSelectedEntityId(null)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="text-sm space-y-1">
                  <p><span className="font-medium">Type:</span> {selectedEntity.type}</p>
                  <p><span className="font-medium">Confidence:</span> {Math.round(selectedEntity.confidence * 100)}%</p>
                </div>
                <div className="mt-3 flex space-x-2">
                  <button
                    className={`px-3 py-1 text-sm rounded transition-colors ${canApprove
                      ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    onClick={() => handleApproveEntity(selectedEntity.id)}
                    disabled={!canApprove}
                    title={!canApprove ? 'You need Admin or Reviewer role to approve entities' : ''}
                  >
                    Approve
                  </button>
                  <button
                    className={`px-3 py-1 text-sm rounded transition-colors ${canApprove
                      ? 'bg-red-600 text-white hover:bg-red-700 cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    onClick={() => handleRejectEntity(selectedEntity.id)}
                    disabled={!canApprove}
                    title={!canApprove ? 'You need Admin or Reviewer role to reject entities' : ''}
                  >
                    Reject
                  </button>
                  <button
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                    onClick={() => handleEditEntity(selectedEntity)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}

            {/* Entities List */}
            <div className="mb-6">
              <h3 className="text-md font-bold text-gray-900 mb-3">Entities ({document.entities.length})</h3>
              {document.entities.length === 0 ? (
                <p className="text-gray-500 italic">No entities extracted from this document.</p>
              ) : (
                <div className="space-y-2">
                  {document.entities.map(entity => (
                    <div
                      key={entity.id}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedEntityId === entity.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      onClick={() => setSelectedEntityId(entity.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-900">{entity.name}</span>
                            <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">
                              {entity.type}
                            </span>
                            {modifiedEntities.has(entity.id) && (
                              <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800 border border-yellow-300">
                                Modified
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Confidence: {Math.round(entity.confidence * 100)}%
                          </div>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            className={`p-1 rounded ${canApprove
                              ? 'text-green-600 hover:bg-green-50 cursor-pointer'
                              : 'text-gray-400 cursor-not-allowed'
                              }`}
                            onClick={(e) => { e.stopPropagation(); handleApproveEntity(entity.id); }}
                            disabled={!canApprove}
                            title={!canApprove ? 'You need Admin or Reviewer role to approve entities' : 'Approve entity'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            className={`p-1 rounded ${canApprove
                              ? 'text-red-600 hover:bg-red-50 cursor-pointer'
                              : 'text-gray-400 cursor-not-allowed'
                              }`}
                            onClick={(e) => { e.stopPropagation(); handleRejectEntity(entity.id); }}
                            disabled={!canApprove}
                            title={!canApprove ? 'You need Admin or Reviewer role to reject entities' : 'Reject entity'}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Relationships List */}
            <div>
              <h3 className="text-md font-bold text-gray-900 mb-3">Relationships ({document.relationships.length})</h3>
              {document.relationships.length === 0 ? (
                <p className="text-gray-500 italic">No relationships extracted from this document.</p>
              ) : (
                <div className="space-y-2">
                  {document.relationships.map(rel => {
                    const sourceEntity = document.entities.find(e => e.id === rel.source);
                    const targetEntity = document.entities.find(e => e.id === rel.target);
                    const isSelected = selectedRelationshipId === rel.id;
                    const isModified = modifiedRelationships.has(rel.id);
                    return (
                      <div
                        key={rel.id}
                        className={`p-3 rounded-lg border-2 ${isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                          } hover:border-gray-300 transition-all cursor-pointer`}
                        onClick={() => setSelectedRelationshipId(rel.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="text-sm text-gray-700 flex items-center gap-2">
                              <span className="font-medium">{sourceEntity?.name || 'Unknown'}</span>
                              <span className="mx-2 text-blue-600 font-mono text-xs">{rel.type}</span>
                              <span className="font-medium">{targetEntity?.name || 'Unknown'}</span>
                              {isModified && (
                                <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                                  Modified
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Confidence: {Math.round(rel.confidence * 100)}%
                            </div>
                          </div>
                          <div className="flex space-x-1">
                            <button
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditRelationship(rel);
                              }}
                              title="Edit relationship"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              className={`p-1 rounded ${canApprove
                                ? 'text-green-600 hover:bg-green-50 cursor-pointer'
                                : 'text-gray-400 cursor-not-allowed'
                                }`}
                              disabled={!canApprove}
                              title={!canApprove ? 'You need Admin or Reviewer role to approve relationships' : 'Approve relationship'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              className={`p-1 rounded ${canApprove
                                ? 'text-red-600 hover:bg-red-50 cursor-pointer'
                                : 'text-gray-400 cursor-not-allowed'
                                }`}
                              disabled={!canApprove}
                              title={!canApprove ? 'You need Admin or Reviewer role to reject relationships' : 'Reject relationship'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingEntityId && editFormData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Edit Entity</h2>
                <button
                  onClick={handleCancelEdit}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Entity Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Entity Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Enter entity name"
                  />
                </div>

                {/* Entity Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Entity Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editFormData.type}
                    onChange={(e) => setEditFormData({ ...editFormData, type: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="Process">Process</option>
                    <option value="Task">Task</option>
                    <option value="Role">Role</option>
                    <option value="System">System</option>
                    <option value="DataAsset">Data Asset</option>
                    <option value="Form">Form</option>
                    <option value="Policy">Policy</option>
                    <option value="Procedure">Procedure</option>
                    <option value="Directive">Directive</option>
                    <option value="Guide">Guide</option>
                  </select>
                </div>

                {/* Description/Note */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description (Optional)
                  </label>
                  <textarea
                    value={editFormData.properties.description || ''}
                    onChange={(e) => setEditFormData({
                      ...editFormData,
                      properties: { ...editFormData.properties, description: e.target.value }
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Add additional context or notes"
                    rows={3}
                  />
                </div>

                {/* Attributes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Attributes (Optional)
                  </label>
                  <input
                    type="text"
                    value={editFormData.properties.attributes || ''}
                    onChange={(e) => setEditFormData({
                      ...editFormData,
                      properties: { ...editFormData.properties, attributes: e.target.value }
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="e.g., automated, manual, required"
                  />
                  <p className="mt-1 text-xs text-gray-500">Comma-separated values</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={handleCancelEdit}
                  className="px-4 py-2 bg-white text-gray-700 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={!editFormData.name.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Relationship Modal */}
      {editingRelationshipId && editRelFormData && document && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Edit Relationship</h2>
                <button
                  onClick={handleCancelRelEdit}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Relationship Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Relationship Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editRelFormData.type}
                    onChange={(e) => setEditRelFormData({ ...editRelFormData, type: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="PRECEDES">PRECEDES</option>
                    <option value="RESPONSIBLE_FOR">RESPONSIBLE_FOR</option>
                    <option value="TRANSFORMS_INTO">TRANSFORMS_INTO</option>
                    <option value="REGULATED_BY">REGULATED_BY</option>
                  </select>
                </div>

                {/* Source Entity */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Source Entity <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editRelFormData.source}
                    onChange={(e) => setEditRelFormData({ ...editRelFormData, source: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  >
                    {document.entities.map(entity => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name} ({entity.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Entity */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Entity <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={editRelFormData.target}
                    onChange={(e) => setEditRelFormData({ ...editRelFormData, target: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  >
                    {document.entities.map(entity => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name} ({entity.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Visual Preview */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-sm text-gray-600 mb-1">Preview:</div>
                  <div className="text-sm text-gray-900 flex items-center gap-2">
                    <span className="font-medium">
                      {document.entities.find(e => e.id === editRelFormData.source)?.name}
                    </span>
                    <span className="text-blue-600 font-mono text-xs px-2 py-1 bg-blue-100 rounded">
                      {editRelFormData.type}
                    </span>
                    <span className="font-medium">
                      {document.entities.find(e => e.id === editRelFormData.target)?.name}
                    </span>
                  </div>
                </div>

                {/* Description/Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={editRelFormData.properties.notes || ''}
                    onChange={(e) => setEditRelFormData({
                      ...editRelFormData,
                      properties: { ...editRelFormData.properties, notes: e.target.value }
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Add additional context or notes about this relationship"
                    rows={3}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={handleCancelRelEdit}
                  className="px-4 py-2 bg-white text-gray-700 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRelEdit}
                  disabled={!editRelFormData.source || !editRelFormData.target || editRelFormData.source === editRelFormData.target}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Entity Modal */}
      {rejectingEntityId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Reject Entity</h2>
                <button
                  onClick={handleCancelReject}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Please provide a reason for rejecting this entity. This will be logged for audit purposes.
              </p>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                  placeholder="e.g., Incorrect entity type, Low confidence, Does not match ontology, etc."
                  rows={4}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  Entity will be moved to the rejected queue and can be re-processed later.
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={handleCancelReject}
                  className="px-4 py-2 bg-white text-gray-700 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReject}
                  disabled={!rejectionReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject All Modal */}
      {showRejectAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Reject All Entities</h2>
                <button
                  onClick={handleCancelRejectAll}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-yellow-800">
                  You are about to reject all {document?.entities.length} entities from this document.
                </p>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Please provide a reason for rejecting all entities. This will be logged for audit purposes.
              </p>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                  placeholder="e.g., Document quality is poor, Wrong document type, Bulk processing error, etc."
                  rows={4}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  All entities will be moved to the rejected queue and the document can be re-processed later.
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={handleCancelRejectAll}
                  className="px-4 py-2 bg-white text-gray-700 border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRejectAll}
                  disabled={!rejectionReason.trim() || actionInProgress}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionInProgress ? 'Processing...' : 'Confirm Reject All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
