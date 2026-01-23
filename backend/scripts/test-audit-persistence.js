/**
 * Test script for Audit Persistence Service (F5.1.2)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../configs/backend.env') });
const { getAuditPersistenceService } = require('../src/services/audit-persistence-service');
const { log } = require('../src/utils/logger');

async function runTest() {
  console.log('Starting Audit Persistence Test...');

  const service = getAuditPersistenceService();
  const timestamp = new Date().toISOString();
  const testId = `test-${Date.now()}`;

  // Test 1: Create generic log
  console.log('\nTest 1: Create generic audit log');
  try {
    const entry = {
      action: 'test_action',
      entityType: 'test_entity',
      entityId: testId,
      user: {
        id: 'test-user-1',
        name: 'Test User',
        email: 'test@example.com'
      },
      details: {
        testRun: true,
        data: 'foo'
      }
    };

    const saved = await service.createLog(entry);
    console.log('✅ Log created:', saved.id);
    
    if (saved.entityId !== testId) throw new Error('Entity ID mismatch');
    if (saved.userId !== 'test-user-1') throw new Error('User ID mismatch');
  } catch (error) {
    console.error('❌ Failed to create log:', error);
    process.exit(1);
  }

  // Test 2: Query logs
  console.log('\nTest 2: Query logs');
  try {
    const logs = await service.queryLogs({
      entityId: testId,
      entityType: 'test_entity'
    });
    
    console.log(`✅ Found ${logs.length} logs for entity ${testId}`);
    if (logs.length === 0) throw new Error('No logs found');
    if (logs[0].action !== 'test_action') throw new Error('Action mismatch');
  } catch (error) {
    console.error('❌ Failed to query logs:', error);
    process.exit(1);
  }

  // Test 3: Log denial (F5.1.3)
  console.log('\nTest 3: Log access denial');
  try {
    const denial = {
      documentId: testId,
      reason: 'insufficient_permissions',
      requiredPermission: 'admin',
      name: 'Secret Doc'
    };
    
    const user = {
      id: 'hacker-1',
      name: 'Bad Actor'
    };

    const savedDenial = await service.logDenial(denial, user);
    console.log('✅ Denial logged:', savedDenial.id);
    
    if (savedDenial.action !== 'ACCESS_DENIED') throw new Error('Action mismatch');
    if (savedDenial.details.reason !== 'insufficient_permissions') throw new Error('Reason mismatch');
  } catch (error) {
    console.error('❌ Failed to log denial:', error);
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!');
}

runTest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
