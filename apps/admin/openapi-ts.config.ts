import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../backend/swagger.json',
  output: 'src/api/generated',
  types: {
    enums: 'typescript',
  },
});
