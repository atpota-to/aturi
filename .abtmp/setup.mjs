import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
register('../scripts/alias-resolve.mjs', import.meta.url);
