// cytoscape-fcose ships no type declarations; declare a minimal shim so the
// TypeScript compiler does not error on `import fcose from 'cytoscape-fcose'`.
declare module 'cytoscape-fcose' {
  import type Cytoscape from 'cytoscape';
  const fcose: Cytoscape.Ext;
  export default fcose;
}
