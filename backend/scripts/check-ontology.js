require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initializeOntologyService } = require('../src/services/ontology-service');

async function checkOntology() {
  console.log('=== ONTOLOGY INTEGRATION CHECK ===');
  console.log('');

  const ontology = await initializeOntologyService();

  // Check entity types
  console.log('ENTITY TYPES (F2.1.1):');
  console.log('  Total defined:', ontology.entityTypes.size);
  const entityTypesList = Array.from(ontology.entityTypes.keys());
  console.log('  Types:', entityTypesList.join(', '));
  console.log('');

  // Check relationship types
  console.log('RELATIONSHIP TYPES (F2.1.1):');
  console.log('  Total defined:', ontology.relationshipTypes.size);
  const relTypesList = Array.from(ontology.relationshipTypes.keys());
  console.log('  Types:', relTypesList.slice(0, 12).join(', '), '...');
  console.log('');

  // Check type hierarchy
  console.log('TYPE HIERARCHY (F2.1.2):');
  const subtypes = ontology.expandTypeWithSubtypes('Activity');
  console.log('  Activity expands to:', subtypes);
  console.log('');

  // Check domain/range constraints for a relationship
  console.log('DOMAIN/RANGE CONSTRAINTS (F2.1.3):');
  const managesInfo = ontology.relationshipTypes.get('MANAGES');
  if (managesInfo) {
    console.log('  MANAGES:');
    console.log('    Domain:', managesInfo.domain);
    console.log('    Range:', managesInfo.range);
  }
  const reportsToInfo = ontology.relationshipTypes.get('REPORTS_TO');
  if (reportsToInfo) {
    console.log('  REPORTS_TO:');
    console.log('    Domain:', reportsToInfo.domain);
    console.log('    Range:', reportsToInfo.range);
  }
  console.log('');

  // Test validation
  console.log('VALIDATION SERVICE (F2.1.4):');
  const validResult = ontology.validateEntityType('Department');
  console.log('  Validate "Department":', validResult.valid ? 'VALID' : 'INVALID');

  const invalidResult = ontology.validateEntityType('FakeType');
  console.log('  Validate "FakeType":', invalidResult.valid ? 'VALID' : 'INVALID');

  const relValidResult = ontology.validateRelationship('MANAGES', 'Role', 'Department');
  console.log('  Validate MANAGES(Role->Department):', relValidResult.valid ? 'VALID' : 'INVALID');
  if (!relValidResult.valid) {
    console.log('    Errors:', relValidResult.errors);
  }
  console.log('');

  // Check version
  console.log('ONTOLOGY VERSION (F2.2.1):');
  const versionInfo = ontology.getVersionInfo();
  console.log('  Version:', versionInfo?.version || 'N/A');
  console.log('  Label:', versionInfo?.label || 'N/A');
  console.log('');

  // Check deprecation support
  console.log('DEPRECATION SUPPORT (F2.2.3):');
  const deprecatedTypes = ontology.getDeprecatedTypes();
  console.log('  Deprecated types:', deprecatedTypes.length > 0 ? deprecatedTypes : 'None');
}

checkOntology().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
