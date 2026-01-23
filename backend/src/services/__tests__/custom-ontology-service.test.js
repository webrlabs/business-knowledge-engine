const { CustomOntologyService } = require('../custom-ontology-service');
const cosmos = require('../../storage/cosmos');

jest.mock('../../storage/cosmos');
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    errorWithStack: jest.fn()
  }
}));

describe('CustomOntologyService', () => {
  let service;

  beforeEach(() => {
    service = new CustomOntologyService();
    jest.clearAllMocks();
  });

  describe('addCustomEntityType', () => {
    it('should create a custom entity type', async () => {
      const def = { name: 'NewType', label: 'New Type' };
      
      cosmos.queryDocuments.mockResolvedValue([]); // No existing type
      cosmos.createDocument.mockResolvedValue({ 
        id: '123', 
        ...def, 
        documentType: 'custom_entity_type' 
      });

      const result = await service.addCustomEntityType(def);

      expect(result.name).toBe('NewType');
      expect(cosmos.createDocument).toHaveBeenCalledWith(expect.objectContaining({
        name: 'NewType',
        documentType: 'custom_entity_type'
      }));
    });

    it('should throw if type already exists', async () => {
      const def = { name: 'ExistingType' };
      
      cosmos.queryDocuments.mockResolvedValue([{ name: 'ExistingType' }]);

      await expect(service.addCustomEntityType(def))
        .rejects.toThrow('already exists');
    });
  });

  describe('getCustomEntityTypes', () => {
    it('should return all custom types', async () => {
      cosmos.queryDocuments.mockResolvedValue([
        { name: 'Type1', documentType: 'custom_entity_type', _rid: '1' },
        { name: 'Type2', documentType: 'custom_entity_type', _rid: '2' }
      ]);

      const types = await service.getCustomEntityTypes();

      expect(types).toHaveLength(2);
      expect(types[0]).not.toHaveProperty('_rid'); // Should be sanitized
      expect(types[0].name).toBe('Type1');
    });
  });

  describe('deleteCustomEntityType', () => {
    it('should delete a custom type', async () => {
      cosmos.queryDocuments.mockResolvedValue([{ id: '123', name: 'TypeToDelete' }]);
      cosmos.deleteDocument.mockResolvedValue(true);

      const result = await service.deleteCustomEntityType('TypeToDelete');

      expect(result).toBe(true);
      expect(cosmos.deleteDocument).toHaveBeenCalledWith('123');
    });

    it('should return false if type not found', async () => {
      cosmos.queryDocuments.mockResolvedValue([]);

      const result = await service.deleteCustomEntityType('NonExistent');

      expect(result).toBe(false);
      expect(cosmos.deleteDocument).not.toHaveBeenCalled();
    });
  });

  // ==================== Custom Relationship Type Tests ====================
  // Feature: F4.3.5 - Custom Relationship Definitions

  describe('addCustomRelationshipType', () => {
    it('should create a custom relationship type with domain/range constraints', async () => {
      const def = {
        name: 'COLLABORATES_WITH',
        label: 'collaborates with',
        description: 'Indicates collaboration between entities',
        domain: 'Person',
        range: 'Person'
      };

      cosmos.queryDocuments.mockResolvedValue([]); // No existing type
      cosmos.createDocument.mockResolvedValue({
        id: '456',
        ...def,
        domain: ['Person'],
        range: ['Person'],
        documentType: 'custom_relationship_type'
      });

      const result = await service.addCustomRelationshipType(def);

      expect(result.name).toBe('COLLABORATES_WITH');
      expect(result.domain).toEqual(['Person']);
      expect(result.range).toEqual(['Person']);
      expect(cosmos.createDocument).toHaveBeenCalledWith(expect.objectContaining({
        name: 'COLLABORATES_WITH',
        documentType: 'custom_relationship_type',
        domain: ['Person'],
        range: ['Person']
      }));
    });

    it('should accept array domain/range constraints', async () => {
      const def = {
        name: 'MANAGES',
        domain: ['Person', 'Team'],
        range: ['Project', 'Task']
      };

      cosmos.queryDocuments.mockResolvedValue([]);
      cosmos.createDocument.mockResolvedValue({
        id: '789',
        ...def,
        documentType: 'custom_relationship_type'
      });

      const result = await service.addCustomRelationshipType(def);

      expect(result.domain).toEqual(['Person', 'Team']);
      expect(result.range).toEqual(['Project', 'Task']);
    });

    it('should throw if name is missing', async () => {
      const def = { domain: 'Person', range: 'Task' };

      await expect(service.addCustomRelationshipType(def))
        .rejects.toThrow('Relationship type name is required');
    });

    it('should throw if name is not UPPER_SNAKE_CASE', async () => {
      const def = { name: 'collaboratesWith', domain: 'Person', range: 'Person' };

      await expect(service.addCustomRelationshipType(def))
        .rejects.toThrow('UPPER_SNAKE_CASE');
    });

    it('should throw if domain is missing', async () => {
      const def = { name: 'TEST_REL', range: 'Person' };

      await expect(service.addCustomRelationshipType(def))
        .rejects.toThrow('Domain (source entity type) is required');
    });

    it('should throw if range is missing', async () => {
      const def = { name: 'TEST_REL', domain: 'Person' };

      await expect(service.addCustomRelationshipType(def))
        .rejects.toThrow('Range (target entity type) is required');
    });

    it('should throw if relationship type already exists', async () => {
      const def = { name: 'EXISTING_REL', domain: 'Person', range: 'Task' };

      cosmos.queryDocuments.mockResolvedValue([{ name: 'EXISTING_REL' }]);

      await expect(service.addCustomRelationshipType(def))
        .rejects.toThrow('already exists');
    });

    it('should set default values for optional fields', async () => {
      const def = {
        name: 'SIMPLE_REL',
        domain: 'Entity',
        range: 'Entity'
      };

      cosmos.queryDocuments.mockResolvedValue([]);
      cosmos.createDocument.mockImplementation(doc => Promise.resolve(doc));

      const result = await service.addCustomRelationshipType(def);

      expect(result.label).toBe('simple rel');
      expect(result.description).toBe('');
      expect(result.category).toBe('Custom');
      expect(result.bidirectional).toBe(false);
      expect(result.inverse).toBe(null);
    });
  });

  describe('getCustomRelationshipTypes', () => {
    it('should return all custom relationship types', async () => {
      cosmos.queryDocuments.mockResolvedValue([
        { name: 'REL1', domain: ['Person'], range: ['Task'], documentType: 'custom_relationship_type', _rid: '1' },
        { name: 'REL2', domain: ['Team'], range: ['Project'], documentType: 'custom_relationship_type', _rid: '2' }
      ]);

      const types = await service.getCustomRelationshipTypes();

      expect(types).toHaveLength(2);
      expect(types[0]).not.toHaveProperty('_rid'); // Should be sanitized
      expect(types[0].name).toBe('REL1');
      expect(types[1].name).toBe('REL2');
    });

    it('should return empty array on error', async () => {
      cosmos.queryDocuments.mockRejectedValue(new Error('DB error'));

      const types = await service.getCustomRelationshipTypes();

      expect(types).toEqual([]);
    });
  });

  describe('getCustomRelationshipTypeByName', () => {
    it('should return relationship type by name', async () => {
      cosmos.queryDocuments.mockResolvedValue([
        { name: 'FOUND_REL', domain: ['Person'], range: ['Task'] }
      ]);

      const result = await service.getCustomRelationshipTypeByName('FOUND_REL');

      expect(result.name).toBe('FOUND_REL');
    });

    it('should return null if not found', async () => {
      cosmos.queryDocuments.mockResolvedValue([]);

      const result = await service.getCustomRelationshipTypeByName('NOT_FOUND');

      expect(result).toBeNull();
    });
  });

  describe('updateCustomRelationshipType', () => {
    it('should update an existing relationship type', async () => {
      const existing = { id: '123', name: 'UPDATE_REL', domain: ['Person'], range: ['Task'] };
      const updates = { description: 'Updated description', range: ['Project'] };

      cosmos.queryDocuments.mockResolvedValue([existing]);
      cosmos.updateDocument.mockResolvedValue({ ...existing, ...updates, range: ['Project'] });

      const result = await service.updateCustomRelationshipType('UPDATE_REL', updates);

      expect(result.description).toBe('Updated description');
      expect(result.range).toEqual(['Project']);
      expect(cosmos.updateDocument).toHaveBeenCalledWith('123', expect.objectContaining({
        name: 'UPDATE_REL',
        range: ['Project']
      }));
    });

    it('should throw if relationship type not found', async () => {
      cosmos.queryDocuments.mockResolvedValue([]);

      await expect(service.updateCustomRelationshipType('NOT_FOUND', {}))
        .rejects.toThrow('not found');
    });

    it('should throw if trying to change the name', async () => {
      cosmos.queryDocuments.mockResolvedValue([{ id: '123', name: 'ORIGINAL' }]);

      await expect(service.updateCustomRelationshipType('ORIGINAL', { name: 'CHANGED' }))
        .rejects.toThrow('Cannot change relationship type name');
    });

    it('should normalize domain/range to arrays when updating', async () => {
      const existing = { id: '123', name: 'NORM_REL', domain: ['Person'], range: ['Task'] };

      cosmos.queryDocuments.mockResolvedValue([existing]);
      cosmos.updateDocument.mockImplementation((id, doc) => Promise.resolve(doc));

      const result = await service.updateCustomRelationshipType('NORM_REL', { domain: 'Team' });

      expect(result.domain).toEqual(['Team']);
    });
  });

  describe('deleteCustomRelationshipType', () => {
    it('should delete a custom relationship type', async () => {
      cosmos.queryDocuments.mockResolvedValue([{ id: '123', name: 'TO_DELETE' }]);
      cosmos.deleteDocument.mockResolvedValue(true);

      const result = await service.deleteCustomRelationshipType('TO_DELETE');

      expect(result).toBe(true);
      expect(cosmos.deleteDocument).toHaveBeenCalledWith('123');
    });

    it('should return false if relationship type not found', async () => {
      cosmos.queryDocuments.mockResolvedValue([]);

      const result = await service.deleteCustomRelationshipType('NOT_FOUND');

      expect(result).toBe(false);
      expect(cosmos.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('validateCustomRelationship', () => {
    it('should return valid for matching domain/range', async () => {
      cosmos.queryDocuments.mockResolvedValue([{
        name: 'VALID_REL',
        domain: ['Person'],
        range: ['Task']
      }]);

      const result = await service.validateCustomRelationship('VALID_REL', 'Person', 'Task');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid for domain violation', async () => {
      cosmos.queryDocuments.mockResolvedValue([{
        name: 'STRICT_REL',
        domain: ['Person'],
        range: ['Task']
      }]);

      const result = await service.validateCustomRelationship('STRICT_REL', 'Team', 'Task');

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Source type "Team" is not in the allowed domain');
    });

    it('should return invalid for range violation', async () => {
      cosmos.queryDocuments.mockResolvedValue([{
        name: 'STRICT_REL',
        domain: ['Person'],
        range: ['Task']
      }]);

      const result = await service.validateCustomRelationship('STRICT_REL', 'Person', 'Document');

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Target type "Document" is not in the allowed range');
    });

    it('should accept Entity as wildcard', async () => {
      cosmos.queryDocuments.mockResolvedValue([{
        name: 'GENERIC_REL',
        domain: ['Entity'],
        range: ['Entity']
      }]);

      const result = await service.validateCustomRelationship('GENERIC_REL', 'AnyType', 'OtherType');

      expect(result.valid).toBe(true);
    });

    it('should skip validation for non-custom types', async () => {
      cosmos.queryDocuments.mockResolvedValue([]);

      const result = await service.validateCustomRelationship('CORE_TYPE', 'Person', 'Task');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getCustomRelationshipTypesByCategory', () => {
    it('should group relationship types by category', async () => {
      cosmos.queryDocuments.mockResolvedValue([
        { name: 'REL1', category: 'Social', domain: ['Person'], range: ['Person'] },
        { name: 'REL2', category: 'Social', domain: ['Person'], range: ['Person'] },
        { name: 'REL3', category: 'Work', domain: ['Person'], range: ['Task'] }
      ]);

      const result = await service.getCustomRelationshipTypesByCategory();

      expect(result.Social).toHaveLength(2);
      expect(result.Work).toHaveLength(1);
    });

    it('should use "Custom" as default category', async () => {
      cosmos.queryDocuments.mockResolvedValue([
        { name: 'REL1', domain: ['Person'], range: ['Task'] } // No category
      ]);

      const result = await service.getCustomRelationshipTypesByCategory();

      expect(result.Custom).toHaveLength(1);
    });
  });
});
