/**
 * Tests for GraphService entity version history lookup.
 *
 * Feature: F2.3.5 - Entity History API
 */

const { GraphService } = require('../graph-service');

describe('GraphService getEntityVersionHistoryById', () => {
  it('should return ordered versions from oldest to newest', async () => {
    const service = new GraphService();

    const entitiesById = {
      'v1': {
        id: 'v1',
        name: 'Legacy System',
        temporalStatus: 'superseded',
        supersededBy: 'v2',
      },
      'v2': {
        id: 'v2',
        name: 'Modern System',
        temporalStatus: 'superseded',
        supersedes: 'v1',
        supersededBy: 'v3',
      },
      'v3': {
        id: 'v3',
        name: 'Current System',
        temporalStatus: 'current',
        supersedes: 'v2',
      },
    };

    service.findVertexById = jest.fn(async (id) => entitiesById[id] || null);

    const versions = await service.getEntityVersionHistoryById('v2');

    expect(versions.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(versions[2].isCurrentVersion).toBe(true);
    expect(service.findVertexById).toHaveBeenCalled();
  });

  it('should return empty array when entity is not found', async () => {
    const service = new GraphService();
    service.findVertexById = jest.fn(async () => null);

    const versions = await service.getEntityVersionHistoryById('missing-id');

    expect(versions).toEqual([]);
  });
});
