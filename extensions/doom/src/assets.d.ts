declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.wasm" {
  const content: string; // base64-encoded
  export default content;
}

declare module "*.jsdos" {
  const content: string; // base64-encoded
  export default content;
}
