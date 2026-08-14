import SwaggerParser from '@apidevtools/swagger-parser';

const api = await SwaggerParser.validate('openapi.yaml');
const operations = Object.values(api.paths || {}).reduce((count, path) => count + Object.keys(path).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);

if (api.openapi !== '3.1.0') throw new Error(`openapi-check: expected OpenAPI 3.1.0, received ${api.openapi}`);
if (!api.paths?.['/api/health'] || !api.paths?.['/api/projects'] || !api.paths?.['/api/projects/{id}/generate']) throw new Error('openapi-check: core API paths are missing');
if (operations < 30) throw new Error(`openapi-check: expected at least 30 documented operations, received ${operations}`);

console.log(`openapi-check: valid OpenAPI ${api.openapi}, paths=${Object.keys(api.paths).length}, operations=${operations}`);
