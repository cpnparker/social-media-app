/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    // @huggingface/transformers (wake-phrase detection) ships a Node build
    // that pulls in the onnxruntime-node native binary — webpack can't parse
    // it during the server compile. It's only ever used client-side (WASM),
    // so keep it out of the server bundle entirely.
    serverComponentsExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  },
  webpack: (config) => {
    // Client bundle: never resolve the Node ONNX runtime or sharp —
    // transformers.js uses the WASM backend in the browser.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node$": false,
      sharp$: false,
    };
    return config;
  },
};

export default nextConfig;
