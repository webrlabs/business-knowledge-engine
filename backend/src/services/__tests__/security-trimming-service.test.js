const {
  SecurityTrimmingService,
  createSecurityTrimmingService,
  CLASSIFICATION_LEVELS,
  ROLE_CLASSIFICATION_ACCESS,
} = require('../security-trimming-service');

describe('Security Trimming Service', () => {
  let service;

  beforeEach(() => {
    service = createSecurityTrimmingService({ enabled: true });
  });

  describe('filterSearchResults', () => {
    const mockResults = [
      { id: '1', title: 'Public Doc', classification: 'public', content: 'Test content 1' },
      { id: '2', title: 'Internal Doc', classification: 'internal', content: 'Test content 2' },
      { id: '3', title: 'Confidential Doc', classification: 'confidential', content: 'Test content 3' },
      { id: '4', title: 'Restricted Doc', classification: 'restricted', content: 'Test content 4' },
    ];

    it('should allow admins to access all documents', () => {
      const adminUser = { roles: ['Admin'], groups: [] };
      const { filteredResults, accessSummary } = service.filterSearchResults(mockResults, adminUser);

      expect(filteredResults).toHaveLength(4);
      expect(accessSummary.allowed).toBe(4);
      expect(accessSummary.denied).toBe(0);
    });

    it('should filter based on Reader role classification', () => {
      const readerUser = { roles: ['Reader'], groups: [] };
      const { filteredResults, denied } = service.filterSearchResults(mockResults, readerUser);

      // Readers can access public and internal
      expect(filteredResults).toHaveLength(2);
      expect(filteredResults.map((r) => r.id)).toEqual(['1', '2']);
      expect(denied).toHaveLength(2);
    });

    it('should filter based on Reviewer role classification', () => {
      const reviewerUser = { roles: ['Reviewer'], groups: [] };
      const { filteredResults } = service.filterSearchResults(mockResults, reviewerUser);

      // Reviewers can access up to confidential
      expect(filteredResults).toHaveLength(3);
      expect(filteredResults.map((r) => r.id)).toEqual(['1', '2', '3']);
    });

    it('should filter based on group membership', () => {
      const results = [
        { id: '1', title: 'HR Doc', allowedGroups: ['HR', 'Management'] },
        { id: '2', title: 'Public Doc', allowedGroups: [] },
        { id: '3', title: 'Engineering Doc', allowedGroups: ['Engineering'] },
      ];

      const hrUser = { roles: ['Contributor'], groups: ['HR'] };
      const { filteredResults } = service.filterSearchResults(results, hrUser);

      expect(filteredResults).toHaveLength(2);
      expect(filteredResults.map((r) => r.id)).toEqual(['1', '2']);
    });

    it('should handle null user', () => {
      const { filteredResults } = service.filterSearchResults(mockResults, null);

      // No user means no access (except public in some cases)
      expect(filteredResults.length).toBeLessThan(mockResults.length);
    });

    it('should return all results when disabled', () => {
      const disabledService = createSecurityTrimmingService({ enabled: false });
      const readerUser = { roles: ['Reader'], groups: [] };
      const { filteredResults } = disabledService.filterSearchResults(mockResults, readerUser);

      expect(filteredResults).toHaveLength(4);
    });
  });

  describe('filterGraphEntities', () => {
    const mockEntities = [
      { id: 'e1', name: 'Approved Entity', status: 'approved' },
      { id: 'e2', name: 'Pending Entity', status: 'pending_review' },
      { id: 'e3', name: 'Rejected Entity', status: 'rejected' },
    ];

    it('should allow admins to see all entities', () => {
      const adminUser = { roles: ['Admin'], groups: [] };
      const { filteredEntities } = service.filterGraphEntities(mockEntities, adminUser);

      expect(filteredEntities).toHaveLength(3);
    });

    it('should filter pending entities for non-reviewers', () => {
      const contributorUser = { roles: ['Contributor'], groups: [] };
      const { filteredEntities, denied } = service.filterGraphEntities(mockEntities, contributorUser);

      expect(filteredEntities).toHaveLength(1);
      expect(filteredEntities[0].id).toBe('e1');
      expect(denied).toHaveLength(2);
    });

    it('should allow reviewers to see pending entities', () => {
      const reviewerUser = { roles: ['Reviewer'], groups: [] };
      const { filteredEntities } = service.filterGraphEntities(mockEntities, reviewerUser);

      expect(filteredEntities).toHaveLength(3);
    });
  });

  describe('filterGraphRelationships', () => {
    const mockRelationships = [
      { from: 'e1', to: 'e2', label: 'RELATED_TO' },
      { from: 'e1', to: 'e3', label: 'RELATED_TO' },
      { from: 'e2', to: 'e3', label: 'RELATED_TO' },
    ];

    it('should only include relationships with both endpoints accessible', () => {
      const allowedEntityIds = ['e1', 'e2'];
      const filtered = service.filterGraphRelationships(mockRelationships, allowedEntityIds);

      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toEqual({ from: 'e1', to: 'e2', label: 'RELATED_TO' });
    });

    it('should include all relationships when all entities are accessible', () => {
      const allowedEntityIds = ['e1', 'e2', 'e3'];
      const filtered = service.filterGraphRelationships(mockRelationships, allowedEntityIds);

      expect(filtered).toHaveLength(3);
    });

    it('should return empty array when no entities are accessible', () => {
      const filtered = service.filterGraphRelationships(mockRelationships, []);

      expect(filtered).toHaveLength(0);
    });
  });

  describe('buildSearchFilter', () => {
    it('should build classification filter for Reader', () => {
      const readerUser = { roles: ['Reader'], groups: [] };
      const filter = service.buildSearchFilter(readerUser);

      expect(filter).toContain('classification');
      expect(filter).toContain('public');
      expect(filter).toContain('internal');
    });

    it('should include group filter when user has groups', () => {
      const userWithGroups = { roles: ['Contributor'], groups: ['HR', 'Finance'] };
      const filter = service.buildSearchFilter(userWithGroups);

      expect(filter).toContain('allowedGroups');
      expect(filter).toContain('HR');
      expect(filter).toContain('Finance');
    });

    it('should return null for admin users', () => {
      const adminUser = { roles: ['Admin'], groups: [] };
      const filter = service.buildSearchFilter(adminUser);

      // Admins should have no filter restrictions
      expect(filter).toBeNull();
    });

    it('should return null when disabled', () => {
      const disabledService = createSecurityTrimmingService({ enabled: false });
      const filter = disabledService.buildSearchFilter({ roles: ['Reader'], groups: [] });

      expect(filter).toBeNull();
    });
  });

  describe('checkDocumentAccess', () => {
    it('should allow access to public documents', () => {
      const doc = { classification: 'public' };
      const user = { roles: ['Reader'], groups: [] };
      const result = service.checkDocumentAccess(doc, user);

      expect(result.allowed).toBe(true);
    });

    it('should deny access to restricted documents for non-admins', () => {
      const doc = { classification: 'restricted' };
      const user = { roles: ['Reviewer'], groups: [] };
      const result = service.checkDocumentAccess(doc, user);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('classification_denied');
    });

    it('should deny access based on group restrictions', () => {
      const doc = { allowedGroups: ['Engineering'] };
      const user = { roles: ['Contributor'], groups: ['HR'] };
      const result = service.checkDocumentAccess(doc, user);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('group_denied');
    });
  });

  describe('Sensitive field trimming', () => {
    it('should remove internal metadata for non-reviewers', () => {
      const results = [
        {
          id: '1',
          title: 'Doc',
          internalNotes: 'Secret notes',
          reviewerComments: 'Review comments',
          processingMetadata: { key: 'value' },
        },
      ];

      const contributorUser = { roles: ['Contributor'], groups: [] };
      const { filteredResults } = service.filterSearchResults(results, contributorUser);

      expect(filteredResults[0].internalNotes).toBeUndefined();
      expect(filteredResults[0].reviewerComments).toBeUndefined();
      expect(filteredResults[0].processingMetadata).toBeUndefined();
    });

    it('should keep internal metadata for reviewers', () => {
      const results = [
        {
          id: '1',
          title: 'Doc',
          internalNotes: 'Secret notes',
        },
      ];

      const reviewerUser = { roles: ['Reviewer'], groups: [] };
      const { filteredResults } = service.filterSearchResults(results, reviewerUser);

      expect(filteredResults[0].internalNotes).toBe('Secret notes');
    });
  });

  describe('Denial logging', () => {
    it('should log denials when auditDenials is true', () => {
      const results = [{ id: '1', classification: 'restricted' }];
      const user = { id: 'user1', roles: ['Reader'], groups: [] };

      service.filterSearchResults(results, user);

      const log = service.getDenialLog();
      expect(log).toHaveLength(1);
      expect(log[0].documentId).toBe('1');
      expect(log[0].userId).toBe('user1');
      expect(log[0].reason).toBe('classification_denied');
    });

    it('should clear denial log', () => {
      const results = [{ id: '1', classification: 'restricted' }];
      service.filterSearchResults(results, { roles: ['Reader'], groups: [] });

      service.clearDenialLog();

      expect(service.getDenialLog()).toHaveLength(0);
    });
  });

  describe('Role hierarchy', () => {
    it('should use highest role in hierarchy', () => {
      const userWithMultipleRoles = { roles: ['Reader', 'Reviewer'], groups: [] };
      const results = [{ id: '1', classification: 'confidential' }];

      const { filteredResults } = service.filterSearchResults(results, userWithMultipleRoles);

      // Should use Reviewer access (higher than Reader)
      expect(filteredResults).toHaveLength(1);
    });
  });

  describe('Department restrictions', () => {
    it('should filter based on department', () => {
      const results = [
        { id: '1', restrictedToDepartment: 'Engineering' },
        { id: '2', restrictedToDepartment: 'HR' },
      ];

      const engineeringUser = { roles: ['Contributor'], groups: [], department: 'Engineering' };
      const { filteredResults } = service.filterSearchResults(results, engineeringUser);

      expect(filteredResults).toHaveLength(1);
      expect(filteredResults[0].id).toBe('1');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty results array', () => {
      const { filteredResults, accessSummary } = service.filterSearchResults(
        [],
        { roles: ['Reader'], groups: [] }
      );

      expect(filteredResults).toHaveLength(0);
      expect(accessSummary.total).toBe(0);
    });

    it('should handle null results', () => {
      const { filteredResults } = service.filterSearchResults(null, { roles: ['Reader'], groups: [] });

      expect(filteredResults).toHaveLength(0);
    });

    it('should handle documents without classification', () => {
      const results = [{ id: '1', title: 'No classification' }];
      const user = { roles: ['Reader'], groups: [] };

      const { filteredResults } = service.filterSearchResults(results, user);

      // Documents without classification default to 'internal'
      expect(filteredResults).toHaveLength(1);
    });
  });
});
