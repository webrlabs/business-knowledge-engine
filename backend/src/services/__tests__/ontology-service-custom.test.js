const { OntologyService, getOntologyService } = require('../ontology-service');
const { getCustomOntologyService } = require('../custom-ontology-service');
const fs = require('fs');
const path = require('path');

jest.mock('../custom-ontology-service');
jest.mock('fs');
jest.mock('path');

// Mock ontology data
const mockOntologyData = {
  "@id": "https://business-knowledge-engine.io/ontology/business-process",
  "@type": "owl:Ontology",
  "label": "Business Knowledge Engine Ontology",
  "@graph": [
    { "@id": "bke:Entity", "@type": "rdfs:Class" },
    { "@id": "bke:Process", "@type": "rdfs:Class", "subClassOf": "bke:Entity" }
  ]
};

describe('OntologyService - Custom Types', () => {
  let service;
  let mockCustomService;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup FS mocks
    path.resolve.mockReturnValue('/mock/path/ontology.jsonld');
    fs.readFileSync.mockReturnValue(JSON.stringify(mockOntologyData));

    // Setup Custom Ontology Service mock
    mockCustomService = {
      getCustomEntityTypes: jest.fn().mockResolvedValue([]),
      addCustomEntityType: jest.fn(),
      deleteCustomEntityType: jest.fn()
    };
    getCustomOntologyService.mockReturnValue(mockCustomService);

    service = new OntologyService();
  });

  it('should load custom types during initialization', async () => {
    mockCustomService.getCustomEntityTypes.mockResolvedValue([
      { name: 'Vendor', label: 'Vendor', parentType: 'Entity' }
    ]);

    await service.initialize();

    expect(service.entityTypes.has('Vendor')).toBe(true);
    expect(service.entityTypes.get('Vendor').isCustom).toBe(true);
    expect(service.entityTypes.get('Entity').children).toContain('Vendor');
  });

  it('should add a custom entity type via addCustomEntityType', async () => {
    await service.initialize();

    const def = { name: 'NewType', parentType: 'Process' };
    mockCustomService.addCustomEntityType.mockResolvedValue(def);

    await service.addCustomEntityType(def);

    expect(mockCustomService.addCustomEntityType).toHaveBeenCalledWith(def);
    expect(service.entityTypes.has('NewType')).toBe(true);
    expect(service.entityTypes.get('NewType').parent).toBe('Process');
    // Verify hierarchy update
    expect(service.entityTypes.get('Process').children).toContain('NewType');
  });

  it('should delete a custom entity type via deleteCustomEntityType', async () => {
    mockCustomService.getCustomEntityTypes.mockResolvedValue([
      { name: 'Vendor', label: 'Vendor', parentType: 'Entity' }
    ]);
    
    await service.initialize();
    
    expect(service.entityTypes.has('Vendor')).toBe(true);

    await service.deleteCustomEntityType('Vendor');

    expect(mockCustomService.deleteCustomEntityType).toHaveBeenCalledWith('Vendor');
    expect(service.entityTypes.has('Vendor')).toBe(false);
    expect(service.entityTypes.get('Entity').children).not.toContain('Vendor');
  });

  it('should throw when deleting a core type', async () => {
    await service.initialize();
    
    await expect(service.deleteCustomEntityType('Process'))
      .rejects.toThrow('core type and cannot be deleted');
  });
});
