import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../backend/swagger.json',
  output: 'src/api/generated',
  client: '@hey-api/client-axios',
  types: {
    enums: 'typescript',
  },
});
