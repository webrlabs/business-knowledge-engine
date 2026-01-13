const swaggerSpecs = require('./src/swagger');

console.log('OpenAPI Specification:');
console.log('Version:', swaggerSpecs.openapi);
console.log('Title:', swaggerSpecs.info.title);
console.log('');
console.log('Documented Endpoints:');

if (swaggerSpecs.paths) {
  Object.keys(swaggerSpecs.paths).forEach(path => {
    const methods = Object.keys(swaggerSpecs.paths[path]);
    methods.forEach(method => {
      const endpoint = swaggerSpecs.paths[path][method];
      console.log(`  ${method.toUpperCase()} ${path}`);
      console.log(`    Summary: ${endpoint.summary || 'N/A'}`);
      console.log(`    Tags: ${(endpoint.tags || []).join(', ')}`);
    });
  });
  console.log('');
  console.log(`Total endpoints documented: ${Object.keys(swaggerSpecs.paths).length}`);
} else {
  console.log('No paths found in specification!');
}
