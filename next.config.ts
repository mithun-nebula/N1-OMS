import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Vertex authenticates through `google-auth-library`, which Next otherwise
   * tries to bundle and fails on — two open issues in `vercel/ai` describe it.
   * Without this the build dies with an error that looks nothing like an auth
   * problem, so it is worth the line even though it reads like boilerplate.
   */
  serverExternalPackages: ["google-auth-library", "gaxios"],
};

export default nextConfig;
