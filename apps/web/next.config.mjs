import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(appDir, "../..");

const nextConfig = {
  output: "standalone",
  turbopack: {
    root: repoRoot
  }
};

export default nextConfig;
